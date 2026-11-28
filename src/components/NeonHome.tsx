import { useMemo } from 'react';
import {
  Plus, ClipboardPaste, Swords, Dices, GraduationCap, Target, BookOpen, ChevronRight, Crown, Zap, Timer, Flame, Sun, CalendarDays, Sparkles, BookMarked,
  type LucideIcon,
} from 'lucide-react';
import type { AnalysisResult, ImportedGame } from '@/lib/types';
import { loadLearnProgress, getOverallProgress } from '@/lib/learnStorage';
import { getUsername, youSide } from '@/lib/player';

export type NeonTarget = 'learn' | 'openings' | 'puzzles' | 'play' | 'variants' | 'story' | 'library';

/** Speed of a game from its time control ("180+2" = 3 minutes): the label and icon the recent list shows. */
function speedOf(tc: string | undefined): { label: string; icon: LucideIcon } {
  if (!tc || tc === '-') return { label: 'Game', icon: Crown };
  if (tc.includes('/')) return { label: 'Daily', icon: CalendarDays };
  const [base, inc] = tc.split('+').map((x) => Number(x) || 0);
  const total = base + 40 * inc;
  if (total < 180) return { label: 'Bullet', icon: Flame };
  if (total < 600) return { label: 'Blitz', icon: Zap };
  if (total < 1800) return { label: 'Rapid', icon: Timer };
  return { label: 'Classical', icon: Sun };
}

/**
 * Home screen of the Android app (neon skin). Same features as the website's home, laid out like a modern chess app:
 * a mint "Play it." panel with the main actions, a "Learn more" row, and your recent games with result and accuracy.
 */
export function NeonHome({ games, analyses, onImport, onPaste, onGo, onOpenGame }: {
  games: ImportedGame[];
  analyses: Record<string, AnalysisResult>;
  onImport: () => void;
  onPaste: () => void;
  onGo: (t: NeonTarget) => void;
  onOpenGame: (id: string) => void;
}) {
  const learn = useMemo(() => getOverallProgress(loadLearnProgress()), []);
  const me = getUsername();
  const recent = useMemo(() => games.slice(0, 40).map((g) => {
    const side = youSide(g, me);
    const r = g.result;
    const outcome = r === '1/2-1/2' || r === '½-½' ? 'Draw' : !side || (r !== '1-0' && r !== '0-1') ? null : (r === '1-0') === (side === 'w') ? 'Win' : 'Loss';
    const opp = side === 'w' ? g.black : side === 'b' ? g.white : `${g.white} vs ${g.black}`;
    const a = analyses[g.id];
    const acc = a && side ? a.accuracy?.[side === 'w' ? 'white' : 'black'] : null;
    return { g, outcome, opp, acc, speed: speedOf(g.timeControl) };
  }), [games, analyses, me]);

  const learnRow: { key: NeonTarget; title: string; sub: string; icon: LucideIcon }[] = [
    { key: 'learn', title: 'Learn path', sub: `${learn.percent}% done`, icon: GraduationCap },
    { key: 'puzzles', title: 'Puzzles', sub: 'Tactics training', icon: Target },
    { key: 'openings', title: 'Openings', sub: 'Build a repertoire', icon: BookOpen },
    { key: 'story', title: 'Your story', sub: 'Your chess in numbers', icon: BookMarked },
  ];

  return (
    <div className="sm:hidden fixed inset-x-0 top-[var(--appbar-h)] bottom-[calc(env(safe-area-inset-bottom)+84px)] z-10 flex flex-col gap-4 bg-ink-950">
      {/* Mint panel */}
      <section className="relative shrink-0 overflow-hidden rounded-b-[2rem] bg-brand-500 px-4 pb-4 pt-4 text-ink-950">
        <div className="flex items-center justify-between">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-950 text-brand-400"><Crown size={22} /></span>
          <span className="rounded-full bg-ink-950/10 px-3 py-1 text-xs font-bold">
            {me ? `Hi, ${me}` : 'ChessLens'}
          </span>
        </div>
        <h2 className="mt-3 !text-[2.9rem] !leading-[0.9] !text-ink-950">Play it.</h2>
        <Crown size={150} strokeWidth={1.4} className="pointer-events-none absolute -right-6 top-6 text-ink-950/10" aria-hidden />

        <div className="relative mt-4 grid grid-cols-2 gap-2.5">
          <button onClick={onImport} className="row-span-2 flex flex-col justify-between rounded-[1.6rem] bg-ink-950 p-4 text-left text-ink-100 active:scale-[0.98] transition-transform">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/15 text-brand-400"><Sparkles size={18} /></span>
            <span>
              <span className="block text-lg font-extrabold leading-tight">Analyze a game</span>
              <span className="mt-1 block text-[11px] text-ink-400">From Chess.com or a PGN</span>
              <span className="mt-2 flex gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-500 px-3 py-1.5 text-xs font-bold text-ink-950"><Plus size={14} /> Import</span>
                <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onPaste(); }} className="inline-flex items-center gap-1 rounded-full bg-ink-800 px-3 py-1.5 text-xs font-bold text-ink-100" aria-label="Paste a game"><ClipboardPaste size={14} /></span>
              </span>
            </span>
          </button>
          <button onClick={() => onGo('play')} className="rounded-[1.4rem] bg-ink-900 p-3.5 text-left text-ink-100 active:scale-[0.98] transition-transform">
            <Swords size={18} className="text-brand-400" />
            <span className="mt-2 block text-sm font-bold leading-tight">Play</span>
            <span className="block text-[11px] text-ink-400">Computer or a friend</span>
          </button>
          <button onClick={() => onGo('variants')} className="rounded-[1.4rem] bg-ink-800 p-3.5 text-left text-ink-100 active:scale-[0.98] transition-transform">
            <Dices size={18} className="text-[rgb(var(--neon-lime))]" />
            <span className="mt-2 block text-sm font-bold leading-tight">Chess variants</span>
            <span className="block text-[11px] text-ink-400">Bots, power-ups, drawbacks</span>
          </button>
        </div>
      </section>

      {/* Learn more */}
      <section className="shrink-0 px-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="!text-lg">Learn more</h3>
          <button onClick={() => onGo('learn')} className="rounded-full border border-ink-700 px-3 py-1 text-[11px] font-semibold text-ink-300">View all</button>
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4">
          {learnRow.map((x) => (
            <button key={x.key} onClick={() => onGo(x.key)} className="flex min-w-[10.5rem] items-center gap-3 rounded-[1.4rem] border border-white/5 bg-ink-800 p-3 text-left active:bg-ink-700">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ink-950 text-brand-400"><x.icon size={20} /></span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink-100">{x.title}</span>
                <span className="block text-[11px] text-ink-400">{x.sub}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Recent games */}
      <section className="mx-4 flex min-h-0 flex-1 flex-col rounded-[1.8rem] border border-white/5 bg-ink-800 px-4 pt-3">
        <div className="mb-1 flex shrink-0 items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-400">Your games <span className="ml-1 font-semibold normal-case tracking-normal text-ink-500">{games.length}</span></p>
          {games.length > 0 && <button onClick={() => onGo('library')} className="rounded-full border border-ink-700 px-3 py-1 text-[11px] font-semibold text-ink-300">Manage</button>}
        </div>
        {recent.length === 0 ? (
          <button onClick={onImport} className="mt-2 flex w-full items-center justify-between rounded-2xl bg-ink-900 p-3 text-left text-sm text-ink-300">
            Import your first game to see it here <ChevronRight size={16} />
          </button>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto overscroll-contain pb-2">
            {recent.map(({ g, outcome, opp, acc, speed }) => (
              <li key={g.id}>
                <button onClick={() => onOpenGame(g.id)} className="flex w-full items-center gap-3 py-2.5 text-left">
                  <speed.icon size={16} className="shrink-0 text-ink-400" />
                  <span className="w-14 shrink-0 text-xs font-semibold text-ink-300">{speed.label}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">{opp}</span>
                  {acc != null && <span className="shrink-0 font-mono text-[11px] text-ink-400">{Math.round(acc)}%</span>}
                  {outcome && (
                    <span className={`w-10 shrink-0 text-right text-xs font-bold ${outcome === 'Win' ? 'text-brand-400' : outcome === 'Loss' ? 'text-rose-400' : 'text-ink-300'}`}>{outcome}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The app's floating bottom bar: four destinations and a raised lime Import button in the middle. */
export function NeonBar({ page, onGo, onImport, hidden }: {
  page: string;
  onGo: (p: 'home' | NeonTarget) => void;
  onImport: () => void;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const item = (p: 'home' | NeonTarget, label: string, Icon: LucideIcon) => (
    <button onClick={() => onGo(p)} aria-current={page === p ? 'page' : undefined} aria-label={label} className="neon-bar-item">
      <Icon size={21} strokeWidth={page === p ? 2.4 : 1.9} />
      {label}
    </button>
  );
  return (
    <nav className="neon-bar sm:hidden" aria-label="Main">
      {item('home', 'Home', Crown)}
      {item('puzzles', 'Puzzles', Target)}
      <button onClick={onImport} className="neon-bar-main" aria-label="Import a game"><Plus size={26} strokeWidth={2.6} /></button>
      {item('variants', 'Variants', Dices)}
      {item('play', 'Play', Swords)}
    </nav>
  );
}
