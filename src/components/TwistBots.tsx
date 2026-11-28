import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import type { Key } from '@lichess-org/chessground/types';
import { Flag, RotateCcw, Shuffle, Loader2, ArrowLeft, Bot, Crown } from 'lucide-react';
import { VariantBoard } from './VariantBoard';
import { BOTS, botById, botMove, rankAll, type BotId, type BotMemory } from '@/lib/twist-bots';

const SAVE_KEY = 'chesslens:twist-bot-game:v1';

interface BotGame {
  bot: BotId;
  human: 'w' | 'b';
  ucis: string[];
  sans: string[];
  memory: BotMemory;
  note: string;
  resigned: boolean;
}

function load(): BotGame | null {
  try { const r = localStorage.getItem(SAVE_KEY); return r ? JSON.parse(r) as BotGame : null; } catch { return null; }
}
function save(g: BotGame | null) {
  try { if (g) localStorage.setItem(SAVE_KEY, JSON.stringify(g)); else localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

/** Replays the moves (chess.js needs the history for threefold repetition). */
function replay(ucis: string[]): Chess {
  const c = new Chess();
  for (const u of ucis) { try { c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { break; } }
  return c;
}

const GROUPS: { id: 'strength' | 'choice' | 'habit'; title: string; sub: string }[] = [
  { id: 'strength', title: 'Its strength changes', sub: 'The rating goes up or down with what happens in the game.' },
  { id: 'choice', title: 'It picks a different move', sub: "Not always its best: the 2nd best, a random one of its top moves, a copy of yours..." },
  { id: 'habit', title: 'It has an obsession', sub: 'One rule it follows no matter what.' },
];

export function TwistBots() {
  const [game, setGame] = useState<BotGame | null>(() => load());
  useEffect(() => { save(game); }, [game]);
  const [picked, setPicked] = useState<BotId | null>(null);

  if (game) return <BotGameScreen game={game} setGame={setGame} onLeave={() => setGame(null)} />;

  if (picked) {
    const b = botById(picked);
    const start = (side: 'w' | 'b' | 'random') => {
      const human = side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side;
      setGame({ bot: picked, human, ucis: [], sans: [], memory: {}, note: '', resigned: false });
      setPicked(null);
    };
    return (
      <div className="mx-auto max-w-md space-y-3">
        <button onClick={() => setPicked(null)} className="flex items-center gap-1 text-xs text-ink-400 hover:text-ink-200"><ArrowLeft size={13} /> All bots</button>
        <div className="card p-4">
          <p className="flex items-center gap-2 text-lg font-bold"><Bot size={18} className="text-brand-400" /> {b.name}</p>
          <p className="mt-1 text-sm text-ink-300">Stockfish, but… {b.twist.charAt(0).toLowerCase() + b.twist.slice(1)}</p>
          <p className="mt-3 mb-1 text-xs text-ink-400">You play</p>
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => start('w')} className="btn-secondary text-sm">White</button>
            <button onClick={() => start('random')} className="btn-secondary text-sm"><Shuffle size={14} /> Random</button>
            <button onClick={() => start('b')} className="btn-secondary text-sm">Black</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {GROUPS.map((g) => (
        <section key={g.id}>
          <h3 className="!text-base">{g.title}</h3>
          <p className="mb-2 text-xs text-ink-400">{g.sub}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {BOTS.filter((b) => b.group === g.id).map((b) => (
              <button key={b.id} onClick={() => setPicked(b.id)} className="card flex items-start gap-3 p-3 text-left transition-colors hover:bg-ink-700/60">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-300"><Bot size={18} /></span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-semibold text-ink-100">{b.name}<span className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[10px] text-ink-300">{b.rating}</span></span>
                  <span className="block text-xs text-ink-400">{b.twist}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function BotGameScreen({ game, setGame, onLeave }: { game: BotGame; setGame: (g: BotGame | null) => void; onLeave: () => void }) {
  const info = botById(game.bot);
  const chess = useMemo(() => replay(game.ucis), [game.ucis]);
  const fen = chess.fen();
  const turn = chess.turn();
  const over = game.resigned || chess.isGameOver();
  const myTurn = !over && turn === game.human;
  const [thinking, setThinking] = useState(false);
  const [orientation, setOrientation] = useState<'white' | 'black'>(game.human === 'b' ? 'black' : 'white');
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);

  // When it is your turn: start the clock (Slow Burner) and let the engine rank your options (The Mirror, The Student).
  const turnStart = useRef(Date.now());
  const ranking = useRef<{ fen: string; p: Promise<string[]> } | null>(null);
  const needsRank = game.bot === 'mirror' || game.bot === 'student';
  useEffect(() => {
    if (!myTurn) return;
    turnStart.current = Date.now();
    if (needsRank) ranking.current = { fen, p: rankAll(fen, 10).then((ls) => ls.map((l) => l.uci)).catch(() => []) };
  }, [fen, myTurn, needsRank]);
  const lastThink = useRef(0);

  // The bot's turn.
  useEffect(() => {
    if (over || turn === game.human) return;
    let live = true;
    setThinking(true);
    (async () => {
      const lastUci = game.ucis[game.ucis.length - 1];
      let rank: number | null = null;
      if (needsRank && lastUci && ranking.current) {
        const list = await ranking.current.p;
        const i = list.findIndex((u) => u.slice(0, 4) === lastUci.slice(0, 4) && (u[4] ?? '') === (lastUci[4] ?? ''));
        rank = i >= 0 ? i + 1 : list.length ? list.length : null;
      }
      const gaveCheck = (game.sans[game.sans.length - 1] ?? '').match(/[+#]/) != null && game.ucis.length > 0;
      const choice = await botMove(game.bot, fen, game.memory, { gaveCheck, rank, thinkMs: lastThink.current }).catch(() => null);
      if (!live) return;
      setThinking(false);
      if (!choice) return;
      const c = replay(game.ucis);
      let san = choice.uci;
      try { san = c.move({ from: choice.uci.slice(0, 2), to: choice.uci.slice(2, 4), promotion: choice.uci[4] }).san; } catch { return; }
      setGame({ ...game, ucis: [...game.ucis, choice.uci], sans: [...game.sans, san], memory: choice.memory, note: choice.note });
    })();
    return () => { live = false; setThinking(false); };
  }, [fen, over]); // eslint-disable-line react-hooks/exhaustive-deps

  const dests = useMemo(() => {
    const map = new Map<Key, Key[]>();
    if (!myTurn) return map;
    for (const m of chess.moves({ verbose: true })) {
      const arr = map.get(m.from as Key) ?? [];
      if (!arr.includes(m.to as Key)) arr.push(m.to as Key);
      map.set(m.from as Key, arr);
    }
    return map;
  }, [chess, myTurn]);

  function playUser(from: string, to: string, promotion?: string) {
    const c = replay(game.ucis);
    let san: string;
    try { san = c.move({ from: from as Square, to: to as Square, promotion }).san; } catch { return; }
    lastThink.current = Date.now() - turnStart.current;
    setGame({ ...game, ucis: [...game.ucis, from + to + (promotion ?? '')], sans: [...game.sans, san] });
  }
  function onMove(from: Key, to: Key) {
    const p = chess.get(from as Square);
    if (p?.type === 'p' && (to[1] === '8' || to[1] === '1')) { setPromo({ from, to }); return; }
    playUser(from, to);
  }

  const last = game.ucis[game.ucis.length - 1];
  const lastMove: [Key, Key] | null = last ? [last.slice(0, 2) as Key, last.slice(2, 4) as Key] : null;
  const result = (() => {
    if (game.resigned) return 'You resigned.';
    if (chess.isCheckmate()) return turn === game.human ? `${info.name} checkmated you.` : `You checkmated ${info.name}!`;
    if (chess.isStalemate()) return 'Stalemate: draw.';
    if (chess.isThreefoldRepetition()) return 'Draw by repetition.';
    if (chess.isInsufficientMaterial()) return 'Draw: not enough material to checkmate.';
    if (chess.isDraw()) return 'Draw by the 50-move rule.';
    return '';
  })();
  const won = chess.isCheckmate() && turn !== game.human;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,560px)_1fr]">
      <div className="min-w-0">
        <div className="neon-board relative overflow-hidden rounded-lg">
          <VariantBoard fen={fen} orientation={orientation} turn={turn} movable={myTurn ? turn : null} dests={dests} lastMove={lastMove} onMove={onMove} />
          {promo && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
              <div className="flex gap-2 rounded-xl bg-ink-800 p-3">
                {['q', 'r', 'b', 'n'].map((t) => (
                  <button key={t} onClick={() => { const p = promo; setPromo(null); playUser(p.from, p.to, t); }} className="rounded-lg bg-ink-700 px-3 py-2 text-sm font-semibold uppercase text-ink-100 hover:bg-ink-600">{t}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          {!over && <span className="font-semibold text-ink-100">{thinking ? <span className="flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> {info.name} is thinking…</span> : myTurn ? (chess.inCheck() ? 'Your move: you are in check' : 'Your move') : ''}</span>}
          <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-300 hover:bg-ink-700"><RotateCcw size={13} /> Flip</button>
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        <div className="rounded-xl border border-ink-700 bg-ink-800/70 p-3">
          <p className="flex items-center gap-2 font-semibold"><Bot size={16} className="text-brand-400" /> {info.name}</p>
          <p className="text-sm text-ink-300">{info.twist}</p>
          {game.note && <p className="mt-2 rounded-lg bg-ink-900/60 px-2.5 py-1.5 text-sm text-brand-200">{game.note}</p>}
        </div>

        {over && (
          <div className={`rounded-xl border p-4 ${won ? 'border-brand-500/40 bg-brand-500/10' : 'border-ink-600 bg-ink-800/70'}`}>
            <p className="flex items-center gap-2 text-lg font-bold"><Crown size={18} className="text-brand-300" /> {won ? 'You win!' : chess.isCheckmate() || game.resigned ? 'You lose' : 'Draw'}</p>
            <p className="mt-1 text-sm text-ink-200">{result}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setGame({ ...game, ucis: [], sans: [], memory: {}, note: '', resigned: false })} className="btn-primary text-sm">Rematch</button>
              <button onClick={onLeave} className="btn-secondary text-sm">Other bots</button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-ink-700 bg-ink-800/70 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Moves</p>
          {game.sans.length === 0 ? <p className="text-sm text-ink-500">No moves yet.</p> : (
            <ol className="grid max-h-48 grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 overflow-y-auto font-mono text-sm">
              {Array.from({ length: Math.ceil(game.sans.length / 2) }, (_, i) => (
                <li key={i} className="contents">
                  <span className="text-ink-500">{i + 1}.</span>
                  <span className="text-ink-100">{game.sans[i * 2]}</span>
                  <span className="text-ink-100">{game.sans[i * 2 + 1] ?? ''}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {!over && (
          <div className="flex gap-2">
            <button onClick={() => { if (window.confirm('Resign this game?')) setGame({ ...game, resigned: true }); }} className="btn-secondary text-sm"><Flag size={14} /> Resign</button>
            <button onClick={onLeave} className="btn-secondary text-sm"><ArrowLeft size={14} /> Other bots</button>
          </div>
        )}
      </div>
    </div>
  );
}
