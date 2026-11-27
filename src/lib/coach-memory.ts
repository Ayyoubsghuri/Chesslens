/**
 * coach-memory.ts
 * The whole-game coach's work, kept OUTSIDE the screen that shows it.
 *
 * Before: leaving the coach (another tab, another move, another page, the phone's home button) threw away the review
 * and every engine check it had done, and coming back started again from step 1.
 * Now the review is built and checked here, in the background, whether the coach is on screen or not. What is done
 * is saved on the device (localStorage), so even a reload or an app restart keeps it, and the place you stopped at
 * is remembered per game. When you come back, the coach tells you what it finished while you were away.
 *
 * No React here: components subscribe with subscribeReview() and read snapshots with getReview().
 */
import type { AnalyzedMove } from './types';
import {
  prepareGameBeats, deepenBeat, deepCandidates,
  type GameBeat, type GameScene, type GameCoachOptions, type GameDetail,
} from './coach-game';

export type ReviewStatus = 'building' | 'ready';

export interface ReviewState {
  key: string;
  status: ReviewStatus;
  /** 0..1 while the review is being written. */
  frac: number;
  beats: GameBeat[];
  /** Engine-checked explanations, by beat id. */
  deep: Record<string, GameScene[]>;
  /** The beat the engine is checking right now (null = idle or finished). */
  busy: string | null;
  /** How many beats need an engine check, and how many are done. */
  total: number;
  done: number;
}

interface Entry extends ReviewState {
  moves: AnalyzedMove[];
  opts: GameCoachOptions;
  /** Beat the viewer is on: the engine checks it (and the ones after it) first. */
  focus: string | null;
  running: boolean;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();
/** Only one review uses the engine at a time: the one opened last. */
let active: string | null = null;

const STORE = 'chesslens:coach-review:v1:';
const INDEX = 'chesslens:coach-review:v1:index';
const PLACE = 'chesslens:coach-place:v1:';
const MAX_SAVED = 8;

export const reviewKey = (gameId: string, o: GameCoachOptions) =>
  `${gameId}|${o.detail}|${o.you ?? '-'}|${o.level ?? '-'}|${o.depth}|${o.winner ?? '-'}`;

// ---------------------------------------------------------------------------
// Saved on the device
// ---------------------------------------------------------------------------
function loadDeep(key: string): Record<string, GameScene[]> {
  try {
    const raw = localStorage.getItem(STORE + key);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

function saveDeep(key: string, deep: Record<string, GameScene[]>) {
  try {
    // strip what only matters while a scene is being spoken
    const clean = Object.fromEntries(Object.entries(deep).map(([id, s]) => [id, s.map(({ spoken: _s, ...x }) => x)]));
    localStorage.setItem(STORE + key, JSON.stringify(clean));
    const idx: string[] = JSON.parse(localStorage.getItem(INDEX) ?? '[]').filter((k: string) => k !== key);
    idx.push(key);
    while (idx.length > MAX_SAVED) { const old = idx.shift(); if (old) localStorage.removeItem(STORE + old); }
    localStorage.setItem(INDEX, JSON.stringify(idx));
  } catch { /* storage full or blocked: the work stays in memory for this visit */ }
}

/** Where the viewer stopped in a game's review, and what was finished at that moment. */
export interface CoachPlace {
  detail: GameDetail;
  side: 'both' | 'w' | 'b';
  /** The beat and the step inside it (steps move when engine checks arrive, the beat does not). */
  beatId: string | null;
  offset: number;
  /** Engine checks that were finished when the viewer left (to tell what got done while away). */
  seenDone: number;
  /** The viewer had started the review (pressed Play) at least once. */
  started: boolean;
  at: number;
}

export function loadPlace(gameId: string): CoachPlace | null {
  try {
    const raw = localStorage.getItem(PLACE + gameId);
    return raw ? JSON.parse(raw) as CoachPlace : null;
  } catch { return null; }
}

export function savePlace(gameId: string, p: CoachPlace) {
  try { localStorage.setItem(PLACE + gameId, JSON.stringify(p)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// The background work
// ---------------------------------------------------------------------------
const snapshot = (e: Entry): ReviewState => ({
  key: e.key, status: e.status, frac: e.frac, beats: e.beats, deep: e.deep, busy: e.busy, total: e.total, done: e.done,
});
const snaps = new Map<string, ReviewState>();
function emit(e: Entry) {
  if (entries.get(e.key) !== e) return; // replaced by a newer analysis of the same game
  snaps.set(e.key, snapshot(e));
  e.listeners.forEach((l) => l());
}

async function run(e: Entry) {
  if (e.running) return;
  e.running = true;
  try {
    if (e.status === 'building') {
      const beats = await prepareGameBeats(e.moves, e.opts, (f) => { e.frac = f; emit(e); }, () => false);
      if (!beats) return;
      e.beats = beats;
      e.status = 'ready';
      // Work saved on an earlier visit only counts for beats that still exist.
      const ids = new Set(beats.map((b) => b.id));
      e.deep = Object.fromEntries(Object.entries(e.deep).filter(([id]) => ids.has(id)));
      const cands = deepCandidates(beats);
      e.total = cands.length;
      e.done = cands.filter((b) => e.deep[b.id]).length;
      emit(e);
    }
    // Engine checks, one beat at a time, the one being watched first. Stops (and resumes later) when another review takes over.
    for (;;) {
      if (active !== e.key || entries.get(e.key) !== e) return;
      const cands = deepCandidates(e.beats).filter((b) => !e.deep[b.id]);
      if (!cands.length) break;
      const at = e.focus ? e.beats.findIndex((b) => b.id === e.focus) : 0;
      const next = cands.find((b) => e.beats.indexOf(b) >= at) ?? cands[0];
      e.busy = next.id;
      emit(e);
      const body = await deepenBeat(next, () => active !== e.key);
      if (active !== e.key) { e.busy = null; emit(e); return; }
      // A failed check keeps the short version, so the loop never retries it forever.
      e.deep = { ...e.deep, [next.id]: body ?? [...next.body] };
      e.done = deepCandidates(e.beats).filter((b) => e.deep[b.id]).length;
      saveDeep(e.key, e.deep);
      emit(e);
    }
    e.busy = null;
    emit(e);
  } catch {
    e.busy = null;
    emit(e);
  } finally {
    e.running = false;
  }
}

/**
 * Starts (or picks up) the review of a game. Safe to call on every render: the work is done once, and it keeps
 * going after the coach leaves the screen.
 */
export function ensureReview(gameId: string, moves: AnalyzedMove[], opts: GameCoachOptions): string {
  const key = reviewKey(gameId, opts);
  let e = entries.get(key);
  if (!e || e.moves !== moves) {
    e = {
      key, status: 'building', frac: 0, beats: [], deep: loadDeep(key), busy: null, total: 0, done: 0,
      moves, opts, focus: e?.focus ?? null, running: false, listeners: e?.listeners ?? new Set(),
    };
    entries.set(key, e);
    snaps.set(key, snapshot(e));
  }
  active = key;
  void run(e);
  return key;
}

export const getReview = (key: string): ReviewState | null => snaps.get(key) ?? null;

export function subscribeReview(key: string, fn: () => void): () => void {
  const e = entries.get(key);
  if (!e) return () => {};
  e.listeners.add(fn);
  return () => { e.listeners.delete(fn); };
}

/** The viewer moved to this beat: check it first. */
export function focusReview(key: string, beatId: string | null) {
  const e = entries.get(key);
  if (e) e.focus = beatId;
}
