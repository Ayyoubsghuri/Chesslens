// Three quick board-vision mini-games for the Learn Path. Self-contained (no engine needed).
// Place in src/components/MiniGames.tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { logMiniGame, type Activity } from '@/lib/activity';
import { ArrowLeft, Crosshair, Scale, Timer } from 'lucide-react';

const FILES = 'abcdefgh';
const sq = (f: number, r: number) => FILES[f] + (r + 1);
const rnd = (n: number) => Math.floor(Math.random() * n);

type GameId = 'coords' | 'knight' | 'value';

const GAMES: { id: GameId; title: string; blurb: string; max: string; icon: ReactNode }[] = [
  { id: 'coords', title: 'Coordinate Sprint', blurb: 'You get 60 seconds. Click the named square as many times as you can.', max: 'squares', icon: <Timer size={18} /> },
  { id: 'knight', title: 'Knight Hop', blurb: 'Reach the target in as few knight moves as possible. 5 rounds, up to 15 points.', max: '/ 15', icon: <Crosshair size={18} /> },
  { id: 'value', title: 'Material Count', blurb: 'Who is ahead on material: White, Black, or equal? 10 quick questions.', max: '/ 10', icon: <Scale size={18} /> },
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
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

// ───────────── shared board ─────────────

function MiniBoard({ flipped, onSquare, cell }: {
  flipped?: boolean;
  onSquare: (f: number, r: number) => void;
  cell: (f: number, r: number) => { content?: ReactNode; cls?: string };
}) {
  const ranks = flipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <div className="grid grid-cols-8 w-full max-w-[420px] mx-auto rounded-lg overflow-hidden select-none border border-ink-700">
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
    } else {
      setMiss((m) => m + 1);
    }
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

// ───────────── 2. Knight Hop ─────────────

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
  const target = cands[rnd(cands.length)];
  return { start, target, opt: d[target[0]][target[1]] };
}

function KnightGame({ onFinish, best }: { onFinish: (s: number) => void; best?: number }) {
  const [phase, setPhase] = useState<'play' | 'done'>('play');
  const [round, setRound] = useState(0);
  const [puz, setPuz] = useState(newKnightRound);
  const [path, setPath] = useState<[number, number][]>(() => [puz.start]);
  const [pts, setPts] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [prevBest, setPrevBest] = useState<number | undefined>(best);

  const pos = path[path.length - 1];
  const moves = path.length - 1;

  const click = (f: number, r: number) => {
    if (pts !== null) return;
    const ok = KN.some(([df, dr]) => pos[0] + df === f && pos[1] + dr === r);
    if (!ok) return;
    const np = [...path, [f, r] as [number, number]];
    setPath(np);
    if (f === puz.target[0] && r === puz.target[1]) {
      const m = np.length - 1;
      const p = m === puz.opt ? 3 : m === puz.opt + 1 ? 1 : 0;
      setPts(p);
      setTotal((t) => t + p);
    }
  };

  const next = () => {
    if (round === 4) {
      setPhase('done');
      onFinish(total);
      return;
    }
    const p = newKnightRound();
    setRound((r) => r + 1);
    setPuz(p);
    setPath([p.start]);
    setPts(null);
  };

  const again = () => {
    const p = newKnightRound();
    setPrevBest(best === undefined ? total : Math.max(best, total));
    setRound(0); setTotal(0); setPuz(p); setPath([p.start]); setPts(null); setPhase('play');
  };

  if (phase === 'done') return <Result score={total} max="/ 15" best={prevBest} onAgain={again} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between max-w-[420px] mx-auto text-sm text-ink-400">
        <span>Round <b className="text-ink-100">{round + 1}/5</b></span>
        <span>Moves <b className="text-ink-100">{moves}</b> <span className="text-ink-500">(best possible: {puz.opt})</span></span>
        <span>Points <b className="text-ink-100">{total}</b></span>
      </div>
      <MiniBoard onSquare={click}
        cell={(f, r) => {
          const isPos = pos[0] === f && pos[1] === r;
          const isTarget = puz.target[0] === f && puz.target[1] === r;
          const visited = path.some((p, i) => i < path.length - 1 && p[0] === f && p[1] === r);
          const legal = pts === null && KN.some(([df, dr]) => pos[0] + df === f && pos[1] + dr === r);
          return {
            cls: isTarget ? '!bg-emerald-400/80' : visited ? '!bg-amber-300/60' : '',
            content: isPos ? '♞\uFE0E' : isTarget ? '★' : legal ? <span className="w-2.5 h-2.5 rounded-full bg-black/40" /> : null,
          };
        }} />
      <div className="flex items-center justify-center gap-2 min-h-[2.25rem]">
        {pts === null ? (
          <>
            <p className="text-xs text-ink-500">Click a square the knight can jump to. Get to the ★.</p>
            {moves > 0 && <button onClick={() => setPath(path.slice(0, -1))} className="btn-ghost text-xs">Undo</button>}
          </>
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
          <p className="text-sm text-ink-200">
            {answer === correct ? 'Correct! ' : 'Not quite. '}White {wv} · Black {bv}
          </p>
          <button onClick={next} className="btn-primary text-sm">{n === 9 ? 'Finish' : 'Next'}</button>
        </div>
      )}
    </div>
  );
}
