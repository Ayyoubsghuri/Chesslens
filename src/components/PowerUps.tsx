import { useEffect, useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import type { Key } from '@lichess-org/chessground/types';
import { Crosshair, Rocket, CircleDot, Plus, Flag, RotateCcw, Loader2, ArrowLeft, Crown, X, Zap } from 'lucide-react';
import { VariantBoard } from './VariantBoard';
import { playMove } from '@/lib/engine';
import { searchMoveAmong } from '@/lib/drawback';
import {
  POWERS, sniperTargets, shoot, launchTargets, launch, dropSquares, drop, moveWithPortals, outcome, stockfishCanPlay,
  type PowerId, type Portals, type PowerResult,
} from '@/lib/powerups';

const SAVE_KEY = 'chesslens:powerup-game:v1';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const STRENGTHS = [
  { elo: 1500, label: 'Club', sub: '1500' },
  { elo: 2200, label: 'Expert', sub: '2200' },
  { elo: 3600, label: 'Stockfish', sub: 'full strength' },
];
const ICON: Record<PowerId, typeof Crosshair> = { sniper: Crosshair, catapult: Rocket, portals: CircleDot, drops: Plus };

interface PowerGame {
  power: PowerId;
  elo: number;
  dropMode: 'and' | 'or';
  fen: string;
  history: { label: string; by: 'w' | 'b' }[];
  last: [string, string] | null;
  portals: Portals;
  /** "and" mode: you moved, now add your pawn (Black waits). */
  dropNow: boolean;
  resigned: boolean;
}

function load(): PowerGame | null { try { const r = localStorage.getItem(SAVE_KEY); return r ? JSON.parse(r) as PowerGame : null; } catch { return null; } }
function save(g: PowerGame | null) { try { if (g) localStorage.setItem(SAVE_KEY, JSON.stringify(g)); else localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

export function PowerUps() {
  const [game, setGame] = useState<PowerGame | null>(() => load());
  useEffect(() => { save(game); }, [game]);
  const [power, setPower] = useState<PowerId>('sniper');
  const [elo, setElo] = useState(2200);
  const [dropMode, setDropMode] = useState<'and' | 'or'>('or');

  if (game) return <PowerGameScreen game={game} setGame={setGame} onLeave={() => setGame(null)} />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p className="text-sm text-ink-300">You play White against Stockfish, with one unfair advantage. Stockfish doesn't know about it.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {POWERS.map((p) => {
          const Icon = ICON[p.id];
          return (
            <button key={p.id} onClick={() => setPower(p.id)} aria-pressed={power === p.id}
              className={`card flex items-start gap-3 p-3 text-left transition-colors ${power === p.id ? 'ring-2 ring-brand-400' : 'hover:bg-ink-700/60'}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-300"><Icon size={18} /></span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-100">{p.name}</span>
                <span className="block text-xs text-ink-400">{p.text}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="card space-y-3 p-4">
        <div>
          <p className="mb-1 text-xs text-ink-400">Stockfish strength</p>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-ink-900/50 p-0.5">
            {STRENGTHS.map((s) => (
              <button key={s.elo} onClick={() => setElo(s.elo)} aria-pressed={elo === s.elo}
                className={`rounded-md px-2 py-1.5 text-xs font-semibold ${elo === s.elo ? 'bg-ink-600 text-white' : 'text-ink-400 hover:bg-ink-700/60'}`}>
                {s.label} <span className="font-normal opacity-70">{s.sub}</span>
              </button>
            ))}
          </div>
        </div>
        {power === 'drops' && (
          <div>
            <p className="mb-1 text-xs text-ink-400">Pawn drops</p>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-ink-900/50 p-0.5">
              {(['and', 'or'] as const).map((m) => (
                <button key={m} onClick={() => setDropMode(m)} aria-pressed={dropMode === m}
                  className={`rounded-md px-2 py-1.5 text-xs font-semibold ${dropMode === m ? 'bg-ink-600 text-white' : 'text-ink-400 hover:bg-ink-700/60'}`}>
                  {m === 'and' ? 'Move AND add a pawn' : 'Move OR add a pawn'}
                </button>
              ))}
            </div>
          </div>
        )}
        <button onClick={() => setGame({ power, elo, dropMode, fen: START, history: [], last: null, portals: { blue: null, orange: null }, dropNow: false, resigned: false })} className="btn-primary w-full">
          <Zap size={16} /> Start game
        </button>
      </div>
    </div>
  );
}

type Aim = null | 'sniper' | 'catapult' | 'blue' | 'orange' | 'drop';

function PowerGameScreen({ game, setGame, onLeave }: { game: PowerGame; setGame: (g: PowerGame | null) => void; onLeave: () => void }) {
  const info = POWERS.find((p) => p.id === game.power)!;
  const chess = useMemo(() => new Chess(game.fen), [game.fen]);
  const end = useMemo(() => outcome(game.fen), [game.fen]);
  const over = game.resigned || end.over;
  const myTurn = !over && chess.turn() === 'w' && !game.dropNow;
  const [aim, setAim] = useState<Aim>(null);
  const [picked, setPicked] = useState<Square | null>(null);
  const [thinking, setThinking] = useState(false);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setAim(null); setPicked(null); }, [game.fen]);

  const commit = (r: PowerResult | { fen: string; label: string; from?: string; to: string }, extra: Partial<PowerGame> = {}) => {
    setError(null);
    setGame({ ...game, ...extra, fen: r.fen, history: [...game.history, { label: r.label, by: 'w' }], last: r.from ? [r.from, r.to] : [r.to, r.to] });
  };

  // Stockfish answers.
  useEffect(() => {
    if (over || chess.turn() !== 'b' || game.dropNow) return;
    let live = true;
    setThinking(true);
    const think = stockfishCanPlay(game.fen)
      ? playMove(game.fen, game.elo)
      // too many pawns for Stockfish: ChessLens's own engine answers (a short pause so the board can update first)
      : new Promise<string | null>((res) => setTimeout(() => {
          const legal = new Chess(game.fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
          res(searchMoveAmong(game.fen, legal, 3));
        }, 60));
    think
      .then((uci) => {
        if (!live || !uci) return;
        const c = new Chess(game.fen);
        const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        setGame({ ...game, fen: c.fen(), history: [...game.history, { label: m.san, by: 'b' }], last: [m.from, m.to] });
      })
      .catch(() => { if (live) setError("Couldn't reach the engine. Try again in a moment."); })
      .finally(() => { if (live) setThinking(false); });
    return () => { live = false; setThinking(false); };
  }, [game.fen, game.dropNow, over]); // eslint-disable-line react-hooks/exhaustive-deps

  // Normal moves (with portals when they are placed).
  const dests = useMemo(() => {
    const map = new Map<Key, Key[]>();
    if (!myTurn || aim) return map;
    for (const m of chess.moves({ verbose: true })) {
      const arr = map.get(m.from as Key) ?? [];
      if (!arr.includes(m.to as Key)) arr.push(m.to as Key);
      map.set(m.from as Key, arr);
    }
    return map;
  }, [chess, myTurn, aim]);

  function onMove(from: Key, to: Key) {
    const promo = chess.get(from as Square)?.type === 'p' && to[1] === '8' ? 'q' : undefined;
    if (game.power === 'portals') {
      const r = moveWithPortals(game.fen, from as Square, to as Square, promo, game.portals);
      if (r) commit(r);
      return;
    }
    const c = new Chess(game.fen);
    let m;
    try { m = c.move({ from: from as Square, to: to as Square, promotion: promo }); } catch { return; }
    // "and" mode: after the move, you add a pawn before Black answers (unless the move already won)
    const andDrop = game.power === 'drops' && game.dropMode === 'and' && !outcome(c.fen()).over;
    commit({ fen: c.fen(), label: m.san, from, to }, { dropNow: andDrop });
  }

  // Aimed power-ups: squares to light, and what a click does.
  const targets = useMemo<Square[]>(() => {
    if (aim === 'sniper' && picked) return sniperTargets(game.fen, picked);
    if (aim === 'catapult' && picked) return launchTargets(game.fen, picked);
    if (aim === 'drop' || game.dropNow) return dropSquares(game.fen);
    if (aim === 'blue' || aim === 'orange') {
      const empty: Square[] = [];
      for (const f of 'abcdefgh') for (let r = 1; r <= 8; r++) { const s = `${f}${r}` as Square; if (!chess.get(s)) empty.push(s); }
      return empty;
    }
    return [];
  }, [aim, picked, game.fen, game.dropNow, chess]);

  const shooters = useMemo<Square[]>(() => {
    if (aim !== 'sniper' && aim !== 'catapult') return [];
    const out: Square[] = [];
    for (const row of chess.board()) for (const p of row) {
      if (!p || p.color !== 'w') continue;
      if (aim === 'sniper' && p.type === 'b' && sniperTargets(game.fen, p.square).length) out.push(p.square);
      if (aim === 'catapult' && p.type === 'p' && launchTargets(game.fen, p.square).length) out.push(p.square);
    }
    return out;
  }, [aim, chess, game.fen]);

  const marks = useMemo(() => {
    const m = new Map<Key, string>();
    if (game.portals.blue) m.set(game.portals.blue as Key, 'vb-portal-blue');
    if (game.portals.orange) m.set(game.portals.orange as Key, 'vb-portal-orange');
    for (const s of shooters) m.set(s as Key, 'vb-pick');
    const cls = aim === 'sniper' ? 'vb-target' : aim === 'catapult' ? 'vb-land' : 'vb-drop';
    for (const t of targets) if (!m.has(t as Key)) m.set(t as Key, cls);
    return m;
  }, [game.portals, shooters, targets, aim]);

  function onSelect(k: Key) {
    const s = k as Square;
    if (game.dropNow) {
      const r = drop(game.fen, s);
      if (r) commit(r, { dropNow: false });
      return;
    }
    if (!myTurn || !aim) return;
    if (aim === 'sniper' || aim === 'catapult') {
      if (shooters.includes(s)) { setPicked(s); return; }
      if (picked && targets.includes(s)) {
        const r = aim === 'sniper' ? shoot(game.fen, picked, s) : launch(game.fen, picked, s);
        if (r) commit(r); else setError('That shot is not allowed (your king would be left in check).');
      }
      return;
    }
    if (aim === 'blue' || aim === 'orange') {
      if (chess.get(s)) return;
      const portals = { ...game.portals, [aim]: s };
      if (portals.blue === portals.orange) return;
      setGame({ ...game, portals });
      setAim(null);
      return;
    }
    if (aim === 'drop') {
      const r = drop(game.fen, s);
      if (r) commit(r); else setError('No pawn there: it would leave your king in check.');
    }
  }

  const lastMove: [Key, Key] | null = game.last ? [game.last[0] as Key, game.last[1] as Key] : null;
  const aimBtn = (a: Aim, label: string, Icon: typeof Crosshair) => (
    <button onClick={() => { setAim(aim === a ? null : a); setPicked(null); setError(null); }} disabled={!myTurn}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40 ${aim === a ? 'bg-brand-500 text-ink-900' : 'bg-ink-700/70 text-ink-100 hover:bg-ink-600'}`}>
      <Icon size={14} /> {label}
    </button>
  );

  const hint = game.dropNow ? 'Now add your pawn: tap a green dot (or skip).'
    : aim === 'sniper' ? (picked ? 'Tap a red target to shoot it.' : 'Tap one of your bishops (yellow).')
    : aim === 'catapult' ? (picked ? 'Tap a yellow dot to launch the pawn there.' : 'Tap one of your pawns (yellow).')
    : aim === 'blue' || aim === 'orange' ? `Tap an empty square for the ${aim} portal.`
    : aim === 'drop' ? 'Tap a green dot to add a pawn (this uses your turn).'
    : '';

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,560px)_1fr]">
      <div className="min-w-0">
        <div className="neon-board">
          <VariantBoard fen={game.fen.split(' ')[0]} orientation={orientation} turn={chess.turn()} movable={myTurn && !aim ? 'w' : null}
            dests={dests} lastMove={lastMove} marks={marks} onMove={onMove} onSelect={onSelect} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {!over && <span className="font-semibold text-ink-100">{thinking ? <span className="flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> {stockfishCanPlay(game.fen) ? 'Stockfish' : 'The engine'} is thinking…</span> : game.dropNow ? 'Add your pawn' : myTurn ? (chess.inCheck() ? 'Your move: you are in check' : 'Your move') : ''}</span>}
          <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-300 hover:bg-ink-700"><RotateCcw size={13} /> Flip</button>
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        <div className="rounded-xl border border-ink-700 bg-ink-800/70 p-3">
          <p className="font-semibold">{info.name}{game.power === 'drops' ? ` (${game.dropMode === 'and' ? 'move AND add' : 'move OR add'})` : ''} <span className="ml-1 text-xs font-normal text-ink-400">vs Stockfish {game.elo}</span></p>
          <p className="text-sm text-ink-300">{info.text}</p>
          {!over && (
            <div className="mt-3 flex flex-wrap gap-2">
              {game.power === 'sniper' && aimBtn('sniper', 'Aim a bishop', Crosshair)}
              {game.power === 'catapult' && aimBtn('catapult', 'Launch a pawn', Rocket)}
              {game.power === 'portals' && (<>
                {aimBtn('blue', game.portals.blue ? 'Move blue portal' : 'Place blue portal', CircleDot)}
                {aimBtn('orange', game.portals.orange ? 'Move orange portal' : 'Place orange portal', CircleDot)}
                {(game.portals.blue || game.portals.orange) && (
                  <button onClick={() => setGame({ ...game, portals: { blue: null, orange: null } })} className="rounded-lg bg-ink-700/70 px-3 py-2 text-xs text-ink-100 hover:bg-ink-600"><X size={13} className="inline" /> Clear</button>
                )}
              </>)}
              {game.power === 'drops' && game.dropMode === 'or' && aimBtn('drop', 'Add a pawn instead', Plus)}
              {game.dropNow && (
                <button onClick={() => setGame({ ...game, dropNow: false })} className="rounded-lg bg-ink-700/70 px-3 py-2 text-xs text-ink-100 hover:bg-ink-600">Skip the pawn</button>
              )}
            </div>
          )}
          {hint && !over && <p className="mt-2 text-xs text-brand-200">{hint}</p>}
          {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
          {!stockfishCanPlay(game.fen) && !over && (
            <p className="mt-2 text-xs text-ink-400">Stockfish can't think about more than 8 pawns a side, so ChessLens's own engine (weaker) is playing Black now.</p>
          )}
        </div>

        {over && (
          <div className={`rounded-xl border p-4 ${end.whiteWins ? 'border-brand-500/40 bg-brand-500/10' : 'border-ink-600 bg-ink-800/70'}`}>
            <p className="flex items-center gap-2 text-lg font-bold"><Crown size={18} className="text-brand-300" /> {game.resigned ? 'You resigned' : end.whiteWins ? 'You win!' : end.whiteWins === false ? 'You lose' : 'Draw'}</p>
            {!game.resigned && <p className="mt-1 text-sm text-ink-200">{end.text}</p>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => setGame({ ...game, fen: START, history: [], last: null, portals: { blue: null, orange: null }, dropNow: false, resigned: false })} className="btn-primary text-sm">Play again</button>
              <button onClick={onLeave} className="btn-secondary text-sm">Other power-ups</button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-ink-700 bg-ink-800/70 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Moves</p>
          {game.history.length === 0 ? <p className="text-sm text-ink-500">No moves yet.</p> : (
            <ol className="flex max-h-48 flex-wrap gap-x-2 gap-y-0.5 overflow-y-auto font-mono text-sm">
              {game.history.map((h, i) => (
                <li key={i} className={h.by === 'w' ? 'text-ink-100' : 'text-ink-400'}>{h.by === 'w' && (i === 0 || game.history[i - 1].by === 'b') ? `${Math.floor(game.history.slice(0, i).filter((x) => x.by === 'b').length) + 1}. ` : ''}{h.label}</li>
              ))}
            </ol>
          )}
        </div>

        {!over && (
          <div className="flex gap-2">
            <button onClick={() => { if (window.confirm('Resign this game?')) setGame({ ...game, resigned: true }); }} className="btn-secondary text-sm"><Flag size={14} /> Resign</button>
            <button onClick={onLeave} className="btn-secondary text-sm"><ArrowLeft size={14} /> Other power-ups</button>
          </div>
        )}
      </div>
    </div>
  );
}
