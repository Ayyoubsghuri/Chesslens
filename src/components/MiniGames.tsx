// Board-vision mini-games for the Learn Path.
// Place in src/components/MiniGames.tsx
//
// Self-contained: this file draws its own board and pieces and every game is played by click / tap,
// so it does not depend on ChessBoard or Piece. chess.js is only used to check captures, and every
// position handed to it has both kings (chess.js 1.x refuses to load a position without them).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Chess } from 'chess.js';
import { logMiniGame, type Activity } from '@/lib/activity';
import {
  ArrowLeft, Crosshair, Scale, Timer, Palette, Move, Eye, ShieldAlert,
  Crown, GitBranch, Zap, Layers, Focus, Swords,
} from 'lucide-react';

// ───────────── tiny chess toolkit (no chess.js needed) ─────────────

type PT = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
type Col = 'w' | 'b';
interface Pc { t: PT; c: Col }
type Board = Map<string, Pc>; // key: 'e4'

const FILES = 'abcdefgh';
const sq = (f: number, r: number) => FILES[f] + (r + 1);
const fr = (s: string): [number, number] => [s.charCodeAt(0) - 97, parseInt(s[1], 10) - 1];
const rnd = (n: number) => Math.floor(Math.random() * n);
const inb = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;
const pick = <T,>(a: readonly T[]): T => a[rnd(a.length)];
const randomSquare = () => sq(rnd(8), rnd(8));
const kingDist = (a: string, b: string) => {
  const [af, ar] = fr(a), [bf, br] = fr(b);
  return Math.max(Math.abs(af - bf), Math.abs(ar - br));
};

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ALL8 = ROOK.concat(BISHOP);
const PIECES: PT[] = ['q', 'r', 'b', 'n', 'p'];

/** Squares a piece attacks. Sliders stop at (and include) the first piece they meet. */
function attacksFrom(board: Board, from: string): string[] {
  const p = board.get(from);
  if (!p) return [];
  const [f0, r0] = fr(from);
  const out: string[] = [];
  const walk = (dirs: number[][], slide: boolean) => {
    for (const [df, dr] of dirs) {
      let f = f0 + df, r = r0 + dr;
      while (inb(f, r)) {
        const s = sq(f, r);
        out.push(s);
        if (!slide || board.has(s)) break;
        f += df; r += dr;
      }
    }
  };
  if (p.t === 'n') walk(KNIGHT, false);
  else if (p.t === 'k') walk(ALL8, false);
  else if (p.t === 'r') walk(ROOK, true);
  else if (p.t === 'b') walk(BISHOP, true);
  else if (p.t === 'q') walk(ALL8, true);
  else {
    const dr = p.c === 'w' ? 1 : -1;
    for (const df of [-1, 1]) if (inb(f0 + df, r0 + dr)) out.push(sq(f0 + df, r0 + dr));
  }
  return out;
}

function isAttacked(board: Board, s: string, by: Col): boolean {
  for (const [from, p] of board) if (p.c === by && attacksFrom(board, from).includes(s)) return true;
  return false;
}

function kingSq(board: Board, c: Col): string | null {
  for (const [s, p] of board) if (p.t === 'k' && p.c === c) return s;
  return null;
}

/** Drops a piece on a random free square (pawns never on rank 1 or 8) and returns that square. */
function put(board: Board, t: PT, c: Col): string {
  for (let i = 0; i < 300; i++) {
    const f = rnd(8), r = rnd(8);
    const s = sq(f, r);
    if (board.has(s) || (t === 'p' && (r === 0 || r === 7))) continue;
    board.set(s, { t, c });
    return s;
  }
  for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) {
    const s = sq(f, r);
    if (!board.has(s) && !(t === 'p' && (r === 0 || r === 7))) { board.set(s, { t, c }); return s; }
  }
  return 'a1';
}

/** Both kings on random squares, not touching. */
function withKings(): { board: Board; wk: string; bk: string } {
  const board: Board = new Map();
  const wk = randomSquare();
  let bk = randomSquare();
  while (kingDist(wk, bk) < 2) bk = randomSquare();
  board.set(wk, { t: 'k', c: 'w' });
  board.set(bk, { t: 'k', c: 'b' });
  return { board, wk, bk };
}

function toFen(board: Board, turn: Col): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board.get(sq(f, r));
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p.c === 'w' ? p.t.toUpperCase() : p.t;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${turn} - - 0 1`;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Captures `side` can make, split into all targets and the ones the opponent cannot take back. */
function captureInfo(board: Board, side: Col): { all: string[]; safe: string[] } {
  const chess = new Chess(toFen(board, side));
  const all = new Set<string>(), safe = new Set<string>();
  for (const m of chess.moves({ verbose: true })) {
    if (!m.captured) continue;
    all.add(m.to);
    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    const back = chess.moves({ verbose: true }).some((x) => x.to === m.to && !!x.captured);
    chess.undo();
    if (!back) safe.add(m.to);
  }
  return { all: [...all], safe: [...safe] };
}

// ───────────── puzzle generators ─────────────

function genCheck(): { board: Board; inCheck: boolean } {
  const want = Math.random() < 0.5;
  for (let i = 0; i < 800; i++) {
    const { board, wk, bk } = withKings();
    const n = 2 + rnd(3);
    for (let j = 0; j < n; j++) put(board, pick(PIECES), Math.random() < 0.6 ? 'b' : 'w');
    if (isAttacked(board, bk, 'w')) continue; // White is to move, so Black cannot be in check
    const inCheck = isAttacked(board, wk, 'b');
    if (inCheck === want) return { board, inCheck };
  }
  return {
    board: new Map<string, Pc>([['e1', { t: 'k', c: 'w' }], ['e8', { t: 'k', c: 'b' }], ['e5', { t: 'r', c: 'b' }]]),
    inCheck: true,
  };
}

/** White pieces that Black (to move) can win for free: attacked and nobody can recapture. */
function genHanging(): { board: Board; answers: string[] } {
  for (let i = 0; i < 600; i++) {
    const { board, wk, bk } = withKings();
    const nW = 3 + rnd(3), nB = 2 + rnd(3);
    for (let j = 0; j < nW; j++) put(board, pick(PIECES), 'w');
    for (let j = 0; j < nB; j++) put(board, pick(PIECES), 'b');
    if (isAttacked(board, bk, 'w') || isAttacked(board, wk, 'b')) continue;
    const { safe } = captureInfo(board, 'b');
    const answers = safe.filter((s) => board.get(s)?.c === 'w');
    // The hint says "attacked and has no defender". Only keep boards where that simple rule and the exact
    // rules of chess agree (a king that cannot really recapture, a pinned defender... would make it unfair).
    const simple = [...board]
      .filter(([s, p]) => p.c === 'w' && p.t !== 'k' && isAttacked(board, s, 'b') && !isAttacked(board, s, 'w'))
      .map(([s]) => s);
    if (!sameSet(simple, answers)) continue;
    if (answers.length >= 1 && answers.length <= 2) return { board, answers };
  }
  return {
    board: new Map<string, Pc>([['g1', { t: 'k', c: 'w' }], ['h8', { t: 'k', c: 'b' }], ['e4', { t: 'p', c: 'w' }], ['d6', { t: 'n', c: 'b' }]]),
    answers: ['e4'],
  };
}

/** Black pieces White can capture without being recaptured. */
function genCaptures(): { board: Board; answers: string[] } {
  for (let i = 0; i < 800; i++) {
    const { board, wk, bk } = withKings();
    const nW = 2 + rnd(3), nB = 3 + rnd(2);
    for (let j = 0; j < nW; j++) put(board, pick(PIECES), 'w');
    for (let j = 0; j < nB; j++) put(board, pick(PIECES), 'b');
    if (isAttacked(board, bk, 'w') || isAttacked(board, wk, 'b')) continue;
    const { all, safe } = captureInfo(board, 'w');
    // keep only boards where "White attacks it and Black has no defender" matches the exact rules
    const simple = [...board]
      .filter(([s, p]) => p.c === 'b' && p.t !== 'k' && all.includes(s) && !isAttacked(board, s, 'b'))
      .map(([s]) => s);
    if (!sameSet(simple, safe)) continue;
    // prefer boards that also contain a tempting but defended capture
    if (safe.length >= 1 && safe.length <= 3 && (all.length > safe.length || i > 400)) return { board, answers: safe };
  }
  return {
    board: new Map<string, Pc>([['e1', { t: 'k', c: 'w' }], ['e8', { t: 'k', c: 'b' }], ['e4', { t: 'p', c: 'w' }], ['d5', { t: 'p', c: 'b' }]]),
    answers: ['d5'],
  };
}

/** A marked White piece; is it attacking two or more enemy pieces at once? */
function genFork(): { board: Board; mark: string; targets: string[]; isFork: boolean } {
  const want = Math.random() < 0.5;
  for (let i = 0; i < 1000; i++) {
    const { board } = withKings();
    const mark = put(board, pick<PT>(['n', 'n', 'n', 'q', 'b', 'r']), 'w');
    const nB = 2 + rnd(3);
    for (let j = 0; j < nB; j++) put(board, pick(PIECES), 'b');
    const targets = attacksFrom(board, mark).filter((s) => board.get(s)?.c === 'b');
    const isFork = targets.length >= 2;
    if (isFork === want) return { board, mark, targets, isFork };
  }
  const board: Board = new Map<string, Pc>([
    ['e1', { t: 'k', c: 'w' }], ['a8', { t: 'k', c: 'b' }],
    ['d5', { t: 'n', c: 'w' }], ['c7', { t: 'r', c: 'b' }], ['f6', { t: 'q', c: 'b' }],
  ]);
  return { board, mark: 'd5', targets: ['c7', 'f6'], isFork: true };
}

const ray = (from: string, df: number, dr: number): string[] => {
  const [f0, r0] = fr(from);
  const out: string[] = [];
  let f = f0 + df, r = r0 + dr;
  while (inb(f, r)) { out.push(sq(f, r)); f += df; r += dr; }
  return out;
};

/** Absolute pin: the piece stands between White's king and a Black slider that would otherwise give check. */
function pinnerOf(board: Board, s: string): string | null {
  const p = board.get(s);
  const wk = kingSq(board, 'w');
  if (!p || p.c !== 'w' || p.t === 'k' || !wk) return null;
  if (isAttacked(board, wk, 'b')) return null;
  const without = new Map(board);
  without.delete(s);
  for (const [from, q] of without) {
    if (q.c === 'b' && attacksFrom(without, from).includes(wk)) return from;
  }
  return null;
}

function genPin(): { board: Board; mark: string; isPinned: boolean; pinner: string | null } {
  const want = Math.random() < 0.5;
  for (let i = 0; i < 1500; i++) {
    const board: Board = new Map();
    const wk = randomSquare();
    board.set(wk, { t: 'k', c: 'w' });
    const [df, dr] = pick(ALL8);
    const line = ray(wk, df, dr);
    if (line.length < 2) continue;
    const ortho = df === 0 || dr === 0;
    const a = rnd(line.length - 1);              // where the White piece stands
    const b = a + 1 + rnd(line.length - a - 1);  // where the Black slider stands, beyond it
    const markT = pick<PT>(['n', 'b', 'r', 'q', 'p', 'n', 'b']);
    const [, mr] = fr(line[a]);
    if (markT === 'p' && (mr === 0 || mr === 7)) continue;
    const goodSlider: PT = pick<PT>(ortho ? ['r', 'q'] : ['b', 'q']);
    const wrongSlider: PT = ortho ? 'b' : 'r';
    board.set(line[a], { t: markT, c: 'w' });
    if (want) {
      board.set(line[b], { t: goodSlider, c: 'b' });
    } else {
      const variant = pick(['wrong', 'double', 'none', 'offline']);
      if (variant === 'wrong') board.set(line[b], { t: wrongSlider, c: 'b' });
      else if (variant === 'double' && b - a >= 2) {
        board.set(line[b], { t: goodSlider, c: 'b' });
        // a second blocker between the piece and the slider: no pawns here, they could land on rank 1 or 8
        board.set(line[a + 1 + rnd(b - a - 1)], { t: pick<PT>(['q', 'r', 'b', 'n']), c: Math.random() < 0.5 ? 'w' : 'b' });
      } else if (variant === 'offline') {
        board.delete(line[a]);
        put(board, markT, 'w');
        put(board, goodSlider, 'b');
      } // 'none': nothing behind the piece
    }
    let bk = randomSquare();
    let guard = 0;
    while ((board.has(bk) || kingDist(wk, bk) < 2) && guard++ < 100) bk = randomSquare();
    if (board.has(bk)) continue;
    board.set(bk, { t: 'k', c: 'b' });
    const clutter = rnd(3);
    for (let j = 0; j < clutter; j++) put(board, pick(PIECES), Math.random() < 0.5 ? 'w' : 'b');
    const wkNow = kingSq(board, 'w')!;
    if (isAttacked(board, wkNow, 'b') || isAttacked(board, bk, 'w')) continue;
    // the marked piece is the one we put on the line (or the relocated one)
    const marks = [...board].filter(([s, p]) => p.c === 'w' && p.t !== 'k' && pinnerOf(board, s) !== null).map(([s]) => s);
    const mark = want ? line[a] : [...board].find(([s, p]) => p.c === 'w' && p.t === markT && !marks.includes(s))?.[0];
    if (!mark) continue;
    const pinner = pinnerOf(board, mark);
    if ((pinner !== null) !== want) continue;
    if (!want && marks.length > 0) continue; // keep "No" boards free of any other pin that could confuse
    return { board, mark, isPinned: want, pinner };
  }
  const board: Board = new Map<string, Pc>([
    ['e1', { t: 'k', c: 'w' }], ['e2', { t: 'n', c: 'w' }], ['e7', { t: 'r', c: 'b' }], ['a8', { t: 'k', c: 'b' }],
  ]);
  return { board, mark: 'e2', isPinned: true, pinner: 'e7' };
}

// ───────────── games list ─────────────

type GameId =
  | 'coords' | 'knight' | 'value' | 'colors' | 'legals' | 'hanging' | 'check'
  | 'kingpath' | 'bishopcolor' | 'captures' | 'sight' | 'forks' | 'pins';

const GAMES: { id: GameId; title: string; blurb: string; max: string; icon: ReactNode }[] = [
  { id: 'coords', title: 'Coordinate Sprint', blurb: '60 seconds. Click the named square as many times as you can.', max: 'squares', icon: <Timer size={18} /> },
  { id: 'knight', title: 'Knight Hop', blurb: 'Move the knight to the target in as few jumps as possible. 5 rounds, up to 15 points.', max: '/ 15', icon: <Crosshair size={18} /> },
  { id: 'value', title: 'Material Count', blurb: 'Who is ahead on material: White, Black, or equal? 10 quick questions.', max: '/ 10', icon: <Scale size={18} /> },
  { id: 'colors', title: 'Square Colors', blurb: 'Light or dark? Train automatic colour recognition. 30 questions.', max: '/ 30', icon: <Palette size={18} /> },
  { id: 'legals', title: 'Legal Moves', blurb: 'Click every legal square for the given piece. Empty board, 8 rounds.', max: '/ 8', icon: <Move size={18} /> },
  { id: 'hanging', title: 'Hanging Pieces', blurb: 'Find the unprotected piece that can be captured for free. 8 puzzles.', max: '/ 8', icon: <ShieldAlert size={18} /> },
  { id: 'check', title: 'Check or Not', blurb: 'Is White in check? Fast yes / no training. 12 positions.', max: '/ 12', icon: <Zap size={18} /> },
  { id: 'kingpath', title: 'King Path', blurb: 'Move the king to the target square in the fewest moves. 5 rounds.', max: '/ 15', icon: <Crown size={18} /> },
  { id: 'bishopcolor', title: 'Bishop Colour', blurb: 'Are the two squares the same colour complex? Yes or no. 15 questions.', max: '/ 15', icon: <Layers size={18} /> },
  { id: 'captures', title: 'Safe Captures', blurb: 'Click a piece White can capture safely. 8 boards.', max: '/ 8', icon: <Swords size={18} /> },
  { id: 'sight', title: 'Piece Sight', blurb: 'Click every square the highlighted piece attacks. Other pieces block the way. 8 rounds.', max: '/ 8', icon: <Eye size={18} /> },
  { id: 'forks', title: 'Fork Finder', blurb: 'Does the marked piece attack two or more enemy pieces at once? 10 puzzles.', max: '/ 10', icon: <GitBranch size={18} /> },
  { id: 'pins', title: 'Pin Spotter', blurb: 'Is the marked White piece pinned against its king? Yes / no. 10 positions.', max: '/ 10', icon: <Focus size={18} /> },
];

export function MiniGames({ activity, onPlayed }: { activity: Activity; onPlayed: (id: string, score: number) => void }) {
  const [open, setOpen] = useState<GameId | null>(null);
  const finish = (id: GameId) => (score: number) => {
    logMiniGame(id, score);
    onPlayed(id, score);
  };

  if (open) {
    const g = GAMES.find((x) => x.id === open)!;
    const best = activity.mini[open]?.best;
    return (
      <div className="card p-5">
        <button onClick={() => setOpen(null)} className="text-xs text-ink-400 hover:text-ink-200 flex items-center gap-1 mb-2">
          <ArrowLeft size={12} /> Mini games
        </button>
        <h4 className="font-bold text-lg mb-3 flex items-center gap-2">{g.icon} {g.title}</h4>
        {open === 'coords' && <CoordGame best={best} onFinish={finish('coords')} />}
        {open === 'knight' && <HopGame kind="n" best={best} onFinish={finish('knight')} />}
        {open === 'value' && <ValueGame best={best} onFinish={finish('value')} />}
        {open === 'colors' && <ColorGame best={best} onFinish={finish('colors')} />}
        {open === 'legals' && <SelectGame mode="legals" best={best} onFinish={finish('legals')} />}
        {open === 'hanging' && <HangingGame best={best} onFinish={finish('hanging')} />}
        {open === 'check' && <CheckGame best={best} onFinish={finish('check')} />}
        {open === 'kingpath' && <HopGame kind="k" best={best} onFinish={finish('kingpath')} />}
        {open === 'bishopcolor' && <BishopColorGame best={best} onFinish={finish('bishopcolor')} />}
        {open === 'captures' && <CapturesGame best={best} onFinish={finish('captures')} />}
        {open === 'sight' && <SelectGame mode="sight" best={best} onFinish={finish('sight')} />}
        {open === 'forks' && <ForksGame best={best} onFinish={finish('forks')} />}
        {open === 'pins' && <PinsGame best={best} onFinish={finish('pins')} />}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {GAMES.map((g) => {
        const m = activity.mini[g.id];
        return (
          <button key={g.id} onClick={() => setOpen(g.id)}
            className="card p-4 text-left hover:border-brand-400/40 transition-colors flex flex-col gap-2">
            <span className="flex items-center gap-2 font-semibold text-sm text-ink-100">{g.icon} {g.title}</span>
            <span className="text-xs text-ink-400 leading-snug flex-1">{g.blurb}</span>
            <span className="text-xs text-ink-500">
              {m ? <>Best <b className="text-brand-300">{m.best}</b> {g.max} · {m.plays} play{m.plays === 1 ? '' : 's'}</> : 'Not played yet'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ───────────── shared UI ─────────────

type Overlay = 'sel' | 'ok' | 'bad' | 'miss' | 'target' | 'last' | 'mark' | 'trail';
interface CellInfo { piece?: Pc; overlay?: Overlay; dot?: boolean; label?: string }

const OVERLAY_BG: Record<Overlay, string> = {
  sel: 'rgba(56,189,248,.65)',
  ok: 'rgba(52,211,153,.85)',
  bad: 'rgba(248,113,113,.85)',
  miss: 'rgba(252,211,77,.75)',
  target: 'rgba(255,214,10,.6)', // gold: stands out on both the light and the green squares
  last: 'rgba(247,198,49,.45)',
  mark: 'rgba(116,155,191,.75)',
  trail: 'rgba(255,255,255,.28)',
};
const LIGHT = '#ebecd0';
const DARK = '#779556';

const GLYPH: Record<PT, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟︎' };

function PieceGlyph({ t, c }: Pc) {
  return (
    <span
      aria-hidden="true"
      className="relative z-10 leading-none select-none pointer-events-none"
      style={{
        fontSize: 'clamp(1.8rem, 8vw, 2.9rem)',
        color: c === 'w' ? '#ffffff' : '#161512',
        WebkitTextStroke: c === 'w' ? '0.8px #1b1b1b' : '0',
        textShadow: c === 'w'
          ? '0 0 1px #000, 0 1px 2px rgba(0,0,0,.7)'
          : '0 0 1px rgba(255,255,255,.35)',
      }}
    >
      {GLYPH[t]}
    </span>
  );
}

function MiniBoard({ flipped, onSquare, cell, sizeClass = 'max-w-[420px]' }: {
  flipped?: boolean;
  onSquare: (f: number, r: number) => void;
  cell: (f: number, r: number) => CellInfo;
  sizeClass?: string;
}) {
  const ranks = flipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <div className={`grid grid-cols-8 w-full ${sizeClass} mx-auto rounded-lg overflow-hidden select-none border border-ink-700`}>
      {ranks.flatMap((r) =>
        files.map((f) => {
          const dark = (f + r) % 2 === 0;
          const c = cell(f, r);
          return (
            <button
              type="button"
              key={`${f}${r}`}
              onClick={() => onSquare(f, r)}
              data-sq={sq(f, r)}
              data-piece={c.piece?.t}
              data-color={c.piece?.c}
              data-overlay={c.overlay}
              aria-label={sq(f, r)}
              className="aspect-square relative flex items-center justify-center touch-manipulation"
              style={{ background: dark ? DARK : LIGHT }}
            >
              {c.overlay && (
                <span
                  className="absolute inset-0"
                  style={{
                    background: OVERLAY_BG[c.overlay],
                    boxShadow: c.overlay === 'target' ? 'inset 0 0 0 3px #d99a00' : undefined,
                  }}
                />
              )}
              {c.overlay === 'target' && !c.piece && (
                <span className="absolute z-10 w-1/2 h-1/2 rounded-full border-4 pointer-events-none" style={{ borderColor: '#b45309' }} />
              )}
              {c.dot && <span className="absolute z-10 w-3 h-3 rounded-full bg-black/35" />}
              {c.piece && <PieceGlyph t={c.piece.t} c={c.piece.c} />}
              {c.label && <span className="relative z-10 text-lg font-bold text-black">{c.label}</span>}
            </button>
          );
        }),
      )}
    </div>
  );
}

function Result({ score, max, best, onAgain, extra }: { score: number; max: string; best?: number; onAgain: () => void; extra?: string }) {
  return (
    <div className="text-center space-y-3 py-4">
      <p className="text-4xl font-bold text-brand-300">{score} <span className="text-lg text-ink-400">{max}</span></p>
      {extra && <p className="text-sm text-ink-400">{extra}</p>}
      {best !== undefined && <p className="text-xs text-ink-500">{score > best ? 'New personal best! +5 XP' : `Personal best: ${best} · +5 XP`}</p>}
      <button onClick={onAgain} className="btn-primary text-sm">Play again</button>
    </div>
  );
}

const choiceCls = (answered: boolean, isCorrect: boolean, isPicked: boolean) =>
  answered && isCorrect ? '!bg-emerald-500/30 !border-emerald-400' : isPicked ? '!bg-red-500/30 !border-red-400' : '';

// ───────────── 1. Coordinate Sprint ─────────────

function CoordGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [phase, setPhase] = useState<'idle' | 'run' | 'done'>('idle');
  const [flip, setFlip] = useState(false);
  const [target, setTarget] = useState<[number, number]>([4, 3]);
  const [score, setScore] = useState(0);
  const [miss, setMiss] = useState(0);
  const [left, setLeft] = useState(60);
  const [flash, setFlash] = useState<{ key: string; ok: boolean } | null>(null);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);
  const endAt = useRef(0);
  const scoreRef = useRef(0);
  const finished = useRef(false);

  const pickSq = (prev?: [number, number]): [number, number] => {
    let f = 0, r = 0;
    do { f = rnd(8); r = rnd(8); } while (prev && prev[0] === f && prev[1] === r);
    return [f, r];
  };

  const start = () => {
    scoreRef.current = 0;
    finished.current = false;
    setPrevBest(best);
    setScore(0); setMiss(0); setLeft(60);
    endAt.current = Date.now() + 60000;
    setTarget(pickSq());
    setPhase('run');
  };

  useEffect(() => {
    if (phase !== 'run') return;
    const id = window.setInterval(() => {
      const l = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setLeft(l);
      if (l <= 0 && !finished.current) {
        finished.current = true;
        window.clearInterval(id);
        setPhase('done');
        onFinish(scoreRef.current);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const click = (f: number, r: number) => {
    if (phase !== 'run') return;
    const ok = f === target[0] && r === target[1];
    setFlash({ key: `${f}${r}`, ok });
    window.setTimeout(() => setFlash(null), 250);
    if (ok) {
      scoreRef.current++;
      setScore(scoreRef.current);
      setTarget(pickSq(target));
    } else setMiss((m) => m + 1);
  };

  if (phase === 'done') {
    const acc = score + miss > 0 ? Math.round((score / (score + miss)) * 100) : 0;
    return <Result score={score} max="squares" best={prevBest} extra={`${acc}% accuracy`} onAgain={start} />;
  }

  return (
    <div className="space-y-3">
      {phase === 'idle' ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <div className="flex gap-1 p-1 rounded-lg bg-ink-800 text-sm">
            <button onClick={() => setFlip(false)} className={`px-3 py-1 rounded-md ${!flip ? 'bg-ink-600 text-white' : 'text-ink-400'}`}>As White</button>
            <button onClick={() => setFlip(true)} className={`px-3 py-1 rounded-md ${flip ? 'bg-ink-600 text-white' : 'text-ink-400'}`}>As Black</button>
          </div>
          <button onClick={start} className="btn-primary text-sm">Start 60s</button>
          {best !== undefined && <span className="text-xs text-ink-500">Best: {best}</span>}
        </div>
      ) : (
        <div className="flex items-center justify-between max-w-[420px] mx-auto">
          <span className="text-sm text-ink-400">Time <b className="text-ink-100 tabular-nums">{left}s</b></span>
          <span data-testid="coord-target" className="text-4xl font-bold font-mono text-brand-300">{sq(target[0], target[1])}</span>
          <span className="text-sm text-ink-400">Score <b className="text-ink-100 tabular-nums">{score}</b></span>
        </div>
      )}
      <MiniBoard flipped={flip} onSquare={click}
        cell={(f, r) => ({ overlay: flash?.key === `${f}${r}` ? (flash.ok ? 'ok' : 'bad') : undefined })} />
    </div>
  );
}

// ───────────── 2 + 8. Knight Hop / King Path ─────────────

type XY = [number, number];
interface HopPuz { start: XY; target: XY; opt: number }

function knightDist(f0: number, r0: number): number[][] {
  const d: number[][] = Array.from({ length: 8 }, () => Array(8).fill(-1));
  d[f0][r0] = 0;
  const q: XY[] = [[f0, r0]];
  while (q.length) {
    const [f, r] = q.shift()!;
    for (const [df, dr] of KNIGHT) {
      const nf = f + df, nr = r + dr;
      if (inb(nf, nr) && d[nf][nr] < 0) { d[nf][nr] = d[f][r] + 1; q.push([nf, nr]); }
    }
  }
  return d;
}

function newHopRound(kind: 'n' | 'k'): HopPuz {
  const start: XY = [rnd(8), rnd(8)];
  if (kind === 'n') {
    const d = knightDist(start[0], start[1]);
    const cands: XY[] = [];
    for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) if (d[f][r] >= 2 && d[f][r] <= 4) cands.push([f, r]);
    const target = cands[rnd(cands.length)];
    return { start, target, opt: d[target[0]][target[1]] };
  }
  let target: XY;
  let dist = 0;
  do {
    target = [rnd(8), rnd(8)];
    dist = Math.max(Math.abs(start[0] - target[0]), Math.abs(start[1] - target[1]));
  } while (dist < 2 || dist > 5);
  return { start, target, opt: dist };
}

function isHop(kind: 'n' | 'k', a: XY, b: XY): boolean {
  const dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
  return kind === 'n' ? (dx === 1 && dy === 2) || (dx === 2 && dy === 1) : dx <= 1 && dy <= 1 && dx + dy > 0;
}

interface HopState { puz: HopPuz; pos: XY; moves: number; trail: string[]; pts: number | null; note: string }
const freshHop = (kind: 'n' | 'k'): HopState => {
  const puz = newHopRound(kind);
  return { puz, pos: puz.start, moves: 0, trail: [], pts: null, note: '' };
};

function HopGame({ kind, onFinish, best }: { kind: 'n' | 'k'; onFinish: (s: number) => void; best?: number }) {
  const [phase, setPhase] = useState<'play' | 'done'>('play');
  const [round, setRound] = useState(0);
  const [st, setSt] = useState<HopState>(() => freshHop(kind));
  const [total, setTotal] = useState(0);
  const [hints, setHints] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const name = kind === 'n' ? 'knight' : 'king';
  const targetSq = sq(st.puz.target[0], st.puz.target[1]);

  const click = (f: number, r: number) => {
    if (st.pts !== null) return;
    if (!isHop(kind, st.pos, [f, r])) {
      setSt({ ...st, note: kind === 'n' ? 'A knight jumps in an L: two squares one way, one the other.' : 'The king moves one square in any direction.' });
      return;
    }
    const moves = st.moves + 1;
    let pts: number | null = null;
    if (f === st.puz.target[0] && r === st.puz.target[1]) {
      const p = moves === st.puz.opt ? 3 : moves === st.puz.opt + 1 ? 1 : 0;
      pts = p;
      setTotal((t) => t + p);
    }
    setSt({ ...st, pos: [f, r], moves, trail: [...st.trail, sq(st.pos[0], st.pos[1])], pts, note: '' });
  };

  const restartRound = () => setSt({ ...st, pos: st.puz.start, moves: 0, trail: [], pts: null, note: '' });

  const next = () => {
    if (round === 4) { setPhase('done'); onFinish(total); return; }
    setRound((r) => r + 1);
    setSt(freshHop(kind));
  };

  const again = () => {
    setPrevBest(best === undefined ? total : Math.max(best, total));
    setRound(0); setTotal(0); setSt(freshHop(kind)); setPhase('play');
  };

  if (phase === 'done') return <Result score={total} max="/ 15" best={prevBest} onAgain={again} />;

  const here = sq(st.pos[0], st.pos[1]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Round <b className="text-ink-100">{round + 1}/5</b></span>
        <span>Moves <b className="text-ink-100">{st.moves}</b> <span className="text-ink-500">(best: {st.puz.opt})</span></span>
        <span>Points <b className="text-ink-100">{total}</b></span>
      </div>
      <MiniBoard
        onSquare={click}
        cell={(f, r) => {
          const s = sq(f, r);
          const legal = hints && st.pts === null && isHop(kind, st.pos, [f, r]);
          return {
            piece: s === here ? { t: kind, c: 'w' } : undefined,
            overlay: s === targetSq ? 'target' : st.trail.includes(s) ? 'trail' : undefined,
            dot: legal && s !== here,
          };
        }}
      />
      <div className="flex items-center justify-center gap-2 flex-wrap min-h-[2.25rem]">
        {st.pts === null ? (
          <>
            <p className="text-xs text-ink-500">{st.note || `Click where the ${name} should go. Reach the gold square.`}</p>
            <button onClick={() => setHints((h) => !h)} className="btn-ghost text-xs px-2 py-1">{hints ? 'Hide' : 'Show'} legal squares</button>
            {st.moves > 0 && <button onClick={restartRound} className="btn-ghost text-xs px-2 py-1">Restart round</button>}
          </>
        ) : (
          <>
            <p className="text-sm text-ink-200">
              {st.pts === 3 ? 'Perfect — shortest route! +3' : st.pts === 1 ? 'One move over the best. +1' : `Reached it in ${st.moves} — best was ${st.puz.opt}. +0`}
            </p>
            <button onClick={next} className="btn-primary text-sm">{round === 4 ? 'Finish' : 'Next round'}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── 3. Material Count ─────────────

interface Glyph { g: string; v: number }
const WHITE: Glyph[] = [{ g: '♕', v: 9 }, { g: '♖', v: 5 }, { g: '♗', v: 3 }, { g: '♘', v: 3 }, { g: '♙︎', v: 1 }];
const BLACK: Glyph[] = [{ g: '♛', v: 9 }, { g: '♜', v: 5 }, { g: '♝', v: 3 }, { g: '♞︎', v: 3 }, { g: '♟︎', v: 1 }];
const sum = (a: Glyph[]) => a.reduce((x, p) => x + p.v, 0);

function pickSide(set: Glyph[]): Glyph[] {
  const n = 2 + rnd(4);
  const out: Glyph[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    out.push(set[r < 0.4 ? 4 : r < 0.6 ? 2 : r < 0.75 ? 3 : r < 0.9 ? 1 : 0]);
  }
  return out.sort((a, b) => b.v - a.v);
}

function genQ() {
  for (let i = 0; i < 300; i++) {
    const w = pickSide(WHITE), b = pickSide(BLACK);
    const d = sum(w) - sum(b);
    if (Math.abs(d) <= 3 && (d !== 0 || Math.random() < 0.5)) return { w, b };
  }
  return { w: [WHITE[1]], b: [BLACK[1]] };
}

function ValueGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [q, setQ] = useState(genQ);
  const [n, setN] = useState(0);
  const [score, setScore] = useState(0);
  const [answer, setAnswer] = useState<'w' | 'e' | 'b' | null>(null);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const wv = sum(q.w), bv = sum(q.b);
  const correct: 'w' | 'e' | 'b' = wv > bv ? 'w' : wv < bv ? 'b' : 'e';

  const choose = (a: 'w' | 'e' | 'b') => {
    if (answer) return;
    setAnswer(a);
    if (a === correct) setScore((s) => s + 1);
  };
  const next = () => {
    if (n === 9) { setDone(true); onFinish(score); return; }
    setN(n + 1); setQ(genQ()); setAnswer(null);
  };
  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setN(0); setScore(0); setQ(genQ()); setAnswer(null); setDone(false);
  };

  if (done) return <Result score={score} max="/ 10" best={prevBest} onAgain={again} />;

  const btn = (key: 'w' | 'e' | 'b', label: string) => (
    <button key={key} onClick={() => choose(key)} disabled={!!answer}
      className={`btn-secondary text-sm flex-1 justify-center ${choiceCls(!!answer, key === correct, answer === key)}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4 max-w-[420px] mx-auto">
      <div className="flex justify-between text-sm text-ink-400">
        <span>Question <b className="text-ink-100">{n + 1}/10</b></span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-center">
        {[{ label: 'White', pcs: q.w, light: true }, { label: 'Black', pcs: q.b, light: false }].map((s) => (
          <div key={s.label} className={`rounded-xl p-3 ${s.light ? 'bg-[#f0d9b5] text-black' : 'bg-[#4a3b2c] text-white'}`}>
            <p className="text-xs font-semibold opacity-70 mb-1">{s.label}</p>
            <p data-testid={`pieces-${s.label.toLowerCase()}`} className="text-3xl leading-tight break-words">{s.pcs.map((p) => p.g).join(' ')}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-500 text-center">Queen 9 · Rook 5 · Bishop 3 · Knight 3 · Pawn 1</p>
      <div className="flex gap-2">{btn('w', 'White ahead')}{btn('e', 'Equal')}{btn('b', 'Black ahead')}</div>
      {answer && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-ink-200">{answer === correct ? 'Correct! ' : 'Not quite. '}White {wv} · Black {bv}</p>
          <button onClick={next} className="btn-primary text-sm">{n === 9 ? 'Finish' : 'Next'}</button>
        </div>
      )}
    </div>
  );
}

// ───────────── 4. Square Colors ─────────────

const isDarkSq = (s: string) => {
  const [f, r] = fr(s);
  return (f + r) % 2 === 0;
};

function ColorGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [n, setN] = useState(0);
  const [score, setScore] = useState(0);
  const [target, setTarget] = useState(() => randomSquare());
  const [answer, setAnswer] = useState<'l' | 'd' | null>(null);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const correct = isDarkSq(target) ? 'd' : 'l';

  const choose = (a: 'l' | 'd') => {
    if (answer) return;
    setAnswer(a);
    if (a === correct) setScore((s) => s + 1);
  };
  const next = () => {
    if (n === 29) { setDone(true); onFinish(score); return; }
    setN(n + 1); setTarget(randomSquare()); setAnswer(null);
  };
  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setN(0); setScore(0); setTarget(randomSquare()); setAnswer(null); setDone(false);
  };

  if (done) return <Result score={score} max="/ 30" best={prevBest} onAgain={again} />;

  return (
    <div className="space-y-4 max-w-[420px] mx-auto">
      <div className="flex justify-between text-sm text-ink-400">
        <span>Question <b className="text-ink-100">{n + 1}/30</b></span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      <div className="text-center">
        <p data-testid="color-target" className="text-5xl font-bold font-mono text-brand-300 mb-2">{target}</p>
        <p className="text-sm text-ink-400">Is this square light or dark?</p>
      </div>
      <div className="flex gap-3">
        <button onClick={() => choose('l')} disabled={!!answer}
          className={`btn-secondary flex-1 justify-center ${choiceCls(!!answer, correct === 'l', answer === 'l')}`}>
          Light
        </button>
        <button onClick={() => choose('d')} disabled={!!answer}
          className={`btn-secondary flex-1 justify-center ${choiceCls(!!answer, correct === 'd', answer === 'd')}`}>
          Dark
        </button>
      </div>
      {answer && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-ink-200">{answer === correct ? 'Correct!' : `It is ${correct === 'l' ? 'light' : 'dark'}.`}</p>
          <button onClick={next} className="btn-primary text-sm">{n === 29 ? 'Finish' : 'Next'}</button>
        </div>
      )}
    </div>
  );
}

// ───────────── 5 + 11. Legal Moves / Piece Sight ─────────────

interface SelPuz { board: Board; from: string; piece: PT; answers: Set<string> }

function newSelRound(mode: 'legals' | 'sight'): SelPuz {
  const piece = mode === 'legals' ? pick<PT>(['n', 'b', 'r', 'q', 'k']) : pick<PT>(['n', 'b', 'r', 'q']);
  const from = randomSquare();
  const board: Board = new Map<string, Pc>([[from, { t: piece, c: 'w' }]]);
  if (mode === 'sight') {
    const blockers = 2 + rnd(3);
    for (let i = 0; i < blockers; i++) put(board, pick(PIECES), Math.random() < 0.5 ? 'w' : 'b');
  }
  return { board, from, piece, answers: new Set(attacksFrom(board, from)) };
}

const PIECE_NAME: Record<PT, string> = { n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King', p: 'Pawn' };

function SelectGame({ mode, onFinish, best }: { mode: 'legals' | 'sight'; onFinish: (s: number) => void; best?: number }) {
  const [round, setRound] = useState(0);
  const [puz, setPuz] = useState(() => newSelRound(mode));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const click = (f: number, r: number) => {
    if (submitted) return;
    const s = sq(f, r);
    if (s === puz.from) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const hits = [...selected].filter((s) => puz.answers.has(s)).length;
  const perfect = selected.size === puz.answers.size && hits === puz.answers.size;

  const submit = () => {
    if (submitted || selected.size === 0) return;
    setSubmitted(true);
    if (perfect) setScore((s) => s + 1);
  };

  const next = () => {
    if (round === 7) { setDone(true); onFinish(score); return; }
    setRound((r) => r + 1);
    setPuz(newSelRound(mode));
    setSelected(new Set());
    setSubmitted(false);
  };

  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setRound(0); setScore(0); setPuz(newSelRound(mode));
    setSelected(new Set()); setSubmitted(false); setDone(false);
  };

  if (done) return <Result score={score} max="/ 8" best={prevBest} onAgain={again} />;

  return (
    <div className="space-y-3">
      <div className="flex justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Round <b className="text-ink-100">{round + 1}/8</b></span>
        <span>
          {mode === 'legals'
            ? <>Every legal square for the <b className="text-ink-100">{PIECE_NAME[puz.piece]}</b></>
            : <>Every square the <b className="text-ink-100">{PIECE_NAME[puz.piece]}</b> attacks</>}
        </span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      <MiniBoard
        onSquare={click}
        cell={(f, r) => {
          const s = sq(f, r);
          const isSel = selected.has(s);
          const isAns = puz.answers.has(s);
          let overlay: Overlay | undefined;
          if (submitted) {
            if (isSel && isAns) overlay = 'ok';
            else if (isSel) overlay = 'bad';
            else if (isAns) overlay = 'miss';
          } else if (isSel) overlay = 'sel';
          if (s === puz.from) overlay = 'mark';
          return { piece: puz.board.get(s), overlay };
        }}
      />
      <div className="flex items-center justify-center gap-2 flex-wrap min-h-[2.25rem]">
        {!submitted ? (
          <>
            <p className="text-xs text-ink-500">
              {mode === 'legals'
                ? 'Select every square the piece can move to, then submit.'
                : 'Pieces block the way. A square holding a piece counts if the line reaches it.'}
            </p>
            <button onClick={submit} className="btn-primary text-sm" disabled={selected.size === 0}>Submit</button>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-200">{perfect ? (mode === 'legals' ? 'Perfect!' : 'Perfect vision!') : `Found ${hits} of ${puz.answers.size}${selected.size > hits ? ` (${selected.size - hits} wrong)` : ''}`}</p>
            <button onClick={next} className="btn-primary text-sm">{round === 7 ? 'Finish' : 'Next'}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── 6 + 10. Hanging Pieces / Safe Captures (click a piece) ─────────────

interface PickPuz { board: Board; answers: string[] }

function PickGame({ gen, rounds, prompt, hint, canPick, okMsg, badMsg, onFinish, best }: {
  gen: () => PickPuz;
  rounds: number;
  prompt: string;
  hint: string;
  canPick: (p: Pc | undefined) => boolean;
  okMsg: string;
  badMsg: (answers: string[]) => string;
  onFinish: (s: number) => void;
  best?: number;
}) {
  const [round, setRound] = useState(0);
  const [puz, setPuz] = useState(gen);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const click = (f: number, r: number) => {
    if (picked) return;
    const s = sq(f, r);
    if (!canPick(puz.board.get(s))) { setNote(hint); return; }
    setNote('');
    setPicked(s);
    if (puz.answers.includes(s)) setScore((x) => x + 1);
  };

  const next = () => {
    if (round === rounds - 1) { setDone(true); onFinish(score); return; }
    setRound((r) => r + 1); setPuz(gen()); setPicked(null); setNote('');
  };
  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setRound(0); setScore(0); setPuz(gen()); setPicked(null); setNote(''); setDone(false);
  };

  if (done) return <Result score={score} max={`/ ${rounds}`} best={prevBest} onAgain={again} />;

  const right = picked !== null && puz.answers.includes(picked);
  return (
    <div className="space-y-3">
      <div className="flex justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Round <b className="text-ink-100">{round + 1}/{rounds}</b></span>
        <span>{prompt}</span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      <MiniBoard
        onSquare={click}
        cell={(f, r) => {
          const s = sq(f, r);
          let overlay: Overlay | undefined;
          if (picked) {
            if (s === picked) overlay = right ? 'ok' : 'bad';
            else if (!right && puz.answers.includes(s)) overlay = 'miss';
          }
          return { piece: puz.board.get(s), overlay };
        }}
      />
      <div className="flex items-center justify-center gap-2 flex-wrap min-h-[2.25rem]">
        {!picked ? (
          <p className="text-xs text-ink-500">{note || hint}</p>
        ) : (
          <>
            <p className="text-sm text-ink-200">{right ? okMsg : badMsg(puz.answers)}</p>
            <button onClick={next} className="btn-primary text-sm">{round === rounds - 1 ? 'Finish' : 'Next'}</button>
          </>
        )}
      </div>
    </div>
  );
}

function HangingGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  return (
    <PickGame
      gen={genHanging}
      rounds={8}
      prompt="Click White's hanging piece"
      hint="A hanging piece is attacked by Black and has no defender. Black is to move."
      canPick={(p) => !!p && p.c === 'w' && p.t !== 'k'}
      okMsg="Correct — that piece is hanging!"
      badMsg={(a) => `Not hanging. Hanging: ${a.join(', ')} (highlighted)`}
      onFinish={onFinish}
      best={best}
    />
  );
}

function CapturesGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  return (
    <PickGame
      gen={genCaptures}
      rounds={8}
      prompt="Click a Black piece White can take safely"
      hint="A safe capture is one the opponent cannot take back. White is to move."
      canPick={(p) => !!p && p.c === 'b' && p.t !== 'k'}
      okMsg="Yes — safe capture!"
      badMsg={(a) => `Not safe. Safe captures: ${a.join(', ')} (highlighted)`}
      onFinish={onFinish}
      best={best}
    />
  );
}

// ───────────── 7, 9, 12, 13. Yes / no games ─────────────

function YesNoGame<T>({ gen, total, question, yesLabel, noLabel, truth, board, explain, onFinish, best }: {
  gen: () => T;
  total: number;
  question: string;
  yesLabel: string;
  noLabel: string;
  truth: (p: T) => boolean;
  board: (p: T, answered: boolean) => ReactNode;
  explain: (p: T, correct: boolean) => string;
  onFinish: (s: number) => void;
  best?: number;
}) {
  const [n, setN] = useState(0);
  const [score, setScore] = useState(0);
  const [puz, setPuz] = useState<T>(gen);
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const correct = truth(puz);
  const choose = (a: boolean) => {
    if (answer !== null) return;
    setAnswer(a);
    if (a === correct) setScore((s) => s + 1);
  };
  const next = () => {
    if (n === total - 1) { setDone(true); onFinish(score); return; }
    setN(n + 1); setPuz(gen()); setAnswer(null);
  };
  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setN(0); setScore(0); setPuz(gen()); setAnswer(null); setDone(false);
  };

  if (done) return <Result score={score} max={`/ ${total}`} best={prevBest} onAgain={again} />;

  return (
    <div className="space-y-3">
      <div className="flex justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Question <b className="text-ink-100">{n + 1}/{total}</b></span>
        <span>{question}</span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      {board(puz, answer !== null)}
      <div className="flex gap-3 max-w-[420px] mx-auto">
        <button onClick={() => choose(true)} disabled={answer !== null}
          className={`btn-secondary flex-1 justify-center ${choiceCls(answer !== null, correct, answer === true)}`}>
          {yesLabel}
        </button>
        <button onClick={() => choose(false)} disabled={answer !== null}
          className={`btn-secondary flex-1 justify-center ${choiceCls(answer !== null, !correct, answer === false)}`}>
          {noLabel}
        </button>
      </div>
      {answer !== null && (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <p className="text-sm text-ink-200">{answer === correct ? 'Correct! ' : ''}{explain(puz, correct)}</p>
          <button onClick={next} className="btn-primary text-sm">{n === total - 1 ? 'Finish' : 'Next'}</button>
        </div>
      )}
    </div>
  );
}

function CheckGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  return (
    <YesNoGame
      gen={genCheck}
      total={12}
      question="Is White in check?"
      yesLabel="Yes — Check"
      noLabel="No"
      truth={(p) => p.inCheck}
      board={(p, answered) => {
        const wk = kingSq(p.board, 'w');
        return (
          <MiniBoard onSquare={() => {}}
            cell={(f, r) => {
              const s = sq(f, r);
              return { piece: p.board.get(s), overlay: answered && p.inCheck && s === wk ? 'bad' : undefined };
            }} />
        );
      }}
      explain={(p) => (p.inCheck ? 'White is in check.' : 'White is not in check.')}
      onFinish={onFinish}
      best={best}
    />
  );
}

function BishopColorGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  return (
    <YesNoGame
      gen={() => ({ a: randomSquare(), b: randomSquare() })}
      total={15}
      question="Same colour complex?"
      yesLabel="Yes — same"
      noLabel="No — different"
      truth={(p) => isDarkSq(p.a) === isDarkSq(p.b)}
      board={(p) => (
        <>
          <p data-testid="bishop-squares" className="text-3xl font-bold font-mono text-brand-300 text-center">{p.a} &nbsp;·&nbsp; {p.b}</p>
          <MiniBoard onSquare={() => {}}
            cell={(f, r) => {
              const s = sq(f, r);
              const on = s === p.a || s === p.b;
              return { overlay: on ? 'mark' : undefined, label: on ? s : undefined };
            }} />
        </>
      )}
      explain={(p) => (isDarkSq(p.a) === isDarkSq(p.b) ? 'They are the same colour.' : 'They are different colours.')}
      onFinish={onFinish}
      best={best}
    />
  );
}

function ForksGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  return (
    <YesNoGame
      gen={genFork}
      total={10}
      question="Does the marked piece fork two enemies?"
      yesLabel="Yes — Fork"
      noLabel="No"
      truth={(p) => p.isFork}
      board={(p, answered) => (
        <MiniBoard onSquare={() => {}}
          cell={(f, r) => {
            const s = sq(f, r);
            let overlay: Overlay | undefined;
            if (s === p.mark) overlay = 'mark';
            else if (answered && p.targets.includes(s)) overlay = 'bad';
            return { piece: p.board.get(s), overlay };
          }} />
      )}
      explain={(p) => (p.isFork ? `It attacks ${p.targets.join(' and ')} at once.` : p.targets.length === 1 ? `It only attacks ${p.targets[0]}.` : 'It attacks no enemy piece.')}
      onFinish={onFinish}
      best={best}
    />
  );
}

function PinsGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  return (
    <YesNoGame
      gen={genPin}
      total={10}
      question="Is the marked piece pinned to its king?"
      yesLabel="Yes — Pinned"
      noLabel="No"
      truth={(p) => p.isPinned}
      board={(p, answered) => (
        <MiniBoard onSquare={() => {}}
          cell={(f, r) => {
            const s = sq(f, r);
            let overlay: Overlay | undefined;
            if (s === p.mark) overlay = 'mark';
            else if (answered && p.pinner === s) overlay = 'bad';
            return { piece: p.board.get(s), overlay };
          }} />
      )}
      explain={(p) => (p.isPinned ? `Pinned by the ${PIECE_NAME[p.board.get(p.pinner!)!.t].toLowerCase()} on ${p.pinner}: if it moves, the king is in check.` : 'Not pinned: moving it would not expose the king.')}
      onFinish={onFinish}
      best={best}
    />
  );
}
