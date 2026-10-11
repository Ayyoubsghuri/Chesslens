import { useEffect, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { ChessBoard } from './ChessBoard';
import { GameEndBoard } from './GameEndBoard';
import { FeedbackBanner } from './PracticeBits';
import { analyzePosition } from '@/lib/engine';
import {
  ACCEPTABLE, QUALITY_LABEL, applyUci, gameOverText, judgeMove, pickComputerMove, sleep,
} from '@/lib/practice';
import type { EngineEval, MoveQuality, Settings } from '@/lib/types';
import { Loader2, Lightbulb, Eye, RotateCcw, Undo2, Swords, Maximize2, X, BarChart3 } from 'lucide-react';

export interface PlayedGame {
  pgn: string;
  white: string;
  black: string;
  result: string;
}

const START = new Chess().fen();
const PRESETS = [
  { label: 'Beginner', elo: 600 }, { label: 'Casual', elo: 1000 }, { label: 'Club', elo: 1400 },
  { label: 'Strong', elo: 1800 }, { label: 'Expert', elo: 2200 }, { label: 'Master', elo: 2600 },
];

const FAST_DEPTH = 10;

type Turn = 'player' | 'thinking' | 'judging' | 'over';
interface Entry { san: string; color: 'w' | 'b'; quality?: MoveQuality; fenAfter: string; from: Square; to: Square }

export function PlayVsComputer({ settings, onAnalyze }: { settings: Settings; onAnalyze?: (game: PlayedGame) => void }) {
  // The coach check, hints and prefetch don't need the full analysis depth. Capping it keeps the game snappy.
  const depth = Math.min(settings.analysisDepth, FAST_DEPTH);

  // setup
  const [elo, setElo] = useState(1200);
  const [colorChoice, setColorChoice] = useState<'white' | 'black' | 'random'>('white');
  const [retryBad, setRetryBad] = useState(true);
  const [started, setStarted] = useState(false);

  // game
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [fen, setFen] = useState(START);
  const [history, setHistory] = useState<Entry[]>([]);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [turn, setTurn] = useState<Turn>('player');
  const [feedback, setFeedback] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const [badge, setBadge] = useState<MoveQuality | null>(null);
  const [hintSquare, setHintSquare] = useState<Square | null>(null);
  const [arrow, setArrow] = useState<string | null>(null);
  const [hintSan, setHintSan] = useState<string | null>(null);

  // theater mode (full-window board)
  const [theater, setTheater] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));
  useEffect(() => {
    if (!theater) return;
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTheater(false); };
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [theater]);

  const token = useRef(0); // bumps on new game so stale async work is ignored
  const evalRef = useRef<Promise<EngineEval | null> | null>(null);

  function prefetch(f: string) {
    evalRef.current = analyzePosition(f, depth).catch(() => null);
  }

  function finish(f: string): boolean {
    const text = gameOverText(f);
    if (!text) return false;
    setTurn('over');
    setFeedback({ tone: 'info', text });
    return true;
  }

  function beginPlayerTurn(f: string) {
    if (finish(f)) return;
    setTurn('player');
    prefetch(f);
  }

  async function computerTurn(
    f: string,
    my: number,
    pColor: 'w' | 'b',
    pre?: Promise<Awaited<ReturnType<typeof pickComputerMove>>>,
  ) {
    setTurn('thinking');
    const [move] = await Promise.all([pre ?? pickComputerMove(f, elo), sleep(250)]);
    if (my !== token.current) return;
    if (!move) { finish(f); return; }
    setFen(move.fen);
    setLastMove({ from: move.from, to: move.to });
    setBadge(null);
    setHistory((h) => [...h, { san: move.san, color: pColor === 'w' ? 'b' : 'w', fenAfter: move.fen, from: move.from, to: move.to }]);
    beginPlayerTurn(move.fen);
  }

  function startGame() {
    const my = ++token.current;
    const pc: 'w' | 'b' = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice === 'white' ? 'w' : 'b';
    setPlayerColor(pc);
    setOrientation(pc === 'w' ? 'white' : 'black');
    setFen(START);
    setHistory([]);
    setLastMove(null);
    setBadge(null);
    setFeedback(null);
    setHintSquare(null);
    setArrow(null);
    setHintSan(null);
    setStarted(true);
    if (pc === 'w') beginPlayerTurn(START);
    else computerTurn(START, my, pc);
  }

  async function handleUserMove(m: { from: Square; to: Square; promotion?: string; san: string; fen: string }) {
    if (turn !== 'player') return;
    const my = token.current;
    const before = fen;
    const prevLast = lastMove;
    const uci = m.from + m.to + (m.promotion ?? '');

    setFen(m.fen);
    setLastMove({ from: m.from, to: m.to });
    setHintSquare(null);
    setArrow(null);
    setHintSan(null);

    // Start the computer's reply while the coach is still checking the move (separate engine worker).
    // If the move turns out to be bad it gets taken back and this result is simply dropped.
    const pre = retryBad ? pickComputerMove(m.fen, elo).catch(() => null) : undefined;

    const accept = (q: MoveQuality | null) => {
      setBadge(q);
      setHistory((h) => [...h, { san: m.san, color: playerColor, fenAfter: m.fen, from: m.from, to: m.to }]);
      if (q) {
        setHistory((h) => h.map((e, i) => (i === h.length - 1 ? { ...e, quality: q } : e)));
        setFeedback({ tone: 'good', text: QUALITY_LABEL[q] ?? q });
      } else setFeedback(null);
      if (finish(m.fen)) return;
      computerTurn(m.fen, my, playerColor, pre);
    };

    if (!retryBad) { accept(null); return; }

    // Forced move: nothing to judge.
    try {
      if (new Chess(before).moves().length === 1) { accept('best'); return; }
    } catch { /* fall through to the normal check */ }

    // The position was already analysed while the player was thinking. If they played the engine's
    // best move there is nothing left to check, so skip the second search entirely.
    const prefetched = evalRef.current ? await Promise.race([evalRef.current, sleep(0).then(() => undefined)]) : null;
    if (prefetched && prefetched.bestMove === uci) { accept('best'); return; }

    setTurn('judging');
    try {
      const known = evalRef.current ? await evalRef.current : null;
      if (my !== token.current) return;
      if (known && known.bestMove === uci) { accept('best'); return; }
      const j = await judgeMove(before, uci, depth, known);
      if (my !== token.current) return;
      if (ACCEPTABLE.includes(j.quality)) { accept(j.quality); return; }

      // Wrong move: show it briefly, then put it back so the player can retry.
      setBadge(j.quality);
      setFeedback({ tone: 'bad', text: `${QUALITY_LABEL[j.quality]} — try again` });
      await sleep(800);
      if (my !== token.current) return;
      setBadge(null);
      setFen(before);
      setLastMove(prevLast);
      setTurn('player');
    } catch {
      if (my !== token.current) return;
      accept(null); // engine hiccup: never punish the player for it
    }
  }

  // Take back: undo back to just before the player's last move (also removes the computer's reply)
  const lastPlayerIdx = history.map((e) => e.color).lastIndexOf(playerColor);
  const canTakeBack = lastPlayerIdx >= 0 && (turn === 'player' || turn === 'thinking' || turn === 'over');

  function handleTakeBack() {
    if (!canTakeBack) return;
    token.current++; // drop any in-flight computer move
    const kept = history.slice(0, lastPlayerIdx);
    const prev = kept.length > 0 ? kept[kept.length - 1] : null;
    const f = prev ? prev.fenAfter : START;
    setHistory(kept);
    setFen(f);
    setLastMove(prev ? { from: prev.from, to: prev.to } : null);
    setBadge(null);
    setFeedback(null);
    setHintSquare(null);
    setArrow(null);
    setHintSan(null);
    setTurn('player');
    prefetch(f);
  }

  async function bestMoveUci(): Promise<string | null> {
    const ev = evalRef.current ? await evalRef.current : await analyzePosition(fen, depth).catch(() => null);
    return ev?.bestMove ?? null;
  }

  async function handleHint() {
    const uci = await bestMoveUci();
    if (uci) setHintSquare(uci.slice(0, 2) as Square);
  }

  async function handleShowBest() {
    const uci = await bestMoveUci();
    if (!uci) return;
    setArrow(uci);
    setHintSquare(null);
    setHintSan(applyUci(fen, uci)?.san ?? null);
  }

  if (!started) {
    return (
      <div className="card p-5 max-w-xl mx-auto space-y-5">
        <div className="flex items-center gap-2">
          <Swords size={18} className="text-brand-400" />
          <h3 className="font-semibold text-ink-100">Play vs Computer</h3>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label className="text-sm text-ink-300">Computer strength</label>
            <span className="font-mono text-brand-300 text-lg">{elo}</span>
          </div>
          <input type="range" min={400} max={2800} step={100} value={elo}
            onChange={(e) => setElo(Number(e.target.value))} className="w-full accent-brand-500" />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {PRESETS.map((p) => (
              <button key={p.elo} onClick={() => setElo(p.elo)}
                className={`chip ${elo === p.elo ? 'bg-brand-500/20 text-brand-300' : 'bg-ink-700 text-ink-300'}`}>
                {p.label} · {p.elo}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm text-ink-300 block mb-1.5">You play</label>
          <div className="flex gap-2">
            {(['white', 'black', 'random'] as const).map((c) => (
              <button key={c} onClick={() => setColorChoice(c)}
                className={`${colorChoice === c ? 'btn-primary' : 'btn-secondary'} text-sm capitalize`}>{c}</button>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-ink-300 cursor-pointer">
          <input type="checkbox" checked={retryBad} onChange={(e) => setRetryBad(e.target.checked)} className="mt-1 accent-brand-500" />
          <span>
            Coach mode — the game only moves on when your move is Best, Great, Excellent or Good.
            Inaccuracies, mistakes and blunders are taken back so you can try again.
          </span>
        </label>

        <button onClick={startGame} className="btn-primary w-full justify-center">Start game</button>
      </div>
    );
  }

  const pairs: { n: number; w?: Entry; b?: Entry }[] = [];
  history.forEach((e, i) => {
    const n = Math.floor(i / 2);
    // history may start with black if the player is Black? No: white always moves first.
    if (!pairs[n]) pairs[n] = { n: n + 1 };
    if (e.color === 'w') pairs[n].w = e; else pairs[n].b = e;
  });

  function buildPlayedGame(): PlayedGame {
    const chess = new Chess();
    for (const e of history) { try { chess.move(e.san); } catch { break; } }
    let result = '*';
    if (chess.isCheckmate()) result = chess.turn() === 'w' ? '0-1' : '1-0';
    else if (chess.isDraw() || chess.isStalemate()) result = '1/2-1/2';
    const cpu = `Computer (${elo})`;
    const white = playerColor === 'w' ? 'You' : cpu;
    const black = playerColor === 'b' ? 'You' : cpu;
    const d = new Date();
    chess.header(
      'Event', 'Casual game vs computer',
      'Date', `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`,
      'White', white, 'Black', black, 'Result', result,
    );
    return { pgn: chess.pgn(), white, black, result };
  }

  const renderBoard = (px: number) => (
    <GameEndBoard
      fen={fen}
      orientation={orientation}
      size={px}
      end={null}
      atFinalPosition={turn === 'over'}
      whiteName={playerColor === 'w' ? 'You' : 'Computer'}
      blackName={playerColor === 'b' ? 'You' : 'Computer'}
    >
      {(boardFen, effectPlaying) => (
        <ChessBoard
          fen={boardFen}
          orientation={orientation}
          lastMove={lastMove}
          highlightSquare={hintSquare}
          bestMoveUci={arrow}
          moveQuality={badge}
          interactive={turn === 'player' && !effectPlaying}
          onUserMove={handleUserMove}
          size={px}
          edgeToEdge
        />
      )}
    </GameEndBoard>
  );

  const thinkingLabel = (
    <>
      {turn === 'thinking' && <span className="flex items-center gap-1.5 text-ink-400 text-xs"><Loader2 size={12} className="animate-spin" /> thinking…</span>}
      {turn === 'judging' && <span className="flex items-center gap-1.5 text-ink-400 text-xs"><Loader2 size={12} className="animate-spin" /> checking your move…</span>}
    </>
  );

  const banners = (
    <>
      {feedback && <FeedbackBanner tone={feedback.tone}>{feedback.text}</FeedbackBanner>}
      {hintSan && <FeedbackBanner tone="info">Best move: <span className="font-mono font-semibold">{hintSan}</span></FeedbackBanner>}
      {turn === 'over' && onAnalyze && (
        <button onClick={() => onAnalyze(buildPlayedGame())} className="btn-primary w-full justify-center py-3 font-bold">
          <BarChart3 size={16} /> Analyze game
        </button>
      )}
    </>
  );

  const controls = (
    <div className="flex flex-wrap gap-2">
      <button onClick={handleHint} disabled={turn !== 'player'} className="btn-secondary text-sm"><Lightbulb size={14} /> Hint</button>
      <button onClick={handleShowBest} disabled={turn !== 'player'} className="btn-secondary text-sm"><Eye size={14} /> Show best move</button>
      <button onClick={handleTakeBack} disabled={!canTakeBack} className="btn-secondary text-sm disabled:opacity-40"><Undo2 size={14} /> Take back</button>
      <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} className="btn-ghost text-sm"><RotateCcw size={14} /> Flip</button>
      <button onClick={() => { token.current++; setTheater(false); setStarted(false); }} className="btn-ghost text-sm ml-auto">New game</button>
    </div>
  );

  const movesList = pairs.length === 0 ? (
    <p className="text-sm text-ink-500">No moves yet.</p>
  ) : (
    <div className="grid grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-1 text-sm font-mono">
      {pairs.map((p) => (
        <div key={p.n} className="contents">
          <span className="text-ink-500">{p.n}.</span>
          <span className="text-ink-100">{p.w?.san}{p.w?.quality && <Q q={p.w.quality} />}</span>
          <span className="text-ink-100">{p.b?.san}{p.b?.quality && <Q q={p.b.quality} />}</span>
        </div>
      ))}
    </div>
  );

  // Theater mode: board fills the window, panel beside (desktop) or below (mobile)
  if (theater) {
    const isWide = viewport.w >= 1024;
    const PANEL_W = 360;
    const boardPx = Math.max(
      260,
      Math.floor(isWide ? Math.min(viewport.h - 32, viewport.w - PANEL_W - 24 - 32) : viewport.w),
    );
    return (
      <div className="fixed inset-0 z-50 bg-ink-900 overflow-y-auto">
        <div className={isWide ? 'min-h-full flex items-center justify-center gap-6 p-4' : 'flex flex-col items-center gap-3 pb-6'}>
          <div className="shrink-0" style={{ width: boardPx }}>
            <div className="flex items-center justify-between text-sm text-ink-200 px-3 lg:px-0.5 pb-1.5">
              <span className="font-medium">Computer · {elo}</span>
              {thinkingLabel}
            </div>
            {renderBoard(boardPx)}
            <div className="text-sm font-medium text-ink-200 px-3 lg:px-0.5 pt-1.5">You · {playerColor === 'w' ? 'White' : 'Black'}</div>
          </div>
          <div
            className="flex flex-col gap-3 rounded-xl border border-ink-700/60 bg-ink-800/50 p-3 shrink-0 w-full max-w-[560px]"
            style={isWide ? { width: PANEL_W, height: boardPx } : undefined}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-200">Moves</h3>
              <button onClick={() => setTheater(false)} className="btn-ghost p-2" title="Exit theater mode (Esc)"><X size={18} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto max-h-[30vh] lg:max-h-none">{movesList}</div>
            {banners}
            {controls}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="flex items-center justify-between text-sm text-ink-200 px-0.5">
          <span className="font-medium">Computer · {elo}</span>
          {thinkingLabel}
        </div>
        {/* Mobile: edge to edge (cancels the page's px-4). Desktop: capped. */}
        <div className="-mx-4 w-[calc(100%+2rem)] sm:mx-auto sm:w-full sm:max-w-[560px]">
          {renderBoard(560)}
        </div>
        <div className="flex items-center justify-between px-0.5">
          <span className="text-sm font-medium text-ink-200">You · {playerColor === 'w' ? 'White' : 'Black'}</span>
          <button onClick={() => setTheater(true)} className="btn-secondary px-2.5 py-1.5" title="Theater mode — full-window board">
            <Maximize2 size={14} />
          </button>
        </div>
        {banners}
      </div>

      <div className="flex flex-col gap-4">
        <div className="card p-4">{controls}</div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-ink-200 mb-2">Moves</h3>
          {movesList}
        </div>
      </div>
    </div>
  );
}

function Q({ q }: { q: MoveQuality }) {
  const sym: Partial<Record<MoveQuality, string>> = { brilliant: '!!', great: '!', best: '★' };
  return sym[q] ? <span className="ml-1 text-brand-300">{sym[q]}</span> : null;
}