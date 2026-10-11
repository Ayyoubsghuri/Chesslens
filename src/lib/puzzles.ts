import { Chess } from 'chess.js';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface Puzzle {
  id: string;
  rating: number;
  themes: string[];
  /** Position the puzzle data starts from. */
  fen: string;
  /** UCI moves. */
  moves: string[];
  /**
   * true  -> moves[0] is the opponent's setup move (Lichess database CSV format)
   * false -> the solver moves first (Lichess API format, position already set up)
   */
  setup: boolean;
}

export interface PuzzleAttempt {
  id: string;
  rating: number;
  win: boolean;
  ts: number;
  themes: string[];
}

export interface PuzzleProgress {
  rating: number;
  solved: number;
  failed: number;
  streak: number;
  bestStreak: number;
  seenIds: string[];
  history: PuzzleAttempt[];
  themeStats: Record<string, { solved: number; failed: number }>;
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

const PROGRESS_KEY = 'chesslens_puzzle_progress_v1';
const BANK_KEY = 'chesslens_puzzle_bank_v1';

export const defaultProgress = (): PuzzleProgress => ({
  rating: 1500,
  solved: 0,
  failed: 0,
  streak: 0,
  bestStreak: 0,
  seenIds: [],
  history: [],
  themeStats: {},
});

export function loadPuzzleProgress(): PuzzleProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return defaultProgress();
    return { ...defaultProgress(), ...JSON.parse(raw) };
  } catch {
    return defaultProgress();
  }
}

export function savePuzzleProgress(p: PuzzleProgress) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch (e) {
    console.error('Could not save puzzle progress', e);
  }
}

export function resetPuzzleProgress(): PuzzleProgress {
  const fresh = defaultProgress();
  savePuzzleProgress(fresh);
  return fresh;
}

export function loadPuzzleBank(): Puzzle[] {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    return raw ? (JSON.parse(raw) as Puzzle[]) : [];
  } catch {
    return [];
  }
}

export function savePuzzleBank(bank: Puzzle[]) {
  try {
    localStorage.setItem(BANK_KEY, JSON.stringify(bank));
  } catch (e) {
    console.error('Could not save puzzle bank (storage full?)', e);
    throw e;
  }
}

export function clearPuzzleBank() {
  localStorage.removeItem(BANK_KEY);
}

/* ------------------------------------------------------------------ */
/* Progress / rating                                                   */
/* ------------------------------------------------------------------ */

export function recordResult(prev: PuzzleProgress, puzzle: Puzzle, win: boolean): PuzzleProgress {
  const expected = 1 / (1 + Math.pow(10, (puzzle.rating - prev.rating) / 400));
  const rating = Math.round(prev.rating + 32 * ((win ? 1 : 0) - expected));
  const streak = win ? prev.streak + 1 : 0;

  const themeStats = { ...prev.themeStats };
  for (const t of puzzle.themes) {
    const cur = themeStats[t] ?? { solved: 0, failed: 0 };
    themeStats[t] = win ? { ...cur, solved: cur.solved + 1 } : { ...cur, failed: cur.failed + 1 };
  }

  return {
    rating,
    solved: prev.solved + (win ? 1 : 0),
    failed: prev.failed + (win ? 0 : 1),
    streak,
    bestStreak: Math.max(prev.bestStreak, streak),
    seenIds: prev.seenIds.includes(puzzle.id) ? prev.seenIds : [...prev.seenIds, puzzle.id].slice(-5000),
    history: [
      ...prev.history,
      { id: puzzle.id, rating: puzzle.rating, win, ts: Date.now(), themes: puzzle.themes },
    ].slice(-100),
    themeStats,
  };
}

/* ------------------------------------------------------------------ */
/* Lichess API (public, no auth, CORS enabled)                         */
/* ------------------------------------------------------------------ */

interface LichessPuzzleResponse {
  game: { id: string; pgn: string };
  puzzle: { id: string; rating: number; solution: string[]; themes: string[]; initialPly: number };
}

function uciLegal(fen: string, uci: string): boolean {
  try {
    const c = new Chess(fen);
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return true;
  } catch {
    return false;
  }
}

function fromLichessApi(data: LichessPuzzleResponse): Puzzle {
  const game = new Chess();
  game.loadPgn(data.game.pgn);
  const history = game.history({ verbose: true });
  const first = data.puzzle.solution[0];

  // Normally the PGN ends right before the solver's first move.
  // Try a couple of fallbacks in case a position is off by a ply.
  const candidates = [history.length, data.puzzle.initialPly + 1, data.puzzle.initialPly];
  for (const n of candidates) {
    if (n < 0 || n > history.length) continue;
    const c = new Chess();
    for (let i = 0; i < n; i++) c.move(history[i].san);
    const fen = c.fen();
    if (uciLegal(fen, first)) {
      return {
        id: data.puzzle.id,
        rating: data.puzzle.rating,
        themes: data.puzzle.themes,
        fen,
        moves: data.puzzle.solution,
        setup: false,
      };
    }
  }
  throw new Error('Puzzle position did not match its solution');
}

export async function fetchLichessPuzzle(id?: string): Promise<Puzzle> {
  const url = id ? `https://lichess.org/api/puzzle/${id}` : 'https://lichess.org/api/puzzle/next';
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Lichess returned ${res.status}`);
  return fromLichessApi((await res.json()) as LichessPuzzleResponse);
}

/* ------------------------------------------------------------------ */
/* Lichess database CSV import                                         */
/* https://database.lichess.org/#puzzles                               */
/* Columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,      */
/*          NbPlays,Themes,GameUrl,OpeningTags                         */
/* ------------------------------------------------------------------ */

export function parsePuzzleCsv(text: string, limit = 3000): Puzzle[] {
  const out: Puzzle[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (out.length >= limit) break;
    if (!line || line.startsWith('PuzzleId')) continue;
    const f = line.split(',');
    if (f.length < 8) continue;
    const [id, fen, moves, rating, , , , themes] = f;
    const mv = moves.trim().split(/\s+/);
    if (!id || !fen || mv.length < 2 || !Number.isFinite(Number(rating))) continue;
    out.push({
      id,
      fen,
      moves: mv,
      rating: Number(rating),
      themes: themes ? themes.trim().split(/\s+/) : [],
      setup: true,
    });
  }
  return out;
}

/** Loads the trimmed database sample from public/puzzles.csv (see scripts/trim-puzzles.mjs). */
export async function fetchBundledPuzzles(limit = Number.POSITIVE_INFINITY): Promise<Puzzle[]> {
  try {
    const base = (import.meta as any).env?.BASE_URL ?? '/';
    const res = await fetch(`${base}puzzles.csv`);
    if (!res.ok) return [];
    if ((res.headers.get('content-type') || '').includes('text/html')) return [];
    return parsePuzzleCsv(await res.text(), limit);
  } catch {
    return [];
  }
}

/** Pick a puzzle from the imported bank near the player's rating, preferring unseen ones. */
export function pickFromBank(bank: Puzzle[], progress: PuzzleProgress): Puzzle | null {
  if (bank.length === 0) return null;
  const seen = new Set(progress.seenIds);
  let pool = bank.filter(p => !seen.has(p.id));
  if (pool.length === 0) pool = bank;
  // Widen the rating window until there are enough candidates. This avoids sorting the whole bank
  // on every pick, which gets slow with hundreds of thousands of puzzles.
  let near: Puzzle[] = pool;
  for (const w of [50, 100, 200, 400, 800]) {
    near = pool.filter(p => Math.abs(p.rating - progress.rating) <= w);
    if (near.length >= 10) break;
  }
  if (near.length === 0) near = pool;
  return near[Math.floor(Math.random() * near.length)];
}

export const prettyTheme = (t: string) =>
  t.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();