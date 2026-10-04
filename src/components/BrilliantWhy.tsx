import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { explainBrilliant } from '@/lib/brilliant-explain';
import { getBrilliantExplanation } from '@/lib/coach-brilliant';
import { formatEval } from '@/lib/engine';
import type { AnalyzedMove, Settings } from '@/lib/types';

/** Shown under the coach bubble on brilliant moves: "why is it brilliant?" */
export function BrilliantWhy({ move, settings, compact }: { move: AnalyzedMove; settings?: Settings; compact?: boolean }) {
  const evalText = move.evalAfter ? formatEval(move.evalAfter) : null;
  const local = useMemo(
    () => explainBrilliant(move.fenBefore, move.san, move.color, move.evalAfter?.continuation, evalText),
    [move.fenBefore, move.san, move.color, move.evalAfter, evalText],
  );
  const [ai, setAi] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setAi(null); setLoading(false); }, [move.index]);

  const askAi = async () => {
    if (!settings) return;
    setLoading(true);
    setAi(await getBrilliantExplanation(move, local, settings));
    setLoading(false);
  };

  return (
    <div className={`${compact ? 'px-2 pb-2' : 'px-4 pb-3'} text-ink-300 ${compact ? 'text-xs' : 'text-sm'}`}>
      <div className="rounded-lg border border-[#26c2a3]/30 bg-[#26c2a3]/10 p-3">
        <div className="flex items-center gap-1.5 font-semibold text-[#26c2a3] mb-1">
          <Sparkles size={14} /> Why is this brilliant?
        </div>
        <p className="leading-snug">{ai ?? local}</p>
        {settings?.openaiApiKey && !ai && (
          <button onClick={askAi} disabled={loading} className="mt-2 inline-flex items-center gap-1.5 text-[#26c2a3] hover:underline disabled:opacity-60">
            {loading && <Loader2 size={12} className="animate-spin" />} Explain in simple words (AI)
          </button>
        )}
      </div>
    </div>
  );
}
