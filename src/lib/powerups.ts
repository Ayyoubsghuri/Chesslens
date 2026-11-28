/**
 * powerups.ts
 * Normal chess against Stockfish, but YOU (White) have a power-up:
 *  - Sniper bishops: instead of moving, a bishop shoots the first enemy piece on one of its diagonals.
 *  - Pawn catapult: instead of moving, launch a pawn 2 to 4 squares straight ahead, flying over anything.
 *  - Portals: place a blue and an orange portal; your piece that lands on one comes out of the other.
 *  - Pawn drops: add a pawn of yours on any empty square ("and": every turn after your move; "or": instead of moving).
 * Stockfish does not know about the power-up: it just answers the position it gets.
 * The king can never be shot, launched onto or captured through a portal, and a power-up can't leave your king in check.
 */
import { Chess, type Square } from 'chess.js';

export type PowerId = 'sniper' | 'catapult' | 'portals' | 'drops';

export const POWERS: { id: PowerId; name: string; text: string }[] = [
  { id: 'sniper', name: 'Sniper bishops', text: 'Instead of moving, one of your bishops can shoot the first enemy piece on any of its diagonals. The bishop stays where it is. Uses your turn.' },
  { id: 'catapult', name: 'Pawn catapult', text: 'Instead of moving, launch a pawn 2 to 4 squares straight ahead, flying over anything in the way. It can land on an empty square or on an enemy piece (capturing it). Uses your turn.' },
  { id: 'portals', name: 'Portals', text: 'Place a blue and an orange portal on empty squares (free, any time on your turn). When one of your pieces ends its move on a portal, it comes out of the other one.' },
  { id: 'drops', name: 'Pawn drops', text: 'Add a pawn of yours on any empty square from the 2nd to the 7th rank. Choose "and" (move, then add a pawn, every turn) or "or" (move or add a pawn).' },
];

const FILES = 'abcdefgh';
const sq = (f: number, r: number) => `${FILES[f]}${r + 1}` as Square;
const fr = (s: string) => ({ f: FILES.indexOf(s[0]), r: Number(s[1]) - 1 });

type Side = 'w' | 'b';
const opp = (s: Side): Side => (s === 'w' ? 'b' : 'w');

/** A FEN for the board after `side` used a power-up: the other side to move, castling rights that still make sense. */
function afterPower(c: Chess, side: Side = 'w', halfmoveReset = true): string {
  const parts = c.fen().split(' ');
  const has = (s: Square, t: string, col: Side) => { const p = c.get(s); return !!p && p.type === t && p.color === col; };
  let cast = '';
  if (parts[2].includes('K') && has('e1', 'k', 'w') && has('h1', 'r', 'w')) cast += 'K';
  if (parts[2].includes('Q') && has('e1', 'k', 'w') && has('a1', 'r', 'w')) cast += 'Q';
  if (parts[2].includes('k') && has('e8', 'k', 'b') && has('h8', 'r', 'b')) cast += 'k';
  if (parts[2].includes('q') && has('e8', 'k', 'b') && has('a8', 'r', 'b')) cast += 'q';
  const full = side === 'b' ? String(Number(parts[5] || 1) + 1) : parts[5];
  return [parts[0], opp(side), cast || '-', '-', halfmoveReset ? '0' : parts[4], full].join(' ');
}

const kingSq = (c: Chess, col: Side): Square | null => {
  for (const row of c.board()) for (const p of row) if (p && p.type === 'k' && p.color === col) return p.square;
  return null;
};
/** `side`'s king is not attacked after the power-up (the opponent would be able to take it). */
const safe = (c: Chess, side: Side = 'w') => { const k = kingSq(c, side); return !!k && !c.isAttacked(k, opp(side)); };
/** A copy of `fen` with `side` to move, without validation (used to test a power-up). */
function asSide(fen: string, side: Side): Chess {
  const parts = fen.split(' ');
  const c = new Chess();
  c.load([parts[0], side, parts[2], '-', parts[4] ?? '0', parts[5] ?? '1'].join(' '), { skipValidation: true });
  return c;
}

export interface PowerResult { fen: string; label: string; from?: Square; to: Square }

// ---------------- Sniper bishops ----------------
/** Enemy pieces a bishop of `side` on `from` can shoot (the first piece on each diagonal, never the king). */
export function sniperTargets(fen: string, from: Square, side: Side = 'w'): Square[] {
  const c = new Chess(fen);
  const p = c.get(from);
  if (!p || p.type !== 'b' || p.color !== side || c.turn() !== side) return [];
  const { f, r } = fr(from);
  const out: Square[] = [];
  for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    let ff = f + df, rr = r + dr;
    while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
      const t = c.get(sq(ff, rr));
      if (t) { if (t.color === opp(side) && t.type !== 'k') out.push(sq(ff, rr)); break; }
      ff += df; rr += dr;
    }
  }
  return out.filter((t) => { const x = asSide(fen, side); x.remove(t); return safe(x, side); });
}
export function shoot(fen: string, from: Square, target: Square, side: Side = 'w'): PowerResult | null {
  if (!sniperTargets(fen, from, side).includes(target)) return null;
  const c = new Chess(fen);
  const victim = c.remove(target);
  return { fen: afterPower(c, side), label: `B${from}→${target}${victim ? ` (${victim.type === 'p' ? 'pawn' : victim.type.toUpperCase()})` : ''}`, from, to: target };
}

// ---------------- Pawn catapult ----------------
const lastRank = (side: Side) => (side === 'w' ? '8' : '1');
/** Where a pawn of `side` on `from` can be launched: 2 to 4 squares straight ahead (towards the enemy), over anything. */
export function launchTargets(fen: string, from: Square, side: Side = 'w'): Square[] {
  const c = new Chess(fen);
  const p = c.get(from);
  if (!p || p.type !== 'p' || p.color !== side || c.turn() !== side) return [];
  const { f, r } = fr(from);
  const dir = side === 'w' ? 1 : -1;
  const out: Square[] = [];
  for (let d = 2; d <= 4; d++) {
    const rr = r + dir * d;
    if (rr < 0 || rr > 7) break;
    const to = sq(f, rr);
    const t = c.get(to);
    if (t && (t.color === side || t.type === 'k')) continue;
    out.push(to);
  }
  return out.filter((to) => {
    const x = asSide(fen, side); x.remove(from); x.remove(to);
    x.put({ type: to[1] === lastRank(side) ? 'q' : 'p', color: side }, to);
    return safe(x, side);
  });
}
export function launch(fen: string, from: Square, to: Square, side: Side = 'w'): PowerResult | null {
  if (!launchTargets(fen, from, side).includes(to)) return null;
  const c = new Chess(fen);
  c.remove(from);
  const victim = c.remove(to);
  c.put({ type: to[1] === lastRank(side) ? 'q' : 'p', color: side }, to);
  return { fen: afterPower(c, side), label: `${from}^${to}${victim ? 'x' : ''}${to[1] === lastRank(side) ? '=Q' : ''}`, from, to };
}

// ---------------- Pawn drops ----------------
/** Empty squares on ranks 2 to 7 where `side` can add a pawn without leaving its king in check. */
export function dropSquares(fen: string, side: Side = 'w'): Square[] {
  const c = new Chess(fen);
  const out: Square[] = [];
  for (let r = 1; r <= 6; r++) for (let f = 0; f < 8; f++) {
    const s = sq(f, r);
    if (c.get(s)) continue;
    const x = asSide(fen, side); x.put({ type: 'p', color: side }, s);
    if (safe(x, side)) out.push(s);
  }
  return out;
}
/** Drops a pawn of `side`. Works whether `side` is to move ("or" mode) or has just moved ("and" mode); the other side is to move after it. */
export function drop(fen: string, at: Square, side: Side = 'w'): PowerResult | null {
  const c = new Chess(fen);
  if (c.get(at)) return null;
  const r = Number(at[1]);
  if (r < 2 || r > 7) return null;
  const w = asSide(fen, side);
  w.put({ type: 'p', color: side }, at);
  if (!safe(w, side)) return null;
  return { fen: afterPower(w, side, false), label: `+P${at}`, to: at };
}

// ---------------- Portals ----------------
export interface Portals { blue: Square | null; orange: Square | null }

/**
 * Plays your move; if it ends on a portal (and the other portal is free or holds an enemy piece that is not the king),
 * the piece comes out of the other portal. Castling, en passant and pawns that would leave the board's last ranks do not teleport.
 */
export function moveWithPortals(fen: string, from: Square, to: Square, promotion: string | undefined, portals: Portals): PowerResult & { san: string; teleported: boolean } | null {
  const c = new Chess(fen);
  let m;
  try { m = c.move({ from, to, promotion }); } catch { return null; }
  const base = { fen: c.fen(), label: m.san, san: m.san, from, to: to as Square, teleported: false };
  const { blue, orange } = portals;
  if (!blue || !orange || m.flags.includes('k') || m.flags.includes('q') || m.flags.includes('e')) return base;
  const exit = to === blue ? orange : to === orange ? blue : null;
  if (!exit) return base;
  const piece = c.get(to);
  if (!piece) return base;
  const there = c.get(exit);
  if (there && (there.color === 'w' || there.type === 'k')) return base;
  if (piece.type === 'p' && (exit[1] === '1')) return base;
  const x = new Chess(c.fen());
  x.remove(to);
  x.remove(exit);
  x.put({ type: piece.type === 'p' && exit[1] === '8' ? 'q' : piece.type, color: 'w' }, exit);
  if (!safe(x)) return base;
  return { fen: afterPower(x, 'w'), label: `${m.san}→${exit}${there ? 'x' : ''}`, san: m.san, from, to: exit, teleported: true };
}

/** Black is to move in `fen`: has the game ended? */
export function outcome(fen: string): { over: boolean; text: string; whiteWins: boolean | null } {
  let c: Chess;
  try { c = new Chess(fen); } catch { return { over: false, text: '', whiteWins: null }; }
  if (c.isCheckmate()) return { over: true, text: c.turn() === 'b' ? 'Checkmate! You beat Stockfish.' : 'Checkmate. Stockfish wins.', whiteWins: c.turn() === 'b' };
  if (c.isStalemate()) return { over: true, text: 'Stalemate: draw.', whiteWins: null };
  if (c.isInsufficientMaterial()) return { over: true, text: 'Draw: not enough material.', whiteWins: null };
  if (!kingSq(c, 'b')) return { over: true, text: 'The black king is gone. You win!', whiteWins: true };
  return { over: false, text: '', whiteWins: null };
}

/**
 * Stockfish refuses positions where a side has more than 8 pawns or more than 16 pieces (it answers no move at all).
 * Pawn drops can go past that, so those positions are played by ChessLens's own (weaker) engine instead.
 */
export function stockfishCanPlay(fen: string): boolean {
  const place = fen.split(' ')[0];
  for (const side of ['w', 'b'] as const) {
    const pieces = [...place].filter((ch) => /[a-z]/i.test(ch) && (side === 'w' ? ch === ch.toUpperCase() : ch === ch.toLowerCase()));
    const pawns = pieces.filter((ch) => ch.toLowerCase() === 'p').length;
    if (pawns > 8 || pieces.length > 16) return false;
  }
  return true;
}
