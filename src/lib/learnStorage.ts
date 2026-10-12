import type { LearnProgress, SkillProgress } from './learnTypes';
import { LEVELS, XP_PER_SKILL_COMPLETE } from './learnTypes';

const KEY = 'chesslens-learn-progress';

const defaultProgress = (): LearnProgress => ({
  skills: {},
  xp: 0,
  streak: 0,
});

export function loadLearnProgress(): LearnProgress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProgress();
    return { ...defaultProgress(), ...JSON.parse(raw) };
  } catch {
    return defaultProgress();
  }
}

export function saveLearnProgress(progress: LearnProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // ignore quota errors
  }
}

export function getSkillStatus(
  skillId: string,
  progress: LearnProgress
): SkillProgress {
  const existing = progress.skills[skillId];
  if (existing?.status === 'completed') {
    return existing;
  }

  let prevSkillId: string | null = null;
  let found = false;
  for (const level of LEVELS) {
    for (const skill of level.skills) {
      if (skill.id === skillId) {
        found = true;
        break;
      }
      prevSkillId = skill.id;
    }
    if (found) break;
  }

  if (!prevSkillId) {
    return existing || { status: 'available', completedCount: 0 };
  }

  const prev = progress.skills[prevSkillId];
  if (prev?.status === 'completed') {
    return existing || { status: 'available', completedCount: 0 };
  }

  return { status: 'locked', completedCount: 0 };
}

export function markSkillProgress(
  progress: LearnProgress,
  skillId: string,
  increment: number,
  targetCount: number
): LearnProgress {
  const current = getSkillStatus(skillId, progress);
  if (current.status === 'locked') return progress;

  const newCount = Math.min(targetCount, (current.completedCount || 0) + increment);
  const completed = newCount >= targetCount;
  const wasAlreadyComplete = current.status === 'completed';

  const next: LearnProgress = {
    ...progress,
    skills: {
      ...progress.skills,
      [skillId]: {
        status: completed ? 'completed' : 'in_progress',
        completedCount: newCount,
        completedAt: completed ? new Date().toISOString() : current.completedAt,
      },
    },
    xp: progress.xp + (completed && !wasAlreadyComplete ? XP_PER_SKILL_COMPLETE : increment > 0 ? 5 : 0),
  };

  const today = new Date().toISOString().slice(0, 10);
  if (progress.lastActiveDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);
    next.streak = progress.lastActiveDate === yStr ? progress.streak + 1 : 1;
    next.lastActiveDate = today;
  }

  return next;
}

export function toggleDailyRoutine(
  progress: LearnProgress,
  key: 'puzzles' | 'lesson' | 'games' | 'review'
): LearnProgress {
  const today = new Date().toISOString().slice(0, 10);
  const routine = progress.dailyRoutine?.date === today
    ? { ...progress.dailyRoutine }
    : { puzzles: false, lesson: false, games: false, review: false, date: today };

  const wasDone = routine[key];
  routine[key] = !wasDone;

  const allDone =
    routine.puzzles && routine.lesson && routine.games && routine.review;
  const prevAllDone =
    progress.dailyRoutine?.date === today &&
    progress.dailyRoutine.puzzles &&
    progress.dailyRoutine.lesson &&
    progress.dailyRoutine.games &&
    progress.dailyRoutine.review;

  let xp = progress.xp;
  if (allDone && !prevAllDone) xp += 25;
  if (!allDone && prevAllDone) xp = Math.max(0, xp - 25);

  return {
    ...progress,
    dailyRoutine: routine,
    xp,
    lastActiveDate: today,
    streak:
      progress.lastActiveDate === today
        ? progress.streak
        : (() => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            return progress.lastActiveDate === yesterday.toISOString().slice(0, 10)
              ? progress.streak + 1
              : 1;
          })(),
  };
}

export function getLevelProgress(levelId: string, progress: LearnProgress) {
  const level = LEVELS.find((l) => l.id === levelId);
  if (!level) return { completed: 0, total: 0, percent: 0 };
  const total = level.skills.length;
  const completed = level.skills.filter(
    (s) => getSkillStatus(s.id, progress).status === 'completed'
  ).length;
  return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
}

export function getOverallProgress(progress: LearnProgress) {
  const allSkills = LEVELS.flatMap((l) => l.skills);
  const total = allSkills.length;
  const completed = allSkills.filter(
    (s) => getSkillStatus(s.id, progress).status === 'completed'
  ).length;
  return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
}