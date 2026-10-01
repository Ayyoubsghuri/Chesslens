import { Chess, type Square, type Color } from 'chess.js';

export interface ForkTarget {
  square: Square;
  name: string;
}

const NAMES: Record<string, string> = { k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn' };
const JUMPS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];

/**
 * Did this move land a knight that attacks two or more enemy targets at once?
 * A target is the king, a queen, a rook, or an undefended bishop/knight.
 * Returns the forked pieces, or null when it isn't a fork.
 */
export function detectKnightFork(fenAfter: string, san: string, mover: Color): ForkTarget[] | null {
  if (!san.startsWith('N')) return null;
  const dest = san.match(/([a-h][1-8])[+#]?$/);
  if (!dest) return null;
  const to = dest[1] as Square;

  try {
    const chess = new Chess(fenAfter);
    const knight = chess.get(to);
    if (!knight || knight.type !== 'n' || knight.color !== mover) return null;

    const enemy: Color = mover === 'w' ? 'b' : 'w';
    const file = to.charCodeAt(0) - 97;
    const rank = Number(to[1]) - 1;
    const targets: ForkTarget[] = [];

    for (const [df, dr] of JUMPS) {
      const f = file + df;
      const r = rank + dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      const sq = (String.fromCharCode(97 + f) + (r + 1)) as Square;
      const piece = chess.get(sq);
      if (!piece || piece.color !== enemy) continue;

      const valuable = piece.type === 'k' || piece.type === 'q' || piece.type === 'r';
      const looseMinor = (piece.type === 'b' || piece.type === 'n') && !chess.isAttacked(sq, enemy);
      if (valuable || looseMinor) targets.push({ square: sq, name: NAMES[piece.type] });
    }

    return targets.length >= 2 ? targets : null;
  } catch {
    return null;
  }
}
