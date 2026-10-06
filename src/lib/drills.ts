import { Chess } from 'chess.js';
import type { AnalyzedMove, Drill } from './types';

/** Longest drill: my move, reply, my move, reply, my move. */
const MAX_PLIES = 5;

/**
 * Build one drill per mistake/blunder.
 * - ids are stable (position + move number) so "completed" survives tab switches and reloads
 * - the solution is the engine line, trimmed to legal moves and to END on the player's move
 */
export function generateDrills(moves: AnalyzedMove[]): Drill[] {
  const drills: Drill[] = [];

  for (const move of moves) {
    if (move.quality !== 'blunder' && move.quality !== 'mistake') continue;
    const best = move.evalBefore?.bestMove;
    if (!best) continue;

    const raw = (move.evalBefore?.continuation ?? '').split(/\s+/).filter(Boolean);
    const line = raw[0] === best ? raw : [best];

    // Keep only legal moves
    const chess = new Chess(move.fenBefore);
    const legal: string[] = [];
    for (const uci of line.slice(0, MAX_PLIES)) {
      try {
        const r = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
        if (!r) break;
        legal.push(uci);
      } catch { break; }
    }
    if (legal.length === 0) continue;
    if (legal.length % 2 === 0) legal.pop(); // must end on the player's move

    const isWhite = move.color === 'w';
    drills.push({
      id: `${move.fenBefore}#${move.index}`,
      fen: move.fenBefore,
      theme: inferTheme(move),
      description: `Find the best move for ${isWhite ? 'White' : 'Black'} instead of ${move.san}.`,
      solutionMoves: legal,
      sourceMoveIndex: move.index,
      difficulty: move.quality === 'blunder' ? 'hard' : 'medium',
    });
  }

  return drills;
}

function inferTheme(move: AnalyzedMove): string {
  const san = move.san;
  if (san.includes('x')) return 'Tactical capture';
  if (san.includes('+')) return 'Check evasion';
  if (san.includes('O-O')) return 'Castling decision';
  if (move.evalDelta && move.evalDelta > 5) return 'Missed tactic';
  return 'Positional improvement';
}