import { useEffect, useState } from 'react';
import { Database, Loader2, ListVideo } from 'lucide-react';
import {
  buildTablebaseLine, describeTablebase, fetchTablebase, tablebaseEligible,
  type TbFrame, type TbSummary,
} from '@/lib/tablebase';

interface Props {
  /** Position after the move being shown. */
  fen: string;
  compact?: boolean;
  /** Called with the full winning line so the board can play it. */
  onPlayLine?: (frames: TbFrame[], label: string) => void;
}

/** Shows the Lichess 7-piece tablebase verdict, plus a button to play the whole sequence. */
export function TablebaseNote({ fen, compact, onPlayLine }: Props) {
  const eligible = tablebaseEligible(fen);
  const [summary, setSummary] = useState<TbSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [plies, setPlies] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setSummary(null);
    setError(null);
    setBuilding(false);
    if (!eligible) return;
    let cancelled = false;
    setLoading(true);
    fetchTablebase(fen)
      .then((res) => { if (!cancelled) setSummary(describeTablebase(res, fen)); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fen, eligible, attempt]);

  if (!eligible) return null;
  if (loading) {
    return (
      <div className="mt-2 flex items-center gap-2 px-1 text-xs text-ink-400">
        <Loader2 size={12} className="animate-spin" /> Checking tablebase…
      </div>
    );
  }
  if (error && !summary) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-xl bg-ink-800/70 border border-ink-700/60 px-3 py-2 text-xs text-ink-400">
        <Database size={13} className="shrink-0" />
        <span className="flex-1">Tablebase unavailable: {error}</span>
        <button onClick={() => setAttempt((n) => n + 1)} className="btn-ghost text-xs px-2 py-1">Retry</button>
      </div>
    );
  }
  if (!summary) return null;

  async function showSequence() {
    setBuilding(true);
    setError(null);
    setPlies(0);
    try {
      const frames = await buildTablebaseLine(fen, setPlies);
      if (frames.length === 0) setError('No line found');
      else onPlayLine?.(frames, 'Tablebase line');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the line');
    } finally {
      setBuilding(false);
    }
  }

  const tone =
    summary.tone === 'win' ? 'text-brand-300' : summary.tone === 'draw' ? 'text-accent-400' : 'text-ink-400';

  return (
    <div className="mt-2 rounded-xl bg-ink-800/70 border border-ink-700/60 px-3 py-2">
      <div className={`flex items-start gap-2 ${compact ? 'text-xs' : 'text-sm'} ${tone}`}>
        <Database size={compact ? 13 : 15} className="mt-0.5 shrink-0" />
        <span>{summary.text}</span>
      </div>
      {summary.hasLine && onPlayLine && (
        <button
          onClick={showSequence}
          disabled={building}
          className="btn-secondary text-xs mt-2 w-full justify-center"
        >
          {building ? (
            <><Loader2 size={12} className="animate-spin" /> Building line… {plies > 0 && `${plies} moves`}</>
          ) : (
            <><ListVideo size={12} /> Show full sequence</>
          )}
        </button>
      )}
      {error && <p className="text-xs text-red-400 mt-1.5">Couldn't load the line: {error}</p>}
    </div>
  );
}
