import { Chess } from 'chess.js';
import type { PieceColor } from './types';

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 } as const;

/** Material balance from `color`'s point of view (positive = `color` is up). */
function material(chess: Chess, color: PieceColor): number {
  let diff = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq) diff += (sq.color === color ? 1 : -1) * VALUES[sq.type];
    }
  }
  return diff;
}

function playUci(chess: Chess, uci: string) {
  return chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  });
}

/**
 * True if the played move is a real material sacrifice.
 *
 * Play the move, then the engine's best continuation (`continuation`, whose
 * first move is the opponent's reply). Track the mover's material relative to
 * BEFORE the move:
 *
 *   lowPoint = worst material after any opponent move in the line
 *   net      = material after the last complete pair of moves
 *
 * It's a sacrifice when:
 *   1. lowPoint <= -minLoss   → the mover really does give material up
 *                                (e.g. rook hanging to Kxh6), AND
 *   2. |net| >= 2             → it is NOT just a trade. A trade dips down
 *                                and comes straight back to ~0. A sacrifice
 *                                either stays down (positional/attacking
 *                                compensation) or wins back MORE than it
 *                                gave (e.g. rook sacrificed to win a queen).
 *
 * The caller separately checks that the engine still rates the move well.
 *
 * `minLoss` 2 = an exchange (R for B/N) or more; use 3 to require a full piece.
 */
export function detectSacrifice(
  fenBefore: string,
  playedUci: string,
  continuation: string | undefined,
  color: PieceColor,
  minLoss = 2,
  maxPlies = 6,
): boolean {
  try {
    const chess = new Chess(fenBefore);
    const before = material(chess, color);

    if (!playUci(chess, playedUci)) return false;

    const pv = (continuation ?? '').split(/\s+/).filter(Boolean).slice(0, maxPlies);

    let lowPoint = Infinity;
    let net = 0;
    let played = 0;

    for (const uci of pv) {
      if (!playUci(chess, uci)) break;
      played++;
      const diff = material(chess, color) - before;
      if (played % 2 === 1) {
        // After an opponent move: this is when a sacrificed piece is gone.
        lowPoint = Math.min(lowPoint, diff);
      } else {
        // After our reply: exchange resolved.
        net = diff;
      }
    }

    // Need the opponent's reply and our answer to tell a sacrifice from a trade.
    if (played < 2) return false;

    return lowPoint <= -minLoss && Math.abs(net) >= 2;
  } catch {
    return false;
  }
}