/**
 * accuracy-model.ts — a Chess.com-style (CAPS2-like) accuracy, reverse-engineered from real Chess.com reviews.
 *
 * What the Chess.com numbers show (fitted on reviewed games where we know Chess.com's labels and accuracy):
 *  - Small losses already cost a lot. An "excellent" move (0-2% win chance lost) scores about 83, a "good" one
 *    (2-5%) about 70, an inaccuracy (5-10%) about 58. Lichess's curve is far more lenient there.
 *  - Big losses cost LESS than in Lichess: a blunder (20%+) still scores ~20, never 0.
 *  - The game score is mostly a harmonic mean (mix 0.1 arithmetic + 0.9 harmonic), no volatility weights.
 *
 *     per-move accuracy = 100 * e^(-k * (scale * winLoss)^p)
 *     game accuracy      = mix * arithmeticMean + (1 - mix) * harmonicMean
 *
 * Defaults: k = 0.18, p = 0.6, mix = 0.1 (Chess.com's move bands, 4 reviewed players, within ~1-3 points).
 * `scale` corrects for the browser engine seeing losses differently from Chess.com's deeper engine.
 *
 * SELF-CALIBRATION: every time the app learns Chess.com's real accuracy for a game it has analyzed (from the
 * Chess.com API, or typed in by the player), it stores that game's per-move losses and the real numbers.
 * The model is then re-fitted on those games, so the estimate keeps getting closer for this player.
 */
import type { AnalyzedMove, PieceColor } from './types';
import { evalToWinChance } from './engine';

export interface AccuracyModel { k: number; p: number; mix: number; scale: number; samples: number }
export const DEFAULT_MODEL: AccuracyModel = { k: 0.18, p: 0.6, mix: 0.1, scale: 1, samples: 0 };

const MODEL_KEY = 'chesslens.accuracyModel.v1';
const SAMPLES_KEY = 'chesslens.accuracySamples.v1';
const MAX_SAMPLES = 60;

/** One game where Chess.com's accuracy is known: the per-move win% losses (null = book move) and the real numbers. */
export interface Sample { id: string; w: (number | null)[]; b: (number | null)[]; target: { white: number; black: number } }

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------
export const moveAccuracy = (loss: number, m: AccuracyModel) =>
  loss <= 0 ? 100 : Math.max(1, 100 * Math.exp(-m.k * Math.pow(m.scale * loss, m.p)));

function aggregate(losses: (number | null)[], m: AccuracyModel): number {
  const vals = losses.map((l) => (l == null ? 100 : moveAccuracy(l, m)));
  if (!vals.length) return 0;
  const arith = vals.reduce((a, v) => a + v, 0) / vals.length;
  const harm = vals.length / vals.reduce((a, v) => a + 1 / v, 0);
  return m.mix * arith + (1 - m.mix) * harm;
}

/** Win% (0-100) lost by each player's moves, from the stored evaluations. Book moves are null. */
export function moveLosses(moves: AnalyzedMove[]): Record<PieceColor, (number | null)[]> {
  const out: Record<PieceColor, (number | null)[]> = { w: [], b: [] };
  let prev = moves[0]?.evalBefore ? evalToWinChance(moves[0].evalBefore) : 50;
  for (const m of moves) {
    const after = m.evalAfter ? evalToWinChance(m.evalAfter) : prev;
    const before = m.evalBefore ? evalToWinChance(m.evalBefore) : prev;
    const loss = m.color === 'w' ? before - after : after - before;
    out[m.color].push(m.quality === 'book' ? null : Math.max(0, loss));
    prev = after;
  }
  return out;
}

export function accuracyFromLosses(l: Record<PieceColor, (number | null)[]>, m: AccuracyModel = loadModel()) {
  const r = (x: number) => Math.round(x * 10) / 10;
  return { white: r(aggregate(l.w, m)), black: r(aggregate(l.b, m)) };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
export function loadModel(): AccuracyModel {
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    if (raw) { const m = JSON.parse(raw); if (typeof m.k === 'number') return { ...DEFAULT_MODEL, ...m }; }
  } catch { /* use the default */ }
  return DEFAULT_MODEL;
}

export function loadSamples(): Sample[] {
  try { return JSON.parse(localStorage.getItem(SAMPLES_KEY) ?? '[]') as Sample[]; } catch { return []; }
}

/**
 * Teach the model one game: its moves (as analyzed here) and Chess.com's real accuracy.
 * Re-fits the model and returns it.
 */
export function addSample(id: string, moves: AnalyzedMove[], target: { white: number; black: number }): AccuracyModel {
  if (!moves.length || !(target.white > 0) || !(target.black > 0)) return loadModel();
  const l = moveLosses(moves);
  const samples = [{ id, w: l.w, b: l.b, target }, ...loadSamples().filter((s) => s.id !== id)].slice(0, MAX_SAMPLES);
  try { localStorage.setItem(SAMPLES_KEY, JSON.stringify(samples)); } catch { /* full: keep the model as it is */ }
  const m = fitModel(samples);
  try { localStorage.setItem(MODEL_KEY, JSON.stringify(m)); } catch { /* ignore */ }
  return m;
}

export function resetCalibration() {
  try { localStorage.removeItem(SAMPLES_KEY); localStorage.removeItem(MODEL_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Fitting (small grid search: quick, and it cannot run away with few games)
// ---------------------------------------------------------------------------
function error(samples: Sample[], m: AccuracyModel): number {
  let e = 0;
  for (const s of samples) {
    e += (aggregate(s.w, m) - s.target.white) ** 2 + (aggregate(s.b, m) - s.target.black) ** 2;
  }
  // Gentle pull toward the defaults, so 1-2 games cannot bend the model into something silly.
  const prior = 2 * ((m.k - DEFAULT_MODEL.k) / 0.06) ** 2 + 2 * ((m.p - DEFAULT_MODEL.p) / 0.15) ** 2 + 2 * ((m.mix - DEFAULT_MODEL.mix) / 0.3) ** 2 + 2 * (Math.log(m.scale) / 0.5) ** 2;
  return e + prior;
}

export function fitModel(samples: Sample[]): AccuracyModel {
  if (!samples.length) return DEFAULT_MODEL;
  let best: AccuracyModel = { ...DEFAULT_MODEL, samples: samples.length };
  let bestErr = error(samples, best);
  const ks = [0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.22, 0.25, 0.28, 0.32];
  const ps = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const mixes = [0, 0.1, 0.25, 0.5];
  const scales = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];
  // With only a few games, fit the scale (and the curve's steepness) only; the shape needs more data.
  const many = samples.length >= 5;
  for (const k of ks) for (const p of many ? ps : [DEFAULT_MODEL.p]) for (const mix of many ? mixes : [DEFAULT_MODEL.mix]) for (const scale of scales) {
    const m = { k, p, mix, scale, samples: samples.length };
    const e = error(samples, m);
    if (e < bestErr) { bestErr = e; best = m; }
  }
  return best;
}
