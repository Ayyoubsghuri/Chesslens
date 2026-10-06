import { Chess, type Square } from 'chess.js';
import { analyzePosition, analyzePositions, evalToPawns } from '@/lib/engine';
import { classifyMove } from '@/lib/analysis';
import type { EngineEval, MoveQuality, PieceColor } from '@/lib/types';

/** Moves that count as "fine" when playing vs the computer. */
export const ACCEPTABLE: MoveQuality[] = ['book', 'brilliant', 'great', 'best', 'excellent', 'good'];
/** Moves that count as "found it" when hunting the best move. */
export const BEST_TIER: MoveQuality[] = ['brilliant', 'great', 'best'];
/** Moves that mean "you went wrong" in a game. */
export const ERROR_QUALITIES: MoveQuality[] = ['inaccuracy', 'mistake', 'blunder', 'miss'];

export const QUALITY_LABEL: Record<string, string> = {
  brilliant: 'Brilliant', great: 'Great move', best: 'Best move', excellent: 'Excellent',
  good: 'Good', book: 'Book move', inaccuracy: 'Inaccuracy', mistake: 'Mistake',
  blunder: 'Blunder', miss: 'Missed win',
};

export interface SimpleMove {
  uci: string;
  san: string;
  from: Square;
  to: Square;
  promotion?: string;
  fen: string;
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Apply a UCI move to a FEN. Returns null if illegal. */
export function applyUci(fen: string, uci: string): SimpleMove | null {
  try {
    const c = new Chess(fen);
    const r = c.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    if (!r) return null;
    return { uci, san: r.san, from: r.from as Square, to: r.to as Square, promotion: r.promotion, fen: c.fen() };
  } catch {
    return null;
  }
}

/** from/to squares of a SAN move played in a position. */
export function sanCoords(fenBefore: string, san: string): { from: Square; to: Square } | null {
  try {
    const r = new Chess(fenBefore).move(san);
    return r ? { from: r.from as Square, to: r.to as Square } : null;
  } catch {
    return null;
  }
}

export function colorOfFen(fen: string): PieceColor {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** Eval in pawns from the mover's point of view, clamped so mates don't explode the maths. */
export function moverPawns(ev: EngineEval | null | undefined, color: PieceColor): number | null {
  if (!ev) return null;
  const v = (color === 'w' ? 1 : -1) * evalToPawns(ev);
  return Math.max(-15, Math.min(15, v));
}

export interface JudgedMove {
  move: SimpleMove;
  color: PieceColor;
  quality: MoveQuality;
  isBest: boolean;
  evalBefore: EngineEval;
  evalAfter: EngineEval;
  winPercentLoss: number;
  evalLoss: number;
}

/**
 * Grade one move the same way the analysis does.
 * Fast paths: engine's best move, or a move that mates, skip the second search.
 */
export async function judgeMove(
  fenBefore: string,
  uci: string,
  depth: number,
  knownBefore?: EngineEval | null,
): Promise<JudgedMove> {
  const move = applyUci(fenBefore, uci);
  if (!move) throw new Error('Illegal move');
  const color = colorOfFen(fenBefore);
  const evalBefore = knownBefore ?? (await analyzePosition(fenBefore, depth));

  const mates = new Chess(move.fen).isCheckmate();
  if (mates || evalBefore.bestMove === uci) {
    return { move, color, quality: 'best', isBest: true, evalBefore, evalAfter: evalBefore, winPercentLoss: 0, evalLoss: 0 };
  }

  const evalAfter = await analyzePosition(move.fen, depth);
  const r = classifyMove(evalBefore, evalAfter, uci, color, false, move.san, fenBefore);
  return {
    move, color, quality: r.quality, isBest: r.isBest,
    evalBefore, evalAfter, winPercentLoss: r.winPercentLoss, evalLoss: r.evalLoss,
  };
}

/* ------------------------------------------------------------------ */
/* Computer opponent with an Elo dial                                  */
/* ------------------------------------------------------------------ */

function depthForElo(elo: number): number {
  if (elo < 700) return 1;
  if (elo < 1100) return 2;
  if (elo < 1500) return 3;
  if (elo < 1900) return 4;
  if (elo < 2300) return 6;
  return 8;
}

/** Higher temperature = more willing to play an inferior move. */
function temperatureForElo(elo: number): number {
  return Math.max(0.02, 3 * Math.exp(-(elo - 400) / 450));
}

/**
 * Pick a reply for the computer at roughly the given Elo.
 * Every legal move is searched shallowly, then one is sampled with a
 * softmax: weak settings often pick second-rate moves (and sometimes pure
 * blunders), strong settings nearly always pick the best one.
 */
export async function pickComputerMove(fen: string, elo: number): Promise<SimpleMove | null> {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  if (legal.length === 0) return null;

  const fromVerbose = (m: (typeof legal)[number]): SimpleMove => {
    const c = new Chess(fen);
    c.move(m.san);
    return { uci: m.from + m.to + (m.promotion ?? ''), san: m.san, from: m.from as Square, to: m.to as Square, promotion: m.promotion, fen: c.fen() };
  };

  if (legal.length === 1) return fromVerbose(legal[0]);

  if (elo >= 2400) {
    try {
      const ev = await analyzePosition(fen, 12);
      const best = ev.bestMove ? applyUci(fen, ev.bestMove) : null;
      if (best) return best;
    } catch { /* fall through to the sampling path */ }
  }

  // Beginners sometimes just play something random.
  const blunderP = elo < 1000 ? ((1000 - elo) / 600) * 0.3 : 0;
  if (Math.random() < blunderP) return fromVerbose(legal[Math.floor(Math.random() * legal.length)]);

  const mover = chess.turn();
  const sign = mover === 'w' ? 1 : -1;
  const cands = legal.map((m) => {
    const c = new Chess(fen);
    c.move(m.san);
    return { m, fen: c.fen(), mate: c.isCheckmate(), draw: c.isGameOver() && !c.isCheckmate() };
  });

  const search = cands.filter((c) => !c.mate && !c.draw);
  let evals: (EngineEval | null)[] = [];
  try {
    evals = await analyzePositions(search.map((c) => c.fen), depthForElo(elo));
  } catch {
    return fromVerbose(legal[Math.floor(Math.random() * legal.length)]);
  }

  const scores = new Map<string, number>();
  search.forEach((c, i) => {
    const ev = evals[i];
    scores.set(c.fen, ev ? Math.max(-15, Math.min(15, sign * evalToPawns(ev))) : 0);
  });
  const scored = cands.map((c) => ({
    c,
    s: c.mate ? 20 : c.draw ? 0 : scores.get(c.fen) ?? 0,
  }));

  const T = temperatureForElo(elo);
  const max = Math.max(...scored.map((x) => x.s));
  const weights = scored.map((x) => Math.exp((x.s - max) / T));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i];
    if (r <= 0) return fromVerbose(scored[i].c.m);
  }
  return fromVerbose(scored[0].c.m);
}

export function gameOverText(fen: string): string | null {
  const c = new Chess(fen);
  if (!c.isGameOver()) return null;
  if (c.isCheckmate()) return `Checkmate — ${c.turn() === 'w' ? 'Black' : 'White'} wins`;
  if (c.isStalemate()) return 'Draw by stalemate';
  if (c.isThreefoldRepetition()) return 'Draw by repetition';
  if (c.isInsufficientMaterial()) return 'Draw — insufficient material';
  return 'Draw';
}
