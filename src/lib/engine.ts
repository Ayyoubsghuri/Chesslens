import type { EngineEval } from './types';

/**
 * ── One-time setup ──────────────────────────────────────────────────────
 * This used to call https://stockfish.online/api — which has no CORS
 * headers for arbitrary browser origins and rate-limits aggressively (429s).
 * Instead we run Stockfish locally, in-browser, inside a Web Worker.
 *
 * 1. npm install stockfish
 *
 * 2. Copy the engine files into your `public/` folder so they're served as
 *    plain static assets. Web Worker + WASM loading is finicky across
 *    bundlers (Vite tries to fingerprint/bundle worker scripts and their
 *    relative .wasm lookups break), so serving them unbundled from
 *    `public/` sidesteps that entirely — this is the same approach lichess
 *    and most chess web apps use.
 *
 *      mkdir -p public/stockfish
 *      cp node_modules/stockfish/stockfish-18-lite-single.js   public/stockfish/
 *      cp node_modules/stockfish/stockfish-18-lite.wasm public/stockfish/
 *
 *    (This package ships stockfish-18-lite.js/.wasm directly in its root,
 *    not under src/ — check node_modules/stockfish/ if your version differs.
 *    Keep the .js and .wasm together with matching filenames; the glue code
 *    loads the .wasm by name relative to itself.)
 *
 * 3. stockfish-18-lite is a single-threaded NNUE build, so no extra
 *    cross-origin-isolation (COOP/COEP) server headers are needed — those
 *    are only required for multi-threaded builds.
 * ────────────────────────────────────────────────────────────────────────
 */
const ENGINE_SCRIPT_PATH = '/stockfish/stockfish-18-lite-single.js';

const READY_TIMEOUT_MS = 10_000;
const SEARCH_TIMEOUT_MS = 30_000;

class Engine {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  // Serializes searches — a single Stockfish instance can only run one `go` at a time.
  private queue: Promise<unknown> = Promise.resolve();

  private getWorker(): Worker {
    if (this.worker) return this.worker;

    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are not available in this environment.');
    }

    const worker = new Worker(ENGINE_SCRIPT_PATH);
    this.worker = worker;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Stockfish did not respond within ${READY_TIMEOUT_MS}ms. Check that ${ENGINE_SCRIPT_PATH} exists in your public/ folder.`));
      }, READY_TIMEOUT_MS);

      const onMessage = (e: MessageEvent) => {
        const line = String(e.data);
        if (line === 'uciok') {
          worker.postMessage('isready');
        } else if (line === 'readyok') {
          cleanup();
          resolve();
        }
      };
      const onError = (e: ErrorEvent) => {
        cleanup();
        this.worker = null;
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

    return worker;
  }

  private async waitUntilReady(): Promise<void> {
    this.getWorker();
    await this.readyPromise;
  }

  /** Clear the engine's hash table so every analysis starts from a clean state. */
  async reset(): Promise<void> {
    const run = this.queue.then(() => this.runReset());
    // Never let one failed/timed-out reset wedge the queue for the next caller.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runReset(): Promise<void> {
    await this.waitUntilReady();
    const worker = this.worker!;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Engine reset timed out`));
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
  }

  async analyze(fen: string, depth: number): Promise<EngineEval> {
    const run = this.queue.then(() => this.runSearch(fen, depth));
    // Never let one failed/timed-out search wedge the queue for the next caller.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runSearch(fen: string, depth: number): Promise<EngineEval> {
    await this.waitUntilReady();
    const worker = this.worker!;

    return new Promise<EngineEval>((resolve, reject) => {
      let bestMove: string | null = null;
      let continuation = '';
      let evaluation: number | null = null;
      let mate: number | null = null;
      let reachedDepth = depth;

      // UCI scores are always "from the perspective of the side to move".
      // The rest of the app (evalToPawns, accuracy calc, the eval bar) expects
      // a consistent White-positive convention, so flip sign when Black is to move.
      const sideToMoveSign = fen.split(' ')[1] === 'b' ? -1 : 1;

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Engine analysis timed out after ${SEARCH_TIMEOUT_MS}ms`));
      }, SEARCH_TIMEOUT_MS);

      const onMessage = (e: MessageEvent) => {
        const line = String(e.data);

        if (line.startsWith('info')) {
          const depthMatch = line.match(/\bdepth (\d+)/);
          if (depthMatch) reachedDepth = Number(depthMatch[1]);

          const mateMatch = line.match(/score mate (-?\d+)/);
          const cpMatch = line.match(/score cp (-?\d+)/);
          if (mateMatch) {
            mate = Number(mateMatch[1]) * sideToMoveSign;
            evaluation = null;
          } else if (cpMatch) {
            evaluation = (Number(cpMatch[1]) / 100) * sideToMoveSign;
            mate = null;
          }

          const pvMatch = line.match(/\bpv (.+)$/);
          if (pvMatch) continuation = pvMatch[1].trim();
        } else if (line.startsWith('bestmove')) {
          const parts = line.split(/\s+/);
          bestMove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
          cleanup();
          resolve({
            fen,
            bestMove,
            continuation,
            evaluation,
            mate,
            depth: reachedDepth,
            success: bestMove !== null,
          });
        }
      };

      function cleanup() {
        clearTimeout(timeout);
        worker.removeEventListener('message', onMessage);
      }

      worker.addEventListener('message', onMessage);
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth}`);
    });
  }
}

// One engine instance for the whole app's lifetime — spinning up a new WASM
// worker per call would be slow and would break search serialization.
const engine = new Engine();

export async function analyzePosition(fen: string, depth: number): Promise<EngineEval> {
  return engine.analyze(fen, depth);
}

export async function resetEngine(): Promise<void> {
  return engine.reset();
}

export function evalToPawns(ev: EngineEval): number {
  if (ev.mate !== null) {
    return ev.mate > 0 ? 100 : -100;
  }
  return ev.evaluation ?? 0;
}

/**
 * White's win probability (0–100), using the standard Lichess/chess.com
 * win% curve: winPercent = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1).
 *
 * ── FIX ──────────────────────────────────────────────────────────────────
 * `ev.evaluation` is stored in PAWNS (we divide UCI's `score cp` by 100 when
 * parsing it above), but this formula's constant is calibrated for
 * CENTIPAWNS. The old code multiplied pawns directly by -0.004 — 100x too
 * small — so the sigmoid never moved off ~50%, no matter the eval. That
 * silently broke every win%-based calculation (miss detection, "great"/
 * "brilliant" thresholds, accuracy). Converting back to centipawns first
 * fixes it.
 * ──────────────────────────────────────────────────────────────────────────
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