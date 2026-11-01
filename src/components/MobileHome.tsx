import { useMemo } from 'react';
import { Plus, GraduationCap, Target, Swords, BookOpen, ChevronRight, Crown } from 'lucide-react';
import { loadLearnProgress, getOverallProgress, getSkillStatus } from '@/lib/learnStorage';
import { LEVELS } from '@/lib/learnTypes';

export type HomeTarget = 'learn' | 'openings' | 'puzzles' | 'play';

/**
 * Phone Home header (hidden from `sm:` up): hero card, quick-action tiles and a "Continue learning" card.
 * Same layout idea as a modern chess-community app, in ChessLens colours.
 */
export function MobileHome({ onImport, onGo }: { onImport: () => void; onGo: (t: HomeTarget) => void }) {
  const next = useMemo(() => {
    const progress = loadLearnProgress();
    const overall = getOverallProgress(progress);
    for (const level of LEVELS) {
      const idx = level.skills.findIndex((s) => getSkillStatus(s.id, progress).status !== 'completed');
      if (idx >= 0) return { level, skill: level.skills[idx], idx, overall };
    }
    return { level: LEVELS[LEVELS.length - 1], skill: null, idx: 0, overall };
  }, []);

  const tiles: { key: string; icon: any; title: string; sub: string; onClick: () => void }[] = [
    { key: 'import', icon: Plus, title: 'Import', sub: 'Add games', onClick: onImport },
    { key: 'learn', icon: GraduationCap, title: 'Learn', sub: 'Lessons', onClick: () => onGo('learn') },
    { key: 'puzzles', icon: Target, title: 'Puzzles', sub: 'Tactics', onClick: () => onGo('puzzles') },
    { key: 'play', icon: Swords, title: 'Play', sub: 'vs Computer', onClick: () => onGo('play') },
  ];

  return (
    <div className="sm:hidden space-y-5 mb-5">
      <section className="relative overflow-hidden rounded-2xl border border-ink-700 bg-gradient-to-br from-brand-600/25 via-ink-800 to-ink-900 p-5">
        <Crown size={170} strokeWidth={1.2} className="absolute -right-8 -bottom-8 text-brand-400/10 pointer-events-none" aria-hidden />
        <h2 className="!text-[2rem] leading-[1.05] max-w-[14rem]">Know <em>why</em> you lost.</h2>
        <p className="mt-2 text-sm text-ink-300 max-w-[17rem]">Import a game and get a coach's explanation for every move, on your phone.</p>
        <button onClick={onImport} className="btn-primary mt-4">
          <Plus size={18} /> Import a game
        </button>
      </section>

      <section className="grid grid-cols-4 gap-2" aria-label="Quick actions">
        {tiles.map((t) => (
          <button key={t.key} onClick={t.onClick} className="card flex flex-col items-center gap-1 px-1 py-3 active:bg-ink-700 transition-colors">
            <span className="w-11 h-11 rounded-full bg-brand-500/15 text-brand-300 flex items-center justify-center"><t.icon size={20} /></span>
            <span className="text-[13px] font-semibold text-ink-100 mt-0.5">{t.title}</span>
            <span className="text-[10px] text-ink-400 leading-none">{t.sub}</span>
          </button>
        ))}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="!text-lg">Continue learning</h3>
          <button onClick={() => onGo('learn')} className="text-xs font-semibold text-brand-300 flex items-center gap-0.5">See all <ChevronRight size={13} /></button>
        </div>
        <button onClick={() => onGo('learn')} className="card w-full p-3.5 flex items-center gap-3 text-left active:bg-ink-700 transition-colors">
          <span className="w-14 h-14 shrink-0 rounded-xl bg-brand-500/15 text-brand-300 flex items-center justify-center"><BookOpen size={24} /></span>
          <span className="min-w-0 flex-1">
            <span className="chip bg-ink-700 text-ink-300 !py-0.5 !text-[10px]">Level {next.level.number}</span>
            <span className="block text-sm font-semibold text-ink-100 truncate mt-1">{next.skill ? next.skill.title : 'All lessons complete'}</span>
            <span className="block text-xs text-ink-400">{next.level.title}{next.skill ? ` · Lesson ${next.idx + 1} of ${next.level.skills.length}` : ''}</span>
            <span className="mt-2 flex items-center gap-2">
              <span className="h-1.5 flex-1 rounded-full bg-ink-700 overflow-hidden"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${next.overall.percent}%` }} /></span>
              <span className="text-[11px] font-mono text-ink-400">{next.overall.percent}%</span>
            </span>
          </span>
          <ChevronRight size={18} className="text-ink-500 shrink-0" />
        </button>
      </section>
    </div>
  );
}
