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
/** What a brilliant sacrifice gets in return. */
export type SacrificePayoff = 'mate' | 'material' | 'position';

/**
 * Brilliant = a real sacrifice of a VALUABLE piece (a knight, bishop, rook or queen: at least 3 points given up,
 * not a trade) that pays off in the engine's line:
 *   - 'mate':     it leads to checkmate (the line ends in mate, or the engine sees a forced mate for the mover);
 *   - 'material': it wins back MORE than it gave (e.g. a rook given to win the queen);
 *   - 'position': the material stays given (the mover ends at least a pawn down), but the position is clearly better for it
 *                 (`winAfter`, the mover's winning chances after the move, is 60% or more).
 * Returns the payoff, or null when the move is not a brilliant sacrifice.
 */
export function brilliantSacrifice(
  fenBefore: string,
  playedUci: string,
  continuation: string | undefined,
  color: PieceColor,
  moverMates: boolean,
  winAfter: number,
  maxPlies = 10,
): SacrificePayoff | null {
  try {
    const chess = new Chess(fenBefore);
    const before = material(chess, color);
    if (!playUci(chess, playedUci)) return null;
    const pv = (continuation ?? '').split(/\s+/).filter(Boolean).slice(0, maxPlies);
    let lowPoint = 0;
    let gaveValuable = false;
    let net = 0;
    let played = 0;
    let mated = false;
    for (const uci of pv) {
      const m = playUci(chess, uci);
      if (!m) break;
      played++;
      const diff = material(chess, color) - before;
      if (played % 2 === 1) {
        // the opponent's move: did it take one of the mover's valuable pieces while the mover is behind?
        // the opponent takes it right away: a piece lost later in the line belongs to another plan, not to this move
        if (played === 1 && m.captured && VALUES[m.captured as keyof typeof VALUES] >= 3 && diff <= -2) gaveValuable = true;
        lowPoint = Math.min(lowPoint, diff);
      } else {
        net = diff;
      }
      if (chess.isCheckmate()) { mated = chess.turn() !== color; break; }
    }
    if (played < 2 || !gaveValuable || lowPoint > -2) return null;
    if (mated || moverMates) return 'mate';
    if (net >= 1) return 'material';
    if (net <= -1 && winAfter >= 60) return 'position';
    return null;
  } catch {
    return null;
  }
}
