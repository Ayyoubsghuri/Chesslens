/**
 * drawback.ts
 * "Secret Drawbacks": chess where each player has a hidden handicap.
 *
 * Rules (this app's version):
 *  - Each player gets a drawback: a rule that forbids some of their moves. You know yours; your opponent's stays
 *    hidden until the game ends.
 *  - There is no check and no checkmate. Moving into danger is allowed, and you win by CAPTURING the enemy king.
 *  - If your drawback (or the position) leaves you without a single move, you lose.
 *  - Castling is allowed even when the king or the squares it crosses are attacked (there is no check), but the
 *    squares between king and rook must be empty and neither may have moved.
 *  - Draw: 50 moves by each side with no capture and no pawn move, or the same position three times.
 *  - Drawbacks apply to every move, capturing the king included.
 *
 * chess.js cannot be used here (it forbids moving into check and capturing the king), so the moves are generated here.
 * Pure: no DOM, no React.
 */

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export interface Piece { t: PieceType; c: Color }

/** Square index = rank * 8 + file (a1 = 0, h1 = 7, a8 = 56). */
export type Sq = number;

export interface Move {
  from: Sq;
  to: Sq;
  piece: PieceType;
  captured?: PieceType;
  promo?: PieceType;
  castle?: 'k' | 'q';
  ep?: boolean;
  double?: boolean;
}

export interface State {
  board: (Piece | null)[];
  turn: Color;
  castling: { wk: boolean; wq: boolean; bk: boolean; bq: boolean };
  /** En passant target square, or -1. */
  ep: Sq;
  /** Plies since the last capture or pawn move. */
  quiet: number;
  /** Moves played by each side. */
  played: Record<Color, number>;
  /** Square each side's last moved piece landed on (-1 = none yet). */
  lastTo: Record<Color, Sq>;
  /** Did each side's last move capture something? */
  lastCapture: Record<Color, boolean>;
  /** Position keys, for threefold repetition. */
  seen: Record<string, number>;
}

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
export const fileOf = (s: Sq) => s & 7;
export const rankOf = (s: Sq) => s >> 3;
export const sqName = (s: Sq) => 'abcdefgh'[fileOf(s)] + (rankOf(s) + 1);
export const sqIndex = (name: string): Sq => (Number(name[1]) - 1) * 8 + 'abcdefgh'.indexOf(name[0]);
export const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAME: Record<PieceType, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const pieceName = (t: PieceType) => NAME[t];

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------
export function initialState(): State {
  const board: (Piece | null)[] = new Array(64).fill(null);
  const back: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let f = 0; f < 8; f++) {
    board[f] = { t: back[f], c: 'w' };
    board[8 + f] = { t: 'p', c: 'w' };
    board[48 + f] = { t: 'p', c: 'b' };
    board[56 + f] = { t: back[f], c: 'b' };
  }
  const s: State = {
    board, turn: 'w', castling: { wk: true, wq: true, bk: true, bq: true }, ep: -1, quiet: 0,
    played: { w: 0, b: 0 }, lastTo: { w: -1, b: -1 }, lastCapture: { w: false, b: false }, seen: {},
  };
  s.seen[positionKey(s)] = 1;
  return s;
}

const LETTER: Record<PieceType, string> = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' };

/** Piece placement in FEN form (what the board component needs). */
export function placement(board: (Piece | null)[]): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[r * 8 + f];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p.c === 'w' ? LETTER[p.t].toUpperCase() : LETTER[p.t];
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

function positionKey(s: State): string {
  const c = s.castling;
  return `${placement(s.board)} ${s.turn} ${c.wk ? 'K' : ''}${c.wq ? 'Q' : ''}${c.bk ? 'k' : ''}${c.bq ? 'q' : ''} ${s.ep}`;
}

// ---------------------------------------------------------------------------
// Moves (pseudo-legal: moving into danger is allowed, the king can be captured)
// ---------------------------------------------------------------------------
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export function pseudoMoves(s: State, side: Color = s.turn): Move[] {
  const out: Move[] = [];
  const b = s.board;
  const push = (from: Sq, to: Sq, piece: PieceType, extra: Partial<Move> = {}) => {
    const cap = b[to];
    out.push({ from, to, piece, ...(cap ? { captured: cap.t } : {}), ...extra });
  };
  for (let from = 0; from < 64; from++) {
    const p = b[from];
    if (!p || p.c !== side) continue;
    const f = fileOf(from), r = rankOf(from);
    const at = (ff: number, rr: number) => (ff >= 0 && ff < 8 && rr >= 0 && rr < 8 ? rr * 8 + ff : -1);
    if (p.t === 'p') {
      const dir = side === 'w' ? 1 : -1;
      const start = side === 'w' ? 1 : 6;
      const last = side === 'w' ? 7 : 0;
      const one = at(f, r + dir);
      const promos: (PieceType | undefined)[] = r + dir === last ? ['q', 'n', 'r', 'b'] : [undefined];
      if (one >= 0 && !b[one]) {
        for (const pr of promos) push(from, one, 'p', pr ? { promo: pr } : {});
        const two = at(f, r + 2 * dir);
        if (r === start && two >= 0 && !b[two]) push(from, two, 'p', { double: true });
      }
      for (const df of [-1, 1]) {
        const to = at(f + df, r + dir);
        if (to < 0) continue;
        const t = b[to];
        if (t && t.c !== side) for (const pr of promos) push(from, to, 'p', pr ? { promo: pr } : {});
        else if (!t && to === s.ep) out.push({ from, to, piece: 'p', captured: 'p', ep: true });
      }
      continue;
    }
    if (p.t === 'n' || p.t === 'k') {
      for (const [df, dr] of p.t === 'n' ? KNIGHT : KING) {
        const to = at(f + df, r + dr);
        if (to < 0) continue;
        const t = b[to];
        if (!t || t.c !== side) push(from, to, p.t);
      }
      if (p.t === 'k') {
        const home = side === 'w' ? 4 : 60;
        if (from === home) {
          const rights = s.castling;
          const k = side === 'w' ? rights.wk : rights.bk;
          const q = side === 'w' ? rights.wq : rights.bq;
          const rook = (sq: Sq) => { const x = b[sq]; return !!x && x.t === 'r' && x.c === side; };
          if (k && !b[home + 1] && !b[home + 2] && rook(home + 3)) out.push({ from, to: home + 2, piece: 'k', castle: 'k' });
          if (q && !b[home - 1] && !b[home - 2] && !b[home - 3] && rook(home - 4)) out.push({ from, to: home - 2, piece: 'k', castle: 'q' });
        }
      }
      continue;
    }
    const dirs = p.t === 'r' ? ROOK_DIRS : p.t === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
    for (const [df, dr] of dirs) {
      let ff = f + df, rr = r + dr;
      while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
        const to = rr * 8 + ff;
        const t = b[to];
        if (t && t.c === side) break;
        push(from, to, p.t);
        if (t) break;
        ff += df; rr += dr;
      }
    }
  }
  return out;
}

/** Plays a move (no checks: pass a move from legalMoves). Returns the new state. */
export function play(s: State, m: Move): State {
  const b = s.board.slice();
  const side = s.turn;
  const p = b[m.from]!;
  b[m.from] = null;
  if (m.ep) b[m.to + (side === 'w' ? -8 : 8)] = null;
  b[m.to] = m.promo ? { t: m.promo, c: side } : p;
  if (m.castle) {
    const home = side === 'w' ? 4 : 60;
    if (m.castle === 'k') { b[home + 1] = b[home + 3]; b[home + 3] = null; }
    else { b[home - 1] = b[home - 4]; b[home - 4] = null; }
  }
  const c = { ...s.castling };
  const touch = (sq: Sq) => {
    if (sq === 4) { c.wk = false; c.wq = false; }
    if (sq === 60) { c.bk = false; c.bq = false; }
    if (sq === 0) c.wq = false;
    if (sq === 7) c.wk = false;
    if (sq === 56) c.bq = false;
    if (sq === 63) c.bk = false;
  };
  touch(m.from); touch(m.to);
  const next: State = {
    board: b,
    turn: other(side),
    castling: c,
    ep: m.double ? m.from + (side === 'w' ? 8 : -8) : -1,
    quiet: m.captured || m.piece === 'p' ? 0 : s.quiet + 1,
    played: { ...s.played, [side]: s.played[side] + 1 },
    lastTo: { ...s.lastTo, [side]: m.to },
    lastCapture: { ...s.lastCapture, [side]: !!m.captured },
    seen: s.seen,
  };
  const key = positionKey(next);
  next.seen = { ...s.seen, [key]: (s.seen[key] ?? 0) + 1 };
  return next;
}

// ---------------------------------------------------------------------------
// Drawbacks
// ---------------------------------------------------------------------------
export interface Drawback {
  id: string;
  name: string;
  /** The rule, said to the player who has it ("Your pawns can't capture."). */
  text: string;
  /** 1 = mild, 2 = medium, 3 = harsh. */
  level: 1 | 2 | 3;
  /** Removes the moves this drawback forbids, for `side`. */
  filter: (moves: Move[], s: State, side: Color) => Move[];
}

const forbid = (pred: (m: Move, s: State, side: Color) => boolean) =>
  (moves: Move[], s: State, side: Color) => moves.filter((m) => !pred(m, s, side));
/** "Forward" for `side`: +1 rank for White, -1 for Black. */
const ahead = (m: Move, side: Color) => (rankOf(m.to) - rankOf(m.from)) * (side === 'w' ? 1 : -1);
const isLight = (sq: Sq) => (fileOf(sq) + rankOf(sq)) % 2 === 1;
const dist = (m: Move) => Math.max(Math.abs(fileOf(m.to) - fileOf(m.from)), Math.abs(rankOf(m.to) - rankOf(m.from)));

export const DRAWBACKS: Drawback[] = [
  // ---- mild
  { id: 'small-steps', name: 'Small steps', level: 1, text: "Your pawns can't move two squares.", filter: forbid((m) => !!m.double) },
  { id: 'no-castling', name: 'Homebody rooks', level: 1, text: "You can't castle.", filter: forbid((m) => !!m.castle) },
  { id: 'edge-knights', name: 'Knights fear the edge', level: 1, text: "Your knights can't move to the a- or h-file.", filter: forbid((m) => m.piece === 'n' && (fileOf(m.to) === 0 || fileOf(m.to) === 7)) },
  { id: 'polite-king', name: 'Polite king', level: 1, text: "Your king can't capture.", filter: forbid((m) => m.piece === 'k' && !!m.captured) },
  { id: 'frozen-flanks', name: 'Frozen flanks', level: 1, text: "Your a- and h-pawns can't move.", filter: forbid((m) => m.piece === 'p' && (fileOf(m.from) === 0 || fileOf(m.from) === 7)) },
  { id: 'proud-queen', name: 'Proud queen', level: 1, text: "Your queen can't capture pawns.", filter: forbid((m) => m.piece === 'q' && m.captured === 'p') },
  { id: 'glass-ceiling', name: 'Glass ceiling', level: 1, text: "Your pawns can't promote.", filter: forbid((m) => !!m.promo) },
  { id: 'slow-start', name: 'Slow start', level: 1, text: "You can't capture during your first 6 moves.", filter: forbid((m, s, side) => !!m.captured && s.played[side] < 6) },
  // ---- medium
  { id: 'peaceful-pawns', name: 'Peaceful pawns', level: 2, text: "Your pawns can't capture.", filter: forbid((m) => m.piece === 'p' && !!m.captured) },
  { id: 'gentle-knights', name: 'Gentle knights', level: 2, text: "Your knights can't capture.", filter: forbid((m) => m.piece === 'n' && !!m.captured) },
  { id: 'nearsighted-bishops', name: 'Nearsighted bishops', level: 2, text: 'Your bishops move at most two squares.', filter: forbid((m) => m.piece === 'b' && dist(m) > 2) },
  { id: 'heavy-rooks', name: 'Heavy rooks', level: 2, text: 'Your rooks move at most two squares.', filter: forbid((m) => m.piece === 'r' && dist(m) > 2) },
  { id: 'take-turns', name: 'Take turns', level: 2, text: "You can't move the same piece twice in a row.", filter: forbid((m, s, side) => s.lastTo[side] === m.from) },
  { id: 'catch-breath', name: 'Catch your breath', level: 2, text: "You can't capture two turns in a row.", filter: forbid((m, s, side) => !!m.captured && s.lastCapture[side]) },
  { id: 'keep-off-grass', name: 'Keep off the grass', level: 2, text: "You can't move onto d4, e4, d5 or e5.", filter: forbid((m) => [27, 28, 35, 36].includes(m.to)) },
  { id: 'respect-elders', name: 'Respect your elders', level: 2, text: "You can't capture a piece worth more than the piece that captures (the king can always be taken).", filter: forbid((m) => !!m.captured && m.captured !== 'k' && VALUE[m.captured] > VALUE[m.piece]) },
  { id: 'lazy-rooks', name: 'Lazy rooks', level: 2, text: "Your rooks can't leave your back rank.", filter: forbid((m, _s, side) => m.piece === 'r' && rankOf(m.to) !== (side === 'w' ? 0 : 7)) },
  { id: 'hungry', name: 'Hungry', level: 2, text: 'If you can capture something, you must.', filter: (moves) => (moves.some((m) => m.captured) ? moves.filter((m) => m.captured) : moves) },
  // ---- harsh
  { id: 'stubborn-king', name: 'Stubborn king', level: 3, text: "Your king can't move, except to capture.", filter: forbid((m) => m.piece === 'k' && !m.captured) },
  { id: 'tired-queen', name: 'Tired queen', level: 3, text: 'Your queen moves only one square at a time.', filter: forbid((m) => m.piece === 'q' && dist(m) > 1) },
  { id: 'no-retreat', name: 'No retreat', level: 3, text: "Your pieces (not the king) can't move back toward your side.", filter: forbid((m, _s, side) => m.piece !== 'k' && ahead(m, side) < 0) },
  { id: 'afraid-light', name: 'Afraid of the light', level: 3, text: "Your pieces other than pawns can't end a move on a light square.", filter: forbid((m) => m.piece !== 'p' && isLight(m.to)) },
  { id: 'lefty', name: 'Lefty', level: 3, text: "Your pieces can't move to the right (seen from your side of the board).", filter: forbid((m, _s, side) => (fileOf(m.to) - fileOf(m.from)) * (side === 'w' ? 1 : -1) > 0) },
];

export const drawbackById = (id: string) => DRAWBACKS.find((d) => d.id === id) ?? DRAWBACKS[0];

/** Deals a drawback up to `maxLevel` (never `avoid`). */
export function dealDrawback(maxLevel: 1 | 2 | 3, avoid: string[] = [], rnd: () => number = Math.random): Drawback {
  const pool = DRAWBACKS.filter((d) => d.level <= maxLevel && !avoid.includes(d.id));
  return pool[Math.floor(rnd() * pool.length)] ?? DRAWBACKS[0];
}

/** Every move `side` may play now: the pieces' moves minus what the drawback forbids. */
export function legalMoves(s: State, drawback: Drawback | null, side: Color = s.turn): Move[] {
  const moves = pseudoMoves(s, side);
  return drawback ? drawback.filter(moves, s, side) : moves;
}

// ---------------------------------------------------------------------------
// End of the game
// ---------------------------------------------------------------------------
export type Ending =
  | { kind: 'king'; winner: Color }
  | { kind: 'stuck'; winner: Color }
  | { kind: 'fifty' }
  | { kind: 'repetition' };

/** After `last` was played into `s`: is the game over? `drawbackToMove` is the drawback of the side to move now. */
export function ending(s: State, last: Move | null, drawbackToMove: Drawback | null): Ending | null {
  if (last?.captured === 'k') return { kind: 'king', winner: other(s.turn) };
  if (!legalMoves(s, drawbackToMove).length) return { kind: 'stuck', winner: other(s.turn) };
  if (s.quiet >= 100) return { kind: 'fifty' };
  if (Object.values(s.seen).some((n) => n >= 3)) return { kind: 'repetition' };
  return null;
}

// ---------------------------------------------------------------------------
// Notation
// ---------------------------------------------------------------------------
export function notation(s: State, m: Move): string {
  if (m.castle) return m.castle === 'k' ? 'O-O' : 'O-O-O';
  const to = sqName(m.to);
  if (m.piece === 'p') {
    const base = m.captured ? `${'abcdefgh'[fileOf(m.from)]}x${to}` : to;
    return m.promo ? `${base}=${m.promo.toUpperCase()}` : base;
  }
  const P = m.piece.toUpperCase();
  // the file or rank of the starting square when two pieces of the same kind could go there
  const twins = pseudoMoves(s, s.turn).filter((x) => x.piece === m.piece && x.to === m.to && x.from !== m.from);
  let dis = '';
  if (twins.length) dis = twins.some((x) => fileOf(x.from) === fileOf(m.from)) ? sqName(m.from) : 'abcdefgh'[fileOf(m.from)];
  return `${P}${dis}${m.captured ? 'x' : ''}${to}${m.captured === 'k' ? '!' : ''}`;
}

// ---------------------------------------------------------------------------
// The computer
// ---------------------------------------------------------------------------
const CP: Record<PieceType, number> = { p: 100, n: 310, b: 325, r: 500, q: 900, k: 0 };
const WIN = 1_000_000;
/** Small bonus for being near the centre (knights and bishops most of all) and for advanced pawns. */
function placeBonus(p: Piece, sq: Sq): number {
  const f = fileOf(sq), r = rankOf(sq);
  const centre = 3.5 - Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5)); // 0 at the edge .. 3 in the middle
  if (p.t === 'n') return centre * 9;
  if (p.t === 'b') return centre * 5;
  if (p.t === 'q') return centre * 2;
  if (p.t === 'p') return (p.c === 'w' ? r - 1 : 6 - r) * 6 + (f >= 2 && f <= 5 ? 4 : 0);
  if (p.t === 'k') return -centre * 6; // the king is safer at home: in this game it can simply be taken
  return 0;
}

function evaluate(s: State, side: Color): number {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = s.board[sq];
    if (!p) continue;
    const v = CP[p.t] + placeBonus(p, sq);
    score += p.c === side ? v : -v;
  }
  return score;
}

const order = (moves: Move[]) =>
  moves.map((m) => ({ m, k: (m.captured ? (m.captured === 'k' ? 1e6 : CP[m.captured] * 10 - CP[m.piece]) : 0) + (m.promo === 'q' ? 800 : 0) }))
    .sort((a, b) => b.k - a.k).map((x) => x.m);

interface SearchCtx { me: Color; mine: Drawback | null; nodes: number; limit: number }

/** The computer knows its own drawback, but not yours: it assumes you may play any move. */
const movesFor = (s: State, c: SearchCtx) => legalMoves(s, s.turn === c.me ? c.mine : null);

function quiesce(s: State, alpha: number, beta: number, c: SearchCtx, depth: number): number {
  c.nodes++;
  const stand = evaluate(s, s.turn);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (depth <= 0) return stand;
  const moves = movesFor(s, c);
  for (const m of order(moves.filter((x) => x.captured))) {
    if (m.captured === 'k') return WIN;
    const v = -quiesce(play(s, m), -beta, -alpha, c, depth - 1);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function negamax(s: State, depth: number, alpha: number, beta: number, c: SearchCtx, ply: number): number {
  c.nodes++;
  const moves = movesFor(s, c);
  if (!moves.length) return -WIN + ply; // no move = lost
  for (const m of moves) if (m.captured === 'k') return WIN - ply; // the king can be taken: game over
  if (depth <= 0 || c.nodes > c.limit) return quiesce(s, alpha, beta, c, 4);
  let best = -Infinity;
  for (const m of order(moves)) {
    const v = -negamax(play(s, m), depth - 1, -beta, -alpha, c, ply + 1);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

export type Strength = 'easy' | 'medium' | 'hard';

/** The computer's move for the side to move, which has drawback `mine`. null when it has no move. */
export function computerMove(s: State, mine: Drawback | null, strength: Strength, rnd: () => number = Math.random): Move | null {
  const c: SearchCtx = { me: s.turn, mine, nodes: 0, limit: strength === 'hard' ? 220_000 : 80_000 };
  const moves = movesFor(s, c);
  if (!moves.length) return null;
  const kill = moves.find((m) => m.captured === 'k');
  if (kill) return kill;
  const depth = strength === 'easy' ? 1 : strength === 'medium' ? 2 : 3;
  const noise = strength === 'easy' ? 90 : strength === 'medium' ? 25 : 6;
  let best: Move | null = null;
  let bestV = -Infinity;
  for (const m of order(moves)) {
    const v = -negamax(play(s, m), depth - 1, -Infinity, Infinity, c, 1) + (rnd() - 0.5) * 2 * noise;
    if (v > bestV) { bestV = v; best = m; }
  }
  return best ?? moves[0];
}
