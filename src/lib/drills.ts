import type { AnalyzedMove, Drill } from './types';

export function generateDrills(moves: AnalyzedMove[]): Drill[] {
  const drills: Drill[] = [];

  for (const move of moves) {
    if (move.quality === 'blunder' || move.quality === 'mistake') {
      const isPlayerWhite = move.color === 'w';
      const theme = inferTheme(move);
      drills.push({
        id: crypto.randomUUID(),
        fen: move.fenBefore,
        theme,
        description: `Find the best move for ${isPlayerWhite ? 'White' : 'Black'} instead of ${move.san}.`,
        solutionMoves: move.evalBefore?.continuation?.split(/\s+/).slice(0, 3).filter(Boolean) || [],
        sourceMoveIndex: move.index,
        difficulty: move.quality === 'blunder' ? 'hard' : 'medium',
      });
    }
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
