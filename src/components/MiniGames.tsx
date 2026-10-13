// Board-vision mini-games for the Learn Path.
// Place in src/components/MiniGames.tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Chess, type Square, type PieceSymbol, type Color } from 'chess.js';
import { logMiniGame, type Activity } from '@/lib/activity';
import { ChessBoard } from '@/components/ChessBoard';
import { Piece } from '@/components/Piece';
import {
  ArrowLeft, Crosshair, Scale, Timer, Palette, Move, Eye, ShieldAlert,
  Crown, GitBranch, Zap, Layers, Focus, Swords,
} from 'lucide-react';

const FILES = 'abcdefgh';
const sq = (f: number, r: number) => FILES[f] + (r + 1);
const rnd = (n: number) => Math.floor(Math.random() * n);
const sqToFR = (s: string): [number, number] => [s.charCodeAt(0) - 97, parseInt(s[1], 10) - 1];

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
  { id: 'check', title: 'Check or Not', blurb: 'Is the side to move in check? Fast yes / no training. 12 positions.', max: '/ 12', icon: <Zap size={18} /> },
  { id: 'kingpath', title: 'King Path', blurb: 'Move the king to the target square in the fewest moves. 5 rounds.', max: '/ 15', icon: <Crown size={18} /> },
  { id: 'bishopcolor', title: 'Bishop Colour', blurb: 'Are the two squares the same colour complex? Yes or no. 15 questions.', max: '/ 15', icon: <Layers size={18} /> },
  { id: 'captures', title: 'Safe Captures', blurb: 'Click a square where White can capture safely. 8 boards.', max: '/ 8', icon: <Swords size={18} /> },
  { id: 'sight', title: 'Piece Sight', blurb: 'Click every square the highlighted piece attacks. 8 rounds.', max: '/ 8', icon: <Eye size={18} /> },
  { id: 'forks', title: 'Fork Finder', blurb: 'Does the marked piece fork two enemy units? Spot double attacks. 10 puzzles.', max: '/ 10', icon: <GitBranch size={18} /> },
  { id: 'pins', title: 'Pin Spotter', blurb: 'Is the marked piece pinned against its king? Yes / no. 10 positions.', max: '/ 10', icon: <Focus size={18} /> },
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
        {open === 'knight' && <KnightGame best={best} onFinish={finish('knight')} />}
        {open === 'value' && <ValueGame best={best} onFinish={finish('value')} />}
        {open === 'colors' && <ColorGame best={best} onFinish={finish('colors')} />}
        {open === 'legals' && <LegalsGame best={best} onFinish={finish('legals')} />}
        {open === 'hanging' && <HangingGame best={best} onFinish={finish('hanging')} />}
        {open === 'check' && <CheckGame best={best} onFinish={finish('check')} />}
        {open === 'kingpath' && <KingPathGame best={best} onFinish={finish('kingpath')} />}
        {open === 'bishopcolor' && <BishopColorGame best={best} onFinish={finish('bishopcolor')} />}
        {open === 'captures' && <CapturesGame best={best} onFinish={finish('captures')} />}
        {open === 'sight' && <SightGame best={best} onFinish={finish('sight')} />}
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

// ───────────── shared helpers ─────────────

function MiniBoard({ flipped, onSquare, cell, sizeClass = 'max-w-[420px]' }: {
  flipped?: boolean;
  onSquare: (f: number, r: number) => void;
  cell: (f: number, r: number) => { content?: ReactNode; cls?: string };
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
            <button key={`${f}${r}`} onClick={() => onSquare(f, r)}
              className={`aspect-square relative flex items-center justify-center text-2xl sm:text-3xl text-black ${dark ? 'bg-[#b58863]' : 'bg-[#f0d9b5]'} ${c.cls ?? ''}`}
              aria-label={sq(f, r)}>
              {c.content}
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

function emptyFen(piece?: { type: PieceSymbol; color: Color; square: Square }, turn: Color = 'w'): string {
  const c = new Chess();
  c.clear();
  if (piece) c.put({ type: piece.type, color: piece.color }, piece.square);
  const parts = c.fen().split(' ');
  parts[1] = turn;
  parts[3] = '-';
  parts[4] = '0';
  parts[5] = '1';
  return parts.join(' ');
}

/** Keep the same side to move so the piece stays draggable after each hop. */
function keepTurn(fen: string, turn: Color = 'w'): string {
  const parts = fen.split(' ');
  parts[1] = turn;
  parts[3] = '-';
  return parts.join(' ');
}

function randomSquare(): Square {
  return sq(rnd(8), rnd(8)) as Square;
}

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

  const pick = (prev?: [number, number]): [number, number] => {
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
    setTarget(pick());
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
      setTarget(pick(target));
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
          <span className="text-4xl font-bold font-mono text-brand-300">{sq(target[0], target[1])}</span>
          <span className="text-sm text-ink-400">Score <b className="text-ink-100 tabular-nums">{score}</b></span>
        </div>
      )}
      <MiniBoard flipped={flip} onSquare={click}
        cell={(f, r) => ({ cls: flash?.key === `${f}${r}` ? (flash.ok ? '!bg-emerald-400' : '!bg-red-400') : '' })} />
    </div>
  );
}

// ───────────── 2. Knight Hop (real board + pieces) ─────────────

const KN: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const inb = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;

function knightDist(f0: number, r0: number): number[][] {
  const d: number[][] = Array.from({ length: 8 }, () => Array(8).fill(-1));
  d[f0][r0] = 0;
  const q: [number, number][] = [[f0, r0]];
  while (q.length) {
    const [f, r] = q.shift()!;
    for (const [df, dr] of KN) {
      const nf = f + df, nr = r + dr;
      if (inb(nf, nr) && d[nf][nr] < 0) { d[nf][nr] = d[f][r] + 1; q.push([nf, nr]); }
    }
  }
  return d;
}

function newKnightRound() {
  const start: [number, number] = [rnd(8), rnd(8)];
  const d = knightDist(start[0], start[1]);
  const cands: [number, number][] = [];
  for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) if (d[f][r] >= 2 && d[f][r] <= 4) cands.push([f, r]);
  const target = cands[rnd(cands.length)] ?? [rnd(8), rnd(8)];
  return { start, target, opt: d[target[0]][target[1]] };
}

function KnightGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [phase, setPhase] = useState<'play' | 'done'>('play');
  const [round, setRound] = useState(0);
  const [puz, setPuz] = useState(newKnightRound);
  const [fen, setFen] = useState(() => emptyFen({ type: 'n', color: 'w', square: sq(puz.start[0], puz.start[1]) as Square }));
  const [moves, setMoves] = useState(0);
  const [pts, setPts] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);

  const targetSq = sq(puz.target[0], puz.target[1]) as Square;

  const onUserMove = (m: { from: Square; to: Square; san: string; fen: string }) => {
    if (pts !== null) return;
    setLastMove({ from: m.from, to: m.to });
    setFen(keepTurn(m.fen, 'w'));
    const newMoves = moves + 1;
    setMoves(newMoves);
    if (m.to === targetSq) {
      const p = newMoves === puz.opt ? 3 : newMoves === puz.opt + 1 ? 1 : 0;
      setPts(p);
      setTotal((t) => t + p);
    }
  };

  const next = () => {
    if (round === 4) { setPhase('done'); onFinish(total); return; }
    const p = newKnightRound();
    setRound((r) => r + 1);
    setPuz(p);
    setFen(emptyFen({ type: 'n', color: 'w', square: sq(p.start[0], p.start[1]) as Square }));
    setMoves(0); setPts(null); setLastMove(null);
  };

  const again = () => {
    const p = newKnightRound();
    setPrevBest(best === undefined ? total : Math.max(best, total));
    setRound(0); setTotal(0); setPuz(p);
    setFen(emptyFen({ type: 'n', color: 'w', square: sq(p.start[0], p.start[1]) as Square }));
    setMoves(0); setPts(null); setLastMove(null); setPhase('play');
  };

  if (phase === 'done') return <Result score={total} max="/ 15" best={prevBest} onAgain={again} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Round <b className="text-ink-100">{round + 1}/5</b></span>
        <span>Moves <b className="text-ink-100">{moves}</b> <span className="text-ink-500">(best possible: {puz.opt})</span></span>
        <span>Points <b className="text-ink-100">{total}</b></span>
      </div>
      <div className="max-w-[420px] mx-auto">
        <ChessBoard
          key={`knight-${round}-${targetSq}`}
          fen={fen}
          size={420}
          interactive={pts === null}
          onUserMove={onUserMove}
          annotationSquare={targetSq}
          annotationColor="#81b64c"
          lastMove={lastMove}
          showCelebration={false}
          whiteName="You"
          blackName="Target"
        />
      </div>
      <div className="flex items-center justify-center gap-2 min-h-[2.25rem]">
        {pts === null ? (
          <p className="text-xs text-ink-500">Drag or click the knight toward the green target square</p>
        ) : (
          <>
            <p className="text-sm text-ink-200">
              {pts === 3 ? 'Perfect — shortest route! +3' : pts === 1 ? 'One move over the best. +1' : `Reached it in ${moves} — best was ${puz.opt}. +0`}
            </p>
            <button onClick={next} className="btn-primary text-sm">{round === 4 ? 'Finish' : 'Next round'}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── 3. Material Count ─────────────

interface Pc { g: string; v: number }
const WHITE: Pc[] = [{ g: '♕', v: 9 }, { g: '♖', v: 5 }, { g: '♗', v: 3 }, { g: '♘', v: 3 }, { g: '♙\uFE0E', v: 1 }];
const BLACK: Pc[] = [{ g: '♛', v: 9 }, { g: '♜', v: 5 }, { g: '♝', v: 3 }, { g: '♞\uFE0E', v: 3 }, { g: '♟\uFE0E', v: 1 }];
const sum = (a: Pc[]) => a.reduce((x, p) => x + p.v, 0);

function pickSide(set: Pc[]): Pc[] {
  const n = 2 + rnd(4);
  const out: Pc[] = [];
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
      className={`btn-secondary text-sm flex-1 justify-center ${answer && key === correct ? '!bg-emerald-500/30 !border-emerald-400' : answer === key ? '!bg-red-500/30 !border-red-400' : ''}`}>
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
            <p className="text-3xl leading-tight break-words">{s.pcs.map((p) => p.g).join(' ')}</p>
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

function ColorGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [n, setN] = useState(0);
  const [score, setScore] = useState(0);
  const [target, setTarget] = useState(() => randomSquare());
  const [answer, setAnswer] = useState<'l' | 'd' | null>(null);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const isDark = (s: Square) => {
    const [f, r] = sqToFR(s);
    return (f + r) % 2 === 0;
  };
  const correct = isDark(target) ? 'd' : 'l';

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
        <p className="text-5xl font-bold font-mono text-brand-300 mb-2">{target}</p>
        <p className="text-sm text-ink-400">Is this square light or dark?</p>
      </div>
      <div className="flex gap-3">
        <button onClick={() => choose('l')} disabled={!!answer}
          className={`btn-secondary flex-1 justify-center ${answer && correct === 'l' ? '!bg-emerald-500/30 !border-emerald-400' : answer === 'l' ? '!bg-red-500/30 !border-red-400' : ''}`}>
          Light
        </button>
        <button onClick={() => choose('d')} disabled={!!answer}
          className={`btn-secondary flex-1 justify-center ${answer && correct === 'd' ? '!bg-emerald-500/30 !border-emerald-400' : answer === 'd' ? '!bg-red-500/30 !border-red-400' : ''}`}>
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

// ───────────── 5. Legal Moves ─────────────

const PIECE_TYPES: PieceSymbol[] = ['n', 'b', 'r', 'q', 'k'];

function newLegalsRound() {
  const type = PIECE_TYPES[rnd(PIECE_TYPES.length)];
  const square = randomSquare();
  const fen = emptyFen({ type, color: 'w', square });
  const chess = new Chess(fen);
  const dests = new Set(chess.moves({ square, verbose: true }).map((m) => m.to));
  return { type, square, fen, dests };
}

function LegalsGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [round, setRound] = useState(0);
  const [puz, setPuz] = useState(newLegalsRound);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const click = (f: number, r: number) => {
    if (submitted) return;
    const s = sq(f, r);
    if (s === puz.square) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const submit = () => {
    if (submitted) return;
    setSubmitted(true);
    let correct = 0;
    let wrong = 0;
    for (const s of selected) {
      if (puz.dests.has(s as Square)) correct++;
      else wrong++;
    }
    const missed = puz.dests.size - correct;
    if (wrong === 0 && missed === 0) setScore((s) => s + 1);
  };

  const next = () => {
    if (round === 7) { setDone(true); onFinish(score); return; }
    setRound((r) => r + 1);
    setPuz(newLegalsRound());
    setSelected(new Set());
    setSubmitted(false);
  };

  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setRound(0); setScore(0); setPuz(newLegalsRound());
    setSelected(new Set()); setSubmitted(false); setDone(false);
  };

  if (done) return <Result score={score} max="/ 8" best={prevBest} onAgain={again} />;

  const names: Record<string, string> = { n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

  return (
    <div className="space-y-3">
      <div className="flex justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Round <b className="text-ink-100">{round + 1}/8</b></span>
        <span>Click all legal squares for the <b className="text-ink-100">{names[puz.type]}</b></span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      <MiniBoard
        onSquare={click}
        cell={(f, r) => {
          const s = sq(f, r);
          const isPiece = s === puz.square;
          const isSel = selected.has(s);
          const isDest = puz.dests.has(s as Square);
          let cls = '';
          if (submitted) {
            if (isSel && isDest) cls = '!bg-emerald-400';
            else if (isSel && !isDest) cls = '!bg-red-400';
            else if (!isSel && isDest) cls = '!bg-amber-300/70';
          } else if (isSel) cls = '!bg-sky-400/70';
          return {
            cls,
            content: isPiece ? (
              <Piece piece={puz.type} color="w" size={36} />
            ) : isSel && !submitted ? (
              <span className="w-3 h-3 rounded-full bg-black/50" />
            ) : null,
          };
        }}
      />
      <div className="flex items-center justify-center gap-2 min-h-[2.25rem]">
        {!submitted ? (
          <>
            <p className="text-xs text-ink-500">Select every square the piece can move to, then submit.</p>
            <button onClick={submit} className="btn-primary text-sm" disabled={selected.size === 0}>Submit</button>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-200">
              {selected.size === puz.dests.size && [...selected].every((s) => puz.dests.has(s as Square))
                ? 'Perfect!'
                : `Found ${[...selected].filter((s) => puz.dests.has(s as Square)).length} of ${puz.dests.size}`}
            </p>
            <button onClick={next} className="btn-primary text-sm">{round === 7 ? 'Finish' : 'Next'}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── 6. Hanging Pieces ─────────────

function genHanging(): { fen: string; hanging: Square[] } {
  for (let attempt = 0; attempt < 80; attempt++) {
    const c = new Chess();
    c.clear();
    c.put({ type: 'k', color: 'b' }, 'a8');
    c.put({ type: 'k', color: 'w' }, 'h1');
    const pieces: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p'];
    const used = new Set<string>(['a8', 'h1']);
    const whiteSquares: Square[] = [];
    const nW = 3 + rnd(3);
    for (let i = 0; i < nW; i++) {
      let s: Square;
      do { s = randomSquare(); } while (used.has(s));
      used.add(s);
      c.put({ type: pieces[rnd(pieces.length)], color: 'w' }, s);
      whiteSquares.push(s);
    }
    const nB = 2 + rnd(3);
    for (let i = 0; i < nB; i++) {
      let s: Square;
      do { s = randomSquare(); } while (used.has(s));
      used.add(s);
      c.put({ type: pieces[rnd(pieces.length - 1)], color: 'b' }, s);
    }
    const fenParts = c.fen().split(' ');
    fenParts[1] = 'b';
    fenParts[3] = '-';
    const fen = fenParts.join(' ');
    try {
      const chess = new Chess(fen);
      const hanging: Square[] = [];
      for (const s of whiteSquares) {
        const attackers = (chess as any).attackers?.(s, 'b') ?? [];
        const defenders = (chess as any).attackers?.(s, 'w') ?? [];
        if (attackers.length > 0 && defenders.length === 0) hanging.push(s);
      }
      if (hanging.length >= 1 && hanging.length <= 2) return { fen, hanging };
    } catch { /* continue */ }
  }
  return { fen: '8/8/8/3n4/8/8/4P3/4K2k b - - 0 1', hanging: ['e2'] };
}

function HangingGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [round, setRound] = useState(0);
  const [puz, setPuz] = useState(genHanging);
  const [picked, setPicked] = useState<Square | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const onSquareClick = (square: Square) => {
    if (picked) return;
    setPicked(square);
    if (puz.hanging.includes(square)) setScore((s) => s + 1);
  };

  const next = () => {
    if (round === 7) { setDone(true); onFinish(score); return; }
    setRound((r) => r + 1);
    setPuz(genHanging());
    setPicked(null);
  };

  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setRound(0); setScore(0); setPuz(genHanging()); setPicked(null); setDone(false);
  };

  if (done) return <Result score={score} max="/ 8" best={prevBest} onAgain={again} />;

  return (
    <div className="space-y-3">
      <div className="flex justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Round <b className="text-ink-100">{round + 1}/8</b></span>
        <span>Click a hanging (unprotected) white piece</span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      <div className="max-w-[420px] mx-auto">
        <ChessBoard
          fen={puz.fen}
          size={420}
          interactive={false}
          onSquareClick={onSquareClick}
          highlightSquare={picked}
          annotationSquare={picked && puz.hanging.includes(picked) ? picked : null}
          annotationColor={picked && puz.hanging.includes(picked) ? '#81b64c' : '#fa412d'}
          showCelebration={false}
        />
      </div>
      <div className="flex items-center justify-center gap-2 min-h-[2.25rem]">
        {!picked ? (
          <p className="text-xs text-ink-500">A hanging piece is attacked and has no defender.</p>
        ) : (
          <>
            <p className="text-sm text-ink-200">
              {puz.hanging.includes(picked) ? 'Correct — that piece is hanging!' : `Not hanging. Hanging: ${puz.hanging.join(', ')}`}
            </p>
            <button onClick={next} className="btn-primary text-sm">{round === 7 ? 'Finish' : 'Next'}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── 7. Check or Not ─────────────

function genCheckPos(): { fen: string; inCheck: boolean } {
  for (let i = 0; i < 60; i++) {
    const c = new Chess();
    c.clear();
    c.put({ type: 'k', color: 'w' }, randomSquare());
    c.put({ type: 'k', color: 'b' }, randomSquare());
    const pieces: PieceSymbol[] = ['q', 'r', 'b', 'n'];
    const n = 2 + rnd(4);
    const used = new Set(
      c.board().flat().filter(Boolean).map((p) => p!.square),
    );
    for (let j = 0; j < n; j++) {
      let s: Square;
      do { s = randomSquare(); } while (used.has(s));
      used.add(s);
      const color: Color = Math.random() < 0.5 ? 'w' : 'b';
      c.put({ type: pieces[rnd(pieces.length)], color }, s);
    }
    try {
      const fenParts = c.fen().split(' ');
      fenParts[1] = 'w';
      fenParts[3] = '-';
      const fen = fenParts.join(' ');
      const chess = new Chess(fen);
      if (chess.isCheckmate() || chess.isStalemate()) continue;
      return { fen: chess.fen(), inCheck: chess.inCheck() };
    } catch { continue; }
  }
  return { fen: '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1', inCheck: true };
}

function CheckGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [n, setN] = useState(0);
  const [score, setScore] = useState(0);
  const [puz, setPuz] = useState(genCheckPos);
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const choose = (a: boolean) => {
    if (answer !== null) return;
    setAnswer(a);
    if (a === puz.inCheck) setScore((s) => s + 1);
  };
  const next = () => {
    if (n === 11) { setDone(true); onFinish(score); return; }
    setN(n + 1); setPuz(genCheckPos()); setAnswer(null);
  };
  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setN(0); setScore(0); setPuz(genCheckPos()); setAnswer(null); setDone(false);
  };

  if (done) return <Result score={score} max="/ 12" best={prevBest} onAgain={again} />;

  return (
    <div className="space-y-3">
      <div className="flex justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Question <b className="text-ink-100">{n + 1}/12</b></span>
        <span>Is White in check?</span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      <div className="max-w-[420px] mx-auto">
        <ChessBoard fen={puz.fen} size={420} interactive={false} showCelebration={false} />
      </div>
      <div className="flex gap-3 max-w-[420px] mx-auto">
        <button onClick={() => choose(true)} disabled={answer !== null}
          className={`btn-secondary flex-1 justify-center ${answer !== null && puz.inCheck ? '!bg-emerald-500/30 !border-emerald-400' : answer === true ? '!bg-red-500/30 !border-red-400' : ''}`}>
          Yes — Check
        </button>
        <button onClick={() => choose(false)} disabled={answer !== null}
          className={`btn-secondary flex-1 justify-center ${answer !== null && !puz.inCheck ? '!bg-emerald-500/30 !border-emerald-400' : answer === false ? '!bg-red-500/30 !border-red-400' : ''}`}>
          No
        </button>
      </div>
      {answer !== null && (
        <div className="flex items-center justify-center gap-2">
          <p className="text-sm text-ink-200">{answer === puz.inCheck ? 'Correct!' : puz.inCheck ? 'It is check.' : 'Not in check.'}</p>
          <button onClick={next} className="btn-primary text-sm">{n === 11 ? 'Finish' : 'Next'}</button>
        </div>
      )}
    </div>
  );
}

// ───────────── 8. King Path ─────────────

function kingDist(f0: number, r0: number, f1: number, r1: number) {
  return Math.max(Math.abs(f0 - f1), Math.abs(r0 - r1));
}

function newKingRound() {
  const start: [number, number] = [rnd(8), rnd(8)];
  let target: [number, number];
  do {
    target = [rnd(8), rnd(8)];
  } while (kingDist(start[0], start[1], target[0], target[1]) < 2 || kingDist(start[0], start[1], target[0], target[1]) > 5);
  return { start, target, opt: kingDist(start[0], start[1], target[0], target[1]) };
}

function KingPathGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [phase, setPhase] = useState<'play' | 'done'>('play');
  const [round, setRound] = useState(0);
  const [puz, setPuz] = useState(newKingRound);
  const [fen, setFen] = useState(() => emptyFen({ type: 'k', color: 'w', square: sq(puz.start[0], puz.start[1]) as Square }));
  const [moves, setMoves] = useState(0);
  const [pts, setPts] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);

  const targetSq = sq(puz.target[0], puz.target[1]) as Square;

  const onUserMove = (m: { from: Square; to: Square; fen: string }) => {
    if (pts !== null) return;
    setLastMove({ from: m.from, to: m.to });
    setFen(keepTurn(m.fen, 'w'));
    const newMoves = moves + 1;
    setMoves(newMoves);
    if (m.to === targetSq) {
      const p = newMoves === puz.opt ? 3 : newMoves === puz.opt + 1 ? 1 : 0;
      setPts(p);
      setTotal((t) => t + p);
    }
  };

  const next = () => {
    if (round === 4) { setPhase('done'); onFinish(total); return; }
    const p = newKingRound();
    setRound((r) => r + 1);
    setPuz(p);
    setFen(emptyFen({ type: 'k', color: 'w', square: sq(p.start[0], p.start[1]) as Square }));
    setMoves(0); setPts(null); setLastMove(null);
  };

  const again = () => {
    const p = newKingRound();
    setPrevBest(best === undefined ? total : Math.max(best, total));
    setRound(0); setTotal(0); setPuz(p);
    setFen(emptyFen({ type: 'k', color: 'w', square: sq(p.start[0], p.start[1]) as Square }));
    setMoves(0); setPts(null); setLastMove(null); setPhase('play');
  };

  if (phase === 'done') return <Result score={total} max="/ 15" best={prevBest} onAgain={again} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Round <b className="text-ink-100">{round + 1}/5</b></span>
        <span>Moves <b className="text-ink-100">{moves}</b> <span className="text-ink-500">(best: {puz.opt})</span></span>
        <span>Points <b className="text-ink-100">{total}</b></span>
      </div>
      <div className="max-w-[420px] mx-auto">
        <ChessBoard
          key={`king-${round}-${targetSq}`}
          fen={fen}
          size={420}
          interactive={pts === null}
          onUserMove={onUserMove}
          annotationSquare={targetSq}
          annotationColor="#81b64c"
          lastMove={lastMove}
          showCelebration={false}
        />
      </div>
      <div className="flex items-center justify-center gap-2 min-h-[2.25rem]">
        {pts === null ? (
          <p className="text-xs text-ink-500">Move the king to the green target in as few moves as possible.</p>
        ) : (
          <>
            <p className="text-sm text-ink-200">
              {pts === 3 ? 'Perfect! +3' : pts === 1 ? 'One extra move. +1' : `Took ${moves} (best ${puz.opt}). +0`}
            </p>
            <button onClick={next} className="btn-primary text-sm">{round === 4 ? 'Finish' : 'Next round'}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── 9. Bishop Colour ─────────────

function BishopColorGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [n, setN] = useState(0);
  const [score, setScore] = useState(0);
  const [a, setA] = useState(() => randomSquare());
  const [b, setB] = useState(() => randomSquare());
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const sameColor = (() => {
    const [fa, ra] = sqToFR(a);
    const [fb, rb] = sqToFR(b);
    return (fa + ra) % 2 === (fb + rb) % 2;
  })();

  const choose = (yes: boolean) => {
    if (answer !== null) return;
    setAnswer(yes);
    if (yes === sameColor) setScore((s) => s + 1);
  };
  const next = () => {
    if (n === 14) { setDone(true); onFinish(score); return; }
    setN(n + 1); setA(randomSquare()); setB(randomSquare()); setAnswer(null);
  };
  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setN(0); setScore(0); setA(randomSquare()); setB(randomSquare()); setAnswer(null); setDone(false);
  };

  if (done) return <Result score={score} max="/ 15" best={prevBest} onAgain={again} />;

  return (
    <div className="space-y-4 max-w-[420px] mx-auto">
      <div className="flex justify-between text-sm text-ink-400">
        <span>Question <b className="text-ink-100">{n + 1}/15</b></span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      <div className="text-center space-y-1">
        <p className="text-3xl font-bold font-mono text-brand-300">{a} &nbsp;·&nbsp; {b}</p>
        <p className="text-sm text-ink-400">Same colour complex? (Can a bishop reach both?)</p>
      </div>
      <MiniBoard
        onSquare={() => {}}
        cell={(f, r) => {
          const s = sq(f, r);
          const isA = s === a;
          const isB = s === b;
          return {
            cls: isA || isB ? '!ring-2 !ring-brand-400 ring-inset' : '',
            content: isA || isB ? <span className="text-lg font-bold">{s}</span> : null,
          };
        }}
      />
      <div className="flex gap-3">
        <button onClick={() => choose(true)} disabled={answer !== null}
          className={`btn-secondary flex-1 justify-center ${answer !== null && sameColor ? '!bg-emerald-500/30 !border-emerald-400' : answer === true ? '!bg-red-500/30 !border-red-400' : ''}`}>
          Yes — same
        </button>
        <button onClick={() => choose(false)} disabled={answer !== null}
          className={`btn-secondary flex-1 justify-center ${answer !== null && !sameColor ? '!bg-emerald-500/30 !border-emerald-400' : answer === false ? '!bg-red-500/30 !border-red-400' : ''}`}>
          No — different
        </button>
      </div>
      {answer !== null && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-ink-200">{answer === sameColor ? 'Correct!' : sameColor ? 'They are the same colour.' : 'Different colours.'}</p>
          <button onClick={next} className="btn-primary text-sm">{n === 14 ? 'Finish' : 'Next'}</button>
        </div>
      )}
    </div>
  );
}

// ───────────── 10. Safe Captures ─────────────

function genCaptures(): { fen: string; good: Square[] } {
  for (let attempt = 0; attempt < 60; attempt++) {
    const c = new Chess();
    c.clear();
    c.put({ type: 'k', color: 'w' }, 'e1');
    c.put({ type: 'k', color: 'b' }, 'e8');
    const used = new Set(['e1', 'e8']);
    const pieces: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p'];
    for (let i = 0; i < 3 + rnd(2); i++) {
      let s: Square;
      do { s = randomSquare(); } while (used.has(s));
      used.add(s);
      c.put({ type: pieces[rnd(pieces.length)], color: 'b' }, s);
    }
    for (let i = 0; i < 3 + rnd(2); i++) {
      let s: Square;
      do { s = randomSquare(); } while (used.has(s));
      used.add(s);
      c.put({ type: pieces[rnd(pieces.length)], color: 'w' }, s);
    }
    const fenParts = c.fen().split(' ');
    fenParts[1] = 'w';
    fenParts[3] = '-';
    const fen = fenParts.join(' ');
    try {
      const chess = new Chess(fen);
      const good: Square[] = [];
      for (const m of chess.moves({ verbose: true })) {
        if (m.captured) {
          const defenders = (chess as any).attackers?.(m.to, 'b') ?? [];
          if (defenders.length === 0) good.push(m.to);
        }
      }
      if (good.length >= 1) return { fen, good: [...new Set(good)] };
    } catch { /* continue */ }
  }
  return { fen: '4k3/8/8/3p4/8/8/4P3/4K3 w - - 0 1', good: ['d5'] };
}

function CapturesGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [round, setRound] = useState(0);
  const [puz, setPuz] = useState(genCaptures);
  const [picked, setPicked] = useState<Square | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const onSquareClick = (square: Square) => {
    if (picked) return;
    setPicked(square);
    if (puz.good.includes(square)) setScore((s) => s + 1);
  };

  const next = () => {
    if (round === 7) { setDone(true); onFinish(score); return; }
    setRound((r) => r + 1);
    setPuz(genCaptures());
    setPicked(null);
  };

  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setRound(0); setScore(0); setPuz(genCaptures()); setPicked(null); setDone(false);
  };

  if (done) return <Result score={score} max="/ 8" best={prevBest} onAgain={again} />;

  return (
    <div className="space-y-3">
      <div className="flex justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Round <b className="text-ink-100">{round + 1}/8</b></span>
        <span>Click a square where White can capture safely</span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      <div className="max-w-[420px] mx-auto">
        <ChessBoard
          fen={puz.fen}
          size={420}
          interactive={false}
          onSquareClick={onSquareClick}
          highlightSquare={picked}
          showCelebration={false}
        />
      </div>
      <div className="flex items-center justify-center gap-2 min-h-[2.25rem]">
        {!picked ? (
          <p className="text-xs text-ink-500">A safe capture is one that is not defended by the opponent.</p>
        ) : (
          <>
            <p className="text-sm text-ink-200">
              {puz.good.includes(picked) ? 'Yes — safe capture!' : `Not a safe capture. Valid: ${puz.good.join(', ') || 'none'}`}
            </p>
            <button onClick={next} className="btn-primary text-sm">{round === 7 ? 'Finish' : 'Next'}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── 11. Piece Sight ─────────────

function newSightRound() {
  const type = (['n', 'b', 'r', 'q'] as PieceSymbol[])[rnd(4)];
  const square = randomSquare();
  const fen = emptyFen({ type, color: 'w', square });
  const chess = new Chess(fen);
  const attacks = new Set(chess.moves({ square, verbose: true }).map((m) => m.to));
  return { type, square, fen, attacks };
}

function SightGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [round, setRound] = useState(0);
  const [puz, setPuz] = useState(newSightRound);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const click = (f: number, r: number) => {
    if (submitted) return;
    const s = sq(f, r);
    if (s === puz.square) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const submit = () => {
    if (submitted) return;
    setSubmitted(true);
    let ok = 0;
    for (const s of selected) if (puz.attacks.has(s as Square)) ok++;
    if (ok === puz.attacks.size && selected.size === puz.attacks.size) setScore((s) => s + 1);
  };

  const next = () => {
    if (round === 7) { setDone(true); onFinish(score); return; }
    setRound((r) => r + 1);
    setPuz(newSightRound());
    setSelected(new Set());
    setSubmitted(false);
  };

  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setRound(0); setScore(0); setPuz(newSightRound());
    setSelected(new Set()); setSubmitted(false); setDone(false);
  };

  if (done) return <Result score={score} max="/ 8" best={prevBest} onAgain={again} />;

  const names: Record<string, string> = { n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen' };

  return (
    <div className="space-y-3">
      <div className="flex justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Round <b className="text-ink-100">{round + 1}/8</b></span>
        <span>Click every square the <b className="text-ink-100">{names[puz.type]}</b> attacks</span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      <MiniBoard
        onSquare={click}
        cell={(f, r) => {
          const s = sq(f, r);
          const isPiece = s === puz.square;
          const isSel = selected.has(s);
          const isAtt = puz.attacks.has(s as Square);
          let cls = '';
          if (submitted) {
            if (isSel && isAtt) cls = '!bg-emerald-400';
            else if (isSel && !isAtt) cls = '!bg-red-400';
            else if (!isSel && isAtt) cls = '!bg-amber-300/70';
          } else if (isSel) cls = '!bg-sky-400/70';
          return {
            cls,
            content: isPiece ? <Piece piece={puz.type} color="w" size={36} /> : null,
          };
        }}
      />
      <div className="flex items-center justify-center gap-2 min-h-[2.25rem]">
        {!submitted ? (
          <>
            <p className="text-xs text-ink-500">Mark every attacked square, then submit.</p>
            <button onClick={submit} className="btn-primary text-sm">Submit</button>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-200">
              {selected.size === puz.attacks.size && [...selected].every((s) => puz.attacks.has(s as Square))
                ? 'Perfect vision!'
                : `Got ${[...selected].filter((s) => puz.attacks.has(s as Square)).length}/${puz.attacks.size}`}
            </p>
            <button onClick={next} className="btn-primary text-sm">{round === 7 ? 'Finish' : 'Next'}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── 12. Fork Finder ─────────────

function genFork(): { fen: string; isFork: boolean; pieceSq: Square } {
  for (let attempt = 0; attempt < 80; attempt++) {
    const c = new Chess();
    c.clear();
    c.put({ type: 'k', color: 'b' }, 'e8');
    c.put({ type: 'k', color: 'w' }, 'e1');
    const used = new Set(['e8', 'e1']);
    for (let i = 0; i < 2; i++) {
      let s: Square;
      do { s = randomSquare(); } while (used.has(s));
      used.add(s);
      c.put({ type: (['q', 'r', 'b', 'n'] as PieceSymbol[])[rnd(4)], color: 'b' }, s);
    }
    let pieceSq: Square;
    do { pieceSq = randomSquare(); } while (used.has(pieceSq));
    const pType: PieceSymbol = Math.random() < 0.6 ? 'n' : 'q';
    c.put({ type: pType, color: 'w' }, pieceSq);
    const fenParts = c.fen().split(' ');
    fenParts[1] = 'w';
    fenParts[3] = '-';
    const fen = fenParts.join(' ');
    try {
      const chess = new Chess(fen);
      const attacks = chess.moves({ square: pieceSq, verbose: true }).filter((m) => m.captured).map((m) => m.to);
      const isFork = attacks.length >= 2;
      if (Math.random() < 0.5 || isFork) return { fen, isFork, pieceSq };
    } catch { /* continue */ }
  }
  return { fen: '4k3/8/8/3n4/8/8/8/4K3 w - - 0 1', isFork: false, pieceSq: 'd5' };
}

function ForksGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [n, setN] = useState(0);
  const [score, setScore] = useState(0);
  const [puz, setPuz] = useState(genFork);
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const choose = (yes: boolean) => {
    if (answer !== null) return;
    setAnswer(yes);
    if (yes === puz.isFork) setScore((s) => s + 1);
  };
  const next = () => {
    if (n === 9) { setDone(true); onFinish(score); return; }
    setN(n + 1); setPuz(genFork()); setAnswer(null);
  };
  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setN(0); setScore(0); setPuz(genFork()); setAnswer(null); setDone(false);
  };

  if (done) return <Result score={score} max="/ 10" best={prevBest} onAgain={again} />;

  return (
    <div className="space-y-3">
      <div className="flex justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Question <b className="text-ink-100">{n + 1}/10</b></span>
        <span>Does the highlighted piece fork two enemies?</span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      <div className="max-w-[420px] mx-auto">
        <ChessBoard
          fen={puz.fen}
          size={420}
          interactive={false}
          highlightSquare={puz.pieceSq}
          annotationSquare={puz.pieceSq}
          annotationColor="#749bbf"
          showCelebration={false}
        />
      </div>
      <div className="flex gap-3 max-w-[420px] mx-auto">
        <button onClick={() => choose(true)} disabled={answer !== null}
          className={`btn-secondary flex-1 justify-center ${answer !== null && puz.isFork ? '!bg-emerald-500/30 !border-emerald-400' : answer === true ? '!bg-red-500/30 !border-red-400' : ''}`}>
          Yes — Fork
        </button>
        <button onClick={() => choose(false)} disabled={answer !== null}
          className={`btn-secondary flex-1 justify-center ${answer !== null && !puz.isFork ? '!bg-emerald-500/30 !border-emerald-400' : answer === false ? '!bg-red-500/30 !border-red-400' : ''}`}>
          No
        </button>
      </div>
      {answer !== null && (
        <div className="flex items-center justify-center gap-2">
          <p className="text-sm text-ink-200">{answer === puz.isFork ? 'Correct!' : puz.isFork ? 'It is a fork.' : 'Not a fork.'}</p>
          <button onClick={next} className="btn-primary text-sm">{n === 9 ? 'Finish' : 'Next'}</button>
        </div>
      )}
    </div>
  );
}

// ───────────── 13. Pin Spotter ─────────────

function genPin(): { fen: string; isPinned: boolean; pieceSq: Square } {
  const patterns = [
    { fen: '4k3/8/8/8/8/8/4b3/4K2R w - - 0 1', isPinned: true, pieceSq: 'e2' as Square },
    { fen: '4k3/8/8/8/8/8/4n3/4K2R w - - 0 1', isPinned: true, pieceSq: 'e2' as Square },
    { fen: '4k3/8/8/8/8/4b3/8/4K2R w - - 0 1', isPinned: false, pieceSq: 'e3' as Square },
    { fen: '4k3/8/8/8/4r3/8/8/4K3 w - - 0 1', isPinned: false, pieceSq: 'e5' as Square },
    { fen: '4k3/8/8/8/8/8/4q3/R3K3 w - - 0 1', isPinned: true, pieceSq: 'e2' as Square },
    { fen: '4k3/8/8/8/8/8/3b4/4K2R w - - 0 1', isPinned: false, pieceSq: 'd2' as Square },
    { fen: '4k3/8/8/8/8/8/2n5/4K2R w - - 0 1', isPinned: false, pieceSq: 'c2' as Square },
    { fen: '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1', isPinned: false, pieceSq: 'e2' as Square },
  ];
  if (Math.random() < 0.35) {
    const c = new Chess();
    c.clear();
    c.put({ type: 'k', color: 'w' }, 'e1');
    c.put({ type: 'k', color: 'b' }, 'e8');
    const s = randomSquare();
    c.put({ type: 'n', color: 'w' }, s);
    const fenParts = c.fen().split(' ');
    fenParts[1] = 'w';
    return { fen: fenParts.join(' '), isPinned: false, pieceSq: s };
  }
  return patterns[rnd(patterns.length)];
}

function PinsGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [n, setN] = useState(0);
  const [score, setScore] = useState(0);
  const [puz, setPuz] = useState(genPin);
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const choose = (yes: boolean) => {
    if (answer !== null) return;
    setAnswer(yes);
    if (yes === puz.isPinned) setScore((s) => s + 1);
  };
  const next = () => {
    if (n === 9) { setDone(true); onFinish(score); return; }
    setN(n + 1); setPuz(genPin()); setAnswer(null);
  };
  const again = () => {
    setPrevBest(best === undefined ? score : Math.max(best, score));
    setN(0); setScore(0); setPuz(genPin()); setAnswer(null); setDone(false);
  };

  if (done) return <Result score={score} max="/ 10" best={prevBest} onAgain={again} />;

  return (
    <div className="space-y-3">
      <div className="flex justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Question <b className="text-ink-100">{n + 1}/10</b></span>
        <span>Is the highlighted piece pinned to its king?</span>
        <span>Score <b className="text-ink-100">{score}</b></span>
      </div>
      <div className="max-w-[420px] mx-auto">
        <ChessBoard
          fen={puz.fen}
          size={420}
          interactive={false}
          highlightSquare={puz.pieceSq}
          annotationSquare={puz.pieceSq}
          annotationColor="#f7c631"
          showCelebration={false}
        />
      </div>
      <div className="flex gap-3 max-w-[420px] mx-auto">
        <button onClick={() => choose(true)} disabled={answer !== null}
          className={`btn-secondary flex-1 justify-center ${answer !== null && puz.isPinned ? '!bg-emerald-500/30 !border-emerald-400' : answer === true ? '!bg-red-500/30 !border-red-400' : ''}`}>
          Yes — Pinned
        </button>
        <button onClick={() => choose(false)} disabled={answer !== null}
          className={`btn-secondary flex-1 justify-center ${answer !== null && !puz.isPinned ? '!bg-emerald-500/30 !border-emerald-400' : answer === false ? '!bg-red-500/30 !border-red-400' : ''}`}>
          No
        </button>
      </div>
      {answer !== null && (
        <div className="flex items-center justify-center gap-2">
          <p className="text-sm text-ink-200">{answer === puz.isPinned ? 'Correct!' : puz.isPinned ? 'It is pinned.' : 'Not pinned.'}</p>
          <button onClick={next} className="btn-primary text-sm">{n === 9 ? 'Finish' : 'Next'}</button>
        </div>
      )}
    </div>
  );
}
