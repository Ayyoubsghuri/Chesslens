import { Chess, type Square } from 'chess.js';
import { analyzePosition, evalToPawns, playMove } from '@/lib/engine';
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

/**
 * Pick a reply for the computer at roughly the given Elo.
 * One search, weakened by Stockfish itself (see playMove in engine.ts), so it stays fast and
 * never floods the CPU. Beginners also have a chance of just playing a random legal move.
 */
export async function pickComputerMove(fen: string, elo: number): Promise<SimpleMove | null> {
  const legal = new Chess(fen).moves({ verbose: true });
  if (legal.length === 0) return null;

  const fromVerbose = (m: (typeof legal)[number]) => applyUci(fen, m.from + m.to + (m.promotion ?? ''));
  const randomMove = () => fromVerbose(legal[Math.floor(Math.random() * legal.length)]);

  if (legal.length === 1) return fromVerbose(legal[0]);

  const blunderP = elo < 1000 ? ((1000 - elo) / 600) * 0.3 : 0;
  if (Math.random() < blunderP) return randomMove();

  try {
    const uci = await playMove(fen, elo);
    const m = uci ? applyUci(fen, uci) : null;
    if (m) return m;
  } catch (e) {
    console.error('Computer move failed, playing a random move', e);
  }
  return randomMove();
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