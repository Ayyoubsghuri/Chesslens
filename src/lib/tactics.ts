/**
 * Tactic detector for the advanced coach: forks (any piece), pins, skewers, discovered attacks,
 * mate threats, promotion threats, hanging pieces, and "what does this line lead to?".
 * Everything is verified on the board with chess.js (legal moves + exchange check), nothing is guessed.
 */
import { Chess, type Square } from 'chess.js';

export const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export type Side = 'w' | 'b';
export const other = (c: Side): Side => (c === 'w' ? 'b' : 'w');

export type PlyMove = {
  from: string; to: string; san: string; piece: string; captured?: string;
  promotion?: string; color: Side; flags: string;
};

const FILES = 'abcdefgh';
const sq = (f: number, r: number) => (FILES[f] + (r + 1)) as Square;

/** Same position with `side` to move (to ask "what could this side do right now?"). */
export function movesFor(fen: string, side: Side) {
  try {
    const f = fen.split(' ');
    f[1] = side;
    f[3] = '-';
    return new Chess(f.join(' ')).moves({ verbose: true });
  } catch {
    return [];
  }
}

/** Is the piece standing on `square` protected by a friendly piece? */
export function isDefended(fen: string, square: Square): boolean {
  try {
    const c = new Chess(fen);
    const p = c.get(square);
    if (!p || p.type === 'k') return false;
    c.remove(square);
    c.put({ type: 'p', color: other(p.color) }, square);
    return movesFor(c.fen(), p.color).some((m) => m.to === square && !!m.captured);
  } catch {
    return false;
  }
}

export function kingSquare(fen: string, side: Side): Square | null {
  try {
    const board = new Chess(fen).board();
    for (const row of board) for (const p of row) if (p && p.type === 'k' && p.color === side) return p.square as Square;
  } catch { /* ignore */ }
  return null;
}

export interface Capture { from: Square; to: Square; victim: string; attacker: string; gain: number; free: boolean }

/** Captures `bySide` could make that win material (undefended piece, or a bigger piece for a smaller one). */
export function winnableCaptures(fen: string, bySide: Side): Capture[] {
  const out: Capture[] = [];
  for (const m of movesFor(fen, bySide)) {
    if (!m.captured || m.captured === 'k') continue;
    let recapture = false;
    try {
      const f = fen.split(' ');
      f[1] = bySide; f[3] = '-';
      const c = new Chess(f.join(' '));
      c.move(m.san);
      recapture = movesFor(c.fen(), other(bySide)).some((r) => r.to === m.to && !!r.captured);
    } catch { /* ignore */ }
    const gain = recapture ? VAL[m.captured] - VAL[m.piece] : VAL[m.captured];
    if (gain >= 1) out.push({ from: m.from as Square, to: m.to as Square, victim: m.captured, attacker: m.piece, gain, free: !recapture });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/** Can the opponent win the piece standing on `square`? */
export function hangingInfo(fenAfter: string, square: Square, mover: Side) {
  return winnableCaptures(fenAfter, other(mover)).find((c) => c.to === square) ?? null;
}

/** Enemy pieces the piece on `square` attacks and could win. */
export function threatsFrom(fenAfter: string, square: Square, mover: Side) {
  return winnableCaptures(fenAfter, mover)
    .filter((c) => c.from === square)
    .map((c) => ({ square: c.to, piece: c.victim }));
}

// ---------------------------------------------------------------------------

export type TacticKind =
  | 'mate' | 'double-check' | 'greek-gift' | 'fork' | 'pin' | 'skewer' | 'discovered'
  | 'remove-defender' | 'trapped' | 'mate-threat' | 'promotion';
export interface Tactic {
  kind: TacticKind;
  /** The name a coach would use: "Fork", "Pin", "Back-rank mate", "Double check"... */
  name: string;
  /** Verb phrase: "forks the king on e8 and the queen on d8". Never contains "+" or "#". */
  text: string;
  arrows: { from: Square; to: Square }[];
}

const DIRS = {
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
};

/** For a slider on `from`: along each direction, the first two pieces it meets. */
function raysFrom(c: Chess, from: Square, type: 'b' | 'r' | 'q') {
  const dirs = type === 'q' ? [...DIRS.b, ...DIRS.r] : DIRS[type];
  const f0 = FILES.indexOf(from[0]);
  const r0 = Number(from[1]) - 1;
  return dirs.map(([df, dr]) => {
    const seen: { sq: Square; type: string; color: Side }[] = [];
    let f = f0 + df, r = r0 + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8 && seen.length < 2) {
      const s = sq(f, r);
      const p = c.get(s);
      if (p) seen.push({ sq: s, type: p.type, color: p.color });
      f += df; r += dr;
    }
    return seen;
  });
}

const list = (parts: string[]) => (parts.length <= 1 ? parts[0] ?? '' : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]);

/** Tactics created by move `m` (played from `fenBefore`, giving `fenAfter`), best first. */
export function describeTactics(fenBefore: string, m: PlyMove, fenAfter: string): Tactic[] {
  const out: Tactic[] = [];
  const mover = m.color, opp = other(mover);
  let c: Chess;
  try { c = new Chess(fenAfter); } catch { return out; }
  const here = m.to as Square;
  const gaveMate = m.san.endsWith('#');
  const gaveCheck = m.san.includes('+');

  if (gaveMate) {
    // Name the pattern: smothered mate (knight, king boxed in by its own men) or back-rank mate (rook / queen on the last rank).
    const ek = kingSquare(fenAfter, opp);
    const around = (s: Square) => {
      const f = FILES.indexOf(s[0]), r = Number(s[1]) - 1;
      const res: Square[] = [];
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
        if (!df && !dr) continue;
        const ff = f + df, rr = r + dr;
        if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) res.push(sq(ff, rr));
      }
      return res;
    };
    let name = 'Checkmate';
    let text = 'delivers checkmate';
    if (ek) {
      const ring = around(ek);
      if (m.piece === 'n' && ring.every((s) => c.get(s)?.color === opp)) {
        name = 'Smothered mate';
        text = 'delivers checkmate: the king has no escape because its own pieces surround it';
      } else if ((m.piece === 'r' || m.piece === 'q') && (ek[1] === '1' || ek[1] === '8')
        && ring.filter((s) => s[1] !== ek[1]).every((s) => c.get(s)?.color === opp)) {
        name = 'Back-rank mate';
        text = 'delivers checkmate: the king is trapped on its back rank behind its own pawns';
      }
    }
    out.push({ kind: 'mate', name, text, arrows: [] });
  }

  // --- Double check: two pieces give check at once, so the king MUST move
  if (gaveCheck && !gaveMate) {
    try {
      const ek = kingSquare(fenAfter, opp);
      const n = ek && typeof (c as any).attackers === 'function' ? (c as any).attackers(ek, mover).length : 0;
      if (ek && n >= 2) {
        out.push({
          kind: 'double-check', name: 'Double check',
          text: 'gives check with two pieces at once, so the king has to move',
          arrows: [{ from: here, to: ek }],
        });
      }
    } catch { /* ignore */ }
  }

  // --- Fork: the moved piece attacks two or more things worth winning (a check counts)
  if (!gaveMate) {
    const targets = threatsFrom(fenAfter, here, mover).map((t) => ({ sq: t.square, piece: t.piece }));
    const king = kingSquare(fenAfter, opp);
    if (gaveCheck && king) targets.unshift({ sq: king, piece: 'k' });
    if (targets.length >= 2) {
      const hang = hangingInfo(fenAfter, here, mover);
      const forkerLost = !!hang && hang.gain >= Math.max(2, VAL[m.piece]) ;
      if (!forkerLost) {
        const shown = targets.slice(0, 3);
        out.push({
          kind: 'fork', name: 'Fork',
          text: `forks the ${list(shown.map((t) => `${NAME[t.piece]} on ${t.sq}`))}`,
          arrows: shown.map((t) => ({ from: here, to: t.sq })),
        });
      }
    }
  }

  // --- Pin / skewer by the moved slider
  if (!gaveMate && (m.piece === 'b' || m.piece === 'r' || m.piece === 'q')) {
    for (const seen of raysFrom(c, here, m.piece as 'b' | 'r' | 'q')) {
      const [A, B] = seen;
      if (!A || !B || A.color !== opp || B.color !== opp) continue;
      if (A.type !== 'k' && (B.type === 'k' || VAL[B.type] > VAL[A.type])) {
        out.push({
          kind: 'pin', name: 'Pin',
          text: B.type === 'k'
            ? `pins the ${NAME[A.type]} on ${A.sq} to the king`
            : `pins the ${NAME[A.type]} on ${A.sq} to the ${NAME[B.type]} on ${B.sq}`,
          arrows: [{ from: here, to: A.sq }, { from: A.sq, to: B.sq }],
        });
      } else if ((A.type === 'k' || VAL[A.type] > VAL[B.type]) && B.type !== 'k' && (!isDefended(fenAfter, B.sq) || VAL[B.type] > VAL[m.piece])) {
        out.push({
          kind: 'skewer', name: 'Skewer',
          text: `skewers the ${NAME[A.type]} on ${A.sq}: when it moves, the ${NAME[B.type]} on ${B.sq} falls`,
          arrows: [{ from: here, to: A.sq }, { from: A.sq, to: B.sq }],
        });
      }
    }
  }

  // --- Discovered attack: moving this piece uncovered a NEW attack by another piece
  if (!gaveMate) {
    const was = new Set(winnableCaptures(fenBefore, mover).map((x) => x.from + x.to));
    const fresh = winnableCaptures(fenAfter, mover).filter((x) => x.from !== here && !was.has(x.from + x.to));
    if (fresh.length) {
      const f = fresh[0];
      let attackerName = 'piece';
      try { attackerName = NAME[c.get(f.from)?.type ?? 'p']; } catch { /* ignore */ }
      out.push({
        kind: 'discovered', name: 'Discovered attack',
        text: `opens the line for the ${attackerName} on ${f.from}, which now hits the ${NAME[f.victim]} on ${f.to}`,
        arrows: [{ from: f.from, to: f.to }],
      });
    }
  }

  // --- Mate threat: if the opponent passes, the mover has mate in one
  if (!gaveCheck) {
    const mate = movesFor(fenAfter, mover).find((x) => x.san.endsWith('#'));
    if (mate) out.push({ kind: 'mate-threat', name: 'Mate threat', text: `threatens checkmate on ${mate.to}`, arrows: [{ from: mate.from as Square, to: mate.to as Square }] });
  }

  // --- Pawn about to promote
  if (m.piece === 'p' && ((mover === 'w' && m.to[1] === '7') || (mover === 'b' && m.to[1] === '2'))) {
    const ahead = (m.to[0] + (mover === 'w' ? '8' : '1')) as Square;
    if (!c.get(ahead)) out.push({ kind: 'promotion', name: 'Promotion', text: `threatens to promote on ${ahead}`, arrows: [{ from: here, to: ahead }] });
  }

  // --- Greek gift: bishop takes the h-pawn with check, and the bishop can be taken (the classic attacking sacrifice)
  if (gaveCheck && !gaveMate && m.piece === 'b' && m.captured === 'p' && m.to === (mover === 'w' ? 'h7' : 'h2')) {
    const ek = kingSquare(fenAfter, opp);
    if (ek && hangingInfo(fenAfter, here, mover)) {
      out.push({
        kind: 'greek-gift', name: 'Greek gift',
        text: `sacrifices the bishop on ${m.to} to tear open the king's shelter`,
        arrows: [{ from: here, to: ek }],
      });
    }
  }

  // --- Removing the defender: the capture took away the protection of another piece, which now falls
  if (!gaveMate && m.captured) {
    const wasWinnable = new Set(winnableCaptures(fenBefore, mover).map((x) => x.from + x.to));
    const fresh = winnableCaptures(fenAfter, mover).find(
      (x) => x.free && x.to !== here && VAL[x.victim] >= 3 && !wasWinnable.has(x.from + x.to)
        && isDefended(fenBefore, x.to) && !isDefended(fenAfter, x.to),
    );
    if (fresh) {
      out.push({
        kind: 'remove-defender', name: 'Removing the defender',
        text: `takes a key defender, so the ${NAME[fresh.victim]} on ${fresh.to} is no longer protected and falls`,
        arrows: [{ from: fresh.from, to: fresh.to }],
      });
    }
  }

  // --- Trapped piece: this move attacks a piece that has no safe square to run to (and was not attacked before)
  if (!gaveMate && !gaveCheck) {
    const wasAttacked = new Set(winnableCaptures(fenBefore, mover).map((x) => x.to));
    for (const hit of winnableCaptures(fenAfter, mover).filter((x) => x.victim !== 'p' && !wasAttacked.has(x.to)).slice(0, 3)) {
      if (c.get(hit.to)?.color !== opp) continue;
      let safe = false;
      for (const e of movesFor(fenAfter, opp).filter((x) => x.from === hit.to)) {
        try {
          const t = new Chess(fenAfter);
          t.move(e.san);
          if (!winnableCaptures(t.fen(), mover).some((x) => x.to === e.to)) { safe = true; break; }
        } catch { /* ignore */ }
      }
      if (!safe) {
        out.push({
          kind: 'trapped', name: 'Trapped piece',
          text: `traps the ${NAME[hit.victim]} on ${hit.to}: it is attacked and has no safe square to go to`,
          arrows: [{ from: hit.from, to: hit.to }],
        });
        break;
      }
    }
  }

  const order: TacticKind[] = ['mate', 'double-check', 'greek-gift', 'fork', 'pin', 'skewer', 'discovered', 'remove-defender', 'trapped', 'mate-threat', 'promotion'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

export interface LineTactic { ply: number; move: PlyMove; tactic: Tactic; fenBefore: string; fenAfter: string }

/** First tactic `side` creates along a UCI line (e.g. the engine's main line). Skips promotion threats. */
export function firstTactic(fenStart: string, ucis: string[], side: Side, maxPlies = 8): LineTactic | null {
  let c: Chess;
  try { c = new Chess(fenStart); } catch { return null; }
  for (let i = 0; i < Math.min(ucis.length, maxPlies); i++) {
    const u = ucis[i];
    const before = c.fen();
    let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined }); } catch { return null; }
    if (m.color !== side) continue;
    const t = describeTactics(before, m as PlyMove, c.fen()).find((x) => x.kind !== 'promotion');
    if (t) return { ply: i, move: m as PlyMove, tactic: t, fenBefore: before, fenAfter: c.fen() };
  }
  return null;
}
