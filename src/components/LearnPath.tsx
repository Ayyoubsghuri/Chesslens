import { useState, useEffect, useCallback } from 'react';
import {
  LEVELS,
  type Level,
  type Skill,
  type LearnProgress,
  type PracticeTarget,
} from '@/lib/learnTypes';
import {
  loadLearnProgress,
  saveLearnProgress,
  getSkillStatus,
  markSkillProgress,
  toggleDailyRoutine,
  getLevelProgress,
  getOverallProgress,
} from '@/lib/learnStorage';
import {
  BookOpen,
  CheckCircle2,
  Circle,
  Lock,
  Flame,
  Star,
  Target,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Trophy,
  RotateCcw,
  Play,
  GraduationCap,
  Swords,
  Eye,
  Puzzle,
  Home,
  ExternalLink,
  Gamepad2,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { loadPuzzleProgress, prettyTheme } from '@/lib/puzzles';
import type { PuzzleProgress } from '@/lib/puzzles';
import { loadActivity, saveCredited, resetCredited, emptyDay, activityStreak, todayKey, type Activity } from '@/lib/activity';
import { MiniGames } from './MiniGames';
import { autoCount, DAILY_PUZZLE_GOAL, type Mission } from '@/lib/mission';

export type LearnNavigate =
  | { page: 'puzzles'; theme?: string; mission?: Mission }
  | { page: 'play'; mission?: Mission }
  | { page: 'openings'; mission?: Mission }
  | { page: 'home'; mission?: Mission };

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; bar: string; soft: string }> = {
  emerald: {
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/40',
    text: 'text-emerald-300',
    bar: 'bg-emerald-500',
    soft: 'bg-emerald-500/10',
  },
  sky: {
    bg: 'bg-sky-500/15',
    border: 'border-sky-500/40',
    text: 'text-sky-300',
    bar: 'bg-sky-500',
    soft: 'bg-sky-500/10',
  },
  violet: {
    bg: 'bg-violet-500/15',
    border: 'border-violet-500/40',
    text: 'text-violet-300',
    bar: 'bg-violet-500',
    soft: 'bg-violet-500/10',
  },
  amber: {
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/40',
    text: 'text-amber-300',
    bar: 'bg-amber-500',
    soft: 'bg-amber-500/10',
  },
  rose: {
    bg: 'bg-rose-500/15',
    border: 'border-rose-500/40',
    text: 'text-rose-300',
    bar: 'bg-rose-500',
    soft: 'bg-rose-500/10',
  },
  indigo: {
    bg: 'bg-indigo-500/15',
    border: 'border-indigo-500/40',
    text: 'text-indigo-300',
    bar: 'bg-indigo-500',
    soft: 'bg-indigo-500/10',
  },
  teal: {
    bg: 'bg-teal-500/15',
    border: 'border-teal-500/40',
    text: 'text-teal-300',
    bar: 'bg-teal-500',
    soft: 'bg-teal-500/10',
  },
};

interface LearnPathProps {
  onNavigate?: (target: LearnNavigate) => void;
}

interface Credit {
  skill: Skill;
  delta: number;
}

/**
 * Credits unlocked skills for activity done since the last visit. A skill's baseline is set the
 * first time it is seen unlocked, so old history never cascades through the whole tree at once.
 */
function applyAutoCredit(start: LearnProgress, act: Activity) {
  let next = start;
  const credited = { ...act.credited };
  const credits: Credit[] = [];
  for (const level of LEVELS) {
    for (const skill of level.skills) {
      const st = getSkillStatus(skill.id, next).status;
      if (st === 'locked' || st === 'completed') continue;
      const auto = autoCount(skill, act);
      if (credited[skill.id] === undefined) {
        credited[skill.id] = auto;
        continue;
      }
      const delta = auto - credited[skill.id];
      credited[skill.id] = auto;
      if (delta > 0) {
        next = markSkillProgress(next, skill.id, delta, skill.targetCount);
        credits.push({ skill, delta });
      }
    }
  }
  return { next, credited, credits };
}

export function LearnPath({ onNavigate }: LearnPathProps) {
  const [progress, setProgress] = useState<LearnProgress>(() => loadLearnProgress());
  const [activity, setActivity] = useState<Activity>(() => loadActivity());
  const [puzzleStats] = useState<PuzzleProgress>(() => loadPuzzleProgress());
  const [expandedLevel, setExpandedLevel] = useState<string | null>('level-1');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [credits, setCredits] = useState<Credit[]>([]);

  useEffect(() => {
    saveLearnProgress(progress);
  }, [progress]);

  useEffect(() => {
    for (const level of LEVELS) {
      const { percent } = getLevelProgress(level.id, progress);
      if (percent < 100) {
        setExpandedLevel(level.id);
        break;
      }
    }
    // Credit puzzles / lines / games done since the last visit
    const act = loadActivity();
    const res = applyAutoCredit(progress, act);
    saveCredited(res.credited);
    if (res.credits.length > 0) {
      setProgress(res.next);
      setCredits(res.credits);
    }
    setActivity(loadActivity());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overall = getOverallProgress(progress);

  const handleDrill = useCallback((skill: Skill, count = 1) => {
    setProgress((prev) => markSkillProgress(prev, skill.id, count, skill.targetCount));
  }, []);

  const handleCompleteSkill = useCallback((skill: Skill) => {
    setProgress((prev) => {
      const status = getSkillStatus(skill.id, prev);
      const remaining = Math.max(0, skill.targetCount - (status.completedCount || 0));
      return markSkillProgress(prev, skill.id, remaining || skill.targetCount, skill.targetCount);
    });
  }, []);

  const handleDaily = useCallback((key: 'puzzles' | 'lesson' | 'games' | 'review') => {
    setProgress((prev) => toggleDailyRoutine(prev, key));
  }, []);

  const handleMiniPlayed = useCallback(() => {
    setActivity(loadActivity());
    setProgress((p) => ({ ...p, xp: p.xp + 5 }));
  }, []);

  const launchPractice = useCallback(
    (target: PracticeTarget, skillId?: string) => {
      if (skillId) {
        setProgress((prev) => ({ ...prev, activeSkillId: skillId }));
      }
      if (!onNavigate) return;
      const mission: Mission | undefined = skillId ? { type: 'skill', skillId } : undefined;
      switch (target.type) {
        case 'puzzles':
          onNavigate({
            page: 'puzzles',
            theme: target.theme === 'all' ? undefined : target.theme,
            mission,
          });
          break;
        case 'puzzles-multi': {
          // Start with the theme you've solved the least
          const theme = [...target.themes].sort(
            (a, b) => (activity.themes[a]?.s ?? 0) - (activity.themes[b]?.s ?? 0),
          )[0];
          onNavigate({ page: 'puzzles', theme, mission });
          break;
        }
        case 'play':
          onNavigate({ page: 'play', mission });
          break;
        case 'openings':
          onNavigate({ page: 'openings', mission });
          break;
        case 'home-review':
          onNavigate({ page: 'home', mission });
          break;
        case 'manual':
          break;
      }
    },
    [onNavigate, activity.themes],
  );

  const handleReset = () => {
    if (!window.confirm('Reset all learning progress? Your puzzle rating and history are kept.')) return;
    const fresh: LearnProgress = { skills: {}, xp: 0, streak: 0 };
    setProgress(fresh);
    saveLearnProgress(fresh);
    resetCredited();
    saveCredited(applyAutoCredit(fresh, loadActivity()).credited);
    setActivity(loadActivity());
    setCredits([]);
    setSelectedSkill(null);
    setExpandedLevel('level-1');
  };

  // ── today's goals, detected automatically from real activity ──
  const today = todayKey();
  const day = { ...emptyDay(), ...(activity.days[today] ?? {}) };
  const puzzlesToday = day.puzzlesSolved + day.puzzlesMissed;
  const autoDone = {
    puzzles: puzzlesToday >= DAILY_PUZZLE_GOAL,
    lesson: day.lessons > 0,
    games: day.games > 0,
    review: day.reviews > 0,
  };
  const routine =
    progress.dailyRoutine?.date === today
      ? progress.dailyRoutine
      : { puzzles: false, lesson: false, games: false, review: false, date: today };

  useEffect(() => {
    (['puzzles', 'lesson', 'games', 'review'] as const).forEach((key) => {
      if (!autoDone[key]) return;
      setProgress((prev) =>
        prev.dailyRoutine?.date === today && prev.dailyRoutine[key] ? prev : toggleDailyRoutine(prev, key),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDone.puzzles, autoDone.lesson, autoDone.games, autoDone.review]);

  // ── what to do next ──
  const allSkills = LEVELS.flatMap((l) => l.skills);
  const isOpen = (s: Skill) => {
    const st = getSkillStatus(s.id, progress).status;
    return st !== 'completed' && st !== 'locked';
  };
  const activeSkill = progress.activeSkillId ? allSkills.find((s) => s.id === progress.activeSkillId) ?? null : null;
  const nextSkill = (activeSkill && isOpen(activeSkill) ? activeSkill : null) ?? allSkills.find(isOpen) ?? null;
  const nextStatus = nextSkill ? getSkillStatus(nextSkill.id, progress) : null;
  const nextAuto = nextSkill ? nextSkill.practice.some((t) => t.type !== 'manual') : false;

  // ── weak puzzle themes (from your real puzzle history) ──
  const focus = Object.entries(puzzleStats.themeStats ?? {})
    .map(([theme, st]) => ({ theme, solved: st.solved, failed: st.failed, total: st.solved + st.failed }))
    .filter((t) => t.total >= 3 && t.failed / t.total >= 0.4)
    .sort((a, b) => b.failed / b.total - a.failed / a.total)
    .slice(0, 4);

  // ── last 7 days ──
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    const st = { ...emptyDay(), ...(activity.days[d.toISOString().slice(0, 10)] ?? {}) };
    return {
      label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
      total: st.puzzlesSolved + st.puzzlesMissed + st.games + st.lessons + st.reviews + st.miniGames,
      solved: st.puzzlesSolved,
      missed: st.puzzlesMissed,
    };
  });
  const maxBar = Math.max(5, ...week.map((w) => w.total));
  const weekSolved = week.reduce((a, w) => a + w.solved, 0);
  const weekMissed = week.reduce((a, w) => a + w.missed, 0);
  const streak = Math.max(progress.streak, activityStreak(activity));

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <GraduationCap className="text-brand-400" size={28} />
              Zero-to-Pro Path
            </h2>
            <p className="text-ink-400 text-sm mt-1 max-w-lg">
              A skill tree from beginner to a solid 1600+ foundation. Skills fill up automatically as you solve
              puzzles, finish opening lines and play games on ChessLens.
            </p>
          </div>
          <button
            onClick={handleReset}
            className="btn-ghost text-xs text-ink-500 hover:text-red-300"
            title="Reset progress"
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard icon={<Star size={18} className="text-amber-400" />} label="XP" value={String(progress.xp)} />
          <StatCard
            icon={<Flame size={18} className="text-orange-400" />}
            label="Practice streak"
            value={`${streak} day${streak === 1 ? '' : 's'}`}
          />
          <StatCard
            icon={<Trophy size={18} className="text-brand-400" />}
            label="Skills"
            value={`${overall.completed}/${overall.total}`}
          />
          <StatCard
            icon={<Target size={18} className="text-emerald-400" />}
            label="Puzzle rating"
            value={String(puzzleStats.rating)}
          />
        </div>

        <div className="h-2.5 rounded-full bg-ink-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand-500 to-emerald-400 transition-all duration-500"
            style={{ width: `${overall.percent}%` }}
          />
        </div>
        <p className="text-xs text-ink-500 mt-1">{overall.percent}% of the path complete</p>
      </div>

      {credits.length > 0 && (
        <div className="card p-4 mb-6 border border-emerald-500/30 bg-emerald-500/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-200 flex items-center gap-1.5">
                <Zap size={14} /> Nice work — progress added automatically
              </p>
              <p className="text-xs text-ink-300 mt-1">
                {credits.map((c) => `${c.skill.id} ${c.skill.title} +${c.delta}`).join(' · ')}
              </p>
            </div>
            <button onClick={() => setCredits([])} className="btn-ghost text-xs">
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Up next */}
        <div className="card p-5 border border-brand-500/30 bg-brand-500/5">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-300 mb-1">Up next</div>
          {nextSkill && nextStatus ? (
            <>
              <h3 className="text-lg font-bold leading-tight">
                {nextSkill.id} · {nextSkill.title}
              </h3>
              <p className="text-sm text-ink-300 mt-1">{nextSkill.description}</p>
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-ink-800 overflow-hidden">
                  <div
                    className="h-full bg-brand-500 transition-all"
                    style={{ width: `${Math.min(100, (nextStatus.completedCount / nextSkill.targetCount) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-ink-400 tabular-nums">
                  {nextStatus.completedCount}/{nextSkill.targetCount}
                </span>
              </div>
              <p className="text-xs text-ink-500 mt-1">
                {nextAuto
                  ? 'Counts automatically when you practice — no logging needed.'
                  : 'Do this one off-site, then log it with “+1 log” below.'}
              </p>
              <PracticeButtons targets={nextSkill.practice} skillId={nextSkill.id} onLaunch={launchPractice} />
              {nextSkill.tip && <p className="text-xs text-ink-400 mt-3 italic">Tip: {nextSkill.tip}</p>}
            </>
          ) : (
            <>
              <h3 className="text-lg font-bold">Path complete 🎉</h3>
              <p className="text-sm text-ink-300 mt-1">
                Keep your rating climbing with real puzzles from the Lichess database, and play games to apply it.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button onClick={() => onNavigate?.({ page: 'puzzles' })} className="btn-primary text-sm">
                  <Puzzle size={14} /> Practice puzzles
                </button>
                <button onClick={() => onNavigate?.({ page: 'play' })} className="btn-secondary text-sm">
                  <Swords size={14} /> Play a game
                </button>
              </div>
            </>
          )}
        </div>

        {/* Daily goals */}
        <div className="card p-5">
          <h3 className="font-semibold mb-1 flex items-center gap-2">
            <Sparkles size={18} className="text-amber-400" />
            Today
          </h3>
          <p className="text-xs text-ink-500 mb-3">Ticks off automatically when you do it. All four = +25 XP.</p>
          <div className="space-y-2">
            <RoutineItem
              done={routine.puzzles}
              onToggle={() => handleDaily('puzzles')}
              onGo={() => onNavigate?.({ page: 'puzzles', mission: { type: 'daily', key: 'puzzles' } })}
              icon={<Puzzle size={16} />}
              title={`Solve ${DAILY_PUZZLE_GOAL} puzzles`}
              subtitle={`${Math.min(puzzlesToday, DAILY_PUZZLE_GOAL)}/${DAILY_PUZZLE_GOAL} today`}
            />
            <RoutineItem
              done={routine.lesson}
              onToggle={() => handleDaily('lesson')}
              onGo={() => onNavigate?.({ page: 'openings', mission: { type: 'daily', key: 'lesson' } })}
              icon={<BookOpen size={16} />}
              title="Finish an opening line or chapter"
              subtitle={`${day.lessons} today`}
            />
            <RoutineItem
              done={routine.games}
              onToggle={() => handleDaily('games')}
              onGo={() => onNavigate?.({ page: 'play', mission: { type: 'daily', key: 'games' } })}
              icon={<Swords size={16} />}
              title="Play a game"
              subtitle={`${day.games} today · apply CCT every move`}
            />
            <RoutineItem
              done={routine.review}
              onToggle={() => handleDaily('review')}
              onGo={() => onNavigate?.({ page: 'home', mission: { type: 'daily', key: 'review' } })}
              icon={<Eye size={16} />}
              title="Review a game"
              subtitle={`${day.reviews} today · Analysis / Coach`}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {/* Focus areas */}
        <div className="card p-5">
          <h3 className="font-semibold mb-1 flex items-center gap-2">
            <Target size={18} className="text-red-300" />
            Focus on these
          </h3>
          {focus.length > 0 ? (
            <>
              <p className="text-xs text-ink-500 mb-3">Your weakest puzzle themes, from your real results.</p>
              <div className="flex flex-wrap gap-2">
                {focus.map((t) => (
                  <button
                    key={t.theme}
                    onClick={() => onNavigate?.({ page: 'puzzles', theme: t.theme })}
                    className="chip bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors"
                    title="Practice this theme"
                  >
                    {prettyTheme(t.theme)} · {t.solved}/{t.total}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-ink-500 mb-3">
                Solve a few puzzles in Practice Puzzles and the themes you miss most will show up here.
              </p>
              <button onClick={() => onNavigate?.({ page: 'puzzles' })} className="btn-secondary text-sm">
                <Puzzle size={14} /> Start puzzles
              </button>
            </>
          )}
        </div>

        {/* This week */}
        <div className="card p-5">
          <h3 className="font-semibold mb-1 flex items-center gap-2">
            <TrendingUp size={18} className="text-emerald-400" />
            This week
          </h3>
          <p className="text-xs text-ink-500 mb-3">
            {weekSolved + weekMissed > 0
              ? `${weekSolved} of ${weekSolved + weekMissed} puzzles solved (${Math.round((weekSolved / (weekSolved + weekMissed)) * 100)}%)`
              : 'No puzzles yet this week.'}
          </p>
          <div className="flex items-end gap-2 h-16">
            {week.map((w, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${w.total} activities`}>
                <div className="w-full flex-1 flex items-end">
                  <div
                    className={`w-full rounded-sm ${w.total > 0 ? 'bg-brand-500' : 'bg-ink-800'}`}
                    style={{ height: `${w.total > 0 ? Math.max(12, (w.total / maxBar) * 100) : 8}%` }}
                  />
                </div>
                <span className="text-[10px] text-ink-500">{w.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mini games */}
      <div className="mb-8">
        <h3 className="font-semibold mb-1 flex items-center gap-2">
          <Gamepad2 size={18} className="text-violet-300" />
          Mini games
        </h3>
        <p className="text-xs text-ink-500 mb-3">
          Two-minute board-vision drills. Each finished game earns +5 XP. Played today: {day.miniGames}.
        </p>
        <MiniGames activity={activity} onPlayed={handleMiniPlayed} />
      </div>

      <h3 className="font-semibold mb-3">Skill tree</h3>
      <div className="space-y-4">
        {LEVELS.map((level) => (
          <LevelCard
            key={level.id}
            level={level}
            progress={progress}
            expanded={expandedLevel === level.id}
            onToggle={() => setExpandedLevel((id) => (id === level.id ? null : level.id))}
            onSelectSkill={setSelectedSkill}
            selectedSkillId={selectedSkill?.id}
            onDrill={handleDrill}
            onComplete={handleCompleteSkill}
            onLaunch={launchPractice}
          />
        ))}
      </div>

      {selectedSkill && (
        <SkillDetail
          skill={selectedSkill}
          progress={progress}
          onClose={() => setSelectedSkill(null)}
          onDrill={handleDrill}
          onComplete={handleCompleteSkill}
          onLaunch={launchPractice}
        />
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card px-4 py-3 flex items-center gap-3">
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-ink-500">{label}</div>
        <div className="font-semibold text-sm truncate">{value}</div>
      </div>
    </div>
  );
}

function RoutineItem({
  done,
  onToggle,
  onGo,
  icon,
  title,
  subtitle,
}: {
  done: boolean;
  onToggle: () => void;
  onGo?: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
        done
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
          : 'bg-ink-800/50 border-ink-700 text-ink-200'
      }`}
    >
      <button onClick={onToggle} className={`mt-0.5 shrink-0 ${done ? 'text-emerald-400' : 'text-ink-500'}`}>
        {done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium flex items-center gap-2">
          {icon} {title}
        </div>
        <div className="text-xs text-ink-500 mt-0.5">{subtitle}</div>
      </div>
      {onGo && (
        <button onClick={onGo} className="btn-secondary text-xs px-2.5 py-1.5 shrink-0" title="Go practice">
          <ExternalLink size={12} /> Go
        </button>
      )}
    </div>
  );
}

function PracticeButtons({
  targets,
  skillId,
  onLaunch,
  compact,
}: {
  targets: PracticeTarget[];
  skillId?: string;
  onLaunch: (t: PracticeTarget, skillId?: string) => void;
  compact?: boolean;
}) {
  if (!targets.length) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? '' : 'mt-2'}`}>
      {targets.map((t, i) => {
        const icon =
          t.type === 'puzzles' || t.type === 'puzzles-multi' ? (
            <Puzzle size={12} />
          ) : t.type === 'play' ? (
            <Swords size={12} />
          ) : t.type === 'openings' ? (
            <BookOpen size={12} />
          ) : t.type === 'home-review' ? (
            <Home size={12} />
          ) : (
            <Play size={12} />
          );
        const isManual = t.type === 'manual';
        return (
          <button
            key={i}
            onClick={() => onLaunch(t, skillId)}
            className={`${isManual ? 'btn-ghost' : 'btn-primary'} text-xs px-2.5 py-1.5`}
            title={t.label}
          >
            {icon} {t.label}
          </button>
        );
      })}
    </div>
  );
}

function LevelCard({
  level,
  progress,
  expanded,
  onToggle,
  onSelectSkill,
  selectedSkillId,
  onDrill,
  onComplete,
  onLaunch,
}: {
  level: Level;
  progress: LearnProgress;
  expanded: boolean;
  onToggle: () => void;
  onSelectSkill: (s: Skill) => void;
  selectedSkillId?: string;
  onDrill: (s: Skill, n?: number) => void;
  onComplete: (s: Skill) => void;
  onLaunch: (t: PracticeTarget, skillId?: string) => void;
}) {
  const { completed, total, percent } = getLevelProgress(level.id, progress);
  const colors = COLOR_MAP[level.color] || COLOR_MAP.emerald;
  const allDone = percent === 100;

  const levelIndex = LEVELS.findIndex((l) => l.id === level.id);
  const prevComplete =
    levelIndex === 0 || getLevelProgress(LEVELS[levelIndex - 1].id, progress).percent === 100;
  const locked = !prevComplete;

  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-colors ${
        locked ? 'border-ink-800 opacity-60' : allDone ? colors.border : 'border-ink-700'
      }`}
    >
      <button
        onClick={onToggle}
        disabled={locked}
        className={`w-full flex items-center gap-4 p-4 text-left ${
          locked ? 'cursor-not-allowed' : 'hover:bg-ink-800/40'
        } ${allDone ? colors.soft : 'bg-ink-900/60'}`}
      >
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg shrink-0 ${
            locked
              ? 'bg-ink-800 text-ink-500'
              : allDone
                ? colors.bg + ' ' + colors.text
                : 'bg-ink-800 text-ink-200'
          }`}
        >
          {locked ? <Lock size={20} /> : allDone ? <CheckCircle2 size={22} /> : level.number}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">
              Level {level.number}: {level.title}
            </span>
            {allDone && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>
                Complete
              </span>
            )}
          </div>
          <p className="text-xs text-ink-400 mt-0.5 truncate">{level.goal}</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-ink-800 overflow-hidden max-w-[12rem]">
              <div className={`h-full ${colors.bar} transition-all`} style={{ width: `${percent}%` }} />
            </div>
            <span className="text-xs text-ink-500">
              {completed}/{total}
            </span>
          </div>
        </div>
        <div className="text-ink-500 shrink-0">
          {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </div>
      </button>

      {expanded && !locked && (
        <div className="border-t border-ink-800 bg-ink-950/40 p-4 space-y-3">
          {level.skills.map((skill) => {
            const status = getSkillStatus(skill.id, progress);
            const isSelected = selectedSkillId === skill.id;
            return (
              <SkillRow
                key={skill.id}
                skill={skill}
                status={status}
                colors={colors}
                selected={isSelected}
                onSelect={() => onSelectSkill(skill)}
                onDrill={() => onDrill(skill, 1)}
                onComplete={() => onComplete(skill)}
                onLaunch={onLaunch}
              />
            );
          })}

          <div className={`mt-2 p-3 rounded-xl border ${colors.border} ${colors.soft}`}>
            <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${colors.text}`}>
              Level Drill
            </div>
            <p className="text-sm text-ink-300 mb-2">{level.levelDrill}</p>
            {level.levelPractice && (
              <PracticeButtons targets={level.levelPractice} onLaunch={onLaunch} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SkillRow({
  skill,
  status,
  colors,
  selected,
  onSelect,
  onDrill,
  onComplete,
  onLaunch,
}: {
  skill: Skill;
  status: { status: string; completedCount: number };
  colors: (typeof COLOR_MAP)[string];
  selected: boolean;
  onSelect: () => void;
  onDrill: () => void;
  onComplete: () => void;
  onLaunch: (t: PracticeTarget, skillId?: string) => void;
}) {
  const locked = status.status === 'locked';
  const done = status.status === 'completed';
  const pct = Math.min(100, Math.round((status.completedCount / skill.targetCount) * 100));

  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${
        selected
          ? colors.border + ' ' + colors.soft
          : locked
            ? 'border-ink-800 bg-ink-900/30'
            : 'border-ink-700 bg-ink-900/50 hover:border-ink-600'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {locked ? (
            <Lock size={18} className="text-ink-600" />
          ) : done ? (
            <CheckCircle2 size={18} className={colors.text} />
          ) : (
            <Circle size={18} className="text-ink-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <button
            onClick={onSelect}
            disabled={locked}
            className={`text-left w-full ${locked ? 'cursor-not-allowed' : ''}`}
          >
            <div className="font-medium text-sm">
              {skill.id} · {skill.title}
            </div>
            <p className="text-xs text-ink-400 mt-0.5 line-clamp-2">{skill.description}</p>
          </button>

          {!locked && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-ink-800 overflow-hidden min-w-[6rem] max-w-[10rem]">
                  <div className={`h-full ${colors.bar} transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-ink-500 tabular-nums">
                  {status.completedCount}/{skill.targetCount}
                </span>
                {!done && (
                  <>
                    <button onClick={onDrill} className="btn-ghost text-xs text-ink-400 hover:text-ink-200">
                      +1 log
                    </button>
                    <button
                      onClick={onComplete}
                      className="btn-ghost text-xs text-ink-400 hover:text-emerald-300"
                    >
                      Mark done
                    </button>
                  </>
                )}
              </div>
              {!done && (
                <div className="mt-2">
                  <PracticeButtons
                    targets={skill.practice}
                    skillId={skill.id}
                    onLaunch={onLaunch}
                    compact
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillDetail({
  skill,
  progress,
  onClose,
  onDrill,
  onComplete,
  onLaunch,
}: {
  skill: Skill;
  progress: LearnProgress;
  onClose: () => void;
  onDrill: (s: Skill, n?: number) => void;
  onComplete: (s: Skill) => void;
  onLaunch: (t: PracticeTarget, skillId?: string) => void;
}) {
  const status = getSkillStatus(skill.id, progress);
  const level = LEVELS.find((l) => l.id === skill.levelId)!;
  const colors = COLOR_MAP[level.color] || COLOR_MAP.emerald;
  const done = status.status === 'completed';
  const locked = status.status === 'locked';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${colors.text}`}>
              Level {level.number} · Skill {skill.id}
            </div>
            <h3 className="text-xl font-bold">{skill.title}</h3>
          </div>
          <button onClick={onClose} className="btn-ghost p-2 text-ink-400" aria-label="Close">
            ✕
          </button>
        </div>

        <p className="text-ink-300 text-sm mb-4">{skill.description}</p>

        {skill.tip && (
          <div className={`p-3 rounded-xl mb-4 ${colors.soft} border ${colors.border}`}>
            <div className={`text-xs font-semibold mb-1 ${colors.text}`}>Pro tip</div>
            <p className="text-sm text-ink-200">{skill.tip}</p>
          </div>
        )}

        <div className="mb-4">
          <div className="flex justify-between text-xs text-ink-500 mb-1">
            <span>Progress</span>
            <span>
              {status.completedCount} / {skill.targetCount} drills
            </span>
          </div>
          <div className="h-2 rounded-full bg-ink-800 overflow-hidden">
            <div
              className={`h-full ${colors.bar} transition-all`}
              style={{
                width: `${Math.min(100, (status.completedCount / skill.targetCount) * 100)}%`,
              }}
            />
          </div>
        </div>

        {!locked && !done && (
          <>
            <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2">
              Practice with ChessLens
            </p>
            <PracticeButtons targets={skill.practice} skillId={skill.id} onLaunch={onLaunch} />
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-ink-800">
              <button onClick={() => onDrill(skill, 1)} className="btn-secondary text-sm">
                +1 log
              </button>
              <button onClick={() => onDrill(skill, 5)} className="btn-secondary text-sm">
                +5 log
              </button>
              <button onClick={() => onComplete(skill)} className="btn-primary text-sm">
                <CheckCircle2 size={14} /> Mark complete
              </button>
            </div>
          </>
        )}
        {done && (
          <div className={`flex items-center gap-2 p-3 rounded-xl ${colors.soft} ${colors.text}`}>
            <CheckCircle2 size={20} />
            <span className="font-medium">Skill mastered! +50 XP</span>
          </div>
        )}
        {locked && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-ink-800 text-ink-400">
            <Lock size={18} />
            <span className="text-sm">Complete the previous skill to unlock.</span>
          </div>
        )}
      </div>
    </div>
  );
}