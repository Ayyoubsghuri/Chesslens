import { Chess } from 'chess.js';
import type { AnalyzedMove, EngineEval, ImportedGame, MoveQuality, OpeningInfo, PieceColor } from './types';
import { analyzePosition, evalToPawns, evalToWinChance, resetEngine } from './engine';
import { getMoveHistory } from './pgn';
import { BookWalker } from './openings';

/**
 * ── Why this file changed ────────────────────────────────────────────────
 * The previous version classified moves using FIXED PAWN thresholds
 * (e.g. "evalLoss > 0.6 pawns = inaccuracy") and computed accuracy from a
 * lookup table of fixed weights per category (best=100, good=60, ...).
 *
 * Both of those diverge badly from chess.com/Lichess, for the same reason:
 * neither of them accounts for the position. A 0.6 pawn swing is a real
 * inaccuracy in an equal position, but meaningless noise at +6 (both sides
 * are still ~99% to win either way). Chess.com/Lichess grade moves by how
 * much WIN PROBABILITY the move costs, not a flat pawn amount — so we do
 * the same here, using the corrected evalToWinChance() from engine.ts.
 *
 * Accuracy is likewise now the continuous exponential decay curve
 * Lichess/chess.com actually use on win%-loss, instead of snapping every
 * move onto one of ~10 fixed scores (which crushed the spread between
 * players toward the same mediocre number).
 * ──────────────────────────────────────────────────────────────────────────
 */

/** Win-probability points (0-100) lost by the mover → per-move accuracy (0-100). */
function moveAccuracyFromWinLoss(winPercentLoss: number): number {
  const raw = 103.1668 * Math.exp(-0.04354 * winPercentLoss) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

/** White's win% for a position, reframed from `color`'s perspective. */
function winPercentFor(ev: EngineEval, color: PieceColor): number {
  const whiteWin = evalToWinChance(ev);
  return color === 'w' ? whiteWin : 100 - whiteWin;
}

function classifyMove(
  evalBefore: EngineEval,
  evalAfter: EngineEval,
  playedMove: string,
  color: PieceColor,
  isBook: boolean,
  san: string,
): { quality: MoveQuality; delta: number; isBest: boolean; evalLoss: number; winPercentLoss: number } {
  const beforePawns = evalToPawns(evalBefore);
  const afterPawns = evalToPawns(evalAfter);
  const delta = Math.abs(beforePawns - afterPawns);

  const sign = color === 'w' ? 1 : -1;
  // evalLoss = raw eval drop in pawns, from the player's perspective (always >= 0).
  // Kept around for ACPL, which is conventionally reported in centipawns.
  const evalLoss = Math.max(0, sign * (beforePawns - afterPawns));

  // winLoss = win-probability points given up by this move, from the mover's
  // own perspective. This is what actually drives classification & accuracy.
  const winBefore = winPercentFor(evalBefore, color);
  const winAfter = winPercentFor(evalAfter, color);
  const winPercentLoss = Math.max(0, winBefore - winAfter);

  const isBest = evalBefore.bestMove !== null && playedMove === evalBefore.bestMove;

  // ── Book: matched against the real lichess-org/chess-openings dataset,
  // not a heuristic. See BookWalker in ./openings. ──
  if (isBook) {
    return { quality: 'book', delta, isBest, evalLoss, winPercentLoss };
  }

  // ── Miss: had a winning position and let it slip ──
  const playerMate = evalBefore.mate !== null
    ? (color === 'w' ? evalBefore.mate : -evalBefore.mate)
    : null;
  const hadForcedWin = playerMate !== null && playerMate > 0;
  const hadWin = hadForcedWin || winBefore > 90;
  if (hadWin && !isBest && winPercentLoss > 10) {
    return { quality: 'miss', delta, isBest, evalLoss, winPercentLoss };
  }

  // ── Brilliant / Great: only for truly special best moves ──
  // (FIX: previously required evalLoss === 0 exactly, which floating-point
  // engine output essentially never hits — these categories were dead code.
  // Using a small win%-loss tolerance instead makes them actually fire.)
  if (isBest) {
    const isSacrifice =
      san.includes('x') &&
      winBefore < 60 &&
      winAfter - winBefore > 15 &&
      winPercentLoss < 0.5;
    if (isSacrifice) return { quality: 'brilliant', delta, isBest, evalLoss, winPercentLoss };

    const foundCrushing =
      winBefore < 55 && winAfter > 90 && winPercentLoss < 0.5;
    if (foundCrushing) return { quality: 'great', delta, isBest, evalLoss, winPercentLoss };
  }

  // ── Win%-loss thresholds (Lichess/chess.com-style; NOT flat pawn amounts) ──
  // These scale with how decided the position already is, since losing the
  // same # of pawns matters far less in a already-winning/losing position.
  if (winPercentLoss < 0.5) return { quality: 'best', delta, isBest, evalLoss, winPercentLoss };
  if (winPercentLoss < 2)   return { quality: 'excellent', delta, isBest, evalLoss, winPercentLoss };
  if (winPercentLoss < 5)   return { quality: 'good', delta, isBest, evalLoss, winPercentLoss };
  if (winPercentLoss < 10)  return { quality: 'inaccuracy', delta, isBest, evalLoss, winPercentLoss };
  if (winPercentLoss < 20)  return { quality: 'mistake', delta, isBest, evalLoss, winPercentLoss };
  return { quality: 'blunder', delta, isBest, evalLoss, winPercentLoss };
}

export async function analyzeGame(
  game: ImportedGame,
  depth: number,
  onProgress?: (current: number, total: number) => void,
): Promise<AnalyzedMove[]> {
  await resetEngine(); // ← FIX: clear hash so every run is identical
  const history = getMoveHistory(game.pgn);
  if (history.length === 0) return [];

  const chess = new Chess();
  const analyzed: AnalyzedMove[] = [];
  const book = new BookWalker();

  for (let i = 0; i < history.length; i++) {
    const fenBefore = chess.fen();
    const evalBefore = await analyzePosition(fenBefore, depth).catch(() => null);

    const move = history[i];
    chess.move(move.san);
    const fenAfter = chess.fen();
    const evalAfter = await analyzePosition(fenAfter, depth).catch(() => null);

    const color: PieceColor = move.color;

    // move.lan is chess.js's long algebraic notation, e.g. "e2e4" / "e7e8q" —
    // the same "from+to+promotion" shape the opening trie is keyed on, so once
    // we fall off the book path (returns false) we stay off it for the rest
    // of the game, matching chess.com / lichess opening classification.
    const isBook = book.step(move.lan);
    const opening = isBook ? book.current() : null;

    if (evalBefore && evalAfter) {
      const { quality, delta, isBest, evalLoss, winPercentLoss } = classifyMove(
        evalBefore, evalAfter, move.lan, color, isBook, move.san,
      );
      analyzed.push({
        index: i,
        color,
        san: move.san,
        fenBefore,
        fenAfter,
        evalBefore,
        evalAfter,
        quality,
        evalDelta: delta,
        evalLoss,
        winPercentLoss,
        isBestMove: isBest,
        isCheck: move.san.includes('+'),
        opening,
      });
    } else {
      analyzed.push({
        index: i,
        color,
        san: move.san,
        fenBefore,
        fenAfter,
        evalBefore,
        evalAfter,
        quality: isBook ? 'book' : 'good',
        evalDelta: null,
        evalLoss: null,
        winPercentLoss: null,
        isBestMove: false,
        isCheck: move.san.includes('+'),
        opening,
      });
    }

    onProgress?.(i + 1, history.length);
  }

  return analyzed;
}

/** Deepest named opening reached anywhere in the game's book run, or null. */
export function getOpening(moves: AnalyzedMove[]): OpeningInfo | null {
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].opening) return moves[i].opening;
  }
  return null;
}

/**
 * Chess.com/Lichess-style accuracy.
 *
 * ── Why a plain average is wrong ──────────────────────────────────────────
 * Per-move accuracy (moveAccuracyFromWinLoss) is correct on its own, but
 * averaging those scores with a plain arithmetic mean is NOT what
 * chess.com/Lichess do, and it systematically overstates accuracy. In a
 * normal game, most moves are "best"/"good" and score ~85-100; a couple of
 * real mistakes score ~40-60. A plain mean lets the pile of routine 95s
 * dilute the mistakes down to almost nothing.
 *
 * The real algorithm combines two different means:
 *   1. A WEIGHTED MEAN, where each move's weight is the local volatility
 *      (std-dev) of the win% around that move in a rolling window — sharp,
 *      critical moments count for more than quiet, already-decided ones.
 *   2. The HARMONIC MEAN of the same per-move scores, which — unlike an
 *      arithmetic mean — is dragged down hard by a single bad move (a 40
 *      pulls a harmonic mean down far more than it pulls an arithmetic one).
 * The final accuracy is the average of those two, which is what actually
 * makes one blunder visibly tank the number instead of being absorbed.
 * ──────────────────────────────────────────────────────────────────────────
 */
export function computeAccuracy(moves: AnalyzedMove[]): { white: number; black: number } {
  const scored = moves.filter((m) => m.quality !== 'book' && m.winPercentLoss !== null && m.evalAfter);
  if (scored.length === 0) return { white: 0, black: 0 };

  // Win% (White's perspective) after each scored move, in game order — used
  // purely to measure how "sharp"/volatile the game is at each point.
  const winPercents = scored.map((m) => evalToWinChance(m.evalAfter as EngineEval));
  const perMoveAccuracy = scored.map((m) => moveAccuracyFromWinLoss(m.winPercentLoss as number));

  const windowSize = Math.min(8, Math.max(2, Math.floor(winPercents.length / 10)));
  const weights = winPercents.map((_, i) => {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(winPercents.length, i + windowSize + 1);
    const windowVals = winPercents.slice(start, end);
    const mean = windowVals.reduce((a, b) => a + b, 0) / windowVals.length;
    const variance = windowVals.reduce((a, b) => a + (b - mean) ** 2, 0) / windowVals.length;
    // Clamp so a totally dead-quiet game and a wild tactical game both stay
    // in a sane weighting range rather than washing everything out.
    return Math.max(0.5, Math.min(12, Math.sqrt(variance)));
  });

  function aggregate(color: PieceColor): number {
    const idxs: number[] = [];
    scored.forEach((m, i) => { if (m.color === color) idxs.push(i); });
    if (idxs.length === 0) return 0;

    let weightedSum = 0, weightSum = 0, harmonicDenom = 0;
    for (const i of idxs) {
      weightedSum += perMoveAccuracy[i] * weights[i];
      weightSum += weights[i];
      harmonicDenom += 1 / Math.max(perMoveAccuracy[i], 0.1); // floor avoids divide-by-zero on a 0-score blunder
    }
    const weightedMean = weightSum ? weightedSum / weightSum : 0;
    const harmonicMean = idxs.length / harmonicDenom;

    return Math.round((weightedMean + harmonicMean) / 2);
  }

  return { white: aggregate('w'), black: aggregate('b') };
}

export function computeACPL(moves: AnalyzedMove[]): { white: number; black: number } {
  let whiteSum = 0, whiteCount = 0, blackSum = 0, blackCount = 0;
  for (const m of moves) {
    if (m.evalLoss === null || m.quality === 'book') continue;
    const cpl = Math.round(m.evalLoss * 100);
    if (m.color === 'w') { whiteSum += cpl; whiteCount++; }
    else { blackSum += cpl; blackCount++; }
  }
  return {
    white: whiteCount ? Math.round(whiteSum / whiteCount) : 0,
    black: blackCount ? Math.round(blackSum / blackCount) : 0,
  };
}

export function countByQuality(moves: AnalyzedMove[]) {
  return {
    blunders: moves.filter((m) => m.quality === 'blunder').length,
    mistakes: moves.filter((m) => m.quality === 'mistake').length,
    inaccuracies: moves.filter((m) => m.quality === 'inaccuracy').length,
    bestMoves: moves.filter((m) => m.quality === 'best').length,
    greatMoves: moves.filter((m) => m.quality === 'great').length,
    brilliantMoves: moves.filter((m) => m.quality === 'brilliant').length,
    excellentMoves: moves.filter((m) => m.quality === 'excellent').length,
    goodMoves: moves.filter((m) => m.quality === 'good').length,
    missMoves: moves.filter((m) => m.quality === 'miss').length,
    bookMoves: moves.filter((m) => m.quality === 'book').length,
  };
}