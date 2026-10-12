// One shared log of what the learner actually does on the site (puzzles, lines/chapters, games,
// reviews, mini-games). The Learn Path reads it to credit skills and daily goals automatically.
// Place in src/lib/activity.ts

const KEY = 'chesslens-activity-v1';
const KEEP_DAYS = 60;

export interface DayStats {
  puzzlesSolved: number;
  puzzlesMissed: number;
  games: number;
  lessons: number;
  reviews: number;
  miniGames: number;
}

export interface Activity {
  totals: DayStats;
  themes: Record<string, { s: number; f: number }>; // puzzle results per Lichess theme
  days: Record<string, DayStats>;                   // key = YYYY-MM-DD (UTC, same as Learn Path routine)
  mini: Record<string, { best: number; plays: number }>;
  credited: Record<string, number>;                 // per-skill auto-credit already applied
}

export const emptyDay = (): DayStats => ({ puzzlesSolved: 0, puzzlesMissed: 0, games: 0, lessons: 0, reviews: 0, miniGames: 0 });
export const todayKey = () => new Date().toISOString().slice(0, 10);

const blank = (): Activity => ({ totals: emptyDay(), themes: {}, days: {}, mini: {}, credited: {} });

export function loadActivity(): Activity {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return blank();
    return {
      totals: { ...emptyDay(), ...(raw.totals ?? {}) },
      themes: raw.themes ?? {},
      days: raw.days ?? {},
      mini: raw.mini ?? {},
      credited: raw.credited ?? {},
    };
  } catch {
    return blank();
  }
}

function save(a: Activity) {
  const keys = Object.keys(a.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete a.days[k];
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* storage full / blocked */ }
  try { window.dispatchEvent(new Event('chesslens-activity')); } catch { /* no window */ }
}

function bump(a: Activity, field: keyof DayStats, n = 1) {
  a.totals[field] += n;
  const k = todayKey();
  a.days[k] = { ...emptyDay(), ...(a.days[k] ?? {}) };
  a.days[k][field] += n;
}

/** Call once per puzzle result (win = solved with no mistakes/hints). */
export function logPuzzle(themes: string[], win: boolean) {
  const a = loadActivity();
  bump(a, win ? 'puzzlesSolved' : 'puzzlesMissed');
  for (const t of themes) {
    const cur = a.themes[t] ?? { s: 0, f: 0 };
    if (win) cur.s++; else cur.f++;
    a.themes[t] = cur;
  }
  save(a);
}

/** A game played, an opening line / study chapter finished, or a game reviewed. */
export function logEvent(kind: 'game' | 'lesson' | 'review') {
  const a = loadActivity();
  bump(a, kind === 'game' ? 'games' : kind === 'lesson' ? 'lessons' : 'reviews');
  save(a);
}

export function logMiniGame(id: string, score: number) {
  const a = loadActivity();
  const cur = a.mini[id] ?? { best: 0, plays: 0 };
  a.mini[id] = { best: Math.max(cur.best, score), plays: cur.plays + 1 };
  bump(a, 'miniGames');
  save(a);
}

export function saveCredited(credited: Record<string, number>) {
  const a = loadActivity();
  a.credited = credited;
  save(a);
}

export function resetCredited() {
  saveCredited({});
}

const anyActivity = (d?: DayStats) => !!d && d.puzzlesSolved + d.puzzlesMissed + d.games + d.lessons + d.reviews + d.miniGames > 0;

/** Consecutive days with any activity, ending today (or yesterday if nothing yet today). */
export function activityStreak(a: Activity): number {
  let streak = 0;
  for (let i = 0; i < KEEP_DAYS; i++) {
    const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    if (anyActivity(a.days[key])) streak++;
    else if (i === 0) continue; // today may still be empty
    else break;
  }
  return streak;
}
