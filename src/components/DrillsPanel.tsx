import { useEffect, useMemo, useRef, useState } from 'react';
import { type Square } from 'chess.js';
import { ChessBoard } from './ChessBoard';
import { MoveText, type MovePreview } from './MoveText';
import { FeedbackBanner } from './PracticeBits';
import type { AnalyzedMove, Drill, Settings } from '@/lib/types';
import { generateDrills } from '@/lib/drills';
import { getCoachExplanation } from '@/lib/coach';
import { ACCEPTABLE, applyUci, colorOfFen, judgeMove, sleep } from '@/lib/practice';
import { Target, Loader2, Check, X, RefreshCw, Sparkles, ChevronRight, Lightbulb, Eye, ArrowLeft } from 'lucide-react';

interface DrillsPanelProps {
  moves: AnalyzedMove[];
  settings: Settings;
}

const STORE_KEY = 'chesslens-drills-done';
type Filter = 'all' | 'todo' | 'done';
type Status = 'solving' | 'judging' | 'opponent' | 'done' | 'showing' | 'revealed';

function loadDone(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || '[]')); } catch { return new Set(); }
}
function saveDone(s: Set<string>) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

export function DrillsPanel({ moves, settings }: DrillsPanelProps) {
  const drills = useMemo(() => generateDrills(moves), [moves]);
  const [doneIds, setDoneIds] = useState<Set<string>>(() => loadDone());
  const [filter, setFilter] = useState<Filter>('all');
  const [activeDrill, setActiveDrill] = useState<Drill | null>(null);

  const [boardFen, setBoardFen] = useState('');
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [step, setStep] = useState(0); // index in solutionMoves of the move I must find
  const [status, setStatus] = useState<Status>('solving');
  const [feedback, setFeedback] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const [hint, setHint] = useState<0 | 1 | 2>(0);
  const [usedSolution, setUsedSolution] = useState(false);
  const [tries, setTries] = useState(0);
  const [explanation, setExplanation] = useState('');
  const [loadingExplain, setLoadingExplain] = useState(false);
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const run = useRef(0); // bumps whenever the drill resets, cancelling any running animation
  useEffect(() => () => { run.current++; }, []);

  function startDrill(drill: Drill) {
    run.current++;
    setActiveDrill(drill);
    setBoardFen(drill.fen);
    setLastMove(null);
    setStep(0);
    setStatus('solving');
    setFeedback(null);
    setHint(0);
    setUsedSolution(false);
    setTries(0);
    setExplanation('');
    setPreview(null);
  }

  function markDone(id: string) {
    setDoneIds((prev) => {
      if (prev.has(id)) return prev;
      const n = new Set(prev); n.add(id); saveDone(n); return n;
    });
  }

  async function handleUserMove(m: { from: Square; to: Square; promotion?: string; san: string; fen: string }) {
    if (!activeDrill || status !== 'solving') return;
    const my = ++run.current;
    const before = boardFen;
    const prevLast = lastMove;
    const uci = m.from + m.to + (m.promotion ?? '');
    const expected = activeDrill.solutionMoves[step];
    const last = step >= activeDrill.solutionMoves.length - 1;
    setTries((t) => t + 1);
    setHint(0);
    setBoardFen(m.fen);
    setLastMove({ from: m.from, to: m.to });

    const retry = async (text: string, tone: 'bad' | 'info' = 'bad') => {
      setFeedback({ tone, text });
      await sleep(900);
      if (my !== run.current) return;
      setBoardFen(before);
      setLastMove(prevLast);
      setStatus('solving');
    };

    let correct = uci === expected;
    let alternative = false;
    if (!correct) {
      // Different move: accept it if the engine rates it Brilliant, Great, Best, Excellent or Good.
      setStatus('judging');
      try {
        const known = step === 0 ? moves[activeDrill.sourceMoveIndex]?.evalBefore : undefined;
        const j = await judgeMove(before, uci, settings.analysisDepth, known);
        if (my !== run.current) return;
        if (ACCEPTABLE.includes(j.quality)) { correct = true; alternative = true; }
      } catch { /* treat as wrong */ }
    }

    if (!correct) { await retry('Not it — try again.'); return; }

    // The line only continues if they followed the engine line exactly.
    if (last || alternative) {
      setStatus('done');
      setFeedback({
        tone: 'good',
        text: alternative ? 'Good move — another strong option. Drill complete!' : 'Drill complete! 🎉',
      });
      if (!usedSolution) markDone(activeDrill.id);
      return;
    }

    // Correct, more to find: opponent answers, then it's my turn again.
    setStatus('opponent');
    setFeedback({ tone: 'good', text: 'Good move!' });
    await sleep(650);
    if (my !== run.current) return;
    const reply = applyUci(m.fen, activeDrill.solutionMoves[step + 1]);
    if (!reply) { setStatus('done'); markDone(activeDrill.id); return; }
    setBoardFen(reply.fen);
    setLastMove({ from: reply.from, to: reply.to });
    setStep(step + 2);
    setStatus('solving');
    setFeedback({ tone: 'info', text: 'Your turn — find the next move.' });
  }

  async function handleShowSolution() {
    if (!activeDrill || status === 'showing') return;
    const my = ++run.current;
    setStatus('showing');
    setUsedSolution(true);
    setHint(0);
    setFeedback({ tone: 'info', text: 'Watching the solution…' });
    let fen = boardFen;
    for (let i = step; i < activeDrill.solutionMoves.length; i++) {
      const r = applyUci(fen, activeDrill.solutionMoves[i]);
      if (!r) break;
      await sleep(i === step ? 300 : 900);
      if (my !== run.current) return;
      fen = r.fen;
      setBoardFen(r.fen);
      setLastMove({ from: r.from, to: r.to });
    }
    setStatus('revealed');
    setFeedback({ tone: 'info', text: 'Solution shown. Hit Retry to solve it yourself.' });
  }

  async function handleExplain() {
    if (!activeDrill || !settings.openaiApiKey) return;
    setLoadingExplain(true);
    try {
      const move = moves[activeDrill.sourceMoveIndex];
      if (move) setExplanation(await getCoachExplanation(move, settings));
    } finally {
      setLoadingExplain(false);
    }
  }

  const doneCount = drills.filter((d) => doneIds.has(d.id)).length;

  if (drills.length === 0) {
    return (
      <div className="card p-8 text-center text-ink-400">
        <Target size={32} className="mx-auto mb-3 opacity-50" />
        <p>No drills available. Analyze a game with blunders or mistakes to generate tactical drills.</p>
      </div>
    );
  }

  /* ---------------------------- list ---------------------------- */
  if (!activeDrill) {
    const shown = drills
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => (filter === 'all' ? true : filter === 'done' ? doneIds.has(d.id) : !doneIds.has(d.id)));

    return (
      <div className="space-y-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Target size={18} className="text-brand-400" />
            <h3 className="text-sm font-semibold text-ink-200">Tactical Drills</h3>
            <span className="ml-auto text-xs text-ink-400 font-mono">{doneCount} / {drills.length} completed</span>
          </div>
          <p className="text-sm text-ink-400 mb-3">
            Play the right move on the board. Wrong moves are taken back; keep going until the drill is complete.
          </p>
          <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden mb-3">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${(doneCount / drills.length) * 100}%` }} />
          </div>
          <div className="flex gap-1.5">
            {([['all', `All (${drills.length})`], ['todo', `To do (${drills.length - doneCount})`], ['done', `Completed (${doneCount})`]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={`chip ${filter === v ? 'bg-brand-500/20 text-brand-300' : 'bg-ink-700 text-ink-300'}`}>{label}</button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-400">
            {filter === 'done' ? 'No completed drills yet.' : 'Everything is completed 🎉'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {shown.map(({ d, i }) => {
              const done = doneIds.has(d.id);
              return (
                <button key={d.id} onClick={() => startDrill(d)}
                  className={`card p-4 text-left hover:border-brand-400/40 transition-colors group ${done ? 'border-brand-500/30' : ''}`}>
                  <div className="flex items-start justify-between mb-2">
                    <span className="chip bg-ink-700 text-ink-300">Drill {i + 1}</span>
                    <div className="flex gap-1.5">
                      {done && <span className="chip bg-brand-500/20 text-brand-300"><Check size={11} /> Completed</span>}
                      <span className={`chip ${d.difficulty === 'hard' ? 'bg-red-500/20 text-red-400' : 'bg-accent-400/20 text-accent-400'}`}>{d.difficulty}</span>
                    </div>
                  </div>
                  <h4 className="text-sm font-medium text-ink-100 mb-1">{d.theme}</h4>
                  <p className="text-xs text-ink-400">{d.description}</p>
                  <div className="flex items-center gap-1 mt-3 text-xs text-ink-400 group-hover:text-brand-400 transition-colors">
                    {done ? 'Practice again' : 'Start drill'} <ChevronRight size={12} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ---------------------------- active drill ---------------------------- */
  const orientation = colorOfFen(activeDrill.fen) === 'b' ? 'black' : 'white';
  const nextDrill = drills.find((d) => d.id !== activeDrill.id && !doneIds.has(d.id));
  const nextBest = activeDrill.solutionMoves[step];
  const locked = status !== 'solving';
  const totalMine = Math.ceil(activeDrill.solutionMoves.length / 2);
  const myIndex = Math.floor(step / 2) + 1;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="flex flex-col gap-4 min-w-0">
        <button onClick={() => { run.current++; setActiveDrill(null); }} className="btn-ghost text-xs self-start -mb-2">
          <ArrowLeft size={12} /> All drills
        </button>

        <div className="flex justify-center w-full">
          <div className="w-full max-w-[480px]">
            <ChessBoard
              fen={preview ? preview.fen : boardFen}
              orientation={orientation}
              lastMove={preview ? { from: preview.from, to: preview.to } : lastMove}
              highlightSquare={!preview && hint === 1 && nextBest ? (nextBest.slice(0, 2) as Square) : null}
              bestMoveUci={!preview && hint === 2 ? nextBest : null}
              interactive={!preview && status === 'solving'}
              onUserMove={handleUserMove}
              showCelebration={false}
              size={480}
            />
          </div>
        </div>

        {preview && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-500/10 border border-brand-500/30 px-3 py-2 text-sm text-brand-300">
            <span>Previewing <span className="font-mono font-semibold">{preview.san}</span> <span className="text-brand-400/70">({preview.uci})</span></span>
            <button onClick={() => setPreview(null)} className="btn-ghost text-xs px-2 py-1 shrink-0"><X size={12} /> Back to drill</button>
          </div>
        )}

        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-200">{activeDrill.theme}</h3>
            <div className="flex items-center gap-2">
              {doneIds.has(activeDrill.id) && <span className="chip bg-brand-500/20 text-brand-300"><Check size={11} /> Completed</span>}
              <button onClick={() => startDrill(activeDrill)} className="btn-ghost text-xs px-2 py-1"><RefreshCw size={12} /> Retry</button>
            </div>
          </div>
          <p className="text-sm text-ink-300">{activeDrill.description}</p>
          {totalMine > 1 && status !== 'done' && status !== 'revealed' && (
            <p className="text-xs text-ink-500">Move {Math.min(myIndex, totalMine)} of {totalMine} to find</p>
          )}

          {feedback && <FeedbackBanner tone={feedback.tone}>{feedback.text}</FeedbackBanner>}
          {status === 'judging' && <p className="text-xs text-ink-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> checking your move…</p>}

          <div className="flex flex-wrap gap-2">
            <button onClick={() => setHint(hint === 0 ? 1 : 2)} disabled={locked} className="btn-secondary text-xs">
              <Lightbulb size={12} /> {hint === 0 ? 'Hint' : hint === 1 ? 'Show arrow' : 'Hint shown'}
            </button>
            <button onClick={handleShowSolution} disabled={status === 'showing' || status === 'done' || status === 'revealed' || status === 'opponent'} className="btn-secondary text-xs">
              <Eye size={12} /> Show Solution
            </button>
            <button onClick={handleExplain} disabled={loadingExplain || !settings.openaiApiKey} className="btn-ghost text-xs">
              {loadingExplain ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Explain
            </button>
            {(status === 'done' || status === 'revealed') && nextDrill && (
              <button onClick={() => startDrill(nextDrill)} className="btn-primary text-xs ml-auto">Next drill <ChevronRight size={12} /></button>
            )}
          </div>
          {tries > 1 && status === 'solving' && <p className="text-xs text-ink-500">Attempts: {tries}</p>}
        </div>
      </div>

      <div className="card p-4 self-start">
        <h3 className="text-sm font-semibold text-ink-200 mb-3">Coach Explanation</h3>
        {explanation ? (
          <p className="text-sm text-ink-100 leading-relaxed">
            <MoveText text={explanation} fen={moves[activeDrill.sourceMoveIndex]?.fenBefore || activeDrill.fen} onPreview={setPreview} activeUci={preview?.uci} />
          </p>
        ) : (
          <p className="text-sm text-ink-500">
            {settings.openaiApiKey ? 'Click "Explain" to understand why this is the best move.' : 'Add your OpenAI API key in Settings for drill explanations.'}
          </p>
        )}
      </div>
    </div>
  );
}