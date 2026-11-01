/**
 * maia-elo.ts — "Game Rating" from how human the moves look at each rating.
 *
 * Idea (as in github.com/NoRaincheck/chess-accuracy, estimate_elo.py): Maia 3 is a neural network trained on
 * millions of human games. Given a position and a player's rating, it predicts which move a human of that rating
 * would play. For every candidate pair of ratings (White, Black) we add up the log-probability Maia gives to
 * the moves that were ACTUALLY played. The ratings that explain the game best, combined with a population prior,
 * are the game ratings. This is the same kind of question Chess.com's "Game Rating" answers: what rating plays
 * like this?
 *
 *   Stage A  6x6 joint grid over 300-3000 (step 550) -> smooth surface, interpolated -> modes per colour
 *   Stage B  7x7 joint grid, ±300 around the modes (step 100), re-centred once if the mode is on the edge
 *   Result   parabola-refined mode of each colour's marginal posterior, ± its standard deviation
 *
 * Positions: the first 8 plies (book) and positions with a single legal move are skipped; at most 80 positions,
 * evenly spaced. Model: maia3-5m.onnx (input tokens [B,64,96], self_elos [B], oppo_elos [B]; output logits_move [B,4352]).
 *
 * Inference is pluggable (`Runner`), so this file runs in the browser (onnxruntime-web) and in tests (onnxruntime-node).
 */
import { Chess } from 'chess.js';

export type Runner = (tokens: Float32Array, selfElos: Float32Array, oppoElos: Float32Array, batch: number) => Promise<Float32Array>;

export interface MaiaPosition { fen: string; uci: string }
export interface MaiaEstimate {
  white: number; black: number;
  whiteStd: number; blackStd: number;
  positions: number;
}

export const MIN_ELO = 300;
export const MAX_ELO = 3000;
const ANCHOR_STEP = 550, DENSE_STEP = 50, FINE_MARGIN = 300, FINE_STEP = 100;
const MAX_POSITIONS = 80, SKIP_OPENING = 8;
const VOCAB = 4352, FRAME = 12, HISTORY = 8, D_IN = FRAME * HISTORY, SEQ = 64 * D_IN;
/** Inference batch size: keeps memory around 25 MB per call on phones. */
const CHUNK = 256;

// ---------------------------------------------------------------------------
// Encoding (must match the model's training format)
// ---------------------------------------------------------------------------
const PIECE: Record<string, number> = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };

/** One position as 64 squares x 12 channels, always from the side to move's point of view (mirrored for Black). */
function tokenize(fen: string): Float32Array {
  const out = new Float32Array(64 * FRAME);
  const [placement, turn] = fen.split(' ');
  const black = turn === 'b';
  let sq = 0;
  for (const ch of placement) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') { sq += Number(ch); continue; }
    const rank = 7 - Math.floor(sq / 8), file = sq % 8;
    const target = black ? (7 - rank) * 8 + file : rank * 8 + file;
    const isWhitePiece = ch === ch.toUpperCase();
    // Own pieces in channels 0-5, opponent's in 6-11.
    const offset = (isWhitePiece !== black) ? 0 : 6;
    out[target * FRAME + offset + PIECE[ch.toLowerCase()]] = 1;
    sq++;
  }
  return out;
}

/** Last 8 positions (oldest first, the oldest repeated as padding) as 64 x 96. */
function historyTokens(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(SEQ);
  const pad = HISTORY - frames.length;
  for (let s = 0; s < 64; s++) for (let h = 0; h < HISTORY; h++) {
    const src = frames[Math.max(0, h - pad)];
    for (let c = 0; c < FRAME; c++) out[s * D_IN + h * FRAME + c] = src[s * FRAME + c];
  }
  return out;
}

const mirrorSq = (s: string) => s[0] + String(9 - Number(s[1]));
/** Index of a move in Maia's 4352-move vocabulary (moves of Black are mirrored first). */
export function moveIndex(uci: string, blackToMove: boolean): number {
  const u = blackToMove ? mirrorSq(uci.slice(0, 2)) + mirrorSq(uci.slice(2, 4)) + uci.slice(4) : uci;
  const f = (c: string) => c.charCodeAt(0) - 97;
  if (u.length > 4) return 4096 + f(u[0]) * 32 + f(u[2]) * 4 + { q: 0, r: 1, b: 2, n: 3 }[u[4] as 'q']!;
  const from = f(u[0]) + (Number(u[1]) - 1) * 8, to = f(u[2]) + (Number(u[3]) - 1) * 8;
  return from * 64 + to;
}

interface Prepared { tokens: Float32Array; human: number; legal: Int32Array; white: boolean }

/** Informative positions of the game, encoded once. */
export function preparePositions(game: MaiaPosition[]): Prepared[] {
  const frames: Float32Array[] = [];
  const cands: Prepared[] = [];
  game.forEach((p, i) => {
    frames.push(tokenize(p.fen));
    if (frames.length > HISTORY) frames.shift();
    if (i < SKIP_OPENING) return;
    let legal: string[];
    try { legal = new Chess(p.fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? '')); } catch { return; }
    if (legal.length < 2) return;
    const black = p.fen.split(' ')[1] === 'b';
    cands.push({ tokens: historyTokens(frames), human: moveIndex(p.uci, black), legal: Int32Array.from(legal.map((u) => moveIndex(u, black))), white: !black });
  });
  if (cands.length <= MAX_POSITIONS) return cands;
  // Even spacing, deterministic.
  const keep = new Set<number>();
  for (let k = 0; k < MAX_POSITIONS; k++) keep.add(Math.floor((k * (cands.length - 1)) / (MAX_POSITIONS - 1)));
  return [...keep].sort((a, b) => a - b).map((i) => cands[i]);
}

// ---------------------------------------------------------------------------
// Log-likelihood surface over a (white, black) rating grid
// ---------------------------------------------------------------------------
async function surface(pos: Prepared[], wGrid: number[], bGrid: number[], run: Runner, onStep?: () => void): Promise<Float64Array> {
  const nW = wGrid.length, nB = bGrid.length;
  const out = new Float64Array(nW * nB);
  const jobs: { p: number; cell: number; self: number; oppo: number }[] = [];
  pos.forEach((p, pi) => {
    for (let i = 0; i < nW; i++) for (let j = 0; j < nB; j++) {
      jobs.push({ p: pi, cell: i * nB + j, self: p.white ? wGrid[i] : bGrid[j], oppo: p.white ? bGrid[j] : wGrid[i] });
    }
  });
  for (let start = 0; start < jobs.length; start += CHUNK) {
    const part = jobs.slice(start, start + CHUNK);
    const tokens = new Float32Array(part.length * SEQ);
    const self = new Float32Array(part.length), oppo = new Float32Array(part.length);
    part.forEach((j, k) => { tokens.set(pos[j.p].tokens, k * SEQ); self[k] = j.self; oppo[k] = j.oppo; });
    const logits = await run(tokens, self, oppo, part.length);
    part.forEach((j, k) => {
      const base = k * VOCAB;
      const legal = pos[j.p].legal;
      let max = -Infinity;
      for (const m of legal) max = Math.max(max, logits[base + m]);
      let z = 0;
      for (const m of legal) z += Math.exp(logits[base + m] - max);
      out[j.cell] += logits[base + pos[j.p].human] - max - Math.log(z);
    });
    onStep?.();
    await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  return out;
}

const makeGrid = (lo: number, hi: number, step: number) => {
  const n = Math.ceil((hi - lo) / step - 1e-9);
  return Array.from({ length: n + 1 }, (_, k) => Math.min(hi, lo + k * step));
};

function bilinear(src: Float64Array, grid: number[], dense: number[]): Float64Array {
  const n = grid.length, m = dense.length;
  const out = new Float64Array(m * m);
  const locate = (v: number) => {
    let i = 0;
    while (i < n - 2 && grid[i + 1] < v) i++;
    return { i, t: (v - grid[i]) / (grid[i + 1] - grid[i]) };
  };
  for (let a = 0; a < m; a++) {
    const x = locate(dense[a]);
    for (let b = 0; b < m; b++) {
      const y = locate(dense[b]);
      const v = (i: number, j: number) => src[i * n + j];
      out[a * m + b] = v(x.i, y.i) * (1 - x.t) * (1 - y.t) + v(x.i, y.i + 1) * (1 - x.t) * y.t
        + v(x.i + 1, y.i) * x.t * (1 - y.t) + v(x.i + 1, y.i + 1) * x.t * y.t;
    }
  }
  return out;
}

const logPrior = (e: number, mean: number, std: number) => -0.5 * ((e - mean) / std) ** 2;

/** Marginal log-posteriors (log-sum-exp over the other colour). */
function marginals(s: Float64Array, wG: number[], bG: number[], prior: { w: number; b: number; std: number }) {
  const nW = wG.length, nB = bG.length;
  const lp = new Float64Array(nW * nB);
  for (let i = 0; i < nW; i++) for (let j = 0; j < nB; j++) lp[i * nB + j] = s[i * nB + j] + logPrior(wG[i], prior.w, prior.std) + logPrior(bG[j], prior.b, prior.std);
  const lse = (xs: number[]) => { const m = Math.max(...xs); return m + Math.log(xs.reduce((a, x) => a + Math.exp(x - m), 0)); };
  const w = wG.map((_, i) => lse(bG.map((__, j) => lp[i * nB + j])));
  const b = bG.map((_, j) => lse(wG.map((__, i) => lp[i * nB + j])));
  return { w, b };
}

const argmax = (xs: number[]) => xs.reduce((bi, x, i) => (x > xs[bi] ? i : bi), 0);

function vertex(values: number[], logc: number[]): number {
  const k = argmax(logc);
  if (k > 0 && k < values.length - 1) {
    const [y0, y1, y2] = [logc[k - 1], logc[k], logc[k + 1]];
    const d = y0 - 2 * y1 + y2;
    if (d < 0) return values[k] + 0.5 * ((y0 - y2) / d) * (values[1] - values[0]);
  }
  return values[k];
}

function stdOf(values: number[], logc: number[]): number {
  const m = Math.max(...logc);
  const p = logc.map((x) => Math.exp(x - m));
  const t = p.reduce((a, x) => a + x, 0);
  const mean = values.reduce((a, v, i) => a + v * p[i], 0) / t;
  return Math.sqrt(values.reduce((a, v, i) => a + (v - mean) ** 2 * p[i], 0) / t);
}

/**
 * Estimate both players' ratings for one game.
 * `prior` defaults to the population prior of the reference implementation (1500 ± 350).
 */
export async function estimateGameRatings(
  game: MaiaPosition[], run: Runner,
  opts: { prior?: { w: number; b: number; std: number }; onProgress?: (fraction: number, label: string) => void } = {},
): Promise<MaiaEstimate | null> {
  const prior = opts.prior ?? { w: 1500, b: 1500, std: 350 };
  const pos = preparePositions(game);
  if (!pos.length) return null;
  const anchors = makeGrid(MIN_ELO, MAX_ELO, ANCHOR_STEP);
  // Rough number of model calls, for the progress bar (stage A + one stage B).
  const totalChunks = Math.ceil((pos.length * anchors.length ** 2) / CHUNK) + Math.ceil((pos.length * 49) / CHUNK);
  let done = 0;
  const step = (label: string) => () => { done++; opts.onProgress?.(Math.min(0.99, done / totalChunks), label); };

  const sA = await surface(pos, anchors, anchors, run, step('Scanning all ratings'));
  const dense = makeGrid(MIN_ELO, MAX_ELO, DENSE_STEP);
  const mA = marginals(bilinear(sA, anchors, dense), dense, dense, prior);
  let wMode = dense[argmax(mA.w)], bMode = dense[argmax(mA.b)];

  let wG: number[] = [], bG: number[] = [], mB = { w: [] as number[], b: [] as number[] };
  for (let attempt = 0; attempt < 2; attempt++) {
    wG = makeGrid(Math.max(MIN_ELO, wMode - FINE_MARGIN), Math.min(MAX_ELO, wMode + FINE_MARGIN), FINE_STEP);
    bG = makeGrid(Math.max(MIN_ELO, bMode - FINE_MARGIN), Math.min(MAX_ELO, bMode + FINE_MARGIN), FINE_STEP);
    const sB = await surface(pos, wG, bG, run, step('Refining'));
    mB = marginals(sB, wG, bG, prior);
    const wi = argmax(mB.w), bi = argmax(mB.b);
    const edge = wi === 0 || wi === wG.length - 1 || bi === 0 || bi === bG.length - 1;
    if (attempt === 0 && edge && !(wG[wi] === MIN_ELO || wG[wi] === MAX_ELO || bG[bi] === MIN_ELO || bG[bi] === MAX_ELO)) {
      wMode = wG[wi]; bMode = bG[bi];
      continue;
    }
    break;
  }
  opts.onProgress?.(1, 'Done');
  return {
    white: Math.round(vertex(wG, mB.w)), black: Math.round(vertex(bG, mB.b)),
    whiteStd: Math.round(stdOf(wG, mB.w)), blackStd: Math.round(stdOf(bG, mB.b)),
    positions: pos.length,
  };
}

// ---------------------------------------------------------------------------
// Browser runner: onnxruntime-web from the CDN, model from public/models/
// ---------------------------------------------------------------------------
const ORT_VERSION = '1.17.0';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
let sessionP: Promise<any> | null = null;

function loadOrt(): Promise<any> {
  const w = window as any;
  if (w.ort) return Promise.resolve(w.ort);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${ORT_BASE}ort.min.js`;
    s.onload = () => (w.ort ? resolve(w.ort) : reject(new Error('ONNX Runtime did not start')));
    s.onerror = () => reject(new Error('Could not load ONNX Runtime (check your connection)'));
    document.head.appendChild(s);
  });
}

/** Path of the model file (copy maia3-5m.onnx into public/models/). */
export const MAIA_MODEL_URL = `${import.meta.env.BASE_URL}models/maia3-5m.onnx`;

export function browserRunner(): Runner {
  if (!sessionP) {
    sessionP = (async () => {
      const ort = await loadOrt();
      ort.env.wasm.numThreads = 1; // no SharedArrayBuffer / COOP-COEP needed
      ort.env.wasm.wasmPaths = ORT_BASE;
      const res = await fetch(MAIA_MODEL_URL);
      if (!res.ok) throw new Error('Maia model not found: copy maia3-5m.onnx into public/models/');
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { ort, session: await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }) };
    })();
    sessionP.catch(() => { sessionP = null; });
  }
  return async (tokens, self, oppo, batch) => {
    const { ort, session } = await sessionP!;
    const out = await session.run({
      tokens: new ort.Tensor('float32', tokens, [batch, 64, D_IN]),
      self_elos: new ort.Tensor('float32', self, [batch]),
      oppo_elos: new ort.Tensor('float32', oppo, [batch]),
    });
    return out.logits_move.data as Float32Array;
  };
}
