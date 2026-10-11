import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import { ChessBoard } from '@/components/ChessBoard';
import {
  clearPuzzleBank,
  fetchBundledPuzzles,
  fetchLichessPuzzle,
  loadPuzzleProgress,
  pickFromBank,
  prettyTheme,
  recordResult,
  resetPuzzleProgress,
  savePuzzleProgress,
} from '@/lib/puzzles';
import type { Puzzle, PuzzleProgress } from '@/lib/puzzles';
import { Flame, Lightbulb, Loader2, RotateCcw, SkipForward, Eye, Puzzle as PuzzleIcon } from 'lucide-react';

type Status = 'loading' | 'playing' | 'solved' | 'failed' | 'error';
type Source = 'lichess' | 'bank';

// Tactic / phase categories offered in the filter (Lichess theme keys, in display order)
const CATEGORY_THEMES = [
  'mateIn1', 'mateIn2', 'mateIn3', 'mate', 'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck',
  'hangingPiece', 'trappedPiece', 'sacrifice', 'deflection', 'attraction', 'clearance', 'interference',
  'quietMove', 'zugzwang', 'backRankMate', 'smotheredMate', 'attackingF2F7', 'exposedKing',
  'advancedPawn', 'promotion', 'capturingDefender', 'defensiveMove', 'intermezzo', 'xRayAttack',
  'opening', 'middlegame', 'endgame', 'rookEndgame', 'pawnEndgame', 'knightEndgame', 'bishopEndgame', 'queenEndgame',
  'crushing', 'advantage', 'equality',
];

const uciOf = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? '');

function applyUci(chess: Chess, uci: string) {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

export function PuzzleTrainer() {
  const [progress, setProgress] = useState<PuzzleProgress>(loadPuzzleProgress);
  const [bank, setBank] = useState<Puzzle[]>([]);
  const [source, setSource] = useState<Source>('lichess');
  const [category, setCategory] = useState('all');
  const filterRef = useRef({ category: 'all' });

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [busy, setBusy] = useState(false);
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [boardKey, setBoardKey] = useState(0); // remount the board to snap a wrong move back
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const chessRef = useRef(new Chess());
  const idxRef = useRef(0);
  const puzzleRef = useRef<Puzzle | null>(null);
  const failedRef = useRef(false);
  const recordedRef = useRef(false);
  const requestRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  /* ---------------- persistence ---------------- */
  useEffect(() => {
    savePuzzleProgress(progress);
  }, [progress]);

  /* ---------------- helpers ---------------- */
  const clearTimers = () => {
    timersRef.current.forEach(t => window.clearTimeout(t));
    timersRef.current = [];
  };
  const later = (ms: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  };

  useEffect(() => clearTimers, []);

  const record = useCallback((win: boolean) => {
    if (recordedRef.current || !puzzleRef.current) return;
    recordedRef.current = true;
    const p = puzzleRef.current;
    setProgress(prev => recordResult(prev, p, win));
  }, []);

  /* ---------------- filters ---------------- */
  const applyFilters = (list: Puzzle[]) => {
    const { category: c } = filterRef.current;
    return list.filter((p) => c === 'all' || p.themes.includes(c));
  };

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    bank.forEach((p) => p.themes.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return CATEGORY_THEMES.filter((t) => counts.has(t)).map((t) => ({ key: t, count: counts.get(t)! }));
  }, [bank]);

  const matchCount = useMemo(
    () => (category === 'all' ? bank.length : bank.filter((p) => p.themes.includes(category)).length),
    [bank, category],
  );

  const changeFilter = (c: string) => {
    setCategory(c);
    filterRef.current = { category: c };
    if (bank.length > 0) {
      setSource('bank');
      loadNext('bank', progress);
    }
  };

  /* ---------------- loading puzzles ---------------- */
  const startPuzzle = useCallback((p: Puzzle) => {
    clearTimers();
    const chess = new Chess(p.fen);
    chessRef.current = chess;
    idxRef.current = 0;
    puzzleRef.current = p;
    failedRef.current = false;
    recordedRef.current = false;

    setPuzzle(p);
    setHint(null);
    setWrong(null);
    setLastMove(null);
    setMessage('');
    setError('');
    setFen(chess.fen());
    setStatus('playing');

    if (p.setup) {
      // Database format: the opponent plays moves[0] first, then it's the solver's turn
      setOrientation(chess.turn() === 'w' ? 'black' : 'white');
      setBusy(true);
      later(600, () => {
        const m = applyUci(chess, p.moves[0]);
        idxRef.current = 1;
        setFen(chess.fen());
        setLastMove({ from: m.from, to: m.to });
        setBusy(false);
      });
    } else {
      setOrientation(chess.turn() === 'w' ? 'white' : 'black');
      setBusy(false);
    }
  }, []);

  const loadNext = useCallback(
    async (src: Source = source, prog: PuzzleProgress = progress, bankOverride?: Puzzle[]) => {
      const req = ++requestRef.current;
      clearTimers();
      setStatus('loading');
      setError('');
      try {
        let next: Puzzle | null = null;
        if (src === 'bank') {
          const pool = bankOverride ?? bank;
          next = pickFromBank(applyFilters(pool), prog);
          if (!next) {
            throw new Error(
              pool.length === 0
                ? "The puzzle database isn't available. Run the trim script to create public/puzzles.csv."
                : 'No puzzles match this category. Try another one.',
            );
          }
        } else {
          // Try a few times to avoid puzzles that were already attempted
          for (let i = 0; i < 4; i++) {
            const candidate = await fetchLichessPuzzle();
            if (req !== requestRef.current) return;
            next = candidate;
            if (!prog.seenIds.includes(candidate.id)) break;
          }
        }
        if (req !== requestRef.current || !next) return;
        startPuzzle(next);
      } catch (e) {
        if (req !== requestRef.current) return;
        setError(e instanceof Error ? e.message : 'Could not load a puzzle');
        setStatus('error');
      }
    },
    [source, progress, bank, startPuzzle],
  );

  // First puzzle on mount
  // Prefer the local database sample (public/puzzles.csv) or a previously imported set;
  // fall back to the Lichess API if neither exists.
  useEffect(() => {
    (async () => {
      clearPuzzleBank(); // remove any set imported with the old Import button
      const local = await fetchBundledPuzzles();
      if (local.length > 0) setBank(local);
      if (local.length > 0) {
        setSource('bank');
        loadNext('bank', progress, local);
      } else {
        loadNext('lichess', progress);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchSource = (s: Source) => {
    if (s === 'lichess') {
      setCategory('all');
      filterRef.current = { category: 'all' };
    }
    setSource(s);
    loadNext(s, progress);
  };

  /* ---------------- gameplay ---------------- */
  const finishSolved = () => {
    setStatus('solved');
    if (failedRef.current) {
      setMessage('Solved, but with a mistake. This one counted as a miss.');
    } else {
      record(true);
      setMessage('Puzzle solved!');
    }
  };

  const tryMove = (from: string, to: string) => {
    const chess = chessRef.current;
    const p = puzzleRef.current;
    if (!p) return;
    const legal = chess.moves({ square: from as Square, verbose: true }).filter(m => m.to === to);
    if (legal.length === 0) return;

    const expected = p.moves[idxRef.current];
    let promotion: string | undefined;
    if (legal[0].promotion) {
      promotion = expected && expected.slice(0, 2) === from && expected.slice(2, 4) === to ? expected[4] : 'q';
    }

    const made = chess.move({ from, to, promotion });
    const correct = uciOf(made) === expected || chess.isCheckmate();
    setHint(null);

    if (!correct) {
      chess.undo();
      setFen(chess.fen());
      setBoardKey(k => k + 1);
      setWrong(to);
      later(500, () => setWrong(null));
      setMessage("That's not the best move. Try again.");
      if (!failedRef.current) {
        failedRef.current = true;
        record(false);
      }
      return;
    }

    setFen(chess.fen());
    setLastMove({ from: made.from, to: made.to });
    setMessage('');
    idxRef.current += 1;

    if (idxRef.current >= p.moves.length || chess.isCheckmate()) {
      finishSolved();
      return;
    }

    // Opponent's reply
    setBusy(true);
    later(450, () => {
      const reply = applyUci(chess, p.moves[idxRef.current]);
      idxRef.current += 1;
      setFen(chess.fen());
      setLastMove({ from: reply.from, to: reply.to });
      setBusy(false);
      if (idxRef.current >= p.moves.length) finishSolved();
    });
  };

  const handleUserMove = (m: { from: string; to: string }) => {
    if (status !== 'playing' || busy) return;
    tryMove(m.from, m.to);
  };

  const showHint = () => {
    const p = puzzleRef.current;
    if (!p || status !== 'playing' || busy) return;
    const expected = p.moves[idxRef.current];
    if (!expected) return;
    setHint(expected.slice(0, 2));
    if (!failedRef.current) {
      failedRef.current = true;
      record(false);
    }
    setMessage('Hint: move the highlighted piece. This puzzle now counts as a miss.');
  };

  const showSolution = () => {
    const p = puzzleRef.current;
    if (!p || status !== 'playing') return;
    failedRef.current = true;
    record(false);
    setStatus('failed');
    setHint(null);
    setBusy(false);
    setMessage('Here is the solution.');

    clearTimers();
    const chess = chessRef.current;
    const step = () => {
      if (idxRef.current >= p.moves.length) return;
      const m = applyUci(chess, p.moves[idxRef.current]);
      idxRef.current += 1;
      setFen(chess.fen());
      setLastMove({ from: m.from, to: m.to });
      later(750, step);
    };
    step();
  };

  const handleResetProgress = () => {
    if (window.confirm('Reset your puzzle rating and history? This cannot be undone.')) {
      setProgress(resetPuzzleProgress());
    }
  };

  /* ---------------- derived ---------------- */
  const attempts = progress.solved + progress.failed;
  const accuracy = attempts > 0 ? Math.round((progress.solved / attempts) * 100) : 0;
  const finished = status === 'solved' || status === 'failed';
  const toMove = orientation === 'white' ? 'White' : 'Black';

  const weakThemes = Object.entries(progress.themeStats)
    .map(([theme, s]) => ({ theme, ...s, total: s.solved + s.failed }))
    .filter(t => t.failed > 0 && t.total >= 2)
    .sort((a, b) => b.failed / b.total - a.failed / a.total)
    .slice(0, 3);

  return (
    <section className="mt-12 w-full" aria-labelledby="puzzles-heading">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 id="puzzles-heading" className="text-xl font-bold flex items-center gap-2">
            <PuzzleIcon size={20} className="text-brand-300" /> Practice puzzles
          </h2>
          <p className="text-sm text-ink-400 mt-0.5">
            Real puzzles from the Lichess puzzle database. Your rating and history are saved in this browser.
          </p>
        </div>

        <div className="flex gap-1 p-1 rounded-lg bg-ink-800/70 text-sm">
          <button
            onClick={() => switchSource('lichess')}
            className={`px-3 py-1.5 rounded-md transition-colors ${source === 'lichess' ? 'bg-ink-600 text-white' : 'text-ink-400 hover:text-ink-200'}`}
          >
            Random from Lichess
          </button>
          <button
            onClick={() => switchSource('bank')}
            className={`px-3 py-1.5 rounded-md transition-colors ${source === 'bank' ? 'bg-ink-600 text-white' : 'text-ink-400 hover:text-ink-200'}`}
          >
            Lichess database{bank.length > 0 ? ` (${bank.length.toLocaleString()})` : ''}
          </button>
        </div>
      </div>

      {/* Filters: category (database puzzles only) */}
      <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
        <label className="flex items-center gap-2 text-ink-400">
          Category
          <select
            value={category}
            onChange={(e) => changeFilter(e.target.value)}
            disabled={bank.length === 0}
            className="rounded-md bg-ink-800 border border-ink-700 text-ink-100 px-2 py-1.5 max-w-[11rem] disabled:opacity-50"
          >
            <option value="all">All categories</option>
            {categoryOptions.map((o) => (
              <option key={o.key} value={o.key}>{prettyTheme(o.key)} ({o.count.toLocaleString()})</option>
            ))}
          </select>
        </label>
        {category !== 'all' && (
          <>
            <span className="text-xs text-ink-500">{matchCount.toLocaleString()} puzzles</span>
            <button onClick={() => changeFilter('all')} className="btn-ghost text-xs">Clear</button>
          </>
        )}
        {bank.length === 0 && <span className="text-xs text-ink-500">Filters need the puzzle database (public/puzzles.csv).</span>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,520px)_1fr]">
        {/* Board */}
        <div>
          <div className="relative">
            <ChessBoard
              key={boardKey}
              fen={fen}
              orientation={orientation}
              size={520}
              interactive={status === 'playing' && !busy}
              onUserMove={handleUserMove}
              lastMove={lastMove as { from: Square; to: Square } | null}
              highlightSquare={hint as Square | null}
              annotationSquare={wrong as Square | null}
              annotationColor={wrong ? '#fa412d' : null}
            />
            {status === 'loading' && (
              <div className="absolute inset-0 flex items-center justify-center bg-ink-900/60 rounded-lg">
                <Loader2 className="animate-spin text-brand-300" size={28} />
              </div>
            )}
          </div>
        </div>

        {/* Side panel */}
        <div className="flex flex-col gap-4">
          <div className="card p-4">
            {status === 'error' ? (
              <div>
                <p className="font-medium text-red-300 mb-1">Couldn't load a puzzle</p>
                <p className="text-sm text-ink-400 mb-3">{error}</p>
                <button onClick={() => loadNext()} className="btn-primary text-sm">
                  <RotateCcw size={14} /> Try again
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {status === 'loading' ? 'Loading puzzle…' : finished ? (status === 'solved' ? 'Solved' : 'Not solved') : `${toMove} to move`}
                    </p>
                    <p className="text-sm text-ink-400 mt-0.5">
                      {status === 'playing' && !busy && 'Find the best move.'}
                      {status === 'playing' && busy && 'Opponent is moving…'}
                      {finished && puzzle && `Puzzle ${puzzle.id} · rated ${puzzle.rating}`}
                    </p>
                  </div>
                  {progress.streak >= 2 && (
                    <span className="chip bg-brand-500/20 text-brand-300 flex items-center gap-1">
                      <Flame size={12} /> {progress.streak} in a row
                    </span>
                  )}
                </div>

                {message && (
                  <p
                    className={`mt-3 text-sm ${
                      status === 'solved' && !failedRef.current ? 'text-brand-300' : message.startsWith("That's not") ? 'text-red-300' : 'text-ink-300'
                    }`}
                    role="status"
                  >
                    {message}
                  </p>
                )}
                {error && status !== 'error' && <p className="mt-3 text-sm text-red-300">{error}</p>}

                {finished && puzzle && puzzle.themes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {puzzle.themes.slice(0, 6).map(t => (
                      <span key={t} className="chip bg-ink-700 text-ink-300">
                        {prettyTheme(t)}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-4">
                  {status === 'playing' && (
                    <>
                      <button onClick={showHint} disabled={busy} className="btn-secondary text-sm">
                        <Lightbulb size={14} /> Hint
                      </button>
                      <button onClick={showSolution} className="btn-secondary text-sm">
                        <Eye size={14} /> Show solution
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => loadNext()}
                    disabled={status === 'loading'}
                    className={`${finished ? 'btn-primary' : 'btn-ghost'} text-sm`}
                  >
                    <SkipForward size={14} /> {finished ? 'Next puzzle' : 'Skip'}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Progress */}
          <div className="card p-4">
            <div className="grid grid-cols-4 gap-3 text-center">
              <Stat label="Rating" value={progress.rating} />
              <Stat label="Solved" value={progress.solved} />
              <Stat label="Accuracy" value={attempts > 0 ? `${accuracy}%` : '–'} />
              <Stat label="Best streak" value={progress.bestStreak} />
            </div>

            {progress.history.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-ink-400 mb-1.5">Last {Math.min(progress.history.length, 30)} puzzles</p>
                <div className="flex flex-wrap gap-1">
                  {progress.history.slice(-30).map((h, i) => (
                    <span
                      key={`${h.id}-${i}`}
                      title={`${h.id} (${h.rating}) – ${h.win ? 'solved' : 'missed'}`}
                      className={`w-2.5 h-2.5 rounded-full ${h.win ? 'bg-brand-400' : 'bg-red-400/80'}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {weakThemes.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-ink-400 mb-1.5">Themes to work on</p>
                <div className="flex flex-wrap gap-1.5">
                  {weakThemes.map(t => (
                    <span key={t.theme} className="chip bg-red-500/15 text-red-300">
                      {prettyTheme(t.theme)} · {t.solved}/{t.total}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-ink-800">
              <button onClick={handleResetProgress} className="btn-ghost text-xs ml-auto">
                <RotateCcw size={13} /> Reset progress
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      <p className="text-xs text-ink-400">{label}</p>
    </div>
  );
}