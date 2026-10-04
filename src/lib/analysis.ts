import { Chess } from 'chess.js';
import type { AnalyzedMove, EngineEval, ImportedGame, MoveQuality, OpeningInfo, PieceColor } from './types';
import { analyzePositions, evalToPawns, evalToWinChance, resetEngine } from './engine';
import { getMoveHistory } from './pgn';
import { BookWalker } from './openings';
import { detectSacrifice } from './sacrifice';
import { markOnlyMoves } from './only-move';

/**
 * Tuned to land close to Chess.com Game Review with in-browser Stockfish lite.
 *
 * Chess.com runs much deeper server-side Stockfish, so the same move often
 * shows a larger win%-loss there than here. We compensate with:
 *   1. A small depth-compensation multiplier on win%-loss
 *   2. Stricter classification thresholds
 *   3. A harsher power-mean (p = 0.3) so mistakes pull accuracy down more
 *
 * You still will not match Chess.com move-for-move; aim for same ranking and
 * accuracy within ~3–5 points on most games.
 */

/** Lichess per-move accuracy curve from win%-loss points. */
function moveAccuracyFromWinLoss(winPercentLoss: number): number {
  const raw = 103.1668 * Math.exp(-0.04354 * winPercentLoss) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

/** White's win% reframed from the mover's perspective. */
function winPercentFor(ev: EngineEval, color: PieceColor): number {
  const whiteWin = evalToWinChance(ev);
  return color === 'w' ? whiteWin : 100 - whiteWin;
}

/**
 * Depth compensation: lite SF underestimates tactical swings vs Chess.com.
 * Scale win%-loss up slightly so classification + accuracy behave closer to
 * a deeper engine. Clamp so we never invent absurd losses.
 */
function effectiveWinLoss(raw: number): number {
  return Math.min(100, raw * 1.25);
}

export function classifyMove(
  evalBefore: EngineEval,
  evalAfter: EngineEval,
  playedMove: string,
  color: PieceColor,
  isBook: boolean,
  san: string,
  fenBefore: string,
): { quality: MoveQuality; delta: number; isBest: boolean; evalLoss: number; winPercentLoss: number } {
  const beforePawns = evalToPawns(evalBefore);
  const afterPawns = evalToPawns(evalAfter);
  const delta = Math.abs(beforePawns - afterPawns);

  const sign = color === 'w' ? 1 : -1;
  const evalLoss = Math.max(0, sign * (beforePawns - afterPawns));

  const winBefore = winPercentFor(evalBefore, color);
  const winAfter = winPercentFor(evalAfter, color);
  const rawWinLoss = Math.max(0, winBefore - winAfter);
  // Store the compensated value so accuracy + UI both use the same number
  const winPercentLoss = effectiveWinLoss(rawWinLoss);

  const isBest = evalBefore.bestMove !== null && playedMove === evalBefore.bestMove;

  if (isBook) {
    return { quality: 'book', delta, isBest, evalLoss, winPercentLoss };
  }

  // Miss: winning position given away
  const playerMate =
    evalBefore.mate !== null
      ? color === 'w'
        ? evalBefore.mate
        : -evalBefore.mate
      : null;
  const hadForcedWin = playerMate !== null && playerMate > 0;
  const hadWin = hadForcedWin || winBefore > 88;
  if (hadWin && !isBest && winPercentLoss > 6) {
    return { quality: 'miss', delta, isBest, evalLoss, winPercentLoss };
  }

  // Brilliant: a real material sacrifice that keeps (or gains) the advantage.
  //  - the move gives up material once the engine's line plays out (>= 2 pts)
  //  - it is the best move, or within 1.5 win% of it (depth-12 can disagree
  //    with itself on top-1 in sharp positions)
  //  - the mover wasn't already winning big or had a forced mate (no credit
  //    for sacrificing when everything wins)
  //  - the mover is still OK afterwards (>= 50% win chance)
  const nearBest = isBest || rawWinLoss < 1.5;
  if (nearBest && !hadForcedWin && winBefore < 85 && winAfter >= 50) {
    if (detectSacrifice(fenBefore, playedMove, evalAfter.continuation, color)) {
      return { quality: 'brilliant', delta, isBest, evalLoss, winPercentLoss };
    }
  }

  // Great (rare; only on best moves)
  if (isBest) {
    const foundCrushing = winBefore < 55 && winAfter > 90 && rawWinLoss < 0.5;
    if (foundCrushing) return { quality: 'great', delta, isBest, evalLoss, winPercentLoss };
  }

  // Stricter thresholds (Chess.com-like)
  if (winPercentLoss < 0.4) return { quality: 'best', delta, isBest, evalLoss, winPercentLoss };
  if (winPercentLoss < 1.2) return { quality: 'excellent', delta, isBest, evalLoss, winPercentLoss };
  if (winPercentLoss < 2.5) return { quality: 'good', delta, isBest, evalLoss, winPercentLoss };
  if (winPercentLoss < 6) return { quality: 'inaccuracy', delta, isBest, evalLoss, winPercentLoss };
  if (winPercentLoss < 12) return { quality: 'mistake', delta, isBest, evalLoss, winPercentLoss };
  return { quality: 'blunder', delta, isBest, evalLoss, winPercentLoss };
}

/**
 * Analyze a whole game.
 *
 * Speed-ups vs. the old sequential version:
 *   1. Every position is searched exactly ONCE. Move i's "before" eval is
 *      move i-1's "after" eval (same position), so we no longer search each
 *      position twice.
 *   2. All positions are known up front from the PGN, so they're handed to
 *      the engine worker pool in one batch and searched in parallel.
 *
 * Results are identical to the old code at the same depth; only the time
 * taken changes. `onProgress(done, total)` counts positions (moves + 1).
 *
 * After classification, a short second pass (markOnlyMoves) re-searches only
 * the candidate "best" moves with 2 engine lines and upgrades the ones where
 * every alternative is clearly worse to 'great' (the only move that works).
 */
export async function analyzeGame(
  game: ImportedGame,
  depth: number,
  onProgress?: (current: number, total: number) => void,
): Promise<AnalyzedMove[]> {
  await resetEngine();
  const history = getMoveHistory(game.pgn);
  if (history.length === 0) return [];

  // Pass 1: walk the game once (cheap, no engine) to collect every position.
  // fens[0] = start position, fens[i + 1] = position after move i.
  // Start from the game's own first position (handles [FEN]/[SetUp] games too).
  const startFen: string = history[0].before ?? new Chess().fen();
  const walker = new Chess(startFen);
  const fens: string[] = [walker.fen()];
  const standardStart = startFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w');
  for (const move of history) {
    walker.move(move.san);
    fens.push(walker.fen());
  }

  // Pass 2: search all positions in parallel across the worker pool.
  // Results come back in order; a position that failed is null.
  const evals = await analyzePositions(fens, depth, onProgress);

  // Pass 3: classify (pure CPU, effectively instant).
  const analyzed: AnalyzedMove[] = [];
  const book = new BookWalker();

  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    const color: PieceColor = move.color;
    const fenBefore = fens[i];
    const fenAfter = fens[i + 1];
    const evalBefore = evals[i];
    const evalAfter = evals[i + 1];

    const isBook = standardStart ? book.step(move.lan) : false;
    const opening = isBook ? book.current() : null;

    if (evalBefore && evalAfter) {
      const { quality, delta, isBest, evalLoss, winPercentLoss } = classifyMove(
        evalBefore,
        evalAfter,
        move.lan,
        color,
        isBook,
        move.san,
        fenBefore,
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
  }

  // Pass 4: "great" = the only move that works. Re-searches candidate
  // positions with 2 lines. Never let a failure here break the analysis.
  try {
    await markOnlyMoves(analyzed, depth, (done, total) =>
      onProgress?.(fens.length + done, fens.length + total),
    );
  } catch (e) {
    console.warn('Only-move detection skipped', e);
  }

  return analyzed;
}

export function getOpening(moves: AnalyzedMove[]): OpeningInfo | null {
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].opening) return moves[i].opening;
  }
  return null;
}

/**
 * Accuracy close to Chess.com:
 * - Per-move score from Lichess curve (on compensated win%-loss)
 * - Power mean p = 0.3 so mistakes hurt more than a plain average
 * - Volatility weights: sharp moments count more
 */
export function computeAccuracy(moves: AnalyzedMove[]): { white: number; black: number } {
  const scored = moves.filter(
    (m) => m.quality !== 'book' && m.winPercentLoss !== null && m.evalAfter,
  );
  if (scored.length === 0) return { white: 0, black: 0 };

  const perMoveAccuracy = scored.map((m) =>
    moveAccuracyFromWinLoss(m.winPercentLoss as number),
  );

  const winPercents = scored.map((m) => evalToWinChance(m.evalAfter as EngineEval));
  const windowSize = Math.min(8, Math.max(2, Math.floor(winPercents.length / 10)));
  const weights = winPercents.map((_, i) => {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(winPercents.length, i + windowSize + 1);
    const windowVals = winPercents.slice(start, end);
    const mean = windowVals.reduce((a, b) => a + b, 0) / windowVals.length;
    const variance =
      windowVals.reduce((a, b) => a + (b - mean) ** 2, 0) / windowVals.length;
    return Math.max(0.5, Math.min(10, Math.sqrt(variance)));
  });

  function aggregate(color: PieceColor): number {
    const idxs: number[] = [];
    scored.forEach((m, i) => {
      if (m.color === color) idxs.push(i);
    });
    if (idxs.length === 0) return 0;

    const p = 0.3;
    let weightedPowerSum = 0;
    let weightSum = 0;
    for (const i of idxs) {
      const a = Math.max(perMoveAccuracy[i], 0.1);
      const w = weights[i];
      weightedPowerSum += w * Math.pow(a, p);
      weightSum += w;
    }
    const powerMean = Math.pow(weightedPowerSum / weightSum, 1 / p);
    return Math.round(Math.max(0, Math.min(100, powerMean)));
  }

  return { white: aggregate('w'), black: aggregate('b') };
}

export function computeACPL(moves: AnalyzedMove[]): { white: number; black: number } {
  let whiteSum = 0,
    whiteCount = 0,
    blackSum = 0,
    blackCount = 0;
  for (const m of moves) {
    if (m.evalLoss === null || m.quality === 'book') continue;
    const cpl = Math.round(m.evalLoss * 100);
    if (m.color === 'w') {
      whiteSum += cpl;
      whiteCount++;
    } else {
      blackSum += cpl;
      blackCount++;
    }
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