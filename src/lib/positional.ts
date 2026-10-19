/**
 * Positional layer for the advanced coach: what a real coach talks about when there is no immediate tactic.
 *
 *   tactics.ts            "what tactic did this move create?"
 *   tactics-lookahead.ts  "what can each side do next move?"
 *   positional.ts (this)  "what is structurally good or bad here, and what should I do about it?"
 *
 * Covers: open / half-open files, rooks on the 7th, doubled rooks, open diagonals, good / bad bishops, bishop pair,
 * knight outposts and holes, isolated / doubled / backward / passed pawns, pawn islands, the centre,
 * king safety (castling, pawn shield, enemy pieces near the king, open files at the king, back-rank weakness),
 * absolute pins, trapped and loose pieces, development, and endgame ideas (active king, rule of the square).
 *
 * The checklist follows the standard coaching approach (king safety -> material/threats -> piece activity ->
 * pawn structure -> weak squares -> plan). Everything is computed from the board; nothing is guessed.
 *
 * Main entry points:
 *   positionalInsights(fen, { you?, limit? })            static notes about the position
 *   moveInsights(fenBefore, move, fenAfter, you?)         what THIS move changed structurally (good and bad)
 *   coachPlan(fen, side, you?)                            "what should this side do next?"
 */
import { Chess, type Square } from 'chess.js';
import { VAL, NAME, other, movesFor, winnableCaptures, type Side } from './tactics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type FactKind =
  | 'open-file' | 'half-open' | 'file-info' | 'file-king' | 'rook-7th' | 'rook-battery'
  | 'diagonal' | 'bishop-pair' | 'bad-bishop' | 'rim-knight'
  | 'outpost' | 'outpost-available'
  | 'isolated' | 'doubled' | 'backward' | 'passed' | 'islands' | 'center'
  | 'castled' | 'king-center' | 'shield' | 'king-zone' | 'back-rank'
  | 'pin' | 'trapped' | 'loose' | 'development' | 'early-queen'
  | 'endgame-king' | 'unstoppable';

export interface Arrow { from: Square; to: Square }
export interface Fact {
  /** Stable id, so the same feature can be matched before / after a move. */
  key: string;
  kind: FactKind;
  /** Whose pawn / piece / king this is about (null = neutral, like an open file). */
  side: Side | null;
  polarity: 'asset' | 'weakness' | 'info';
  /** A full sentence a coach would say. */
  text: string;
  /** The rule of thumb behind it. */
  lesson?: string;
  arrows: Arrow[];
  squares: Square[];
  /** Importance, ~5 (minor) to ~30 (decisive). */
  score: number;
}

export interface Insight {
  key: string;
  kind: FactKind;
  side: Side | null;
  verdict: 'good' | 'bad' | 'neutral';
  text: string;
  lesson?: string;
  arrows: Arrow[];
  squares: Square[];
  score: number;
}

export interface PlanItem { text: string; arrows: Arrow[]; squares: Square[]; score: number }
export type Phase = 'opening' | 'middlegame' | 'endgame';

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------
const FILES = 'abcdefgh';
type Piece = { type: string; color: Side };
type Grid = (Piece | null)[][]; // grid[rank 0..7][file 0..7], rank 0 = rank 1
const S = (f: number, r: number) => (FILES[f] + (r + 1)) as Square;
const on = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;
const dirOf = (s: Side) => (s === 'w' ? 1 : -1);
const rel = (s: Side, r: number) => (s === 'w' ? r : 7 - r);
const fileName = (f: number) => `${FILES[f]}-file`;

function toGrid(c: Chess): Grid {
  const g: Grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  c.board().forEach((row, i) => row.forEach((p, f) => { if (p) g[7 - i][f] = { type: p.type, color: p.color as Side }; }));
  return g;
}

interface Located { f: number; r: number; type: string; color: Side; sq: Square }
function pieces(g: Grid): Located[] {
  const out: Located[] = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = g[r][f];
    if (p) out.push({ f, r, type: p.type, color: p.color, sq: S(f, r) });
  }
  return out;
}

const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const STRAIGHT = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ALL8 = [...DIAG, ...STRAIGHT];

/** Pieces of colour `by` that attack square (f, r) right now. */
function attackers(g: Grid, f: number, r: number, by: Side): Located[] {
  const res: Located[] = [];
  const add = (ff: number, rr: number) => { const p = g[rr][ff]!; res.push({ f: ff, r: rr, type: p.type, color: p.color, sq: S(ff, rr) }); };
  const pr = by === 'w' ? r - 1 : r + 1;
  for (const df of [-1, 1]) if (on(f + df, pr) && g[pr][f + df]?.color === by && g[pr][f + df]?.type === 'p') add(f + df, pr);
  for (const [df, dr] of KN) if (on(f + df, r + dr) && g[r + dr][f + df]?.color === by && g[r + dr][f + df]?.type === 'n') add(f + df, r + dr);
  for (const [df, dr] of ALL8) if (on(f + df, r + dr) && g[r + dr][f + df]?.color === by && g[r + dr][f + df]?.type === 'k') add(f + df, r + dr);
  for (const [df, dr] of ALL8) {
    const diag = df !== 0 && dr !== 0;
    let ff = f + df, rr = r + dr;
    while (on(ff, rr)) {
      const p = g[rr][ff];
      if (p) {
        if (p.color === by && (p.type === 'q' || (diag ? p.type === 'b' : p.type === 'r'))) add(ff, rr);
        break;
      }
      ff += df; rr += dr;
    }
  }
  return res;
}

/** Squares a slider can reach along its lines (stops at the first piece, includes it), plus the far end of each ray. */
function sliderReach(g: Grid, f: number, r: number, dirs: number[][]) {
  let count = 0;
  const ends: Square[] = [];
  const squares: Square[] = [];
  for (const [df, dr] of dirs) {
    let ff = f + df, rr = r + dr, last: Square | null = null;
    while (on(ff, rr)) {
      count++; last = S(ff, rr); squares.push(last);
      if (g[rr][ff]) break;
      ff += df; rr += dr;
    }
    if (last) ends.push(last);
  }
  return { count, ends, squares };
}

const kingOf = (all: Located[], s: Side) => all.find((p) => p.type === 'k' && p.color === s);

const phaseOf = (all: Located[], fullmove: number): Phase => {
  const mat = all.filter((p) => 'nbrq'.includes(p.type)).reduce((a, p) => a + VAL[p.type], 0);
  if (fullmove <= 10 && mat >= 50) return 'opening';
  if (mat <= 24 || (!all.some((p) => p.type === 'q') && mat <= 30)) return 'endgame';
  return 'middlegame';
};

/** Wording helpers: "you / your opponent" if `you` is given, otherwise "White / Black". */
function words(you?: Side) {
  const nm = (s: Side) => (you ? (s === you ? 'you' : 'your opponent') : s === 'w' ? 'White' : 'Black');
  const pos = (s: Side) => (you ? (s === you ? 'your' : "your opponent's") : s === 'w' ? "White's" : "Black's");
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  return { nm, pos, cap };
}

// ---------------------------------------------------------------------------
// Fact detection
// ---------------------------------------------------------------------------
export function analyzePhase(fen: string): Phase {
  try {
    const c = new Chess(fen);
    return phaseOf(pieces(toGrid(c)), Number(fen.split(' ')[5]) || 1);
  } catch { return 'middlegame'; }
}

export function positionFacts(fen: string, you?: Side, deep = true): Fact[] {
  let c: Chess;
  try { c = new Chess(fen); } catch { return []; }
  const g = toGrid(c);
  const all = pieces(g);
  const parts = fen.split(' ');
  const rights = parts[2] ?? '-';
  const fullmove = Number(parts[5]) || 1;
  const phase = phaseOf(all, fullmove);
  const { pos, cap } = words(you);
  const facts: Fact[] = [];
  const push = (f: Fact) => facts.push(f);
  const sides: Side[] = ['w', 'b'];

  const pawns: Record<Side, Located[]> = { w: all.filter((p) => p.type === 'p' && p.color === 'w'), b: all.filter((p) => p.type === 'p' && p.color === 'b') };
  const of = (s: Side, t: string) => all.filter((p) => p.color === s && p.type === t);
  const king = { w: kingOf(all, 'w'), b: kingOf(all, 'b') };

  // ===== FILES ============================================================
  for (let f = 0; f < 8; f++) {
    const wp = pawns.w.filter((p) => p.f === f), bp = pawns.b.filter((p) => p.f === f);
    const isOpen = !wp.length && !bp.length;
    const heavyOn = (s: Side) => all.filter((p) => p.color === s && p.f === f && (p.type === 'r' || p.type === 'q'));
    const anyHeavy = heavyOn('w').length + heavyOn('b').length > 0;
    if (isOpen && !anyHeavy) {
      push({
        key: `file-info:${f}`, kind: 'file-info', side: null, polarity: 'info', score: 9,
        text: `The ${fileName(f)} is completely open: whoever lands a rook there first controls it.`,
        lesson: 'Rooks belong on open files.', arrows: [], squares: [S(f, 0), S(f, 7)],
      });
    }
    for (const s of sides) {
      const mine = s === 'w' ? wp : bp, theirs = s === 'w' ? bp : wp;
      const heavy = heavyOn(s);
      if (heavy.length && !mine.length) {
        const h = heavy.sort((a, b) => (a.type === 'r' ? -1 : 1) - (b.type === 'r' ? -1 : 1))[0];
        const ek = king[other(s)];
        const nearKing = !!ek && Math.abs(ek.f - f) <= 1;
        if (isOpen) {
          push({
            key: `rookfile:${s}:${f}`, kind: 'open-file', side: s, polarity: 'asset', score: 20 + (nearKing ? 8 : 0),
            text: `${cap(pos(s))} ${NAME[h.type]} on ${h.sq} controls the open ${fileName(f)}${nearKing ? ', and it points straight at the enemy king' : rel(s, h.r) < 6 ? ', so it can invade the seventh rank' : ''}.`,
            lesson: 'Control the open file, then double rooks on it and enter on the 7th or 8th rank.',
            arrows: [{ from: h.sq, to: S(f, s === 'w' ? 7 : 0) }], squares: [h.sq],
          });
        } else {
          const target = theirs.sort((a, b) => (s === 'w' ? a.r - b.r : b.r - a.r))[0];
          push({
            key: `rookfile:${s}:${f}`, kind: 'half-open', side: s, polarity: 'asset', score: 13 + (nearKing ? 6 : 0),
            text: `${cap(pos(s))} ${NAME[h.type]} on ${h.sq} uses the half-open ${fileName(f)} to press on the pawn on ${target.sq}.`,
            lesson: 'A half-open file is a highway to an enemy pawn: pile up on it.',
            arrows: [{ from: h.sq, to: target.sq }], squares: [h.sq, target.sq],
          });
        }
      }
      // A really OPEN file (no pawns at all) next to the king of side s that the enemy can use.
      // (A file blocked by the attacker's own pawn is not a danger, and a quiet opening position is not either.)
      const k = king[s];
      if (k && phase !== 'endgame' && Math.abs(k.f - f) <= 1 && isOpen) {
        const onFile = heavyOn(other(s))[0];
        if (onFile || phase === 'middlegame') {
          const enemyHeavy = all.some((p) => p.color === other(s) && (p.type === 'r' || p.type === 'q'));
          if (enemyHeavy) {
            push({
              key: `fileking:${s}:${f}`, kind: 'file-king', side: s, polarity: 'weakness',
              score: 14 + (onFile ? 6 : 0) + (k.f === f ? 4 : 0),
              text: `The open ${fileName(f)} ${k.f === f ? 'runs straight at' : 'sits right next to'} ${pos(s)} king${onFile ? `, and ${pos(other(s))} ${NAME[onFile.type]} on ${onFile.sq} is already on it` : `, so ${pos(other(s))} rooks and queen can swing over and attack`}.`,
              lesson: 'Open files near your own king invite an attack. Close them or keep rooks ready to defend.',
              arrows: onFile ? [{ from: onFile.sq, to: k.sq }] : [], squares: [k.sq],
            });
          }
        }
      }
    }
  }

  // ===== ROOKS: 7th rank, batteries =======================================
  for (const s of sides) {
    const rooks = of(s, 'r');
    const ek = king[other(s)];
    for (const r of rooks) {
      if (rel(s, r.r) === 6) {
        const targets = pawns[other(s)].filter((p) => p.r === r.r);
        if ((ek && rel(s, ek.r) === 7) || targets.length) {
          push({
            key: `rook7:${s}:${r.sq}`, kind: 'rook-7th', side: s, polarity: 'asset', score: 17,
            text: `${cap(pos(s))} rook on ${r.sq} sits on the seventh rank, hitting pawns from behind and boxing the king in.`,
            lesson: 'A rook on the 7th rank is worth about a pawn: it attacks weak pawns and cuts the king off.',
            arrows: targets.slice(0, 2).map((t) => ({ from: r.sq, to: t.sq })), squares: [r.sq],
          });
        }
      }
    }
    for (let i = 0; i < rooks.length; i++) for (let j = i + 1; j < rooks.length; j++) {
      const a = rooks[i], b = rooks[j];
      if (a.f !== b.f) continue;
      let clear = true;
      for (let r = Math.min(a.r, b.r) + 1; r < Math.max(a.r, b.r); r++) if (g[r][a.f]) clear = false;
      const noOwnPawn = !pawns[s].some((p) => p.f === a.f);
      if (clear && noOwnPawn) {
        push({
          key: `battery:${s}:${a.f}`, kind: 'rook-battery', side: s, polarity: 'asset', score: 14,
          text: `${cap(pos(s))} rooks are doubled on the ${fileName(a.f)}: that is double the pressure on the file.`,
          lesson: 'Doubled rooks on an open file are hard to stop.', arrows: [], squares: [a.sq, b.sq],
        });
      }
    }
  }

  // ===== BISHOPS ==========================================================
  for (const s of sides) {
    const bishops = of(s, 'b');
    if (bishops.length >= 2 && of(other(s), 'b').length < 2 && pawns.w.length + pawns.b.length <= 14) {
      push({
        key: `bpair:${s}`, kind: 'bishop-pair', side: s, polarity: 'asset', score: 10,
        text: `${cap(pos(s))} two bishops cover both colours of squares; in an open position that is a real edge.`,
        lesson: 'The bishop pair loves open positions: avoid closing the game when you have it, trade it only for something concrete.',
        arrows: [], squares: bishops.map((b) => b.sq),
      });
    }
    for (const b of bishops) {
      const parity = (b.f + b.r) % 2;
      const sameColourPawns = pawns[s].filter((p) => (p.f + p.r) % 2 === parity);
      const { count, ends } = sliderReach(g, b.f, b.r, DIAG);
      const ek = king[other(s)];
      const hitsKing = !!ek && sliderReach(g, b.f, b.r, DIAG).squares.some((q) => Math.abs(FILES.indexOf(q[0]) - ek.f) <= 1 && Math.abs(Number(q[1]) - 1 - ek.r) <= 1);
      const longDiag = b.f === b.r || b.f + b.r === 7;
      if (sameColourPawns.length >= 5 && count <= 5) {
        push({
          key: `badbishop:${s}:${b.sq}`, kind: 'bad-bishop', side: s, polarity: 'weakness', score: 10,
          text: `${cap(pos(s))} bishop on ${b.sq} is "bad": ${sameColourPawns.length} of its own pawns stand on the same colour and hem it in.`,
          lesson: 'Put your pawns on the opposite colour of your bishop, or trade the bad bishop / break it free.',
          arrows: [], squares: [b.sq],
        });
      } else if ((longDiag && count >= 7) || count >= 10) {
        push({
          key: `diag:${s}:${b.sq}`, kind: 'diagonal', side: s, polarity: 'asset', score: 11 + (hitsKing ? 8 : 0),
          text: `${cap(pos(s))} bishop on ${b.sq} rakes an open ${longDiag ? 'long ' : ''}diagonal${hitsKing ? ' toward the enemy king' : ''}.`,
          lesson: 'Bishops need open diagonals. Keep your own pawns off its colour and aim it at the king or a weak pawn.',
          arrows: ends.slice(0, 2).map((e) => ({ from: b.sq, to: e })), squares: [b.sq],
        });
      }
    }
    for (const n of of(s, 'n')) {
      if (n.f === 0 || n.f === 7) {
        push({
          key: `rimknight:${s}:${n.sq}`, kind: 'rim-knight', side: s, polarity: 'weakness', score: 6,
          text: `${cap(pos(s))} knight on ${n.sq} is on the edge, where it controls half as many squares.`,
          lesson: 'A knight on the rim is dim: bring it toward the centre.', arrows: [], squares: [n.sq],
        });
      }
    }
  }

  // ===== PAWN STRUCTURE ===================================================
  for (const s of sides) {
    const mine = pawns[s], theirs = pawns[other(s)], d = dirOf(s);
    const byFile = (f: number) => mine.filter((p) => p.f === f);
    for (const p of mine) {
      const neighbours = mine.filter((q) => Math.abs(q.f - p.f) === 1);
      const isolated = neighbours.length === 0;
      const passed = !theirs.some((q) => Math.abs(q.f - p.f) <= 1 && (q.r - p.r) * d > 0);
      const stop = S(p.f, p.r + d);
      const behindOrLevel = neighbours.some((q) => (q.r - p.r) * d <= 0);
      const stopAttacked = on(p.f, p.r + d) && [-1, 1].some((df) => on(p.f + df, p.r + d + d) && g[p.r + d + d]?.[p.f + df]?.type === 'p' && g[p.r + d + d][p.f + df]?.color === other(s));
      if (isolated && mine.length > 1) {
        const front = on(p.f, p.r + d) ? S(p.f, p.r + d) : p.sq;
        push({
          key: `iso:${s}:${p.sq}`, kind: 'isolated', side: s, polarity: 'weakness', score: 12 + (phase === 'endgame' ? 4 : 0),
          text: `${cap(pos(s))} pawn on ${p.sq} is isolated: no neighbouring pawn can ever protect it, and ${front} in front of it is a perfect blockade square.`,
          lesson: 'Attack isolated pawns with pieces and blockade them. Its owner needs active pieces as compensation.',
          arrows: [], squares: [p.sq, front],
        });
      } else if (!passed && !isolated && !behindOrLevel && stopAttacked) {
        push({
          key: `back:${s}:${p.sq}`, kind: 'backward', side: s, polarity: 'weakness', score: 12,
          text: `${cap(pos(s))} pawn on ${p.sq} is backward: it cannot advance because ${stop} is controlled by an enemy pawn, and no pawn can protect it. ${stop} is a hole ${pos(other(s))} pieces can sit on.`,
          lesson: 'Attack backward pawns, especially on a half-open file, and plant a piece on the square in front.',
          arrows: [], squares: [p.sq, stop],
        });
      }
      if (passed) {
        const rr = rel(s, p.r);
        const protectedPawn = neighbours.some((q) => q.r === p.r - d);
        push({
          key: `pass:${s}:${p.sq}`, kind: 'passed', side: s, polarity: 'asset', score: 10 + rr * 4 + (protectedPawn ? 4 : 0),
          text: `${cap(pos(s))} pawn on ${p.sq} is passed${protectedPawn ? ' and protected' : ''}: no enemy pawn can stop it, so ${pos(other(s))} pieces are tied to blockading it.`,
          lesson: 'Passed pawns must be pushed, but support them with pieces first. The opponent should blockade in front of it.',
          arrows: on(p.f, p.r + d) ? [{ from: p.sq, to: S(p.f, s === 'w' ? 7 : 0) }] : [], squares: [p.sq],
        });
      }
    }
    for (let f = 0; f < 8; f++) {
      const col = byFile(f);
      if (col.length >= 2) {
        push({
          key: `dbl:${s}:${f}`, kind: 'doubled', side: s, polarity: 'weakness', score: 8,
          text: `${cap(pos(s))} pawns on ${col.map((p) => p.sq).join(' and ')} are doubled: they cannot protect each other and control fewer squares.`,
          lesson: 'Doubled pawns are fine if they give you an open file or tempo; otherwise they are a long-term weakness.',
          arrows: [], squares: col.map((p) => p.sq),
        });
      }
    }
    let islands = 0, inGroup = false;
    for (let f = 0; f < 8; f++) {
      const has = byFile(f).length > 0;
      if (has && !inGroup) islands++;
      inGroup = has;
    }
    if (islands >= 3) {
      push({
        key: `islands:${s}`, kind: 'islands', side: s, polarity: 'weakness', score: 7,
        text: `${cap(pos(s))} pawns are split into ${islands} islands, so many of them are hard to defend.`,
        lesson: 'Fewer pawn islands means a healthier structure.', arrows: [], squares: [],
      });
    }
    // Centre
    const centreRank = (p: Located) => rel(s, p.r) === 3 || rel(s, p.r) === 4;
    const centre = mine.filter((p) => (p.f === 3 || p.f === 4) && centreRank(p));
    if (centre.length === 2) {
      push({
        key: `centre:${s}`, kind: 'center', side: s, polarity: 'asset', score: 10,
        text: `${cap(pos(s))} pawns on ${centre.map((p) => p.sq).join(' and ')} give a strong centre and lots of space.`,
        lesson: 'Control the centre with pawns, then support it with pieces. Be ready to defend it against pawn breaks.',
        arrows: [], squares: centre.map((p) => p.sq),
      });
    }
  }

  // ===== OUTPOSTS & HOLES =================================================
  const pawnCanAttack = (s: Side, f: number, r: number) =>
    pawns[other(s)].some((q) => Math.abs(q.f - f) === 1 && (q.r - r) * dirOf(s) > 0);
  const pawnSupports = (s: Side, f: number, r: number) =>
    pawns[s].some((q) => Math.abs(q.f - f) === 1 && q.r === r - dirOf(s));
  for (const s of sides) {
    for (const p of all.filter((x) => x.color === s && (x.type === 'n' || x.type === 'b'))) {
      const rr = rel(s, p.r);
      if (rr >= 3 && rr <= 5 && pawnSupports(s, p.f, p.r) && !pawnCanAttack(s, p.f, p.r)) {
        push({
          key: `outpost:${s}:${p.sq}`, kind: 'outpost', side: s, polarity: 'asset', score: p.type === 'n' ? 20 : 12,
          text: `${cap(pos(s))} ${NAME[p.type]} on ${p.sq} is on an outpost: protected by a pawn and no enemy pawn can ever kick it away.`,
          lesson: 'Knights are strongest on protected outposts deep in enemy territory.',
          arrows: [], squares: [p.sq],
        });
      }
    }
    // an empty outpost square a knight can hop to
    const knights = of(s, 'n');
    let best: { sq: Square; from: Square; rr: number } | null = null;
    for (const n of knights) for (const [df, dr] of KN) {
      const f = n.f + df, r = n.r + dr;
      if (!on(f, r) || g[r][f]) continue;
      const rr = rel(s, r);
      if (rr >= 3 && rr <= 5 && pawnSupports(s, f, r) && !pawnCanAttack(s, f, r) && (!best || rr > best.rr)) best = { sq: S(f, r), from: n.sq, rr };
    }
    if (best) {
      push({
        key: `outpost-avail:${s}:${best.sq}`, kind: 'outpost-available', side: s, polarity: 'asset', score: 14,
        text: `${cap(pos(s))} knight on ${best.from} can jump to ${best.sq}: protected by a pawn, and no enemy pawn can ever attack it. That is a hole in ${pos(other(s))} camp.`,
        lesson: 'If the opponent has a square no pawn can defend, put a knight there.',
        arrows: [{ from: best.from, to: best.sq }], squares: [best.sq],
      });
    }
  }

  // ===== KING SAFETY ======================================================
  for (const s of sides) {
    const k = king[s];
    if (!k) continue;
    const kr = rel(s, k.r);
    const enemy = other(s);
    const home = kr === 0;
    const castledSide = home && (k.f >= 6 || k.f <= 2);
    const queensOn = all.some((p) => p.type === 'q');
    const myRights = s === 'w' ? /[KQ]/.test(rights) : /[kq]/.test(rights);
    const enemyHeavy = all.filter((p) => p.color === enemy && (p.type === 'r' || p.type === 'q'));

    if (castledSide) {
      push({
        key: `castled:${s}`, kind: 'castled', side: s, polarity: 'asset', score: 5,
        text: `${cap(pos(s))} king is tucked away behind its pawns.`,
        lesson: 'Castle early: it protects the king and connects the rooks.', arrows: [], squares: [k.sq],
      });
    }
    if (phase !== 'endgame' && queensOn && kr <= 1 && k.f >= 3 && k.f <= 5) {
      if (!myRights) {
        push({
          key: `kingcenter:${s}`, kind: 'king-center', side: s, polarity: 'weakness', score: 16,
          text: `${cap(pos(s))} king is stuck in the centre and can no longer castle; if the centre opens it will be in danger.`,
          lesson: 'A king in the centre with queens on is a target. Open the centre against it.',
          arrows: [], squares: [k.sq],
        });
      } else if (fullmove >= 7) {
        push({
          key: `kingcenter:${s}`, kind: 'king-center', side: s, polarity: 'weakness', score: 9,
          text: `${cap(pos(s))} king has not castled yet. Castle before the centre opens.`,
          lesson: 'Castle early, and every minor piece should come out first.', arrows: [], squares: [k.sq],
        });
      }
    }

    if (phase !== 'endgame') {
      // pawn shield
      if (castledSide) {
        const holes: number[] = [];
        for (const f of [k.f - 1, k.f, k.f + 1]) {
          if (f < 0 || f > 7) continue;
          if (!pawns[s].some((p) => p.f === f && (rel(s, p.r) === 1 || rel(s, p.r) === 2))) holes.push(f);
        }
        for (const f of holes.slice(0, 2)) {
          push({
            key: `shield:${s}:${f}`, kind: 'shield', side: s, polarity: 'weakness', score: 10,
            text: `${cap(pos(s))} king has lost its ${FILES[f]}-pawn shield, so the squares in front of it are exposed.`,
            lesson: 'Do not move pawns in front of your castled king without a reason: every pawn move leaves permanent holes.',
            arrows: [], squares: [k.sq],
          });
        }
      }
      // enemy pieces aiming at the king zone
      const seen = new Map<string, { p: Located; target: Square }>();
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
        const f = k.f + df, r = k.r + dr;
        if (!on(f, r) || (df === 0 && dr === 0)) continue;
        for (const a of attackers(g, f, r, enemy)) if (a.type !== 'p' && !seen.has(a.sq)) seen.set(a.sq, { p: a, target: S(f, r) });
      }
      if (seen.size >= 2) {
        const list = [...seen.values()];
        push({
          key: `zone:${s}:${Math.min(seen.size, 4)}`, kind: 'king-zone', side: s, polarity: 'weakness', score: 7 * Math.min(seen.size, 4),
          text: `${cap(pos(other(s)))} ${list.slice(0, 3).map((x) => `${NAME[x.p.type]} on ${x.p.sq}`).join(', ')} are all aiming at the squares around ${pos(s)} king.`,
          lesson: 'More attackers than defenders near the king means danger: add defenders or trade the attackers.',
          arrows: list.slice(0, 3).map((x) => ({ from: x.p.sq, to: x.target })), squares: [k.sq],
        });
      }
    }

    // back-rank weakness: every square in front of the king is blocked by its own men or covered by the enemy
    if (home && enemyHeavy.length && !all.some((p) => p.color === s && p.r === k.r && (p.type === 'r' || p.type === 'q'))) {
      const r = k.r + dirOf(s);
      const front = [-1, 0, 1].map((df) => k.f + df).filter((f) => f >= 0 && f <= 7);
      const sealed = front.every((f) => {
        const p = g[r][f];
        return (!!p && p.color === s) || attackers(g, f, r, enemy).length > 0;
      });
      if (sealed && g[r][k.f]?.color === s) {
        push({
          key: `backrank:${s}`, kind: 'back-rank', side: s, polarity: 'weakness', score: 14,
          text: `${cap(pos(s))} king has no escape squares: a rook or queen reaching the back rank would be checkmate.`,
          lesson: 'Make luft: give your king a flight square with a pawn move, and keep a rook on the back rank.',
          arrows: [], squares: [k.sq],
        });
      }
    }
  }

  // ===== PINS (absolute) ==================================================
  for (const s of sides) {
    const k = king[s];
    if (!k) continue;
    for (const [df, dr] of ALL8) {
      const diag = df !== 0 && dr !== 0;
      let f = k.f + df, r = k.r + dr, first: Located | null = null;
      while (on(f, r)) {
        const p = g[r][f];
        if (p) {
          if (!first) {
            if (p.color !== s) break;
            first = { f, r, type: p.type, color: p.color, sq: S(f, r) };
          } else {
            if (p.color !== s && (p.type === 'q' || (diag ? p.type === 'b' : p.type === 'r'))) {
              push({
                key: `pin:${s}:${first.sq}`, kind: 'pin', side: s, polarity: 'weakness', score: 12 + (VAL[first.type] > 3 ? 4 : 0),
                text: `${cap(pos(s))} ${NAME[first.type]} on ${first.sq} is pinned to its king by the ${NAME[p.type]} on ${S(f, r)}, so it cannot move.`,
                lesson: 'Unpin with a pawn move, a block, or by attacking the pinning piece twice. Do not rely on a pinned piece as a defender.',
                arrows: [{ from: S(f, r), to: first.sq }, { from: first.sq, to: k.sq }], squares: [first.sq],
              });
            }
            break;
          }
        }
        f += df; r += dr;
      }
    }
  }

  // ===== LOOSE PIECES =====================================================
  for (const s of sides) {
    const loose = all
      .filter((p) => p.color === s && 'nbrq'.includes(p.type) && attackers(g, p.f, p.r, s).length === 0)
      .sort((a, b) => VAL[b.type] - VAL[a.type])
      .slice(0, 2);
    if (loose.length >= 1 && phase !== 'opening') {
      for (const p of loose) {
        const hit = attackers(g, p.f, p.r, other(s)).length > 0;
        push({
          key: `loose:${s}:${p.sq}`, kind: 'loose', side: s, polarity: 'weakness', score: hit ? 18 : 6,
          text: `${cap(pos(s))} ${NAME[p.type]} on ${p.sq} is unprotected${hit ? ' and already attacked' : ''}.`,
          lesson: 'Loose pieces drop off. Keep every piece protected, because forks and double attacks feed on loose pieces.',
          arrows: [], squares: [p.sq],
        });
      }
    }
  }

  // ===== DEVELOPMENT ======================================================
  if (phase === 'opening' || (phase === 'middlegame' && fullmove <= 15)) {
    const homeSq: Record<Side, string[]> = { w: ['b1', 'c1', 'f1', 'g1'], b: ['b8', 'c8', 'f8', 'g8'] };
    const lag = (s: Side) => homeSq[s].filter((q) => { const p = c.get(q as Square); return p && p.color === s && (p.type === 'n' || p.type === 'b'); });
    for (const s of sides) {
      const undeveloped = lag(s);
      const mine = lag(s).length, theirs = lag(other(s)).length;
      if (undeveloped.length >= 2 && fullmove >= 4 && mine > theirs) {
        push({
          key: `dev:${s}`, kind: 'development', side: s, polarity: 'weakness', score: 6 + undeveloped.length * 2,
          text: `${cap(pos(s))} ${undeveloped.length} minor pieces are still at home: ${pos(other(s))} lead in development could become dangerous.`,
          lesson: 'Develop knights and bishops, castle, then connect the rooks. Do not move the same piece twice without a reason.',
          arrows: [], squares: undeveloped as Square[],
        });
      }
      const q = of(s, 'q')[0];
      if (q && fullmove <= 8 && q.sq !== (s === 'w' ? 'd1' : 'd8') && undeveloped.length >= 2) {
        push({
          key: `earlyq:${s}`, kind: 'early-queen', side: s, polarity: 'weakness', score: 7,
          text: `${cap(pos(s))} queen came out early: minor pieces can chase it with tempo.`,
          lesson: 'Develop minor pieces first; the queen belongs behind them until the position opens.',
          arrows: [], squares: [q.sq],
        });
      }
    }
  }

  // ===== ENDGAME ==========================================================
  if (phase === 'endgame') {
    for (const s of sides) {
      const k = king[s];
      if (!k) continue;
      const central = k.f >= 2 && k.f <= 5 && k.r >= 2 && k.r <= 5;
      if (central) {
        push({
          key: `egking:${s}:c`, kind: 'endgame-king', side: s, polarity: 'asset', score: 9,
          text: `${cap(pos(s))} king is active in the centre, which is where it belongs in an endgame.`,
          lesson: 'In the endgame the king is a fighting piece: centralise it.', arrows: [], squares: [k.sq],
        });
      } else if ((rel(s, k.r) === 0 || k.f === 0 || k.f === 7) && king[other(s)] && king[other(s)]!.f >= 2 && king[other(s)]!.f <= 5 && king[other(s)]!.r >= 2 && king[other(s)]!.r <= 5) {
        push({
          key: `egking:${s}:p`, kind: 'endgame-king', side: s, polarity: 'weakness', score: 8,
          text: `${cap(pos(s))} king is still on the edge; with queens off it should walk toward the centre.`,
          lesson: 'Activate the king in the endgame.', arrows: [], squares: [k.sq],
        });
      }
      // Rule of the square: enemy has only king + pawns
      const enemy = other(s);
      const enemyOnlyKP = !all.some((p) => p.color === enemy && 'nbrq'.includes(p.type));
      const ek = king[enemy];
      if (enemyOnlyKP && ek) {
        for (const p of pawns[s]) {
          const passed = !pawns[enemy].some((q) => Math.abs(q.f - p.f) <= 1 && (q.r - p.r) * dirOf(s) > 0);
          if (!passed) continue;
          const promoR = s === 'w' ? 7 : 0;
          let steps = Math.abs(promoR - p.r);
          if (rel(s, p.r) === 1) steps -= 1;
          const dist = Math.max(Math.abs(ek.f - p.f), Math.abs(ek.r - promoR));
          const kingToMove = parts[1] === enemy;
          if (dist > steps + (kingToMove ? 1 : 0)) {
            push({
              key: `unstop:${s}:${p.sq}`, kind: 'unstoppable', side: s, polarity: 'asset', score: 24,
              text: `${cap(pos(s))} pawn on ${p.sq} is outside the square of the enemy king, so the king cannot catch it.`,
              lesson: 'Rule of the square: if the defending king cannot step into the square drawn from the pawn to its promotion square, the pawn runs through.',
              arrows: [{ from: p.sq, to: S(p.f, promoR) }], squares: [p.sq],
            });
          }
        }
      }
    }
  }

  // ===== TRAPPED PIECES (deeper, uses the exchange check from tactics.ts) =
  if (deep) {
    for (const s of sides) {
      let attacked: ReturnType<typeof winnableCaptures>;
      try { attacked = winnableCaptures(fen, other(s)).filter((x) => x.victim !== 'p' && g[Number(x.to[1]) - 1][FILES.indexOf(x.to[0])]?.color === s); } catch { continue; }
      const seenSq = new Set<string>();
      for (const cap0 of attacked.slice(0, 2)) {
        if (seenSq.has(cap0.to)) continue;
        seenSq.add(cap0.to);
        const mv = movesFor(fen, s).filter((m) => m.from === cap0.to);
        let safe = false;
        for (const m of mv) {
          try {
            const t = new Chess(fen.split(' ').map((x, i) => (i === 1 ? s : i === 3 ? '-' : x)).join(' '));
            t.move(m.san);
            if (!winnableCaptures(t.fen(), other(s)).some((x) => x.to === m.to)) { safe = true; break; }
          } catch { /* ignore */ }
        }
        if (!safe) {
          push({
            key: `trapped:${s}:${cap0.to}`, kind: 'trapped', side: s, polarity: 'weakness', score: 20,
            text: `${cap(pos(s))} ${NAME[cap0.victim]} on ${cap0.to} is trapped — it is attacked and has nowhere safe to go.`,
            lesson: 'Before grabbing a pawn or sending a piece deep, check it can get out again.',
            arrows: [{ from: cap0.from, to: cap0.to }], squares: [cap0.to],
          });
        }
      }
    }
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
const toInsight = (f: Fact, text = f.text, verdict?: Insight['verdict'], you?: Side): Insight => {
  let v: Insight['verdict'] = f.polarity === 'asset' ? 'good' : f.polarity === 'weakness' ? 'bad' : 'neutral';
  // With a viewpoint ("you"), the opponent's asset is bad news and the opponent's weakness is good news.
  if (you && f.side && f.side !== you && v !== 'neutral') v = v === 'good' ? 'bad' : 'good';
  return { key: f.key, kind: f.kind, side: f.side, text, lesson: f.lesson, arrows: f.arrows, squares: f.squares, score: f.score, verdict: verdict ?? v };
};

/** Picks the most important facts, at most two per kind so the coach does not repeat itself. */
function topVaried<T extends { kind: FactKind; score: number }>(items: T[], limit: number): T[] {
  const per = new Map<FactKind, number>();
  const out: T[] = [];
  for (const it of [...items].sort((a, b) => b.score - a.score)) {
    const n = per.get(it.kind) ?? 0;
    if (n >= 2) continue;
    per.set(it.kind, n + 1);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

/** Static notes about a position, most important first. */
export function positionalInsights(fen: string, opts: { you?: Side; limit?: number; deep?: boolean } = {}): Insight[] {
  const facts = positionFacts(fen, opts.you, opts.deep ?? true).filter((f) => f.score >= 7);
  return topVaried(facts, opts.limit ?? 5).map((f) => toInsight(f, f.text, undefined, opts.you));
}

/**
 * What a move changed structurally. Compares the position before and after:
 * new assets / weaknesses for the mover and the opponent, and ones that disappeared.
 * `verdict` is from the mover's point of view.
 */
export function moveInsights(
  fenBefore: string,
  move: { color: Side; san?: string; piece?: string; from?: string; to?: string; captured?: string },
  fenAfter: string,
  you?: Side,
  limit = 4,
  /** Was the move itself good? Decides the wording: a bad move never gets "Also good:", a good move never gets "Careful:". */
  moveIsGood = true,
): Insight[] {
  const mover = move.color;
  const before = new Map(positionFacts(fenBefore, you).map((f) => [f.key, f]));
  const after = new Map(positionFacts(fenAfter, you).map((f) => [f.key, f]));
  const out: Insight[] = [];
  const lc = (t: string) => (/^(White|Black)/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
  const gone = (t: string) => `Before this move, ${lc(t.replace(/\.$/, ''))}; now that is gone.`;
  for (const [k, f] of after) {
    if (before.has(k) || f.score < 7) continue;
    if (f.polarity === 'info') { out.push(toInsight(f, f.text, 'neutral')); continue; }
    const mine = f.side === mover;
    if (f.polarity === 'asset') {
      out.push(toInsight(f, (mine ? (moveIsGood ? 'Good: ' : 'On the plus side: ') : 'Watch out: ') + f.text, mine ? 'good' : 'bad'));
    } else if (mine) {
      // A good move that leaves a small weakness is a trade-off, not an error: neutral wording and colour.
      out.push(toInsight(f, (moveIsGood ? 'Note: ' : 'Careful: ') + f.text, moveIsGood ? 'neutral' : 'bad'));
    } else {
      out.push(toInsight(f, (moveIsGood ? 'Nice: ' : 'Still: ') + f.text, 'good'));
    }
  }
  for (const [k, f] of before) {
    if (after.has(k) || f.score < 10 || f.polarity === 'info') continue;
    const mine = f.side === mover;
    if (f.polarity === 'asset') {
      out.push(toInsight(f, (mine ? 'The cost: ' : moveIsGood ? 'Also good: ' : 'On the plus side: ') + gone(f.text), mine ? 'bad' : 'good'));
    } else if (mine) {
      out.push(toInsight(f, (moveIsGood ? 'Also good: this fixes a problem. ' : 'At least this fixes a problem. ') + gone(f.text), 'good'));
    } else {
      out.push(toInsight(f, 'The opponent gets to fix a problem. ' + gone(f.text), 'bad'));
    }
  }
  // What the move itself is, in coach language
  const san = move.san ?? '';
  const mk = (key: string, kind: FactKind, text: string, lesson: string, score: number): Insight =>
    ({ key, kind, side: mover, verdict: 'good', text, lesson, arrows: [], squares: [], score });
  if (/^O-O/.test(san)) {
    out.push(mk('x:castle', 'castled', san.startsWith('O-O-O') ? 'Castling queenside tucks the king away and brings a rook toward the centre.' : 'Castling kingside tucks the king away and brings the rook into play.', 'Castle early: king safety first, then connect the rooks.', 14));
  } else if (move.piece && move.from && move.to) {
    const homeRank = mover === 'w' ? '1' : '8';
    const phase = analyzePhase(fenBefore);
    if ((move.piece === 'n' || move.piece === 'b') && move.from[1] === homeRank && phase === 'opening') {
      out.push(mk('x:develop', 'development', `Developing the ${NAME[move.piece]} brings a new piece into the game.`, 'Develop minor pieces before moving the queen or making pawn moves on the wing.', 9));
    }
    if (move.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(move.to) && phase === 'opening') {
      out.push(mk('x:centre', 'center', `Taking the centre with a pawn on ${move.to} gains space and gives the pieces room.`, 'Control the centre with pawns, then develop pieces to support them.', 10));
    }
    if (move.piece === 'q' && phase === 'opening' && Number(fenBefore.split(' ')[5]) <= 6) {
      out.push({ ...mk('x:earlyq', 'early-queen', 'Bringing the queen out this early lets the opponent chase it with developing moves.', 'Develop minor pieces first; the queen can wait.', 8), verdict: 'bad' });
    }
  }
  return topVaried(out, limit);
}

/** "What should this side do next?" in coach language, based on what is actually on the board. */
export function coachPlan(fen: string, side: Side, you?: Side, limit = 3): PlanItem[] {
  const { pos } = words(you);
  const facts = positionFacts(fen, you, false);
  const mine = facts.filter((f) => f.side === side);
  const theirs = facts.filter((f) => f.side === other(side));
  const plan: PlanItem[] = [];
  const add = (text: string, f?: Fact, score = 10) => plan.push({ text, arrows: f?.arrows ?? [], squares: f?.squares ?? [], score });

  for (const f of mine.filter((x) => x.kind === 'pin' || x.kind === 'back-rank' || (x.kind === 'loose' && x.score >= 18) || x.kind === 'trapped'))
    add(f.kind === 'back-rank' ? 'Make luft with a pawn move so a back-rank check cannot be mate.'
      : f.kind === 'pin' ? 'Break the pin before it costs you: move the king, block, or attack the pinning piece.'
      : f.kind === 'trapped' ? 'Rescue the trapped piece right now.'
      : `Protect or move the ${f.squares[0] ? 'piece on ' + f.squares[0] : 'loose piece'}.`, f, 40);
  const kc = mine.find((x) => x.kind === 'king-center');
  if (kc) add('Get your king to safety: castle, and clear the way with a developing move.', kc, 30);
  const dev = mine.find((x) => x.kind === 'development');
  if (dev) add('Finish developing your minor pieces before starting anything new.', dev, 22);
  const sh = theirs.find((x) => x.kind === 'shield' || x.kind === 'file-king' || x.kind === 'king-center');
  if (sh) add(`Go after ${pos(other(side))} king: bring more pieces to the attack and open a file towards it.`, sh, 26);
  const weakPawn = theirs.find((x) => x.kind === 'isolated' || x.kind === 'backward' || x.kind === 'doubled');
  if (weakPawn) add(`Target the weak pawn: ${weakPawn.squares[0]} is a long-term target. Put a piece on ${weakPawn.squares[1] ?? 'the square in front'} and pile up with rooks.`, weakPawn, 24);
  const outpost = mine.find((x) => x.kind === 'outpost-available');
  if (outpost) add(`Reroute the knight to ${outpost.squares[0]}, a square no pawn can chase it from.`, outpost, 23);
  const openFile = facts.find((x) => x.kind === 'file-info') ?? undefined;
  if (openFile && !mine.some((x) => x.kind === 'open-file')) add(`Put a rook on the open ${openFile.text.match(/The (\S+-file)/)?.[1] ?? 'file'} before the opponent does.`, openFile, 21);
  const passed = mine.find((x) => x.kind === 'passed');
  if (passed) add(`Support the passed pawn on ${passed.squares[0]} with pieces and push it when it is safe.`, passed, 20);
  const theirPassed = theirs.find((x) => x.kind === 'passed');
  if (theirPassed) add(`Blockade the enemy passed pawn on ${theirPassed.squares[0]} with a piece in front of it.`, theirPassed, 19);
  const eg = mine.find((x) => x.kind === 'endgame-king' && x.polarity === 'weakness');
  if (eg) add('Bring your king toward the centre; in the endgame it is a strong piece.', eg, 18);
  const bad = mine.find((x) => x.kind === 'bad-bishop');
  if (bad) add('Trade the bad bishop, or free it by moving pawns off its colour.', bad, 12);
  return topVaried(plan.map((p) => ({ ...p, kind: 'plan' as unknown as FactKind })), limit).map(({ text, arrows, squares, score }) => ({ text, arrows, squares, score }));
}

/** Plain text -> segments for the Text component in AdvancedCoach (bold the squares). */
export function toSegs(text: string): { t: string; hl?: 'key' | 'good' | 'bad' }[] {
  return text.split(/(\b[a-h][1-8]\b)/).filter(Boolean).map((t) => (/^[a-h][1-8]$/.test(t) ? { t, hl: 'key' as const } : { t }));
}

/**
 * One verb phrase saying what a move achieves structurally, or null.
 * Example: "takes control of the open d-file", "leaves the opponent with a weak pawn".
 * Used by the coach where it would otherwise say "improves the position".
 */
export function movePurpose(
  fenBefore: string,
  move: { color: Side; san?: string; piece?: string; from?: string; to?: string; captured?: string },
  fenAfter: string,
): string | null {
  const mover = move.color;
  const fileOf = (key: string) => {
    const m = /:(\d)$/.exec(key);
    return m ? FILES[Number(m[1])] : null;
  };
  for (const i of moveInsights(fenBefore, move, fenAfter, undefined, 8)) {
    const added = /^(Good|Nice):/.test(i.text) || i.kind === 'file-info';
    if (!added || i.verdict === 'bad' || i.key.startsWith('x:')) continue;
    const mine = i.side === mover;
    const f = fileOf(i.key);
    switch (i.kind) {
      case 'open-file': if (mine) return `takes control of the open ${f}-file`; break;
      case 'half-open': if (mine) return `puts pressure on a pawn along the half-open ${f}-file`; break;
      case 'file-info': return `opens the ${f}-file for the rooks`;
      case 'rook-7th': if (mine) return 'lands a rook on the seventh rank'; break;
      case 'rook-battery': if (mine) return 'doubles the rooks on the file'; break;
      case 'diagonal': if (mine) return 'opens a long diagonal for the bishop'; break;
      case 'bishop-pair': if (mine) return 'wins the bishop pair'; break;
      case 'outpost': if (mine) return 'establishes a piece on a strong outpost'; break;
      case 'outpost-available': if (mine) return 'prepares a strong outpost for the knight'; break;
      case 'passed': if (mine) return 'creates a dangerous passed pawn'; break;
      case 'center': if (mine) return 'builds a strong pawn centre'; break;
      case 'isolated': case 'doubled': case 'backward': case 'islands':
        if (!mine) return 'leaves the opponent with a weak pawn structure'; break;
      case 'back-rank': if (!mine) return "exploits the enemy king's lack of escape squares"; break;
      case 'king-center': case 'shield': case 'king-zone': case 'file-king':
        if (!mine) return 'puts the enemy king under pressure'; break;
      case 'unstoppable': if (mine) return 'creates a pawn the enemy king cannot catch'; break;
      default: break;
    }
  }
  return null;
}
