// A "mission" = the task the Learn Path sent you to do (a skill, or a daily goal).
// The banner on Puzzles / Play / Openings reads its live progress from here.
// Place in src/lib/mission.ts
import { LEVELS, type Skill } from '@/lib/learnTypes';
import { getSkillStatus, loadLearnProgress } from '@/lib/learnStorage';
import { emptyDay, loadActivity, todayKey, type Activity } from '@/lib/activity';

export const DAILY_PUZZLE_GOAL = 10;

export type Mission =
  | { type: 'skill'; skillId: string }
  | { type: 'daily'; key: 'puzzles' | 'lesson' | 'games' | 'review' };

export interface MissionStatus {
  title: string;
  hint: string;
  done: number;
  target: number;
  complete: boolean;
}

/** How much real activity counts toward a skill, based on the practice targets it launches. */
export function autoCount(skill: Skill, act: Activity): number {
  let n = 0;
  for (const t of skill.practice) {
    switch (t.type) {
      case 'puzzles':
        n += t.theme === 'all' ? act.totals.puzzlesSolved : act.themes[t.theme]?.s ?? 0;
        break;
      case 'puzzles-multi':
        n += t.themes.reduce((a, th) => a + (act.themes[th]?.s ?? 0), 0);
        break;
      case 'play':
        n += act.totals.games;
        break;
      case 'openings':
        n += act.totals.lessons;
        break;
      case 'home-review':
        n += act.totals.reviews;
        break;
    }
  }
  return n;
}

function skillHint(skill: Skill): string {
  const parts: string[] = [];
  const add = (s: string) => { if (!parts.includes(s)) parts.push(s); };
  for (const t of skill.practice) {
    if (t.type === 'puzzles' || t.type === 'puzzles-multi') add('Solve puzzles in this theme — only clean solves (no hints or mistakes) count.');
    else if (t.type === 'play') add('Finish a game, then press Analyze so it counts.');
    else if (t.type === 'openings') add('Finish an opening line or a study chapter.');
    else if (t.type === 'home-review') add('Open a game and press Analyze.');
    else add('Do this off-site, then log it on the Learn Path.');
  }
  return parts.join(' ');
}

export function getMissionStatus(m: Mission): MissionStatus | null {
  const act = loadActivity();

  if (m.type === 'daily') {
    const d = { ...emptyDay(), ...(act.days[todayKey()] ?? {}) };
    const map = {
      puzzles: { title: `Today: solve ${DAILY_PUZZLE_GOAL} puzzles`, done: d.puzzlesSolved + d.puzzlesMissed, target: DAILY_PUZZLE_GOAL, hint: 'Every puzzle you attempt counts toward today’s goal.' },
      lesson: { title: 'Today: finish an opening line or chapter', done: d.lessons, target: 1, hint: 'Play a line through in Practice, or step to the end of a chapter.' },
      games: { title: 'Today: play a game', done: d.games, target: 1, hint: 'Finish a game, then press Analyze so it counts.' },
      review: { title: 'Today: review a game', done: d.reviews, target: 1, hint: 'Open a game and press Analyze.' },
    } as const;
    const x = map[m.key];
    return { title: x.title, hint: x.hint, target: x.target, done: Math.min(x.done, x.target), complete: x.done >= x.target };
  }

  const skill = LEVELS.flatMap((l) => l.skills).find((s) => s.id === m.skillId);
  if (!skill) return null;
  const st = getSkillStatus(skill.id, loadLearnProgress());
  const auto = autoCount(skill, act);
  const pending = Math.max(0, auto - (act.credited[skill.id] ?? auto)); // done but not yet credited on the path
  const done = Math.min(skill.targetCount, (st.completedCount || 0) + pending);
  return {
    title: `${skill.id} · ${skill.title}`,
    hint: skillHint(skill),
    done,
    target: skill.targetCount,
    complete: st.status === 'completed' || done >= skill.targetCount,
  };
}
