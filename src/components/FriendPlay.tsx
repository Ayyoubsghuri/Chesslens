import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import type { Key } from '@lichess-org/chessground/types';
import { Users, Copy, Share2, Loader2, Flag, Handshake, RotateCcw, X, Wifi, WifiOff, BarChart3, LogIn, Plus, Shuffle } from 'lucide-react';
import { VariantBoard } from './VariantBoard';
import { hostRoom, joinRoom, newCode, cleanCode, type FriendLink, type LinkState, type Msg, type Side } from '@/lib/friend-link';
import { getUsername } from '@/lib/player';
import type { PlayedGame } from './PlayVsComputer';

interface GameState {
  ucis: string[];
  hostColor: Side;
  hostName: string;
  guestName: string;
  result: string | null;
  /** how it ended, in words ("White resigned", "Checkmate"...) */
  reason: string;
  gameId: string;
}

const other = (s: Side): Side => (s === 'w' ? 'b' : 'w');
const sideName = (s: Side) => (s === 'w' ? 'White' : 'Black');
const NAME_KEY = 'chesslens:friend-name';

function replay(ucis: string[]): Chess {
  const c = new Chess();
  for (const u of ucis) { try { c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { break; } }
  return c;
}

/** Result of the position on the board, when the rules end the game. */
function boardResult(c: Chess): { result: string; reason: string } | null {
  if (c.isCheckmate()) return { result: c.turn() === 'w' ? '0-1' : '1-0', reason: 'Checkmate' };
  if (c.isStalemate()) return { result: '1/2-1/2', reason: 'Stalemate' };
  if (c.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'Draw by repetition' };
  if (c.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'Draw: not enough material' };
  if (c.isDraw()) return { result: '1/2-1/2', reason: 'Draw by the 50-move rule' };
  return null;
}

/** Play a friend on another device: same Wi-Fi or anywhere, joined with a short code. */
export function FriendPlay({ onAnalyze }: { onAnalyze?: (g: PlayedGame) => void }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) || getUsername() || ''; } catch { return ''; } });
  const [pick, setPick] = useState<Side | 'random'>('random');
  const [joinCode, setJoinCode] = useState('');
  const [link, setLink] = useState<FriendLink | null>(null);
  const [state, setState] = useState<LinkState | null>(null);
  const [detail, setDetail] = useState('');
  const [game, setGame] = useState<GameState | null>(null);
  const [draw, setDraw] = useState<'sent' | 'received' | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const gameRef = useRef<GameState | null>(null);
  gameRef.current = game;
  const linkRef = useRef<FriendLink | null>(null);
  linkRef.current = link;
  const myName = name.trim() || 'Player';
  useEffect(() => { try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ } }, [name]);

  // Leaving the page closes the room.
  useEffect(() => () => { linkRef.current?.close(); }, []);

  const role = link?.role ?? null;
  const myColor: Side | null = game && role ? (role === 'host' ? game.hostColor : other(game.hostColor)) : null;

  const syncMsg = (g: GameState): Msg => ({ t: 'sync', ucis: g.ucis, hostColor: g.hostColor, hostName: g.hostName, result: g.result ? `${g.result}|${g.reason}` : null, gameId: g.gameId });

  function handle(m: Msg, isHost: boolean) {
    const g = gameRef.current;
    switch (m.t) {
      case 'hello': {
        if (!isHost || !g) return;
        const next = { ...g, guestName: m.name || 'Friend' };
        setGame(next);
        linkRef.current?.send(syncMsg(next));
        return;
      }
      case 'sync': {
        if (isHost) return;
        const [result, reason] = m.result ? m.result.split('|') : [null, ''];
        const isNewGame = lastGameId.current !== m.gameId;
        lastGameId.current = m.gameId;
        setGame({ ucis: m.ucis, hostColor: m.hostColor, hostName: m.hostName, guestName: myName, result, reason: reason ?? '', gameId: m.gameId });
        if (isNewGame) setDraw(null);
        return;
      }
      case 'move': {
        if (!g || g.result) return;
        if (m.ply !== g.ucis.length) { if (isHost) linkRef.current?.send(syncMsg(g)); else linkRef.current?.send({ t: 'hello', name: myName }); return; }
        const c = replay(g.ucis);
        try { c.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] }); } catch { if (isHost) linkRef.current?.send(syncMsg(g)); return; }
        const end = boardResult(c);
        setDraw(null);
        setGame({ ...g, ucis: [...g.ucis, m.uci], result: end?.result ?? null, reason: end?.reason ?? '' });
        return;
      }
      case 'resign': {
        if (!g || g.result) return;
        const loser = isHost ? other(g.hostColor) : g.hostColor;
        setGame({ ...g, result: loser === 'w' ? '0-1' : '1-0', reason: `${sideName(loser)} resigned` });
        return;
      }
      case 'draw-offer': setDraw('received'); return;
      case 'draw-decline': setDraw(null); return;
      case 'draw-accept': {
        if (!g || g.result) return;
        setDraw(null);
        setGame({ ...g, result: '1/2-1/2', reason: 'Draw agreed' });
        return;
      }
      case 'rematch': {
        if (!isHost || !g) return;
        startRematch(g);
        return;
      }
    }
  }
  const lastGameId = useRef<string | null>(null);

  function startRematch(g: GameState) {
    const next: GameState = { ...g, ucis: [], result: null, reason: '', hostColor: other(g.hostColor), gameId: newCode(6) };
    setGame(next);
    setDraw(null);
    linkRef.current?.send(syncMsg(next));
  }

  async function create() {
    const code = newCode();
    const hostColor: Side = pick === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : pick;
    setGame({ ucis: [], hostColor, hostName: myName, guestName: '', result: null, reason: '', gameId: newCode(6) });
    setDetail('');
    try {
      const l = await hostRoom(code, {
        onState: (s, d) => { setState(s); setDetail(d ?? ''); },
        onMessage: (m) => handle(m, true),
        onPeerJoined: () => { const g = gameRef.current; if (g) linkRef.current?.send(syncMsg(g)); },
      });
      setLink(l);
    } catch { setState('error'); setDetail("Couldn't start a room on this device."); }
  }

  async function join() {
    const code = cleanCode(joinCode);
    if (code.length < 4) return;
    setGame(null);
    setDetail('');
    try {
      const l = await joinRoom(code, {
        onState: (s, d) => { setState(s); setDetail(d ?? ''); },
        onMessage: (m) => handle(m, false),
        // introduce yourself: the host answers with the game (also after a reconnect)
        onOpen: (send) => send({ t: 'hello', name: myName }),
      });
      setLink(l);
    } catch { setState('error'); setDetail("Couldn't connect from this device."); }
  }

  function leave() {
    link?.close();
    setLink(null); setState(null); setGame(null); setDraw(null); setDetail('');
  }

  // ---- the board
  const chess = useMemo(() => replay(game?.ucis ?? []), [game?.ucis]);
  const connected = state === 'connected';
  const myTurn = !!game && !game.result && connected && myColor === chess.turn();
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

  function play(from: string, to: string, promotion?: string) {
    if (!game || !link) return;
    const c = replay(game.ucis);
    try { c.move({ from: from as Square, to: to as Square, promotion }); } catch { return; }
    const uci = from + to + (promotion ?? '');
    const end = boardResult(c);
    link.send({ t: 'move', uci, ply: game.ucis.length });
    setDraw(null);
    setGame({ ...game, ucis: [...game.ucis, uci], result: end?.result ?? null, reason: end?.reason ?? '' });
  }
  function onMove(from: Key, to: Key) {
    const p = chess.get(from as Square);
    if (p?.type === 'p' && (to[1] === '8' || to[1] === '1')) { setPromo({ from, to }); return; }
    play(from, to);
  }

  function resign() {
    if (!game || !myColor || game.result || !window.confirm('Resign this game?')) return;
    link?.send({ t: 'resign' });
    setGame({ ...game, result: myColor === 'w' ? '0-1' : '1-0', reason: `${sideName(myColor)} resigned` });
  }
  function offerDraw() { link?.send({ t: 'draw-offer' }); setDraw('sent'); }
  function acceptDraw() { if (!game) return; link?.send({ t: 'draw-accept' }); setDraw(null); setGame({ ...game, result: '1/2-1/2', reason: 'Draw agreed' }); }
  function declineDraw() { link?.send({ t: 'draw-decline' }); setDraw(null); }
  function rematch() { if (!game) return; if (role === 'host') startRematch(game); else link?.send({ t: 'rematch' }); }

  function analyze() {
    if (!game || !onAnalyze) return;
    const c = replay(game.ucis);
    const white = game.hostColor === 'w' ? game.hostName : game.guestName || 'Friend';
    const black = game.hostColor === 'b' ? game.hostName : game.guestName || 'Friend';
    c.header('Event', 'Friendly game', 'Site', 'ChessLens', 'White', white, 'Black', black, 'Result', game.result ?? '*', 'Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'));
    onAnalyze({ pgn: c.pgn(), white, black, result: game.result ?? '*' });
  }

  async function share() {
    if (!link) return;
    const text = `Play chess with me on ChessLens: open Play → Friend → Join and type ${link.code}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'ChessLens game', text }); return; }
    } catch { /* cancelled */ }
    try { await navigator.clipboard.writeText(link.code); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }

  // ---------------- lobby ----------------
  if (!link) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div className="card p-4">
          <p className="flex items-center gap-2 text-lg font-bold"><Users size={18} className="text-brand-400" /> Play a friend</p>
          <p className="mt-1 text-sm text-ink-400">
            One of you creates a room, the other types its code. On the same Wi-Fi the moves go straight between your two devices.
            Connecting needs internet for a few seconds; it also works when you are not on the same network.
          </p>
          <label className="mt-3 block text-xs text-ink-400">Your name
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} placeholder="Player" className="input mt-1" />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card space-y-3 p-4">
            <p className="font-semibold">Create a room</p>
            <div>
              <p className="mb-1 text-xs text-ink-400">You play</p>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-ink-900/50 p-0.5">
                {([['w', 'White'], ['random', 'Random'], ['b', 'Black']] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setPick(v)} aria-pressed={pick === v}
                    className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold ${pick === v ? 'bg-ink-600 text-white' : 'text-ink-400'}`}>
                    {v === 'random' && <Shuffle size={12} />} {l}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={create} className="btn-primary w-full"><Plus size={16} /> Create room</button>
          </div>
          <div className="card space-y-3 p-4">
            <p className="font-semibold">Join a room</p>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(cleanCode(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') join(); }}
              placeholder="CODE"
              inputMode="text"
              autoCapitalize="characters"
              className="input text-center font-mono text-2xl tracking-[0.4em]"
              aria-label="Room code"
            />
            <button onClick={join} disabled={cleanCode(joinCode).length < 4} className="btn-primary w-full"><LogIn size={16} /> Join</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- room ----------------
  const waiting = role === 'host' && (state === 'starting' || state === 'waiting');
  const youName = myName;
  const themName = role === 'host' ? game?.guestName || 'Your friend' : game?.hostName || 'Your friend';
  const last = game?.ucis[game.ucis.length - 1];
  const lastMove: [Key, Key] | null = last ? [last.slice(0, 2) as Key, last.slice(2, 4) as Key] : null;
  const sans = chess.history();
  const won = game?.result && myColor ? (game.result === '1-0') === (myColor === 'w') && game.result !== '1/2-1/2' : false;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,560px)_1fr]">
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span className="font-semibold text-ink-100">{themName}</span>
          {myColor && <span className="text-xs text-ink-400">({sideName(other(myColor))})</span>}
        </div>
        <div className="neon-board relative overflow-hidden rounded-lg">
          <VariantBoard
            fen={chess.fen()} orientation={myColor === 'b' ? 'black' : 'white'} turn={chess.turn()}
            movable={myTurn ? chess.turn() : null} dests={dests} lastMove={lastMove} onMove={onMove}
          />
          {promo && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
              <div className="flex gap-2 rounded-xl bg-ink-800 p-3">
                {['q', 'r', 'b', 'n'].map((t) => (
                  <button key={t} onClick={() => { const p = promo; setPromo(null); play(p.from, p.to, t); }} className="rounded-lg bg-ink-700 px-3 py-2 text-sm font-semibold uppercase text-ink-100 hover:bg-ink-600">{t}</button>
                ))}
              </div>
            </div>
          )}
          {waiting && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-ink-950/80 p-4 text-center">
              <p className="text-sm text-ink-300">Room code</p>
              <p className="font-mono text-5xl font-extrabold tracking-[0.3em] text-brand-300">{link.code}</p>
              <p className="flex items-center gap-2 text-xs text-ink-400"><Loader2 size={13} className="animate-spin" /> Waiting for your friend to join…</p>
              <div className="flex gap-2">
                <button onClick={share} className="btn-secondary text-sm">{copied ? <><Copy size={14} /> Copied</> : <><Share2 size={14} /> Share code</>}</button>
              </div>
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="font-semibold text-ink-100">{youName}</span>
          {myColor && <span className="text-xs text-ink-400">({sideName(myColor)})</span>}
          <span className={`ml-auto flex items-center gap-1 text-xs ${connected ? 'text-brand-300' : 'text-amber-300'}`}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
            {connected ? 'Connected' : state === 'waiting' ? 'Waiting for your friend' : state === 'reconnecting' ? 'Reconnecting…' : state === 'error' ? 'Not connected' : 'Connecting…'}
          </span>
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        {detail && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{detail}</p>}

        {game && connected && !game.result && (
          <p className="text-lg font-bold">{myTurn ? 'Your move' : `${themName} is thinking…`}{chess.inCheck() && myTurn ? ' (check!)' : ''}</p>
        )}

        {draw === 'received' && !game?.result && (
          <div className="flex items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm">
            <Handshake size={16} className="text-brand-300" /> <span className="flex-1">{themName} offers a draw.</span>
            <button onClick={acceptDraw} className="btn-primary px-3 py-1.5 text-xs">Accept</button>
            <button onClick={declineDraw} className="btn-secondary px-3 py-1.5 text-xs">Decline</button>
          </div>
        )}
        {draw === 'sent' && !game?.result && <p className="text-xs text-ink-400">Draw offered. Waiting for {themName}…</p>}

        {game?.result && (
          <div className={`rounded-xl border p-4 ${won ? 'border-brand-500/40 bg-brand-500/10' : 'border-ink-600 bg-ink-800/70'}`}>
            <p className="text-lg font-bold">{game.result === '1/2-1/2' ? 'Draw' : won ? 'You win!' : 'You lose'}</p>
            <p className="text-sm text-ink-300">{game.reason} · {game.result.replace('1/2-1/2', '½-½')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={rematch} disabled={!connected} className="btn-primary text-sm"><RotateCcw size={14} /> Rematch (swap colours)</button>
              {onAnalyze && game.ucis.length > 0 && <button onClick={analyze} className="btn-secondary text-sm"><BarChart3 size={14} /> Analyze this game</button>}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-ink-700 bg-ink-800/70 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Moves</p>
          {sans.length === 0 ? <p className="text-sm text-ink-500">No moves yet.</p> : (
            <ol className="grid max-h-48 grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 overflow-y-auto font-mono text-sm">
              {Array.from({ length: Math.ceil(sans.length / 2) }, (_, i) => (
                <li key={i} className="contents">
                  <span className="text-ink-500">{i + 1}.</span>
                  <span className="text-ink-100">{sans[i * 2]}</span>
                  <span className="text-ink-100">{sans[i * 2 + 1] ?? ''}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {game && !game.result && connected && (
            <>
              <button onClick={resign} className="btn-secondary text-sm"><Flag size={14} /> Resign</button>
              <button onClick={offerDraw} disabled={draw === 'sent'} className="btn-secondary text-sm"><Handshake size={14} /> Offer draw</button>
            </>
          )}
          <button onClick={leave} className="btn-ghost text-sm"><X size={14} /> Leave room</button>
          {role && <span className="ml-auto self-center font-mono text-xs text-ink-500">Room {link.code}</span>}
        </div>
      </div>
    </div>
  );
}
