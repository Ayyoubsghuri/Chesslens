import { useEffect, useMemo, useRef, useState } from 'react';
import { type Square } from 'chess.js';
import { ChessBoard } from './ChessBoard';
import { ComparisonCard, FeedbackBanner, type Comparison } from './PracticeBits';
import {
  BEST_TIER, ERROR_QUALITIES, applyUci, judgeMove, moverPawns, sanCoords, sleep,
} from '@/lib/practice';
import type { AnalyzedMove, Settings } from '@/lib/types';
import { Loader2, Lightbulb, Eye, ChevronRight, RotateCcw, Crosshair } from 'lucide-react';

type Side = 'w' | 'b' | 'both';
type Phase = 'setup' | 'guess' | 'judging' | 'solved' | 'revealed' | 'advancing' | 'finished';

export function GuessGamePanel({ moves, settings }: { moves: AnalyzedMove[]; settings: Settings }) {
  const depth = settings.analysisDepth;
  const [side, setSide] = useState<Side>('w');
  const [onlyErrors, setOnlyErrors] = useState(false);

  const puzzles = useMemo(
    () =>
      moves
        .filter(
          (m) =>
            (side === 'both' || m.color === side) &&
            m.quality !== 'book' &&
            !!m.evalBefore?.bestMove &&
            (!onlyErrors || ERROR_QUALITIES.includes(m.quality)),
        )
        .map((m) => m.index),
    [moves, side, onlyErrors],
  );

  const [phase, setPhase] = useState<Phase>('setup');
  const [pos, setPos] = useState(0);
  const [fen, setFen] = useState('');
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [hint, setHint] = useState<0 | 1 | 2>(0);
  const [feedback, setFeedback] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [stats, setStats] = useState({ first: 0, retry: 0, revealed: 0 });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const cur = phase !== 'setup' && phase !== 'finished' ? moves[puzzles[pos]] : null;
  const bestUci = cur?.evalBefore?.bestMove ?? null;

  function prevCoords(m: AnalyzedMove) {
    const prev = moves[m.index - 1];
    return prev ? sanCoords(prev.fenBefore, prev.san) : null;
  }

  function loadPuzzle(p: number) {
    const m = moves[puzzles[p]];
    setPos(p);
    setFen(m.fenBefore);
    setLastMove(prevCoords(m));
    setAttempts(0);
    setHint(0);
    setFeedback(null);
    setComparison(null);
    setPhase('guess');
  }

  function start() {
    if (puzzles.length === 0) return;
    setStats({ first: 0, retry: 0, revealed: 0 });
    setOrientation(side === 'b' ? 'black' : 'white');
    loadPuzzle(0);
  }

  function buildComparison(m: AnalyzedMove, userUci: string | null, userEval: Comparison['userEval']): Comparison {
    const bestSan = applyUci(m.fenBefore, m.evalBefore!.bestMove!)?.san ?? m.evalBefore!.bestMove!;
    const userSan = userUci ? applyUci(m.fenBefore, userUci)?.san : undefined;
    const mine = userEval ? moverPawns(userEval, m.color) : null;
    const game = moverPawns(m.evalAfter, m.color);
    return {
      bestSan,
      bestEval: m.evalBefore,
      userSan,
      userEval,
      gameSan: m.san,
      gameQuality: m.quality,
      gameEval: m.evalAfter,
      gameLoss: m.evalLoss,
      gain: mine != null && game != null ? mine - game : null,
    };
  }

  async function handleUserMove(mv: { from: Square; to: Square; promotion?: string; san: string; fen: string }) {
    if (phase !== 'guess' || !cur) return;
    const before = cur.fenBefore;
    const prev = lastMove;
    const uci = mv.from + mv.to + (mv.promotion ?? '');
    setFen(mv.fen);
    setLastMove({ from: mv.from, to: mv.to });
    setHint(0);
    setPhase('judging');
    const tries = attempts + 1;
    setAttempts(tries);

    const bounce = async (tone: 'bad' | 'info', text: string) => {
      setFeedback({ tone, text });
      await sleep(1000);
      if (!alive.current) return;
      setFen(before);
      setLastMove(prev);
      setPhase('guess');
    };

    try {
      const j = await judgeMove(before, uci, depth, cur.evalBefore);
      if (!alive.current) return;
      if (uci === bestUci || BEST_TIER.includes(j.quality)) {
        setStats((s) => (tries === 1 ? { ...s, first: s.first + 1 } : { ...s, retry: s.retry + 1 }));
        setFeedback({ tone: 'good', text: uci === bestUci ? 'Yes! That is the best move.' : 'Excellent — that is just as strong as the engine\'s choice.' });
        setComparison(buildComparison(cur, uci, j.evalAfter));
        setPhase('solved');
      } else if (j.quality === 'excellent' || j.quality === 'good') {
        await bounce('info', 'Decent move, but there is a stronger one. Try again.');
      } else {
        await bounce('bad', 'Not the best move. Try again.');
      }
    } catch {
      if (!alive.current) return;
      await bounce('info', 'Could not check that move — try again.');
    }
  }

  function showSolution() {
    if (!cur || !bestUci) return;
    const r = applyUci(cur.fenBefore, bestUci);
    if (!r) return;
    setFen(r.fen);
    setLastMove({ from: r.from, to: r.to });
    setHint(0);
    setStats((s) => ({ ...s, revealed: s.revealed + 1 }));
    setFeedback({ tone: 'info', text: `The best move was ${r.san}.` });
    setComparison(buildComparison(cur, null, cur.evalBefore));
    setPhase('revealed');
  }

  /** Continue the real game: play the moves that were actually played, then jump to the next puzzle. */
  async function next() {
    if (!cur) return;
    setPhase('advancing');
    setFeedback(null);
    setComparison(null);
    const nextPos = pos + 1;
    const stop = nextPos < puzzles.length ? puzzles[nextPos] : moves.length;
    for (let k = cur.index; k < stop; k++) {
      const gm = moves[k];
      const c = sanCoords(gm.fenBefore, gm.san);
      setFen(gm.fenAfter);
      setLastMove(c);
      await sleep(650);
      if (!alive.current) return;
    }
    if (nextPos < puzzles.length) loadPuzzle(nextPos);
    else setPhase('finished');
  }

  /* ------------------------------ UI ------------------------------ */

  if (phase === 'setup') {
    return (
      <div className="card p-5 max-w-xl mx-auto space-y-5">
        <div className="flex items-center gap-2">
          <Crosshair size={18} className="text-brand-400" />
          <h3 className="font-semibold text-ink-100">Find the best move in this game</h3>
        </div>
        <p className="text-sm text-ink-400">
          You'll be shown the positions from this game one by one. Find the engine's best move —
          wrong tries are taken back until you get it. Afterwards you'll see how it compares with
          what was actually played. The game's own moves are never counted against you.
        </p>

        <div>
          <label className="text-sm text-ink-300 block mb-1.5">Practice moves for</label>
          <div className="flex gap-2">
            {([['w', 'White'], ['b', 'Black'], ['both', 'Both']] as const).map(([v, label]) => (
              <button key={v} onClick={() => setSide(v)} className={`${side === v ? 'btn-primary' : 'btn-secondary'} text-sm`}>{label}</button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-300 cursor-pointer">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} className="accent-brand-500" />
          Only positions where an inaccuracy, mistake or blunder was played
        </label>

        <button onClick={start} disabled={puzzles.length === 0} className="btn-primary w-full justify-center">
          {puzzles.length === 0 ? 'No positions match' : `Start · ${puzzles.length} position${puzzles.length === 1 ? '' : 's'}`}
        </button>
      </div>
    );
  }

  if (phase === 'finished') {
    const total = stats.first + stats.retry + stats.revealed;
    return (
      <div className="card p-8 text-center max-w-md mx-auto space-y-3">
        <h3 className="text-lg font-semibold text-ink-100">Game complete 🎉</h3>
        <p className="text-sm text-ink-300">
          {total} position{total === 1 ? '' : 's'}: <b className="text-brand-300">{stats.first}</b> found first try ·{' '}
          <b className="text-ink-100">{stats.retry}</b> after retries ·{' '}
          <b className="text-accent-400">{stats.revealed}</b> revealed
        </p>
        <button onClick={() => setPhase('setup')} className="btn-primary"><RotateCcw size={14} /> Practice again</button>
      </div>
    );
  }

  const busy = phase === 'judging' || phase === 'advancing';
  const done = phase === 'solved' || phase === 'revealed';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="flex items-center justify-between text-sm px-0.5">
          <span className="font-medium text-ink-200">
            Position {pos + 1} / {puzzles.length}
            {cur && <span className="text-ink-400 font-normal"> · move {Math.floor(cur.index / 2) + 1}</span>}
          </span>
          {busy && <Loader2 size={14} className="animate-spin text-ink-400" />}
        </div>
        <div className="w-full max-w-[480px] mx-auto">
          <ChessBoard
            fen={fen}
            orientation={orientation}
            lastMove={lastMove}
            highlightSquare={hint === 1 && bestUci ? (bestUci.slice(0, 2) as Square) : null}
            bestMoveUci={phase === 'revealed' || hint === 2 ? bestUci : null}
            interactive={phase === 'guess'}
            onUserMove={handleUserMove}
            showCelebration={false}
            size={480}
          />
        </div>
        <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
          <div className="h-full bg-brand-500 transition-all" style={{ width: `${((pos + (done ? 1 : 0)) / puzzles.length) * 100}%` }} />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="card p-4 space-y-3">
          <p className="text-sm text-ink-200">
            {phase === 'advancing'
              ? 'Continuing the game…'
              : done
                ? 'Ready for the next position?'
                : <>Find the best move for <b>{cur?.color === 'w' ? 'White' : 'Black'}</b>.</>}
          </p>
          {feedback && <FeedbackBanner tone={feedback.tone}>{feedback.text}</FeedbackBanner>}
          {attempts > 0 && phase === 'guess' && <p className="text-xs text-ink-500">Tries: {attempts}</p>}

          <div className="flex flex-wrap gap-2">
            {!done && (
              <>
                <button disabled={phase !== 'guess'} onClick={() => setHint(hint === 0 ? 1 : 2)} className="btn-secondary text-sm">
                  <Lightbulb size={14} /> {hint === 0 ? 'Hint' : hint === 1 ? 'Hint: show arrow' : 'Hint shown'}
                </button>
                <button disabled={phase !== 'guess'} onClick={showSolution} className="btn-secondary text-sm">
                  <Eye size={14} /> Show solution
                </button>
              </>
            )}
            {done && (
              <button onClick={next} className="btn-primary text-sm">
                {pos + 1 < puzzles.length ? 'Next' : 'Finish'} <ChevronRight size={14} />
              </button>
            )}
            <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} className="btn-ghost text-sm"><RotateCcw size={14} /> Flip</button>
            <button onClick={() => setPhase('setup')} className="btn-ghost text-sm ml-auto">Stop</button>
          </div>
        </div>

        {comparison && <ComparisonCard c={comparison} />}
      </div>
    </div>
  );
}
