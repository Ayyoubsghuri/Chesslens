import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import type { Key } from '@lichess-org/chessground/types';
import {
  Users, Copy, Share2, Loader2, Flag, Handshake, RotateCcw, X, Wifi, WifiOff, BarChart3, LogIn, Plus, Shuffle,
  Crosshair, Rocket, Dices, Crown, EyeOff,
} from 'lucide-react';
import { VariantBoard } from './VariantBoard';
import {
  hostRoom, joinRoom, newCode, cleanCode, type FriendLink, type LinkState, type Msg, type Side, type FriendVariant, type VPly,
} from '@/lib/friend-link';
import { getUsername } from '@/lib/player';
import {
  initialState as dbInitial, legalMoves as dbLegal, play as dbPlay, ending as dbEnding, notation as dbNotation, placement as dbPlacement,
  sqName as dbSq, dealDrawback, drawbackById, type State as DbState, type Move as DbMove,
} from '@/lib/drawback';
import { sniperTargets, shoot, launchTargets, launch, dropSquares, drop, type PowerResult } from '@/lib/powerups';
import type { PlayedGame } from './PlayVsComputer';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const VARIANTS: { id: FriendVariant; name: string; text: string; icon: typeof Crown }[] = [
  { id: 'standard', name: 'Standard', text: 'Normal chess.', icon: Crown },
  { id: 'drawbacks', name: 'Secret Drawbacks', text: 'Each of you gets a hidden handicap. No check: take the king to win.', icon: Dices },
  { id: 'sniper', name: 'Sniper bishops', text: 'Both sides: instead of moving, a bishop can shoot the first enemy piece on its diagonals.', icon: Crosshair },
  { id: 'catapult', name: 'Pawn catapult', text: 'Both sides: instead of moving, launch a pawn 2 to 4 squares ahead, over anything.', icon: Rocket },
  { id: 'drops', name: 'Pawn drops', text: 'Both sides: instead of moving, add a pawn on any empty square (ranks 2 to 7).', icon: Plus },
];
const variantInfo = (v: FriendVariant) => VARIANTS.find((x) => x.id === v) ?? VARIANTS[0];

interface GameState {
  variant: FriendVariant;
  /** standard games: the moves (UCI) */
  ucis: string[];
  /** variant games: every ply with the position after it */
  plies: VPly[];
  hostColor: Side;
  hostName: string;
  guestName: string;
  result: string | null;
  /** how it ended, in words ("White resigned", "Checkmate"...) */
  reason: string;
  gameId: string;
  /** Secret Drawbacks: mine, and theirs once revealed at the end */
  myDrawback?: string;
  theirDrawback?: string;
}

const other = (s: Side): Side => (s === 'w' ? 'b' : 'w');
const sideName = (s: Side) => (s === 'w' ? 'White' : 'Black');
const NAME_KEY = 'chesslens:friend-name';
const winFor = (s: Side) => (s === 'w' ? '1-0' : '0-1');

function replay(ucis: string[]): Chess {
  const c = new Chess();
  for (const u of ucis) { try { c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { break; } }
  return c;
}

/** Result of a normal-chess position, when the rules end the game. */
function boardResult(c: Chess): { result: string; reason: string } | null {
  if (c.isCheckmate()) return { result: c.turn() === 'w' ? '0-1' : '1-0', reason: 'Checkmate' };
  if (c.isStalemate()) return { result: '1/2-1/2', reason: 'Stalemate' };
  if (c.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'Draw by repetition' };
  if (c.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'Draw: not enough material' };
  if (c.isDraw()) return { result: '1/2-1/2', reason: 'Draw by the 50-move rule' };
  return null;
}
/** Same for a power-up game (a position as FEN; no move history, so no repetition rule). */
function fenResult(fen: string): { result: string; reason: string } | null {
  try {
    const c = new Chess(fen);
    if (c.isCheckmate()) return { result: c.turn() === 'w' ? '0-1' : '1-0', reason: 'Checkmate' };
    if (c.isStalemate()) return { result: '1/2-1/2', reason: 'Stalemate' };
    if (c.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'Draw: not enough material' };
  } catch { /* ignore */ }
  return null;
}

const startPos = (v: FriendVariant) => (v === 'drawbacks' ? JSON.stringify(dbInitial()) : START_FEN);
const isPower = (v: FriendVariant) => v === 'sniper' || v === 'catapult' || v === 'drops';

/** Play a friend on another device: same Wi-Fi or anywhere, joined with a short code. Standard chess or a variant. */
export function FriendPlay({ onAnalyze }: { onAnalyze?: (g: PlayedGame) => void }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) || getUsername() || ''; } catch { return ''; } });
  const [pick, setPick] = useState<Side | 'random'>('random');
  const [variant, setVariant] = useState<FriendVariant>('standard');
  const [joinCode, setJoinCode] = useState('');
  const [link, setLink] = useState<FriendLink | null>(null);
  const [state, setState] = useState<LinkState | null>(null);
  const [detail, setDetail] = useState('');
  const [game, setGame] = useState<GameState | null>(null);
  const [draw, setDraw] = useState<'sent' | 'received' | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [aim, setAim] = useState<null | 'power'>(null);
  const [picked, setPicked] = useState<Square | null>(null);
  const [copied, setCopied] = useState(false);
  const gameRef = useRef<GameState | null>(null);
  gameRef.current = game;
  const linkRef = useRef<FriendLink | null>(null);
  linkRef.current = link;
  /** host only: both players' drawbacks (the guest never receives the host's until the end) */
  const dealt = useRef<{ host: string; guest: string } | null>(null);
  const lastGameId = useRef<string | null>(null);
  const myName = name.trim() || 'Player';
  useEffect(() => { try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ } }, [name]);
  useEffect(() => () => { linkRef.current?.close(); }, []);

  const role = link?.role ?? null;
  const myColor: Side | null = game && role ? (role === 'host' ? game.hostColor : other(game.hostColor)) : null;

  const syncMsg = (g: GameState): Msg => ({
    t: 'sync', ucis: g.ucis, hostColor: g.hostColor, hostName: g.hostName, result: g.result ? `${g.result}|${g.reason}` : null, gameId: g.gameId,
    variant: g.variant, plies: g.plies, yourDrawback: g.variant === 'drawbacks' ? dealt.current?.guest : undefined,
  });

  /** Game over: in Secret Drawbacks, show each other's drawback. */
  const reveal = (g: GameState) => { if (g.variant === 'drawbacks' && g.myDrawback) linkRef.current?.send({ t: 'reveal', drawback: g.myDrawback }); };

  function finish(g: GameState, result: string, reason: string, tell = false): GameState {
    // the host dealt both drawbacks, so it can show the friend's at once
    const done = { ...g, result, reason, ...(g.variant === 'drawbacks' && dealt.current && !g.theirDrawback ? { theirDrawback: dealt.current.guest } : {}) };
    if (tell) linkRef.current?.send({ t: 'result', result, reason });
    reveal(done);
    return done;
  }

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
        setGame((prev) => ({
          variant: m.variant ?? 'standard', ucis: m.ucis, plies: m.plies ?? [], hostColor: m.hostColor, hostName: m.hostName, guestName: myName,
          result, reason: reason ?? '', gameId: m.gameId,
          myDrawback: m.yourDrawback ?? (prev && !isNewGame ? prev.myDrawback : undefined),
          theirDrawback: prev && !isNewGame ? prev.theirDrawback : undefined,
        }));
        if (isNewGame) { setDraw(null); setAim(null); setPicked(null); }
        return;
      }
      case 'move': {
        if (!g || g.result || g.variant !== 'standard') return;
        if (m.ply !== g.ucis.length) { if (isHost) linkRef.current?.send(syncMsg(g)); else linkRef.current?.send({ t: 'hello', name: myName }); return; }
        const c = replay(g.ucis);
        try { c.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] }); } catch { if (isHost) linkRef.current?.send(syncMsg(g)); return; }
        const end = boardResult(c);
        setDraw(null);
        setGame({ ...g, ucis: [...g.ucis, m.uci], result: end?.result ?? null, reason: end?.reason ?? '' });
        return;
      }
      case 'vply': {
        if (!g || g.result || g.variant === 'standard') return;
        if (m.n !== g.plies.length) { if (isHost) linkRef.current?.send(syncMsg(g)); else linkRef.current?.send({ t: 'hello', name: myName }); return; }
        setDraw(null);
        let next: GameState = { ...g, plies: [...g.plies, m.ply] };
        if (g.variant === 'drawbacks') {
          const s = JSON.parse(m.ply.pos) as DbState;
          const mine = isHost ? g.hostColor : other(g.hostColor);
          const myDb = g.myDrawback ? drawbackById(g.myDrawback) : null;
          if (!s.board.some((p) => p && p.t === 'k' && p.c === mine)) next = finish(next, winFor(other(mine)), `${sideName(other(mine))} captured the king`);
          else if (s.turn === mine && myDb && dbLegal(s, myDb).length === 0) {
            // only this device knows its drawback: it announces that it is stuck
            next = finish(next, winFor(other(mine)), `${sideName(mine)} had no legal move left`, true);
          } else {
            const e = dbEnding(s, null, null);
            if (e && (e.kind === 'fifty' || e.kind === 'repetition')) next = finish(next, '1/2-1/2', e.kind === 'fifty' ? 'Draw: 50 quiet moves' : 'Draw by repetition');
          }
        } else {
          const end = fenResult(m.ply.pos);
          if (end) next = finish(next, end.result, end.reason);
        }
        setGame(next);
        return;
      }
      case 'result': {
        if (!g || g.result) return;
        setGame(finish(g, m.result, m.reason));
        return;
      }
      case 'reveal': {
        // merged into the latest state: it can arrive right after the move / resignation that ended the game
        setGame((prev) => (prev ? { ...prev, theirDrawback: m.drawback } : prev));
        return;
      }
      case 'resign': {
        if (!g || g.result) return;
        const loser = isHost ? other(g.hostColor) : g.hostColor;
        setGame(finish(g, winFor(other(loser)), `${sideName(loser)} resigned`));
        return;
      }
      case 'draw-offer': setDraw('received'); return;
      case 'draw-decline': setDraw(null); return;
      case 'draw-accept': {
        if (!g || g.result) return;
        setDraw(null);
        setGame(finish(g, '1/2-1/2', 'Draw agreed'));
        return;
      }
      case 'rematch': {
        if (!isHost || !g) return;
        startRematch(g);
        return;
      }
    }
  }

  /** Host: a new game (or a rematch) of `v`, dealing fresh drawbacks when needed. */
  function newGame(v: FriendVariant, hostColor: Side, base: Partial<GameState> = {}): GameState {
    let myDrawback: string | undefined;
    if (v === 'drawbacks') {
      const a = dealDrawback(2);
      const b = dealDrawback(2, [a.id]);
      dealt.current = { host: a.id, guest: b.id };
      myDrawback = a.id;
    } else dealt.current = null;
    return {
      variant: v, ucis: [], plies: [], hostColor, hostName: myName, guestName: '', result: null, reason: '', gameId: newCode(6),
      ...base, myDrawback, theirDrawback: undefined,
    };
  }
  function startRematch(g: GameState) {
    const next = newGame(g.variant, other(g.hostColor), { guestName: g.guestName, hostName: g.hostName });
    setGame(next);
    setDraw(null); setAim(null); setPicked(null);
    linkRef.current?.send(syncMsg(next));
  }

  async function create() {
    const code = newCode();
    const hostColor: Side = pick === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : pick;
    setGame(newGame(variant, hostColor));
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
    setLink(null); setState(null); setGame(null); setDraw(null); setDetail(''); setAim(null); setPicked(null);
  }

  // ---- the position
  const v = game?.variant ?? 'standard';
  const pos = game ? (game.variant === 'standard' ? '' : game.plies.length ? game.plies[game.plies.length - 1].pos : startPos(game.variant)) : '';
  const chess = useMemo(() => (v === 'standard' ? replay(game?.ucis ?? []) : isPower(v) ? new Chess(pos || START_FEN) : new Chess()), [v, game?.ucis, pos]);
  const dbState = useMemo<DbState | null>(() => (v === 'drawbacks' && pos ? (JSON.parse(pos) as DbState) : null), [v, pos]);
  const myDb = game?.myDrawback ? drawbackById(game.myDrawback) : null;
  const turn: Side = dbState ? dbState.turn : (chess.turn() as Side);
  const connected = state === 'connected';
  const myTurn = !!game && !game.result && connected && myColor === turn;

  const dbMoves = useMemo<DbMove[]>(() => (dbState && myTurn && myDb ? dbLegal(dbState, myDb) : []), [dbState, myTurn, myDb]);
  const dests = useMemo(() => {
    const map = new Map<Key, Key[]>();
    if (!myTurn || aim) return map;
    const add = (f: string, t: string) => { const arr = map.get(f as Key) ?? []; if (!arr.includes(t as Key)) arr.push(t as Key); map.set(f as Key, arr); };
    if (dbState) for (const m of dbMoves) add(dbSq(m.from), dbSq(m.to));
    else for (const m of chess.moves({ verbose: true })) add(m.from, m.to);
    return map;
  }, [chess, dbState, dbMoves, myTurn, aim]);

  // ---- my actions
  function sendPly(g: GameState, ply: VPly, end: { result: string; reason: string } | null) {
    linkRef.current?.send({ t: 'vply', ply, n: g.plies.length });
    setDraw(null); setAim(null); setPicked(null);
    let next: GameState = { ...g, plies: [...g.plies, ply] };
    if (end) next = finish(next, end.result, end.reason);
    setGame(next);
  }

  function play(from: string, to: string, promotion?: string) {
    if (!game || !link || !myColor) return;
    if (game.variant === 'standard') {
      const c = replay(game.ucis);
      try { c.move({ from: from as Square, to: to as Square, promotion }); } catch { return; }
      const uci = from + to + (promotion ?? '');
      const end = boardResult(c);
      link.send({ t: 'move', uci, ply: game.ucis.length });
      setDraw(null);
      setGame({ ...game, ucis: [...game.ucis, uci], result: end?.result ?? null, reason: end?.reason ?? '' });
      return;
    }
    if (game.variant === 'drawbacks' && dbState) {
      const m = dbMoves.find((x) => dbSq(x.from) === from && dbSq(x.to) === to && (x.promo ?? '') === (promotion ?? (x.promo ? 'q' : '')));
      if (!m) return;
      const nextState = dbPlay(dbState, m);
      const e = dbEnding(nextState, m, null);
      const end = e?.kind === 'king' ? { result: winFor(myColor), reason: `${sideName(myColor)} captured the king` }
        : e?.kind === 'fifty' ? { result: '1/2-1/2', reason: 'Draw: 50 quiet moves' }
        : e?.kind === 'repetition' ? { result: '1/2-1/2', reason: 'Draw by repetition' } : null;
      sendPly(game, { label: dbNotation(dbState, m), last: [from, to], pos: JSON.stringify(nextState) }, end);
      return;
    }
    // power-up variants: a normal move
    const c = new Chess(pos);
    let mv;
    try { mv = c.move({ from: from as Square, to: to as Square, promotion }); } catch { return; }
    sendPly(game, { label: mv.san, last: [from, to], pos: c.fen() }, fenResult(c.fen()));
  }
  function onMove(from: Key, to: Key) {
    if (dbState) {
      const opts = dbMoves.filter((x) => dbSq(x.from) === from && dbSq(x.to) === to);
      if (opts.length > 1 && opts.some((x) => x.promo)) { setPromo({ from, to }); return; }
      play(from, to, opts[0]?.promo);
      return;
    }
    const p = chess.get(from as Square);
    if (p?.type === 'p' && (to[1] === '8' || to[1] === '1')) { setPromo({ from, to }); return; }
    play(from, to);
  }

  // ---- power-ups (both sides)
  const powerTargets = useMemo<Square[]>(() => {
    if (!myTurn || aim !== 'power' || !myColor || !isPower(v)) return [];
    if (v === 'drops') return dropSquares(pos, myColor);
    if (!picked) return [];
    return v === 'sniper' ? sniperTargets(pos, picked, myColor) : launchTargets(pos, picked, myColor);
  }, [myTurn, aim, myColor, v, pos, picked]);
  const shooters = useMemo<Square[]>(() => {
    if (!myTurn || aim !== 'power' || !myColor || (v !== 'sniper' && v !== 'catapult')) return [];
    const out: Square[] = [];
    for (const row of chess.board()) for (const p of row) {
      if (!p || p.color !== myColor) continue;
      if (v === 'sniper' && p.type === 'b' && sniperTargets(pos, p.square, myColor).length) out.push(p.square);
      if (v === 'catapult' && p.type === 'p' && launchTargets(pos, p.square, myColor).length) out.push(p.square);
    }
    return out;
  }, [myTurn, aim, myColor, v, chess, pos]);
  const marks = useMemo(() => {
    const m = new Map<Key, string>();
    for (const s of shooters) m.set(s as Key, 'vb-pick');
    const cls = v === 'sniper' ? 'vb-target' : v === 'catapult' ? 'vb-land' : 'vb-drop';
    for (const t of powerTargets) if (!m.has(t as Key)) m.set(t as Key, cls);
    return m;
  }, [shooters, powerTargets, v]);
  function onSelect(k: Key) {
    if (!game || !myColor || aim !== 'power' || !myTurn) return;
    const s = k as Square;
    let r: PowerResult | null = null;
    if (v === 'drops') r = drop(pos, s, myColor);
    else if (shooters.includes(s)) { setPicked(s); return; }
    else if (picked && powerTargets.includes(s)) r = v === 'sniper' ? shoot(pos, picked, s, myColor) : launch(pos, picked, s, myColor);
    if (r) sendPly(game, { label: r.label, last: r.from ? [r.from, r.to] : [r.to, r.to], pos: r.fen }, fenResult(r.fen));
  }

  function resign() {
    if (!game || !myColor || game.result || !window.confirm('Resign this game?')) return;
    link?.send({ t: 'resign' });
    setGame(finish(game, winFor(other(myColor)), `${sideName(myColor)} resigned`));
  }
  function offerDraw() { link?.send({ t: 'draw-offer' }); setDraw('sent'); }
  function acceptDraw() { if (!game) return; link?.send({ t: 'draw-accept' }); setDraw(null); setGame(finish(game, '1/2-1/2', 'Draw agreed')); }
  function declineDraw() { link?.send({ t: 'draw-decline' }); setDraw(null); }
  function rematch() { if (!game) return; if (role === 'host') startRematch(game); else link?.send({ t: 'rematch' }); }

  function analyze() {
    if (!game || !onAnalyze || game.variant !== 'standard') return;
    const c = replay(game.ucis);
    const white = game.hostColor === 'w' ? game.hostName : game.guestName || 'Friend';
    const black = game.hostColor === 'b' ? game.hostName : game.guestName || 'Friend';
    c.header('Event', 'Friendly game', 'Site', 'ChessLens', 'White', white, 'Black', black, 'Result', game.result ?? '*', 'Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'));
    onAnalyze({ pgn: c.pgn(), white, black, result: game.result ?? '*' });
  }

  async function share() {
    if (!link) return;
    const vName = game ? variantInfo(game.variant).name : 'chess';
    const text = `Play ${vName} with me on ChessLens: open Play → Friend → Join and type ${link.code}`;
    try { if (navigator.share) { await navigator.share({ title: 'ChessLens game', text }); return; } } catch { /* cancelled */ }
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
              <p className="mb-1 text-xs text-ink-400">Game</p>
              <div className="grid grid-cols-2 gap-1.5">
                {VARIANTS.map((x) => (
                  <button key={x.id} onClick={() => setVariant(x.id)} aria-pressed={variant === x.id} title={x.text}
                    className={`flex items-center gap-1.5 rounded-lg px-2 py-2 text-left text-xs font-semibold ${variant === x.id ? 'bg-brand-500 text-ink-950' : 'bg-ink-900/50 text-ink-300'}`}>
                    <x.icon size={13} className="shrink-0" /> <span className="truncate">{x.name}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-ink-400">{variantInfo(variant).text}</p>
            </div>
            <div>
              <p className="mb-1 text-xs text-ink-400">You play</p>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-ink-900/50 p-0.5">
                {([['w', 'White'], ['random', 'Random'], ['b', 'Black']] as const).map(([val, l]) => (
                  <button key={val} onClick={() => setPick(val)} aria-pressed={pick === val}
                    className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold ${pick === val ? 'bg-ink-600 text-white' : 'text-ink-400'}`}>
                    {val === 'random' && <Shuffle size={12} />} {l}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={create} className="btn-primary w-full"><Plus size={16} /> Create room</button>
          </div>
          <div className="card space-y-3 p-4">
            <p className="font-semibold">Join a room</p>
            <p className="text-[11px] text-ink-400">The game (standard or a variant) is chosen by whoever creates the room.</p>
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
  const themName = role === 'host' ? game?.guestName || 'Your friend' : game?.hostName || 'Your friend';
  const lastMove: [Key, Key] | null = (() => {
    if (!game) return null;
    if (game.variant === 'standard') { const u = game.ucis[game.ucis.length - 1]; return u ? [u.slice(0, 2) as Key, u.slice(2, 4) as Key] : null; }
    const l = game.plies[game.plies.length - 1]?.last;
    return l ? [l[0] as Key, l[1] as Key] : null;
  })();
  const labels = game ? (game.variant === 'standard' ? chess.history() : game.plies.map((p) => p.label)) : [];
  const won = game?.result && myColor ? game.result !== '1/2-1/2' && (game.result === '1-0') === (myColor === 'w') : false;
  const boardFen = dbState ? dbPlacement(dbState.board) : chess.fen();
  const info = game ? variantInfo(game.variant) : null;
  const inCheck = v !== 'drawbacks' && chess.inCheck();
  const powerHint = aim !== 'power' ? '' : v === 'drops' ? 'Tap a green dot to add a pawn (uses your turn).'
    : picked ? (v === 'sniper' ? 'Tap a red target to shoot it.' : 'Tap a yellow dot to launch the pawn there.')
    : v === 'sniper' ? 'Tap one of your bishops (yellow).' : 'Tap one of your pawns (yellow).';

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,560px)_1fr]">
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span className="font-semibold text-ink-100">{themName}</span>
          {myColor && <span className="text-xs text-ink-400">({sideName(other(myColor))})</span>}
          {info && info.id !== 'standard' && <span className="ml-auto flex items-center gap-1 rounded-full bg-ink-800 px-2 py-0.5 text-[11px] font-semibold text-brand-300"><info.icon size={12} /> {info.name}</span>}
        </div>
        <div className="neon-board relative overflow-hidden rounded-lg">
          <VariantBoard
            fen={boardFen} orientation={myColor === 'b' ? 'black' : 'white'} turn={turn}
            movable={myTurn && !aim ? turn : null} dests={dests} lastMove={lastMove} marks={marks} onMove={onMove} onSelect={onSelect}
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
              <p className="text-sm text-ink-300">Room code{info && info.id !== 'standard' ? ` · ${info.name}` : ''}</p>
              <p className="font-mono text-5xl font-extrabold tracking-[0.3em] text-brand-300">{link.code}</p>
              <p className="flex items-center gap-2 text-xs text-ink-400"><Loader2 size={13} className="animate-spin" /> Waiting for your friend to join…</p>
              <button onClick={share} className="btn-secondary text-sm">{copied ? <><Copy size={14} /> Copied</> : <><Share2 size={14} /> Share code</>}</button>
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="font-semibold text-ink-100">{myName}</span>
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
          <p className="text-lg font-bold">{myTurn ? 'Your move' : `${themName} is thinking…`}{inCheck && myTurn ? ' (check!)' : ''}</p>
        )}

        {/* Secret Drawbacks: your own handicap; theirs is shown at the end */}
        {game?.variant === 'drawbacks' && myDb && (
          <div className="rounded-xl border border-ink-700 bg-ink-800/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Your drawback</p>
            <p className="mt-0.5 font-semibold text-ink-100">{myDb.name}</p>
            <p className="text-sm text-ink-300">{myDb.text}</p>
            {!game.result && <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-400"><EyeOff size={13} /> {themName}'s drawback is hidden until the game ends. No check: take the king to win.</p>}
          </div>
        )}

        {/* Power-ups: the same power for both sides */}
        {game && isPower(game.variant) && !game.result && (
          <div className="rounded-xl border border-ink-700 bg-ink-800/70 p-3">
            <p className="text-sm text-ink-300">{info?.text}</p>
            <button
              onClick={() => { setAim(aim ? null : 'power'); setPicked(null); }}
              disabled={!myTurn}
              className={`mt-2 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40 ${aim ? 'bg-brand-500 text-ink-900' : 'bg-ink-700/70 text-ink-100'}`}
            >
              {info && <info.icon size={14} />} {aim ? 'Cancel' : v === 'sniper' ? 'Aim a bishop' : v === 'catapult' ? 'Launch a pawn' : 'Add a pawn instead'}
            </button>
            {powerHint && <p className="mt-2 text-xs text-brand-200">{powerHint}</p>}
          </div>
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
            {game.variant === 'drawbacks' && game.theirDrawback && (
              <p className="mt-2 text-sm text-ink-200">{themName}'s drawback was <b>{drawbackById(game.theirDrawback).name}</b>: {drawbackById(game.theirDrawback).text}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={rematch} disabled={!connected} className="btn-primary text-sm"><RotateCcw size={14} /> Rematch (swap colours)</button>
              {onAnalyze && game.variant === 'standard' && game.ucis.length > 0 && <button onClick={analyze} className="btn-secondary text-sm"><BarChart3 size={14} /> Analyze this game</button>}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-ink-700 bg-ink-800/70 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Moves</p>
          {labels.length === 0 ? <p className="text-sm text-ink-500">No moves yet.</p> : (
            <ol className="grid max-h-48 grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 overflow-y-auto font-mono text-sm">
              {Array.from({ length: Math.ceil(labels.length / 2) }, (_, i) => (
                <li key={i} className="contents">
                  <span className="text-ink-500">{i + 1}.</span>
                  <span className="truncate text-ink-100">{labels[i * 2]}</span>
                  <span className="truncate text-ink-100">{labels[i * 2 + 1] ?? ''}</span>
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
