import { Chess } from 'chess.js';
import type { AnalyzedMove, EngineEval } from './types';
import { analyzeSecondBest, evalToWinChance } from './engine';

/** The 2nd-best move must be worth at least this many win% less than the best move. */
const MIN_GAP = 15;
/** The mover must still be OK after the move (otherwise nothing worked). */
const MIN_WIN_AFTER = 30;
/** Skip positions that are already totally won / lost (the move doesn't matter). */
const TRIVIAL_ABOVE = 95;
const TRIVIAL_BELOW = 5;

const moverWin = (ev: EngineEval, color: 'w' | 'b') => {
  const white = evalToWinChance(ev);
  return color === 'w' ? white : 100 - white;
};

function destination(fen: string, san: string): string | null {
  try {
    return new Chess(fen).move(san).to;
  } catch {
    return null;
  }
}

/**
 * "Great" = the engine's best move AND every other move is clearly worse:
 * the only move that solves the problem / keeps the advantage.
 * Upgrades matching 'best' moves to 'great' in place. Only candidate positions
 * are searched a second time (with 2 lines), so this stays cheap.
 */
export async function markOnlyMoves(
  moves: AnalyzedMove[],
  depth: number,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const candidates = moves.filter((m, i) => {
    if (m.quality !== 'best' || !m.isBestMove || !m.evalBefore) return false;

    const win = moverWin(m.evalBefore, m.color);
    if (win > TRIVIAL_ABOVE || win < TRIVIAL_BELOW) return false;

    // Forced moves (one legal move) are not "great".
    try {
      if (new Chess(m.fenBefore).moves().length <= 1) return false;
    } catch {
      return false;
    }

    // Obvious recaptures (taking back on the square just captured on) are not "great".
    const prev = moves[i - 1];
    if (prev && m.san.includes('x') && prev.san.includes('x')) {
      const to = destination(m.fenBefore, m.san);
      if (to && to === destination(prev.fenBefore, prev.san)) return false;
    }
    return true;
  });
  if (candidates.length === 0) return;

  const results = await analyzeSecondBest(
    candidates.map((m) => m.fenBefore),
    depth,
    onProgress,
  );

  candidates.forEach((m, i) => {
    const r = results[i];
    // Need a real 2nd line, and both searches must agree on the best move.
    if (!r || !r.second || r.bestMove !== m.evalBefore?.bestMove) return;

    const bestWin = moverWin(r, m.color);
    const secondWin = moverWin({ ...r, evaluation: r.second.evaluation, mate: r.second.mate }, m.color);

    if (bestWin >= MIN_WIN_AFTER && bestWin - secondWin >= MIN_GAP) {
      m.quality = 'great';
    }
  });
}
