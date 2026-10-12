// Shown on Puzzles / Play / Openings / Home when you were sent there from the Learn Path.
// Place in src/components/MissionBanner.tsx
import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, X } from 'lucide-react';
import { getMissionStatus, type Mission, type MissionStatus } from '@/lib/mission';

export function MissionBanner({ mission, onBack, onDismiss }: { mission: Mission; onBack: () => void; onDismiss: () => void }) {
  const [st, setSt] = useState<MissionStatus | null>(() => getMissionStatus(mission));

  useEffect(() => {
    const update = () => setSt(getMissionStatus(mission));
    update();
    window.addEventListener('chesslens-activity', update);
    return () => window.removeEventListener('chesslens-activity', update);
  }, [mission]);

  if (!st) return null;
  const pct = Math.min(100, Math.round((st.done / st.target) * 100));

  return (
    <div
      role="status"
      className={`card p-4 mb-5 border ${st.complete ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-brand-500/30 bg-brand-500/5'}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[14rem]">
          <p className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 ${st.complete ? 'text-emerald-300' : 'text-brand-300'}`}>
            {st.complete && <CheckCircle2 size={13} />}
            {st.complete ? 'Mission complete' : 'Learn Path mission'}
          </p>
          <p className="font-semibold text-sm mt-0.5">{st.title}</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-ink-800 overflow-hidden max-w-xs">
              <div className={`h-full transition-all ${st.complete ? 'bg-emerald-400' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-ink-300 tabular-nums">{st.done}/{st.target}</span>
          </div>
          <p className="text-xs text-ink-400 mt-1">
            {st.complete ? 'Great work! Head back to the Learn Path to see what to do next.' : st.hint}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onBack} className={`${st.complete ? 'btn-primary' : 'btn-secondary'} text-sm`}>
            <ArrowLeft size={14} /> {st.complete ? 'Continue on Learn Path' : 'Back to Learn Path'}
          </button>
          <button onClick={onDismiss} className="btn-ghost p-2 text-ink-500" aria-label="Dismiss mission" title="Dismiss">
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
