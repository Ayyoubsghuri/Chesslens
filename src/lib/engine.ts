import { Chess } from 'chess.js';
import type { EngineEval } from './types';

/**
 * ── Setup (unchanged) ────────────────────────────────────────────────────
 *   npm install stockfish
 *   mkdir -p public/stockfish
 *   cp node_modules/stockfish/stockfish-18-lite-single.js   public/stockfish/
 *   cp node_modules/stockfish/stockfish-18-lite-single.wasm public/stockfish/
 *
 * ── Speed-ups in this version ────────────────────────────────────────────
 *  1. Worker cap raised from 4 to 8 (still hardwareConcurrency - 1).
 *  2. Terminal positions (mate / stalemate / dead draw) are evaluated
 *     without the engine. This also fixes the last move of a mated game
 *     falling back to 'good' (Stockfish returns `bestmove (none)` there).
 *  3. Result cache keyed by position + depth. A MultiPV-2 result also
 *     serves MultiPV-1 requests. Concurrent identical requests share one
 *     search.
 *  4. Batches are split into small contiguous chunks of plies. Each worker
 *     is PINNED to a chunk, so consecutive plies reuse that worker's hash
 *     table. Workers pull the next chunk when done, so there is no
 *     straggler at the end.
 * ────────────────────────────────────────────────────────────────────────
 */
const ENGINE_SCRIPT_PATH = `${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`;
const READY_TIMEOUT_MS = 10_000;
const SEARCH_TIMEOUT_MS = 30_000;
const HASH_MB_PER_WORKER = 16;
const CHUNK_SIZE = 6; // contiguous plies per work unit
const CACHE_LIMIT = 5_000;

const MAX_WORKERS = Math.max(
  1,
  Math.min(8, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2) - 1),
);

/** Result of a search; `second` is the 2nd-best line (only filled when MultiPV >= 2). White-positive like the rest. */
export interface EngineEvalMulti extends EngineEval {
  second: { evaluation: number | null; mate: number | null } | null;
}

/* ───────────────────────── Terminal positions + cache ───────────────────── */

function terminalEval(fen: string, depth: number): EngineEvalMulti | null {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return null;
  }
  let evaluation: number;
  if (c.isCheckmate()) evaluation = c.turn() === 'w' ? -100 : 100; // White-positive
  else if (c.isStalemate() || c.isInsufficientMaterial()) evaluation = 0;
  else return null;
  return { fen, bestMove: null, continuation: '', evaluation, mate: null, depth, success: true, second: null };
}

const evalCache = new Map<string, EngineEvalMulti>();
const inflight = new Map<string, Promise<EngineEvalMulti>>();

// Ignore halfmove/fullmove counters so transpositions hit the cache.
const posKey = (fen: string, depth: number, mpv: number) =>
  `${fen.split(' ').slice(0, 4).join(' ')}|${depth}|${mpv}`;

function cacheGet(fen: string, depth: number, mpv: number): EngineEvalMulti | null {
  const hit = evalCache.get(posKey(fen, depth, mpv)) ?? (mpv === 1 ? evalCache.get(posKey(fen, depth, 2)) : undefined);
  return hit ? { ...hit, fen } : null;
}

function cachePut(fen: string, depth: number, mpv: number, r: EngineEvalMulti) {
  if (!r.success) return;
  if (evalCache.size >= CACHE_LIMIT) {
    const oldest = evalCache.keys().next().value;
    if (oldest !== undefined) evalCache.delete(oldest);
  }
  evalCache.set(posKey(fen, depth, mpv), r);
}

/* ───────────────────────────── Engine worker ────────────────────────────── */

/** One Stockfish WASM instance. Runs one command sequence at a time. */
class EngineWorker {
  dead = false;
  private worker: Worker;
  private ready: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();

  constructor() {
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are not available in this environment.');
    }
    this.worker = new Worker(ENGINE_SCRIPT_PATH);
    this.ready = this.handshake();
    this.ready.catch(() => this.kill());
  }

  kill() {
    this.dead = true;
    this.worker.terminate();
  }

  private handshake(): Promise<void> {
    const worker = this.worker;
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Stockfish did not respond within ${READY_TIMEOUT_MS}ms. Check that ${ENGINE_SCRIPT_PATH} exists in your public/ folder.`,
          ),
        );
      }, READY_TIMEOUT_MS);

      const onMessage = (e: MessageEvent) => {
        const line = String(e.data);
        if (line === 'uciok') {
          worker.postMessage(`setoption name Hash value ${HASH_MB_PER_WORKER}`);
          worker.postMessage('isready');
        } else if (line === 'readyok') {
          cleanup();
          resolve();
        }
      };
      const onError = (e: ErrorEvent) => {
        cleanup();
        reject(new Error(`Failed to load Stockfish worker at ${ENGINE_SCRIPT_PATH}: ${e.message || 'unknown error'}`));
      };
      function cleanup() {
        clearTimeout(timeout);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      }

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage('uci');
    });
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Clear this worker's hash table (fresh state for a new game). */
  newGame(): Promise<void> {
    return this.enqueue(async () => {
      await this.ready;
      const worker = this.worker;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Engine reset timed out'));
        }, READY_TIMEOUT_MS);
        const onMessage = (e: MessageEvent) => {
          if (String(e.data) === 'readyok') {
            cleanup();
            resolve();
          }
        };
        function cleanup() {
          clearTimeout(timeout);
          worker.removeEventListener('message', onMessage);
        }
        worker.addEventListener('message', onMessage);
        worker.postMessage('ucinewgame');
        worker.postMessage('isready');
      });
    });
  }

  search(fen: string, depth: number, multiPv = 1): Promise<EngineEvalMulti> {
    return this.enqueue(async () => {
      await this.ready;
      return this.runSearch(fen, depth, multiPv);
    });
  }

  private runSearch(fen: string, depth: number, multiPv: number): Promise<EngineEvalMulti> {
    const worker = this.worker;

    return new Promise<EngineEvalMulti>((resolve, reject) => {
      let continuation = '';
      let evaluation: number | null = null;
      let mate: number | null = null;
      let second: { evaluation: number | null; mate: number | null } | null = null;
      let reachedDepth = depth;

      const sideToMoveSign = fen.split(' ')[1] === 'b' ? -1 : 1;

      const timeout = setTimeout(() => {
        cleanup();
        this.kill();
        reject(new Error(`Engine analysis timed out after ${SEARCH_TIMEOUT_MS}ms`));
      }, SEARCH_TIMEOUT_MS);

      const onError = (e: ErrorEvent) => {
        cleanup();
        this.kill();
        reject(new Error(`Stockfish worker crashed: ${e.message || 'unknown error'}`));
      };

      const onMessage = (e: MessageEvent) => {
        const line = String(e.data);

        if (line.startsWith('info')) {
          const depthMatch = line.match(/\bdepth (\d+)/);
          if (depthMatch) reachedDepth = Number(depthMatch[1]);

          const mpvMatch = line.match(/\bmultipv (\d+)/);
          const pvIdx = mpvMatch ? Number(mpvMatch[1]) : 1;

          const mateMatch = line.match(/score mate (-?\d+)/);
          const cpMatch = line.match(/score cp (-?\d+)/);

          if (pvIdx === 1) {
            if (mateMatch) {
              mate = Number(mateMatch[1]) * sideToMoveSign;
              evaluation = null;
            } else if (cpMatch) {
              evaluation = (Number(cpMatch[1]) / 100) * sideToMoveSign;
              mate = null;
            }

            const pvMatch = line.match(/\bpv (.+)$/);
            if (pvMatch) continuation = pvMatch[1].trim();
          } else if (pvIdx === 2 && !/\b(lowerbound|upperbound)\b/.test(line)) {
            if (mateMatch) {
              second = { evaluation: null, mate: Number(mateMatch[1]) * sideToMoveSign };
            } else if (cpMatch) {
              second = { evaluation: (Number(cpMatch[1]) / 100) * sideToMoveSign, mate: null };
            }
          }
        } else if (line.startsWith('bestmove')) {
          const parts = line.split(/\s+/);
          const bestMove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
          cleanup();
          resolve({
            fen,
            bestMove,
            continuation,
            evaluation,
            mate,
            depth: reachedDepth,
            success: bestMove !== null,
            second,
          });
        }
      };

      function cleanup() {
        clearTimeout(timeout);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      }

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      // Always set MultiPV: workers are reused, so a previous 2-line search must not leak.
      worker.postMessage(`setoption name MultiPV value ${multiPv}`);
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth}`);
    });
  }
}

/* ─────────────────────────────── Worker pool ────────────────────────────── */

interface Waiter {
  resolve: (w: EngineWorker) => void;
  reject: (e: unknown) => void;
}

class EnginePool {
  private workers: EngineWorker[] = [];
  private idle: EngineWorker[] = [];
  private waiters: Waiter[] = [];

  acquire(): Promise<EngineWorker> {
    while (this.idle.length > 0) {
      const w = this.idle.pop()!;
      if (!w.dead) return Promise.resolve(w);
    }
    this.workers = this.workers.filter((w) => !w.dead);
    if (this.workers.length < MAX_WORKERS) {
      try {
        const w = new EngineWorker();
        this.workers.push(w);
        return Promise.resolve(w);
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return new Promise<EngineWorker>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  release(w: EngineWorker) {
    if (w.dead) {
      this.workers = this.workers.filter((x) => x !== w);
      // A slot opened up; spawn a replacement for the next waiter.
      const next = this.waiters.shift();
      if (next) {
        try {
          const nw = new EngineWorker();
          this.workers.push(nw);
          next.resolve(nw);
        } catch (e) {
          next.reject(e);
        }
      }
      return;
    }
    const next = this.waiters.shift();
    if (next) next.resolve(w);
    else this.idle.push(w);
  }

  /** Single position: terminal check, cache, de-duplicated in-flight search. */
  async analyze(fen: string, depth: number, multiPv = 1): Promise<EngineEvalMulti> {
    const t = terminalEval(fen, depth);
    if (t) return t;

    const hit = cacheGet(fen, depth, multiPv);
    if (hit) return hit;

    const key = posKey(fen, depth, multiPv);
    const pending = inflight.get(key);
    if (pending) return { ...(await pending), fen };

    const job = (async () => {
      const w = await this.acquire();
      try {
        const r = await w.search(fen, depth, multiPv);
        cachePut(fen, depth, multiPv, r);
        return r;
      } finally {
        this.release(w);
      }
    })();
    inflight.set(key, job);
    try {
      return await job;
    } finally {
      inflight.delete(key);
    }
  }

  /**
   * Run `fens[start..end)` back-to-back on ONE worker so its hash table
   * carries over between neighbouring plies. Writes into `results`.
   */
  async analyzeRun(
    fens: string[],
    start: number,
    end: number,
    depth: number,
    multiPv: number,
    results: (EngineEvalMulti | null)[],
    tick: () => void,
    worker: EngineWorker,
  ): Promise<EngineWorker> {
    let w = worker;
    for (let i = start; i < end; i++) {
      const fen = fens[i];
      const quick = terminalEval(fen, depth) ?? cacheGet(fen, depth, multiPv);
      if (quick) {
        results[i] = quick;
        tick();
        continue;
      }
      try {
        if (w.dead) {
          this.release(w);
          w = await this.acquire();
        }
        const r = await w.search(fen, depth, multiPv);
        cachePut(fen, depth, multiPv, r);
        results[i] = r;
      } catch {
        results[i] = null;
      }
      tick();
    }
    return w;
  }

  async reset(): Promise<void> {
    await Promise.all(this.workers.filter((w) => !w.dead).map((w) => w.newGame()));
  }
}

const pool = new EnginePool();

/* ───────────────────────────────── Public API ───────────────────────────── */

/** Single position. */
export function analyzePosition(fen: string, depth: number): Promise<EngineEval> {
  return pool.analyze(fen, depth);
}

/**
 * Analyze many positions at once. Returns results in the SAME ORDER as
 * `fens`; a position that failed comes back as `null`.
 * `onProgress(done, total)` fires as each position finishes.
 */
export function analyzePositions(
  fens: string[],
  depth: number,
  onProgress?: (done: number, total: number) => void,
): Promise<(EngineEval | null)[]> {
  return runBatch(fens, depth, 1, onProgress);
}

/** Same as analyzePositions but searches the top 2 lines (`result.second`). */
export function analyzeSecondBest(
  fens: string[],
  depth: number,
  onProgress?: (done: number, total: number) => void,
): Promise<(EngineEvalMulti | null)[]> {
  return runBatch(fens, depth, 2, onProgress);
}

/**
 * Splits the list into small contiguous chunks. Each runner owns one worker
 * and keeps pulling the next unclaimed chunk, so neighbouring plies share a
 * hash table and no worker sits idle while another finishes a big block.
 *
 * Note: only valid for lists that are ordered game positions. Non-adjacent
 * lists (e.g. only-move candidates) still work, they just see less reuse.
 */
async function runBatch(
  fens: string[],
  depth: number,
  multiPv: number,
  onProgress?: (done: number, total: number) => void,
): Promise<(EngineEvalMulti | null)[]> {
  const total = fens.length;
  const results: (EngineEvalMulti | null)[] = new Array(total).fill(null);
  let done = 0;
  const tick = () => onProgress?.(++done, total);

  const chunkCount = Math.ceil(total / CHUNK_SIZE);
  let nextChunk = 0;
  const runners = Math.min(MAX_WORKERS, chunkCount);

  await Promise.all(
    Array.from({ length: runners }, async () => {
      let w: EngineWorker;
      try {
        w = await pool.acquire();
      } catch {
        return; // can't spawn a worker; leftover chunks go to other runners
      }
      try {
        while (nextChunk < chunkCount) {
          const c = nextChunk++;
          const start = c * CHUNK_SIZE;
          const end = Math.min(total, start + CHUNK_SIZE);
          w = await pool.analyzeRun(fens, start, end, depth, multiPv, results, tick, w);
        }
      } finally {
        pool.release(w);
      }
    }),
  );

  // If every runner failed to start, report the remainder as done so progress completes.
  while (done < total) tick();
  return results;
}

/** Clear every worker's hash table (fresh state for a new game). */
export function resetEngine(): Promise<void> {
  return pool.reset();
}

export function evalToPawns(ev: EngineEval): number {
  if (ev.mate !== null) {
    return ev.mate > 0 ? 100 : -100;
  }
  return ev.evaluation ?? 0;
}

/**
 * White's win probability (0–100). `ev.evaluation` is in PAWNS, but the
 * Lichess/chess.com constant is calibrated for CENTIPAWNS, so convert first.
 */
export function evalToWinChance(ev: EngineEval): number {
  if (ev.mate !== null) {
    return ev.mate > 0 ? 100 : 0;
  }
  const cp = (ev.evaluation ?? 0) * 100;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function formatEval(ev: EngineEval): string {
  if (ev.mate !== null) {
    return `M${Math.abs(ev.mate)}`;
  }
  if (ev.evaluation === null) return '—';
  const v = ev.evaluation;
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}