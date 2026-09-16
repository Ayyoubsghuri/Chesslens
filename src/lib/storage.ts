import type { AnalysisResult, ImportedGame, Settings } from './types';

const GAME_KEY = 'chesslens:games';
const ANALYSIS_KEY = 'chesslens:analyses';
const SETTINGS_KEY = 'chesslens:settings';

/**
 * Bump this any time analysis.ts's scoring logic changes (classification
 * thresholds, accuracy formula, etc).
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * saveAnalysis() persists each game's computed AnalyzedMove[]/accuracy to
 * localStorage, keyed by game ID, with no expiry. That's fine until you fix
 * a bug in how scoring works — at that point every previously-analyzed game
 * is still sitting in storage with numbers computed by the OLD, buggy
 * logic, and nothing tells the app to throw that away. The UI happily keeps
 * showing those stale numbers forever, which looks exactly like "the fix
 * didn't work" even when it did.
 *
 * Stamping every saved analysis with the version it was computed under, and
 * discarding anything that doesn't match on load, makes a formula change
 * force a recompute instead of silently serving retired results.
 * ──────────────────────────────────────────────────────────────────────────
 */
const ANALYSIS_SCHEMA_VERSION = 2;

interface StoredAnalysis extends AnalysisResult {
  __schemaVersion?: number;
  /** Engine depth this analysis was computed at, so a settings change invalidates it. */
  __analysisDepth?: number;
}

export function loadGames(): ImportedGame[] {
  try {
    const raw = localStorage.getItem(GAME_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveGames(games: ImportedGame[]): void {
  try { localStorage.setItem(GAME_KEY, JSON.stringify(games)); } catch {}
}

export function loadAnalyses(): Record<string, AnalysisResult> {
  try {
    const raw = localStorage.getItem(ANALYSIS_KEY);
    if (!raw) return {};
    const parsed: Record<string, StoredAnalysis> = JSON.parse(raw);
    const result: Record<string, AnalysisResult> = {};

    for (const key in parsed) {
      const entry = parsed[key];

      // Anything saved under a previous scoring formula is treated as if it
      // were never analyzed at all, so the caller re-runs analyzeGame()
      // with the current logic instead of getting numbers from the retired
      // formula. (Also catches entries from before this field existed.)
      if (entry.__schemaVersion !== ANALYSIS_SCHEMA_VERSION) continue;

      // Migrate old-but-current-version analyses that lack acpl or greatMoves.
      if (!entry.acpl) entry.acpl = { white: 0, black: 0 };
      if (typeof entry.greatMoves !== 'number') entry.greatMoves = 0;

      result[key] = entry;
    }

    return result;
  } catch { return {}; }
}

export function saveAnalysis(gameId: string, analysis: AnalysisResult, analysisDepth: number): void {
  try {
    // Read the raw (unfiltered) store directly rather than via loadAnalyses(),
    // so a save doesn't accidentally purge other games' still-current entries
    // due to some unrelated read-time issue.
    const raw = localStorage.getItem(ANALYSIS_KEY);
    const all: Record<string, StoredAnalysis> = raw ? JSON.parse(raw) : {};
    all[gameId] = { ...analysis, __schemaVersion: ANALYSIS_SCHEMA_VERSION, __analysisDepth: analysisDepth };
    localStorage.setItem(ANALYSIS_KEY, JSON.stringify(all));
  } catch {}
}

/**
 * True if a cached analysis was computed at a different depth than the
 * current setting — meaning it should be treated as stale and recomputed,
 * even though its schema version still matches.
 *
 * loadAnalyses() strips this internal field off before returning, since
 * callers displaying results shouldn't need to know about it — but that
 * means a raw depth comparison against a loaded AnalysisResult won't work.
 * Check with this helper *before* calling loadAnalyses() for that game, by
 * reading raw storage, or simpler: call this right after computing a fresh
 * analysis is being considered, using getStoredDepth() below.
 */
export function getStoredDepth(gameId: string): number | null {
  try {
    const raw = localStorage.getItem(ANALYSIS_KEY);
    if (!raw) return null;
    const all: Record<string, StoredAnalysis> = JSON.parse(raw);
    return all[gameId]?.__analysisDepth ?? null;
  } catch { return null; }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {}
  return defaultSettings();
}

export function saveSettings(settings: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

function defaultSettings(): Settings {
  return { openaiApiKey: '', analysisDepth: 12, coachModel: 'gpt-4o-mini' };
}