import type { EngineEval } from './types';

/**
 * ── Setup (unchanged) ────────────────────────────────────────────────────
 *   npm install stockfish
 *   mkdir -p public/stockfish
 *   cp node_modules/stockfish/stockfish-18-lite-single.js   public/stockfish/
 *   cp node_modules/stockfish/stockfish-18-lite-single.wasm public/stockfish/
 *
 * ── What changed ─────────────────────────────────────────────────────────
 * The old version had ONE worker and a serial queue, so a game was analyzed
 * one position at a time on one CPU core. Positions in a game are
 * independent (all FENs are known from the PGN), so we now run a POOL of
 * single-threaded workers and search different positions at the same time.
 *
 * The single-threaded build is used on purpose: no SharedArrayBuffer, so no
 * COOP/COEP headers needed. At shallow depths (~12), N workers each
 * searching a different position scale far better than N threads all
 * fighting over one position.
 * ────────────────────────────────────────────────────────────────────────
 */
const ENGINE_SCRIPT_PATH = `${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`;
const READY_TIMEOUT_MS = 10_000;
const SEARCH_TIMEOUT_MS = 30_000;
const HASH_MB_PER_WORKER = 16;

// Leave one core for the UI thread; cap at 4 (each worker holds its own WASM
// instance + hash, so more than that costs memory for diminishing returns).
const MAX_WORKERS = Math.max(
  1,
  Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2) - 1),
);

/** Result of a search; `second` is the 2nd-best line (only filled when MultiPV >= 2). White-positive like the rest. */
export interface EngineEvalMulti extends EngineEval {
  second: { evaluation: number | null; mate: number | null } | null;
}

/** One Stockfish WASM instance. Runs one command sequence at a time. */
class EngineWorker {
  dead = false;
  private worker: Worker;
  private ready: Promise<void>;
  // Serializes work on THIS worker (a single instance can only `go` once at a time).
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
    // A failed job must never wedge the queue for the next one.
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

      // UCI scores are from the side to move's perspective; the rest of the
      // app expects White-positive, so flip when Black is to move.
      const sideToMoveSign = fen.split(' ')[1] === 'b' ? -1 : 1;

      const timeout = setTimeout(() => {
        cleanup();
        // A timed-out search leaves the instance mid-`go`; it can't be trusted
        // again, so kill it. The pool spawns a replacement on demand.
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
            // 2nd-best line (only sent when MultiPV >= 2)
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

/**
 * Lazily grows up to MAX_WORKERS. Callers just `await pool.analyze(...)`;
 * work beyond the worker count waits in a FIFO queue. Dead workers (crash /
 * timeout) are dropped and replaced automatically.
 */
class EnginePool {
  private workers: EngineWorker[] = [];
  private idle: EngineWorker[] = [];
  private waiters: Array<(w: EngineWorker) => void> = [];

  private acquire(): Promise<EngineWorker> {
    while (this.idle.length > 0) {
      const w = this.idle.pop()!;
      if (!w.dead) return Promise.resolve(w);
    }
    this.workers = this.workers.filter((w) => !w.dead);
    if (this.workers.length < MAX_WORKERS) {
      const w = new EngineWorker();
      this.workers.push(w);
      return Promise.resolve(w);
    }
    return new Promise<EngineWorker>((resolve) => this.waiters.push(resolve));
  }

  private release(w: EngineWorker) {
    if (w.dead) {
      this.workers = this.workers.filter((x) => x !== w);
      // A slot just opened up — if someone is waiting, spawn a replacement for them.
      const next = this.waiters.shift();
      if (next) {
        try {
          const nw = new EngineWorker();
          this.workers.push(nw);
          next(nw);
        } catch {
          // Can't spawn; leave the waiter's promise pending is worse than
          // failing, so re-queue is not possible here — surface via timeout path.
        }
      }
      return;
    }
    const next = this.waiters.shift();
    if (next) next(w);
    else this.idle.push(w);
  }

  async analyze(fen: string, depth: number, multiPv = 1): Promise<EngineEvalMulti> {
    const w = await this.acquire();
    try {
      return await w.search(fen, depth, multiPv);
    } finally {
      this.release(w);
    }
  }

  async reset(): Promise<void> {
    await Promise.all(this.workers.filter((w) => !w.dead).map((w) => w.newGame()));
  }
}

const pool = new EnginePool();

/** Single position. */
export function analyzePosition(fen: string, depth: number): Promise<EngineEval> {
  return pool.analyze(fen, depth);
}

/**
 * Analyze many positions at once: all FENs are queued and the worker pool
 * searches several in parallel.
 *
 * Returns results in the SAME ORDER as `fens`; a position that failed comes
 * back as `null`. `onProgress(done, total)` fires as each position finishes.
 */
export function analyzePositions(
  fens: string[],
  depth: number,
  onProgress?: (done: number, total: number) => void,
): Promise<(EngineEval | null)[]> {
  return runBatch(fens, depth, 1, onProgress);
}

/**
 * Same as analyzePositions but searches the top 2 lines, so `result.second`
 * holds the 2nd-best move's eval. Used to spot "only moves" (great moves).
 */
export function analyzeSecondBest(
  fens: string[],
  depth: number,
  onProgress?: (done: number, total: number) => void,
): Promise<(EngineEvalMulti | null)[]> {
  return runBatch(fens, depth, 2, onProgress);
}

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

  await Promise.all(
    fens.map((fen, i) =>
      pool
        .analyze(fen, depth, multiPv)
        .then((r) => {
          results[i] = r;
        })
        .catch(() => {
          results[i] = null;
        })
        .then(tick),
    ),
  );
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