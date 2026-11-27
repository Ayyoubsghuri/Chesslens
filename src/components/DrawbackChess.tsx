import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { Dices, EyeOff, Eye, Flag, RotateCcw, Shuffle, Crown, Users, Cpu, HelpCircle, Check, X, AlertTriangle } from 'lucide-react';
import {
  DRAWBACKS, initialState, legalMoves, play, ending, notation, computerMove, placement, dealDrawback, drawbackById,
  pseudoMoves, sqName, other, pieceName,
  type State, type Move, type Color, type Ending, type Strength, type PieceType, type Drawback,
} from '@/lib/drawback';

/* ------------------------------------------------------------------ */
/* Saved game: leaving the page (or closing the app) never loses it    */
/* ------------------------------------------------------------------ */
const SAVE_KEY = 'chesslens:drawback-game:v1';

interface Ply { move: Move; san: string; by: Color }
interface Game {
  mode: 'computer' | 'friends';
  /** The human's colour against the computer (null in a two-player game). */
  human: Color | null;
  strength: Strength;
  drawbacks: Record<Color, string>;
  states: State[];
  plies: Ply[];
  end: Ending | null;
  resigned: Color | null;
  /** Your guess of the computer's drawback. */
  guess: string | null;
}

function loadGame(): Game | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as Game) : null;
  } catch { return null; }
}
function saveGame(g: Game | null) {
  try { if (g) localStorage.setItem(SAVE_KEY, JSON.stringify(g)); else localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

const sideName = (c: Color) => (c === 'w' ? 'White' : 'Black');
const LEVEL_LABEL: Record<number, string> = { 1: 'Mild', 2: 'Medium', 3: 'Harsh' };
const LEVEL_COLOR: Record<number, string> = { 1: 'text-emerald-300 bg-emerald-500/10', 2: 'text-amber-300 bg-amber-500/10', 3: 'text-red-300 bg-red-500/10' };

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */
interface BoardProps {
  fen: string;
  orientation: 'white' | 'black';
  turn: Color;
  /** Who may move pieces right now (null = nobody: the computer is thinking or the game is over). */
  movable: Color | null;
  dests: Map<Key, Key[]>;
  lastMove: [Key, Key] | null;
  shapes: DrawShape[];
  onMove: (from: Key, to: Key) => void;
}

function VariantBoard({ fen, orientation, turn, movable, dests, lastMove, shapes, onMove }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      coordinates: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: false },
      premovable: { enabled: false },
      drawable: { enabled: true, visible: true },
      movable: { free: false, showDests: true, events: { after: (o, d) => moveRef.current(o, d) } },
    });
    const ro = new ResizeObserver(() => api.current?.redrawAll());
    ro.observe(el.current);
    return () => { ro.disconnect(); api.current?.destroy(); api.current = null; };
  }, []);

  useEffect(() => {
    api.current?.set({
      fen,
      orientation,
      turnColor: turn === 'w' ? 'white' : 'black',
      lastMove: lastMove ?? undefined,
      check: false,
      movable: { color: movable ? (movable === 'w' ? 'white' : 'black') : undefined, dests },
    });
    api.current?.setAutoShapes(shapes);
  }, [fen, orientation, turn, movable, dests, lastMove, shapes]);

  return <div ref={el} className="w-full aspect-square" />;
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */
export function DrawbackChess() {
  const [game, setGame] = useState<Game | null>(() => loadGame());
  useEffect(() => { saveGame(game); }, [game]);

  // ---- setup
  const [mode, setMode] = useState<'computer' | 'friends'>('computer');
  const [side, setSide] = useState<Color | 'random'>('random');
  const [strength, setStrength] = useState<Strength>('medium');
  const [severity, setSeverity] = useState<1 | 2 | 3>(2);
  const [mine, setMine] = useState<Drawback>(() => dealDrawback(2));
  const [showList, setShowList] = useState(false);
  useEffect(() => { if (mine.level > severity) setMine(dealDrawback(severity)); }, [severity]); // eslint-disable-line react-hooks/exhaustive-deps

  function start() {
    const human: Color = side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side;
    const a = mode === 'computer' ? mine : dealDrawback(severity);
    const b = dealDrawback(severity, [a.id]);
    const drawbacks: Record<Color, string> = mode === 'computer'
      ? { [human]: a.id, [other(human)]: b.id } as Record<Color, string>
      : { w: a.id, b: b.id };
    setGame({ mode, human: mode === 'computer' ? human : null, strength, drawbacks, states: [initialState()], plies: [], end: null, resigned: null, guess: null });
  }

  if (!game) {
    return (
      <SetupScreen
        mode={mode} setMode={setMode} side={side} setSide={setSide} strength={strength} setStrength={setStrength}
        severity={severity} setSeverity={setSeverity} mine={mine} reroll={() => setMine(dealDrawback(severity, [mine.id]))}
        showList={showList} setShowList={setShowList} onStart={start}
      />
    );
  }
  return <GameScreen game={game} setGame={setGame} onNew={() => setGame(null)} />;
}

/* ------------------------------------------------------------------ */
function Rules() {
  return (
    <ul className="space-y-1.5 text-sm text-ink-300">
      <li><b className="text-ink-100">Everyone has a secret drawback</b>: a rule only they must follow. You see yours; your opponent's stays hidden until the game ends.</li>
      <li><b className="text-ink-100">No check, no checkmate.</b> You may move into danger. You win by <b className="text-brand-300">capturing the enemy king</b>.</li>
      <li><b className="text-ink-100">No moves left? You lose.</b> If your drawback leaves you nothing to play, the game is over.</li>
      <li>Castling is allowed even when your king is attacked. 50 quiet moves each, or the same position three times, is a draw.</li>
      <li>Drawbacks apply to every move, even capturing the king.</li>
    </ul>
  );
}

function DrawbackCard({ d, title, hidden, onToggle }: { d: Drawback | null; title: string; hidden?: boolean; onToggle?: () => void }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800/70 p-3">
      <div className="flex items-center gap-2 text-xs text-ink-400">
        <span className="font-semibold uppercase tracking-wide">{title}</span>
        {d && !hidden && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${LEVEL_COLOR[d.level]}`}>{LEVEL_LABEL[d.level]}</span>}
        {onToggle && (
          <button onClick={onToggle} className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ink-300 hover:bg-ink-700" aria-label={hidden ? 'Show drawback' : 'Hide drawback'}>
            {hidden ? <Eye size={13} /> : <EyeOff size={13} />} {hidden ? 'Show' : 'Hide'}
          </button>
        )}
      </div>
      {d && !hidden ? (
        <>
          <p className="mt-1 font-semibold text-ink-100">{d.name}</p>
          <p className="text-sm text-ink-300">{d.text}</p>
        </>
      ) : (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-400"><EyeOff size={14} /> Hidden</p>
      )}
    </div>
  );
}

function Choice<T extends string | number>({ value, set, options }: { value: T; set: (v: T) => void; options: { v: T; label: string; icon?: LucideIcon }[] }) {
  return (
    <div className="flex gap-1 rounded-lg bg-ink-900/50 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => set(o.v)}
          aria-pressed={value === o.v}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${value === o.v ? 'bg-ink-600 text-white' : 'text-ink-400 hover:bg-ink-700/60 hover:text-ink-200'}`}
        >
          {o.icon && <o.icon size={13} />} {o.label}
        </button>
      ))}
    </div>
  );
}

function SetupScreen(p: {
  mode: 'computer' | 'friends'; setMode: (m: 'computer' | 'friends') => void;
  side: Color | 'random'; setSide: (s: Color | 'random') => void;
  strength: Strength; setStrength: (s: Strength) => void;
  severity: 1 | 2 | 3; setSeverity: (s: 1 | 2 | 3) => void;
  mine: Drawback; reroll: () => void; showList: boolean; setShowList: (b: boolean) => void; onStart: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="relative overflow-hidden rounded-2xl border border-ink-700 bg-gradient-to-br from-brand-600/20 via-ink-800 to-ink-900 p-5">
        <Dices size={150} strokeWidth={1.2} className="pointer-events-none absolute -right-6 -bottom-8 text-brand-400/10" aria-hidden />
        <h2 className="!text-2xl">Secret Drawbacks</h2>
        <p className="mt-1 max-w-lg text-sm text-ink-300">Chess with a twist: each side plays with a hidden handicap. Play around yours, work out theirs, and take the king.</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card space-y-3 p-4">
          <h3 className="!text-base">How it works</h3>
          <Rules />
        </div>

        <div className="card space-y-3 p-4">
          <h3 className="!text-base">New game</h3>
          <div>
            <p className="mb-1 text-xs text-ink-400">Opponent</p>
            <Choice value={p.mode} set={p.setMode} options={[{ v: 'computer', label: 'Computer', icon: Cpu }, { v: 'friends', label: 'Two players', icon: Users }]} />
          </div>
          {p.mode === 'computer' && (
            <>
              <div>
                <p className="mb-1 text-xs text-ink-400">You play</p>
                <Choice value={p.side} set={p.setSide} options={[{ v: 'w', label: 'White' }, { v: 'random', label: 'Random', icon: Shuffle }, { v: 'b', label: 'Black' }]} />
              </div>
              <div>
                <p className="mb-1 text-xs text-ink-400">Computer strength</p>
                <Choice value={p.strength} set={p.setStrength} options={[{ v: 'easy', label: 'Easy' }, { v: 'medium', label: 'Medium' }, { v: 'hard', label: 'Hard' }]} />
              </div>
            </>
          )}
          <div>
            <p className="mb-1 text-xs text-ink-400">Drawbacks up to</p>
            <Choice value={p.severity} set={p.setSeverity} options={[{ v: 1, label: 'Mild' }, { v: 2, label: 'Medium' }, { v: 3, label: 'Harsh' }]} />
          </div>
          {p.mode === 'computer' ? (
            <div>
              <DrawbackCard d={p.mine} title="Your drawback" />
              <button onClick={p.reroll} className="mt-1.5 flex items-center gap-1.5 text-xs text-brand-300 hover:text-brand-200"><Dices size={13} /> Deal another</button>
            </div>
          ) : (
            <p className="text-xs text-ink-400">Each player gets a drawback. Pass the phone on your turn and tap “Show” to see your own; the other player looks away.</p>
          )}
          <button onClick={p.onStart} className="btn-primary w-full">Start game</button>
        </div>
      </div>

      <div className="card p-4">
        <button onClick={() => p.setShowList(!p.showList)} className="flex w-full items-center gap-2 text-left">
          <HelpCircle size={16} className="text-brand-400" />
          <span className="font-semibold">All {DRAWBACKS.length} drawbacks</span>
          <span className="ml-auto text-xs text-ink-400">{p.showList ? 'Hide' : 'Show'}</span>
        </button>
        {p.showList && (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {DRAWBACKS.map((d) => (
              <li key={d.id} className="rounded-lg bg-ink-800/60 px-3 py-2 text-sm">
                <span className="font-semibold text-ink-100">{d.name}</span>
                <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${LEVEL_COLOR[d.level]}`}>{LEVEL_LABEL[d.level]}</span>
                <p className="text-ink-400">{d.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function GameScreen({ game, setGame, onNew }: { game: Game; setGame: (g: Game | null) => void; onNew: () => void }) {
  const state = game.states[game.states.length - 1];
  const db = useMemo(() => ({ w: drawbackById(game.drawbacks.w), b: drawbackById(game.drawbacks.b) }), [game.drawbacks]);
  const over = !!game.end || !!game.resigned;
  const computerSide: Color | null = game.mode === 'computer' && game.human ? other(game.human) : null;
  const humanToMove = !over && state.turn !== computerSide;
  const [thinking, setThinking] = useState(false);
  const [warn, setWarn] = useState(true);
  // two players: the drawback of the side to move stays hidden until that player taps "Show"
  const [peek, setPeek] = useState(false);
  useEffect(() => { setPeek(false); }, [state.turn]);
  const [promo, setPromo] = useState<Move[] | null>(null);
  const [orientation, setOrientation] = useState<'white' | 'black'>(game.human === 'b' ? 'black' : 'white');

  const legal = useMemo(() => (over ? [] : legalMoves(state, db[state.turn])), [state, db, over]);

  const apply = useCallback((m: Move) => {
    const san = notation(state, m);
    const next = play(state, m);
    const end = ending(next, m, db[next.turn]);
    setGame({ ...game, states: [...game.states, next], plies: [...game.plies, { move: m, san, by: state.turn }], end });
  }, [state, db, game, setGame]);

  // The computer's turn.
  useEffect(() => {
    if (over || state.turn !== computerSide) return;
    setThinking(true);
    const t = window.setTimeout(() => {
      const m = computerMove(state, db[state.turn], game.strength);
      setThinking(false);
      if (m) apply(m);
    }, 380);
    return () => { window.clearTimeout(t); setThinking(false); };
  }, [state, over, computerSide]); // eslint-disable-line react-hooks/exhaustive-deps

  const dests = useMemo(() => {
    const map = new Map<Key, Key[]>();
    if (!humanToMove) return map;
    for (const m of legal) {
      const k = sqName(m.from) as Key;
      const arr = map.get(k) ?? [];
      const to = sqName(m.to) as Key;
      if (!arr.includes(to)) arr.push(to);
      map.set(k, arr);
    }
    return map;
  }, [legal, humanToMove]);

  function onMove(from: Key, to: Key) {
    const options = legal.filter((m) => sqName(m.from) === from && sqName(m.to) === to);
    if (!options.length) return;
    if (options.length > 1 && options.some((m) => m.promo)) { setPromo(options); return; }
    apply(options[0]);
  }

  // Danger: with no check in this game, a king left en prise is easy to miss. Show who can take it (opponent's drawback unknown).
  const me: Color | null = game.mode === 'computer' ? game.human : state.turn;
  const danger = useMemo(() => {
    if (!warn || over || !me) return [] as Move[];
    const probe = { ...state, turn: other(me) };
    return pseudoMoves(probe, other(me)).filter((m) => m.captured === 'k');
  }, [warn, over, me, state]);
  const shapes = useMemo<DrawShape[]>(() => danger.map((m) => ({ orig: sqName(m.from) as Key, dest: sqName(m.to) as Key, brush: 'red' })), [danger]);

  const last = game.plies[game.plies.length - 1];
  const lastMove: [Key, Key] | null = last ? [sqName(last.move.from) as Key, sqName(last.move.to) as Key] : null;

  // ---- result
  const winner: Color | null = game.resigned ? other(game.resigned) : game.end && 'winner' in game.end ? game.end.winner : null;
  const resultText = (() => {
    if (game.resigned) return `${sideName(game.resigned)} resigned.`;
    if (!game.end) return '';
    switch (game.end.kind) {
      case 'king': return `${sideName(game.end.winner)} captured the king.`;
      case 'stuck': return `${sideName(other(game.end.winner))} had no legal move left (its drawback forbade them all), so ${sideName(game.end.winner)} wins.`;
      case 'fifty': return 'Draw: 50 moves each without a capture or a pawn move.';
      case 'repetition': return 'Draw: the same position appeared three times.';
    }
  })();
  const youWon = game.human && winner ? winner === game.human : null;

  const status = over ? null
    : thinking ? 'The computer is thinking…'
    : game.mode === 'computer' ? (humanToMove ? 'Your move' : '')
    : `${sideName(state.turn)} to move`;

  const myCard = game.mode === 'computer' && game.human ? db[game.human] : null;
  const theirCard = game.mode === 'computer' && game.human ? db[other(game.human)] : null;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,560px)_1fr]">
      <div className="min-w-0">
        <div className="relative overflow-hidden rounded-lg">
          <VariantBoard
            fen={placement(state.board)} orientation={orientation} turn={state.turn}
            movable={humanToMove ? state.turn : null} dests={dests} lastMove={lastMove} shapes={shapes} onMove={onMove}
          />
          {promo && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
              <div className="rounded-xl bg-ink-800 p-3 shadow-xl">
                <p className="mb-2 text-center text-sm text-ink-200">Promote to</p>
                <div className="flex gap-2">
                  {(['q', 'r', 'b', 'n'] as PieceType[]).map((t) => {
                    const m = promo.find((x) => x.promo === t);
                    return (
                      <button key={t} disabled={!m} onClick={() => { setPromo(null); if (m) apply(m); }} className="rounded-lg bg-ink-700 px-3 py-2 text-sm font-semibold capitalize text-ink-100 hover:bg-ink-600 disabled:opacity-30">
                        {pieceName(t)}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setPromo(null)} className="mt-2 w-full text-xs text-ink-400 hover:text-ink-200">Cancel</button>
              </div>
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {status && <span className="font-semibold text-ink-100">{status}</span>}
          {danger.length > 0 && !over && (
            <span className="flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300">
              <AlertTriangle size={13} /> Your king can be captured{danger.length === 1 ? ` (${pieceName(danger[0].piece)} on ${sqName(danger[0].from)})` : ''}
            </span>
          )}
          <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-300 hover:bg-ink-700" title="Flip board"><RotateCcw size={13} /> Flip</button>
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        {over && (
          <div className={`rounded-xl border p-4 ${youWon === false ? 'border-red-500/40 bg-red-500/10' : 'border-brand-500/40 bg-brand-500/10'}`}>
            <p className="flex items-center gap-2 text-lg font-bold">
              <Crown size={18} className="text-brand-300" />
              {winner ? (game.human ? (youWon ? 'You win!' : 'You lose') : `${sideName(winner)} wins`) : 'Draw'}
            </p>
            <p className="mt-1 text-sm text-ink-200">{resultText}</p>
            {theirCard && (
              <p className="mt-2 text-sm text-ink-200">
                The computer's drawback was <b className="text-ink-100">{theirCard.name}</b>: {theirCard.text}
                {game.guess && (game.guess === theirCard.id
                  ? <span className="ml-1 inline-flex items-center gap-1 font-semibold text-emerald-300"><Check size={14} /> You guessed it!</span>
                  : <span className="ml-1 inline-flex items-center gap-1 text-red-300"><X size={14} /> Your guess: {drawbackById(game.guess).name}</span>)}
              </p>
            )}
            {game.mode === 'friends' && (
              <p className="mt-2 text-sm text-ink-200">White had <b>{db.w.name}</b> ({db.w.text}) Black had <b>{db.b.name}</b> ({db.b.text})</p>
            )}
            <button onClick={onNew} className="btn-primary mt-3">New game</button>
          </div>
        )}

        {game.mode === 'computer' ? (
          <>
            <DrawbackCard d={myCard} title="Your drawback" />
            <div className="rounded-xl border border-ink-700 bg-ink-800/70 p-3">
              <div className="flex items-center gap-2 text-xs text-ink-400">
                <span className="font-semibold uppercase tracking-wide">Computer's drawback</span>
                <span className="ml-auto">{over ? 'Revealed above' : 'Hidden'}</span>
              </div>
              {!over && (
                <>
                  <p className="mt-1 text-sm text-ink-300">Watch what it never does. Your guess is checked when the game ends.</p>
                  <select
                    value={game.guess ?? ''}
                    onChange={(e) => setGame({ ...game, guess: e.target.value || null })}
                    className="mt-2 w-full rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
                    aria-label="Guess the computer's drawback"
                  >
                    <option value="">Guess its drawback…</option>
                    {DRAWBACKS.map((d) => <option key={d.id} value={d.id}>{d.name}: {d.text}</option>)}
                  </select>
                </>
              )}
            </div>
          </>
        ) : !over && (
          <DrawbackCard d={db[state.turn]} title={`${sideName(state.turn)}'s drawback`} hidden={!peek} onToggle={() => setPeek((v) => !v)} />
        )}

        <div className="rounded-xl border border-ink-700 bg-ink-800/70 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Moves</p>
          {game.plies.length === 0 ? (
            <p className="text-sm text-ink-500">No moves yet.</p>
          ) : (
            <ol className="grid max-h-48 grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 overflow-y-auto font-mono text-sm">
              {Array.from({ length: Math.ceil(game.plies.length / 2) }, (_, i) => (
                <li key={i} className="contents">
                  <span className="text-ink-500">{i + 1}.</span>
                  <span className="text-ink-100">{game.plies[i * 2]?.san}</span>
                  <span className="text-ink-100">{game.plies[i * 2 + 1]?.san ?? ''}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!over && (
            <button
              onClick={() => { if (window.confirm('Resign this game?')) setGame({ ...game, resigned: game.human ?? state.turn }); }}
              className="btn-secondary text-sm"
            >
              <Flag size={14} /> Resign
            </button>
          )}
          {!over && <button onClick={onNew} className="btn-secondary text-sm"><RotateCcw size={14} /> New game</button>}
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-ink-300">
            <input type="checkbox" checked={warn} onChange={(e) => setWarn(e.target.checked)} className="accent-brand-500" />
            Warn me when my king can be taken
          </label>
        </div>

        <details className="card p-3">
          <summary className="cursor-pointer text-sm font-semibold">Rules</summary>
          <div className="mt-2"><Rules /></div>
        </details>
      </div>
    </div>
  );
}
