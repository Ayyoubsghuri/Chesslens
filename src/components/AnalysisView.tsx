import { useMemo, useRef, useState, useEffect } from 'react';
import { Chess, type Square } from 'chess.js';
import { ChessBoard } from './ChessBoard';
import { EvalBar } from './Evalbar';
import { EvalGraph } from './EvalGraph';
import { MoveList } from './MoveList';
import { formatEval, evalToPawns, analyzePosition } from '@/lib/engine';
import { classifyMove } from '@/lib/analysis';
import { useElementSize } from '@/lib/useElementSize';
import type { AnalysisResult, AnalyzedMove, MoveQuality, PieceColor } from '@/lib/types';
import {
  ChevronLeft, ChevronRight, AlertTriangle, Target, TrendingUp, Award,
  CheckCircle2, ThumbsUp, Minus, BookOpen, AlertCircle, XCircle, RotateCcw,
  Info, X, Star, HelpCircle, MessageSquare, Sparkles, Zap, Maximize2, ChevronsLeft, ChevronsRight, Play, Pause,
} from 'lucide-react';

const QUALITY_META: Record<MoveQuality, { color: string; bg: string; icon: any; label: string }> = {
  brilliant: { color: '#00bfa5', bg: '#00bfa520', icon: Star, label: 'Brilliant' },
  best:      { color: '#81b64c', bg: '#81b64c20', icon: Star, label: 'Best' },
  great:     { color: '#7cb342', bg: '#7cb34220', icon: ThumbsUp, label: 'Great' },
  excellent: { color: '#96bc4b', bg: '#96bc4b20', icon: CheckCircle2, label: 'Excellent' },
  good:      { color: '#95b3b8', bg: '#95b3b820', icon: Minus, label: 'Good' },
  book:      { color: '#a88865', bg: '#a8886520', icon: BookOpen, label: 'Book' },
  inaccuracy:{ color: '#f7c631', bg: '#f7c63120', icon: AlertCircle, label: 'Inaccuracy' },
  mistake:   { color: '#ffa459', bg: '#ffa45920', icon: AlertTriangle, label: 'Mistake' },
  blunder:   { color: '#fa412d', bg: '#fa412d20', icon: XCircle, label: 'Blunder' },
  miss:      { color: '#e040fb', bg: '#e040fb20', icon: HelpCircle, label: 'Miss' },
};

const QUALITY_ACCURACY: Record<MoveQuality, number> = {
  brilliant: 100, best: 100, great: 95, excellent: 90, good: 82, book: 100,
  // Balanced: errors pull accuracy down, but not crush it
  inaccuracy: 52, mistake: 32, miss: 28, blunder: 12,
};

interface ExploreReview {
  status: 'loading' | 'done' | 'error';
  san: string;
  color: PieceColor;
  quality?: MoveQuality;
  evalLoss?: number | null;
  winPercentLoss?: number | null;
  isBest?: boolean;
  bestMoveUci?: string | null;
}

/** One free move made while exploring, plus its (possibly still-loading) engine review. Forms an undo/redo stack. */
interface ExploreStep {
  id: number;
  fenBefore: string;
  fenAfter: string;
  from: Square;
  to: Square;
  promotion?: string;
  san: string;
  color: PieceColor;
  review: ExploreReview;
}

/** Short human blurb for a move quality — used for both the game-line coach card and free-move review. */
function qualityBlurb(quality: MoveQuality, isBest: boolean): string {
  switch (quality) {
    case 'blunder': return 'This is a serious mistake that changes the evaluation significantly.';
    case 'mistake': return 'This move gives away some of the advantage.';
    case 'inaccuracy': return 'A better move was available, but this is playable.';
    case 'best': return 'The best move in this position!';
    case 'brilliant': return 'A stunning move that finds a difficult tactical solution.';
    case 'great': return 'An excellent move that finds the best continuation.';
    case 'excellent': return isBest ? "This was the engine's top choice — excellent play." : 'A very strong move, close to the best.';
    case 'good': return 'A solid move that maintains the position.';
    case 'book': return 'A known opening move.';
    case 'miss': return 'A tactical opportunity was missed.';
    default: return '';
  }
}

/**
 * Fix engine mislabels: delivering checkmate is never a blunder/mistake.
 */

/** Position key: board + side + castling + ep (ignore move clocks). */
function fenKey(fen: string): string {
  return fen.split(/\s+/).slice(0, 4).join(' ');
}

type OpeningHit = { eco: string; name: string };

/** In-memory ECO book: fenKey → opening. Loaded once from lichess-org/chess-openings. */
let openingBookPromise: Promise<Map<string, OpeningHit>> | null = null;
const OPENING_TSV_URLS = [
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/a.tsv',
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/b.tsv',
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/c.tsv',
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/d.tsv',
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/e.tsv',
];

async function loadOpeningBook(): Promise<Map<string, OpeningHit>> {
  const map = new Map<string, OpeningHit>();
  const results = await Promise.all(
    OPENING_TSV_URLS.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return '';
        return await res.text();
      } catch {
        return '';
      }
    })
  );

  for (const text of results) {
    if (!text) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('eco')) continue;
      // TSV: eco \t name \t pgn
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const eco = parts[0].trim();
      const name = parts[1].trim();
      const pgn = parts[2].trim();
      if (!eco || !name || !pgn) continue;
      try {
        const chess = new Chess();
        // PGN moves like "1. e4 e5 2. Nf3" — strip move numbers
        const tokens = pgn
          .replace(/\d+\./g, ' ')
          .replace(/\.\.\./g, ' ')
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        for (const san of tokens) {
          const moved = chess.move(san);
          if (!moved) break;
        }
        const key = fenKey(chess.fen());
        // Prefer longer / more specific names: always overwrite so last (often more specific) wins,
        // but keep first if same length name is shorter — actually keep the one already there if
        // the new name is a prefix; otherwise take the new entry (variation names are longer).
        const prev = map.get(key);
        if (!prev || name.length >= prev.name.length) {
          map.set(key, { eco, name });
        }
      } catch {
        /* skip broken line */
      }
    }
  }
  return map;
}

function getOpeningBook(): Promise<Map<string, OpeningHit>> {
  if (!openingBookPromise) openingBookPromise = loadOpeningBook();
  return openingBookPromise;
}

/** Deepest opening match along the move list up to `upToIndex` (inclusive). */
function findOpeningForMoves(
  book: Map<string, OpeningHit>,
  moves: AnalyzedMove[],
  upToIndex: number
): OpeningHit | null {
  if (!book.size || moves.length === 0) return null;
  let best: OpeningHit | null = null;
  try {
    const chess = new Chess();
    const end = Math.min(upToIndex, moves.length - 1);
    for (let i = 0; i <= end; i++) {
      const m = moves[i];
      if (!chess.move(m.san)) break;
      const hit = book.get(fenKey(chess.fen()));
      if (hit) best = hit;
    }
  } catch {
    return best;
  }
  return best;
}

/**
 * Soften over-harsh engine labels and fix obvious misclassifications.
 *
 * Chess.com-style eval-loss bands (pawns, player perspective):
 *   ≤ 0.25  → not a real error (good / book / excellent stay)
 *   ≤ 0.80  → inaccuracy at worst
 *   ≤ 1.80  → mistake at worst
 *   > 1.80  → blunder is fair
 */
function correctedQuality(move: AnalyzedMove): MoveQuality {
  // 0) Book moves stay book, even if they also happen to be engine's top choice
  if (move.quality === 'book') return 'book';

  // 1) Engine's top choice → Best (keep brilliant/great)
  const engineBest = move.evalBefore?.bestMove;
  if (engineBest && engineBest.length >= 4) {
    try {
      const chess = new Chess(move.fenBefore);
      const played = chess.move(move.san);
      if (played) {
        const playedUci = played.from + played.to + (played.promotion || '');
        const same =
          playedUci.slice(0, 4) === engineBest.slice(0, 4) &&
          (playedUci.length <= 4 ||
            engineBest.length <= 4 ||
            playedUci[4] === engineBest[4]);
        if (same) {
          if (move.quality === 'brilliant' || move.quality === 'great') return move.quality;
          return 'best';
        }
      }
    } catch { /* ignore */ }
  }

  // 2) Delivering mate is never a blunder
  try {
    const after = new Chess(move.fenAfter);
    if (after.isCheckmate()) {
      if (['blunder', 'mistake', 'inaccuracy', 'miss', 'good', 'excellent'].includes(move.quality)) {
        return 'best';
      }
    }
    if (after.isStalemate() || after.isDraw()) {
      if (move.quality === 'blunder' || move.quality === 'mistake') return 'good';
    }
  } catch { /* ignore */ }

  // 3) Mate score for the mover
  const ev = move.evalAfter as any;
  if (ev && typeof ev.mate === 'number') {
    const mate = ev.mate as number;
    const moverWins =
      (move.color === 'w' && mate > 0) || (move.color === 'b' && mate < 0);
    if (moverWins && ['blunder', 'mistake', 'inaccuracy', 'miss'].includes(move.quality)) {
      return Math.abs(mate) <= 1 ? 'best' : 'excellent';
    }
  }

  // 4) Soften blunder/mistake/miss when eval loss is small
  const loss =
    typeof move.evalLoss === 'number' && Number.isFinite(move.evalLoss)
      ? Math.abs(move.evalLoss)
      : null;

  if (loss != null) {
    // Tiny loss → never blunder/mistake/miss
    if (loss <= 0.25) {
      if (move.quality === 'blunder' || move.quality === 'mistake' || move.quality === 'miss') {
        return loss <= 0.1 ? 'good' : 'inaccuracy';
      }
    }
    // Small loss → inaccuracy at worst (not blunder/mistake)
    if (loss <= 0.8) {
      if (move.quality === 'blunder' || move.quality === 'mistake') {
        return 'inaccuracy';
      }
      if (move.quality === 'miss' && loss <= 0.5) {
        return 'inaccuracy';
      }
    }
    // Medium loss → mistake at worst (not blunder)
    if (loss <= 1.8) {
      if (move.quality === 'blunder') {
        return 'mistake';
      }
    }
    // Only keep blunder when loss is clearly large (> ~1.8 pawns)
  }

  return move.quality;
}


/**
 * Quality used for accuracy % and game-rating penalties.
 * Keeps engine severity (blunder stays blunder) — only fixes clear bugs
 * (mate delivered, played move == engine best). Does NOT soften blunders
 * into inaccuracies; those soft labels are display-only via correctedQuality.
 */
function scoringQuality(move: AnalyzedMove): MoveQuality {
  // 0) Book moves stay book, even if they also happen to be engine's top choice
  if (move.quality === 'book') return 'book';

  const engineBest = move.evalBefore?.bestMove;
  if (engineBest && engineBest.length >= 4) {
    try {
      const chess = new Chess(move.fenBefore);
      const played = chess.move(move.san);
      if (played) {
        const playedUci = played.from + played.to + (played.promotion || '');
        const same =
          playedUci.slice(0, 4) === engineBest.slice(0, 4) &&
          (playedUci.length <= 4 ||
            engineBest.length <= 4 ||
            playedUci[4] === engineBest[4]);
        if (same) {
          if (move.quality === 'brilliant' || move.quality === 'great') return move.quality;
          return 'best';
        }
      }
    } catch { /* ignore */ }
  }

  try {
    const after = new Chess(move.fenAfter);
    if (after.isCheckmate()) {
      if (['blunder', 'mistake', 'inaccuracy', 'miss', 'good', 'excellent'].includes(move.quality)) {
        return 'best';
      }
    }
  } catch { /* ignore */ }

  // Only escalate for scoring when the eval swing is clearly severe
  const loss =
    typeof move.evalLoss === 'number' && Number.isFinite(move.evalLoss)
      ? Math.abs(move.evalLoss)
      : null;
  if (loss != null) {
    if (loss > 2.2 && (move.quality === 'inaccuracy' || move.quality === 'mistake' || move.quality === 'miss')) {
      return 'blunder';
    }
    if (loss > 1.3 && move.quality === 'inaccuracy') {
      return 'mistake';
    }
  }

  return move.quality;
}

function computeRealisticAccuracy(
  moves: AnalyzedMove[],
  result?: string | null
): { white: number; black: number } {
  const whiteScores: number[] = [];
  const blackScores: number[] = [];
  for (const m of moves) {
    const score = QUALITY_ACCURACY[scoringQuality(m)] ?? 70;
    if (m.color === 'w') whiteScores.push(score);
    else blackScores.push(score);
  }
  const avg = (scores: number[]) => {
    if (scores.length === 0) return 0;
    const power = 0.6;
    const sum = scores.reduce((a, s) => a + Math.pow(Math.max(1, s), power), 0);
    return Math.max(0, Math.min(100, Math.pow(sum / scores.length, 1 / power)));
  };
  let white = avg(whiteScores);
  let black = avg(blackScores);
  const res = (result || '').trim();
  if (res === '1-0' || res.startsWith('1-0')) {
    white = Math.min(100, white + 2 + Math.min(3, Math.max(0, white - black) * 0.15));
  } else if (res === '0-1' || res.startsWith('0-1')) {
    black = Math.min(100, black + 2 + Math.min(3, Math.max(0, black - white) * 0.15));
  }
  return { white: Math.round(white * 10) / 10, black: Math.round(black * 10) / 10 };
}

/**
 * Game rating from accuracy + player rating + errors.
 * 560/81% ~1100 | 294/65% ~450 | 560/50%+errors ~100
 */
function estimateGameRating(
  accuracy: number,
  playerRating: number | null,
  errors: {
    blunders: number;
    mistakes: number;
    misses: number;
    inaccuracies?: number;
  } = { blunders: 0, mistakes: 0, misses: 0, inaccuracies: 0 }
): number {
  const acc = Math.max(0, Math.min(100, accuracy));
  let baseFromAcc: number;
  if (acc >= 90) baseFromAcc = 1500 + (acc - 90) * 80;
  else if (acc >= 80) baseFromAcc = 1000 + (acc - 80) * 50;
  else if (acc >= 65) baseFromAcc = 450 + (acc - 65) * (550 / 15);
  else if (acc >= 50) baseFromAcc = 200 + (acc - 50) * (250 / 15);
  else baseFromAcc = Math.max(50, acc * 4);

  let rating = baseFromAcc;
  if (playerRating != null && playerRating > 0) {
    const expectedAcc =
      playerRating < 1000
        ? Math.max(40, Math.min(75, 40 + playerRating / 40))
        : Math.max(55, Math.min(95, playerRating / 100 + 64));
    const accDelta = acc - expectedAcc;
    if (accDelta >= 0) {
      const boost = Math.min(500, accDelta * 14);
      rating = Math.max(playerRating, Math.min(baseFromAcc, playerRating + boost));
      if (baseFromAcc > rating) rating = rating + (baseFromAcc - rating) * 0.35;
    } else {
      // Below expected accuracy → always drag rating down
      const drop = Math.min(playerRating - 50, Math.abs(accDelta) * 40);
      rating = Math.max(50, playerRating - drop);
      rating = Math.min(rating, baseFromAcc + playerRating * 0.1);
    }
    if (playerRating < 600) rating = baseFromAcc * 0.65 + rating * 0.35;
  }

  // Errors always lower game rating (never neutral / boost)
  const { blunders, mistakes, misses } = errors;
  const inaccuracies = errors.inaccuracies ?? 0;
  const errorPenalty =
    blunders * 90 +
    mistakes * 55 +
    misses * 45 +
    inaccuracies * 25 +
    (blunders + mistakes >= 4 ? 80 : 0) +
    (blunders >= 2 ? 60 : 0);

  rating = rating - errorPenalty;

  // Floor when the game was messy
  if (acc <= 55 && blunders + mistakes + misses + inaccuracies >= 4) {
    rating = Math.min(rating, 200);
  }
  if (acc <= 50 && blunders >= 2) {
    rating = Math.min(rating, 120);
  }

  // Cap: game rating should not sit far above player rating if there were real errors
  if (playerRating != null && playerRating > 0) {
    const errorCount = blunders + mistakes + misses + inaccuracies;
    if (errorCount >= 3) {
      rating = Math.min(rating, playerRating + 80);
    }
    if (blunders >= 2 || mistakes >= 3) {
      rating = Math.min(rating, playerRating);
    }
  }

  return Math.round(Math.max(50, Math.min(3200, rating)));
}

function pickTimeClass(timeControl?: string | null): 'chess_bullet' | 'chess_blitz' | 'chess_rapid' | 'chess_daily' {
  if (!timeControl) return 'chess_rapid';
  const tc = timeControl.toLowerCase();
  const base = parseInt(tc.split('+')[0], 10);
  if (!Number.isNaN(base)) {
    if (base < 180) return 'chess_bullet';
    if (base < 600) return 'chess_blitz';
    if (base < 1800) return 'chess_rapid';
    return 'chess_daily';
  }
  if (tc.includes('bullet')) return 'chess_bullet';
  if (tc.includes('blitz')) return 'chess_blitz';
  if (tc.includes('rapid')) return 'chess_rapid';
  if (tc.includes('daily') || tc.includes('correspondence')) return 'chess_daily';
  return 'chess_rapid';
}

/** https://api.chess.com/pub/player/{username}/stats */
async function fetchChessComRating(username: string, timeControl?: string | null): Promise<number | null> {
  const clean = username.trim().toLowerCase().replace(/\s+/g, '');
  if (!clean || clean === 'white' || clean === 'black') return null;
  try {
    const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(clean)}/stats`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const preferred = pickTimeClass(timeControl);
    const order = [preferred, 'chess_rapid', 'chess_blitz', 'chess_bullet', 'chess_daily'] as const;
    const seen = new Set<string>();
    for (const key of order) {
      if (seen.has(key)) continue;
      seen.add(key);
      const rating = data?.[key]?.last?.rating;
      if (typeof rating === 'number' && rating > 0) return rating;
    }
    return null;
  } catch {
    return null;
  }
}

interface AnalysisViewProps {
  analysis: AnalysisResult;
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onCoachExplain: (move: AnalyzedMove) => void;
  /** Engine depth used to review free/explore moves. Defaults to 12 if not provided. */
  depth?: number;
}

export function AnalysisView({ analysis, currentIndex, onIndexChange, onCoachExplain, depth = 12 }: AnalysisViewProps) {
  const moves = analysis.moves;
  const move = moves[currentIndex] || null;
  const displayQuality: MoveQuality | null = move ? correctedQuality(move) : null;

  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const handleFlip = () => setOrientation((prev) => (prev === 'white' ? 'black' : 'white'));

  const [theaterMode, setTheaterMode] = useState(false);
  const [theaterTab, setTheaterTab] = useState<'moves' | 'details' | 'summary'>('moves');
  const [playing, setPlaying] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));
  const handleToggleTheater = () => {
    setPlaying(false);
    setTheaterMode((prev) => !prev);
  };

  // Theater mode takes over the whole window: track its size, lock page scroll, Esc to leave.
  useEffect(() => {
    if (!theaterMode) return;
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPlaying(false);
        setTheaterMode(false);
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [theaterMode]);

  // Auto-play through the game (theater mode's play button)
  useEffect(() => {
    if (!playing) return;
    if (currentIndex >= moves.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => onIndexChange(currentIndex + 1), 900);
    return () => clearTimeout(t);
  }, [playing, currentIndex, moves.length, onIndexChange]);

  const [bestPreview, setBestPreview] = useState<{
    fen: string; from: Square; to: Square; san: string; uci: string;
  } | null>(null);

  // Free-move exploration: leave the game line, try moves, then go back/forward through them
  const [exploreSteps, setExploreSteps] = useState<ExploreStep[]>([]); // moves made, oldest → newest (last = current)
  const [redoSteps, setRedoSteps] = useState<ExploreStep[]>([]); // undone moves, available to redo (last = next to redo)
  const stepIdRef = useRef(0);

  useEffect(() => {
    setBestPreview(null);
    setExploreSteps([]);
    setRedoSteps([]);
  }, [currentIndex]);

  const [openingBook, setOpeningBook] = useState<Map<string, OpeningHit> | null>(null);
  useEffect(() => {
    let cancelled = false;
    getOpeningBook().then((book) => {
      if (!cancelled) setOpeningBook(book);
    });
    return () => { cancelled = true; };
  }, []);

  const liveOpening = useMemo(() => {
    if (!openingBook || moves.length === 0) {
      // Fall back to analysis-provided opening
      if (analysis.opening?.name) {
        return { eco: analysis.opening.eco || '', name: analysis.opening.name };
      }
      return null;
    }
    return findOpeningForMoves(openingBook, moves, currentIndex);
  }, [openingBook, moves, currentIndex, analysis.opening]);

  const currentExploreStep = exploreSteps.length > 0 ? exploreSteps[exploreSteps.length - 1] : null;
  const isExploring = currentExploreStep != null;
  const exploreFen = currentExploreStep?.fenAfter ?? null;
  const exploreLastMove = currentExploreStep ? { from: currentExploreStep.from, to: currentExploreStep.to } : null;
  const exploreReview = currentExploreStep?.review ?? null;
  const canExploreUndo = exploreSteps.length > 0;
  const canExploreRedo = redoSteps.length > 0;

  function updateStepReview(id: number, review: ExploreReview) {
    setExploreSteps((prev) => prev.map((s) => (s.id === id ? { ...s, review } : s)));
    setRedoSteps((prev) => prev.map((s) => (s.id === id ? { ...s, review } : s)));
  }

  async function reviewStep(step: ExploreStep) {
    try {
      const playedUci = step.from + step.to + (step.promotion || '');
      const [evalBefore, evalAfter] = await Promise.all([
        analyzePosition(step.fenBefore, depth),
        analyzePosition(step.fenAfter, depth),
      ]);
      const { quality, evalLoss, winPercentLoss, isBest } = classifyMove(
        evalBefore,
        evalAfter,
        playedUci,
        step.color,
        false,
        step.san,
      );
      updateStepReview(step.id, {
        status: 'done',
        san: step.san,
        color: step.color,
        quality,
        evalLoss,
        winPercentLoss,
        isBest,
        bestMoveUci: evalBefore.bestMove,
      });
    } catch {
      updateStepReview(step.id, { status: 'error', san: step.san, color: step.color });
    }
  }

  function handleUserMove(m: { from: Square; to: Square; promotion?: string; san: string; fen: string }) {
    setPlaying(false);
    setBestPreview(null);
    const beforeFen = exploreFen ?? (move?.fenAfter ?? new Chess().fen());
    const color: PieceColor = beforeFen.split(' ')[1] === 'b' ? 'b' : 'w';
    const step: ExploreStep = {
      id: ++stepIdRef.current,
      fenBefore: beforeFen,
      fenAfter: m.fen,
      from: m.from,
      to: m.to,
      promotion: m.promotion,
      san: m.san,
      color,
      review: { status: 'loading', san: m.san, color },
    };
    setExploreSteps((prev) => [...prev, step]);
    setRedoSteps([]); // making a new move discards any redo history from a prior branch
    reviewStep(step);
  }

  function undoExploreMove() {
    setBestPreview(null);
    setExploreSteps((prev) => {
      if (prev.length === 0) return prev;
      const popped = prev[prev.length - 1];
      setRedoSteps((r) => [...r, popped]);
      return prev.slice(0, -1);
    });
  }

  function redoExploreMove() {
    setBestPreview(null);
    setRedoSteps((prev) => {
      if (prev.length === 0) return prev;
      const popped = prev[prev.length - 1];
      setExploreSteps((e) => [...e, popped]);
      return prev.slice(0, -1);
    });
  }

  function exitExplore() {
    setExploreSteps([]);
    setRedoSteps([]);
    setBestPreview(null);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        if (currentIndex < moves.length - 1) onIndexChange(currentIndex + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (currentIndex > 0) onIndexChange(currentIndex - 1);
      } else if (event.key === 'Home') { event.preventDefault(); onIndexChange(0); }
      else if (event.key === 'End') { event.preventDefault(); onIndexChange(moves.length - 1); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, moves.length, onIndexChange]);

  const fen = useMemo(() => {
    if (exploreFen) return exploreFen;
    if (bestPreview) return bestPreview.fen;
    if (!move) return new Chess().fen();
    return move.fenAfter;
  }, [move, bestPreview, exploreFen]);

  const moveCoords = useMemo(() => {
    if (exploreLastMove) return exploreLastMove;
    if (bestPreview) return { from: bestPreview.from, to: bestPreview.to };
    if (!move) return null;
    try {
      const chess = new Chess(move.fenBefore);
      const result = chess.move(move.san);
      if (result) return { from: result.from as Square, to: result.to as Square };
    } catch {}
    return null;
  }, [move, bestPreview, exploreLastMove]);

  const boardMaxSize = 580;
  const { ref: boardColRef, width: boardRenderedSize } = useElementSize<HTMLDivElement>();
  const boardSize = boardRenderedSize || boardMaxSize;

  const whiteName = analysis.game.white || 'White';
  const blackName = analysis.game.black || 'Black';
  const topName = orientation === 'white' ? blackName : whiteName;
  const bottomName = orientation === 'white' ? whiteName : blackName;
  const topColor: 'white' | 'black' = orientation === 'white' ? 'black' : 'white';
  const bottomColor: 'white' | 'black' = orientation === 'white' ? 'white' : 'black';

  const realistic = useMemo(
    () => computeRealisticAccuracy(moves, analysis.game?.result),
    [moves, analysis.game?.result]
  );
  const whiteAccuracy = moves.length > 0 ? realistic.white : (analysis.accuracy?.white ?? 0);
  const blackAccuracy = moves.length > 0 ? realistic.black : (analysis.accuracy?.black ?? 0);

  const gameAny = analysis.game as any;
  const embeddedWhite: number | null =
    typeof gameAny.whiteRating === 'number' ? gameAny.whiteRating
    : typeof gameAny.whiteElo === 'number' ? gameAny.whiteElo
    : typeof gameAny.white_elo === 'number' ? gameAny.white_elo
    : null;
  const embeddedBlack: number | null =
    typeof gameAny.blackRating === 'number' ? gameAny.blackRating
    : typeof gameAny.blackElo === 'number' ? gameAny.blackElo
    : typeof gameAny.black_elo === 'number' ? gameAny.black_elo
    : null;

  const [fetchedRatings, setFetchedRatings] = useState<{ white: number | null; black: number | null }>({
    white: null, black: null,
  });

  useEffect(() => {
    let cancelled = false;
    const timeControl = analysis.game?.timeControl || gameAny.time_control || null;
    (async () => {
      const [w, b] = await Promise.all([
        embeddedWhite != null ? Promise.resolve(null) : fetchChessComRating(whiteName, timeControl),
        embeddedBlack != null ? Promise.resolve(null) : fetchChessComRating(blackName, timeControl),
      ]);
      if (!cancelled) setFetchedRatings({ white: w, black: b });
    })();
    return () => { cancelled = true; };
  }, [whiteName, blackName, embeddedWhite, embeddedBlack, analysis.game?.timeControl]);

  const whitePlayerRating = embeddedWhite ?? fetchedRatings.white;
  const blackPlayerRating = embeddedBlack ?? fetchedRatings.black;

  const whiteErrors = useMemo(() => ({
    blunders: moves.filter(m => m.color === 'w' && scoringQuality(m) === 'blunder').length,
    mistakes: moves.filter(m => m.color === 'w' && scoringQuality(m) === 'mistake').length,
    misses: moves.filter(m => m.color === 'w' && scoringQuality(m) === 'miss').length,
    inaccuracies: moves.filter(m => m.color === 'w' && scoringQuality(m) === 'inaccuracy').length,
  }), [moves]);
  const blackErrors = useMemo(() => ({
    blunders: moves.filter(m => m.color === 'b' && scoringQuality(m) === 'blunder').length,
    mistakes: moves.filter(m => m.color === 'b' && scoringQuality(m) === 'mistake').length,
    misses: moves.filter(m => m.color === 'b' && scoringQuality(m) === 'miss').length,
    inaccuracies: moves.filter(m => m.color === 'b' && scoringQuality(m) === 'inaccuracy').length,
  }), [moves]);

  const whiteGameRating = estimateGameRating(whiteAccuracy, whitePlayerRating, whiteErrors);
  const blackGameRating = estimateGameRating(blackAccuracy, blackPlayerRating, blackErrors);

  const qualityRows = useMemo(() => {
    const categories: { q: MoveQuality; label: string }[] = [
      { q: 'brilliant', label: 'Brilliant' },
      { q: 'great', label: 'Great' },
      { q: 'book', label: 'Book' },
      { q: 'best', label: 'Best' },
      { q: 'excellent', label: 'Excellent' },
      { q: 'good', label: 'Good' },
      { q: 'inaccuracy', label: 'Inaccuracy' },
      { q: 'mistake', label: 'Mistake' },
      { q: 'miss', label: 'Miss' },
      { q: 'blunder', label: 'Blunder' },
    ];
    return categories.map(({ q, label }) => ({
      q, label,
      whiteCount: moves.filter(m => m.color === 'w' && correctedQuality(m) === q).length,
      blackCount: moves.filter(m => m.color === 'b' && correctedQuality(m) === q).length,
      meta: QUALITY_META[q],
    }));
  }, [moves]);

  const playedUci = useMemo(() => {
    if (!move) return null;
    try {
      const chess = new Chess(move.fenBefore);
      const result = chess.move(move.san);
      if (!result) return null;
      return result.from + result.to + (result.promotion || '');
    } catch { return null; }
  }, [move]);

  const engineBestUci = move?.evalBefore?.bestMove || null;
  const isPlayedBest =
    !!playedUci && !!engineBestUci &&
    playedUci.slice(0, 4) === engineBestUci.slice(0, 4) &&
    (playedUci.length <= 4 || engineBestUci.length <= 4 || playedUci[4] === engineBestUci[4]);

  function handleBestMoveClick(uci: string) {
    if (!move || uci.length < 4) return;
    if (playedUci && uci.slice(0, 4) === playedUci.slice(0, 4)) {
      setBestPreview(null);
      return;
    }
    try {
      const chess = new Chess(move.fenBefore);
      const result = chess.move({
        from: uci.slice(0, 2), to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (result) {
        setBestPreview({
          fen: chess.fen(), from: result.from as Square, to: result.to as Square,
          san: result.san, uci,
        });
      }
    } catch {}
  }

  const moveMeta = displayQuality ? QUALITY_META[displayQuality] : null;

  const exploreQuality: MoveQuality | null =
    exploreReview && exploreReview.status === 'done' && exploreReview.quality ? exploreReview.quality : null;
  const exploreBestUci: string | null =
    exploreReview && exploreReview.status === 'done' && !exploreReview.isBest
      ? exploreReview.bestMoveUci || null
      : null;

  const renderBoard = (boardPx: number) => (
            <ChessBoard
              fen={fen}
              orientation={orientation}
              lastMove={moveCoords}
              bestMoveUci={
                bestPreview
                  ? null
                  : isExploring
                    ? exploreBestUci
                    : isPlayedBest
                      ? null
                      : (move?.evalBefore?.bestMove || null)
              }
              annotationSquare={
                bestPreview
                  ? null
                  : isExploring
                    ? (exploreQuality ? exploreLastMove?.to || null : null)
                    : (moveCoords?.to || null)
              }
              annotationColor={
                bestPreview
                  ? null
                  : isExploring
                    ? (exploreQuality ? QUALITY_META[exploreQuality]?.color : null)
                    : displayQuality
                      ? QUALITY_META[displayQuality]?.color
                      : null
              }
              moveQuality={bestPreview ? null : isExploring ? exploreQuality : displayQuality}
              size={boardPx}
              whiteName={whiteName}
              blackName={blackName}
              interactive
              onUserMove={handleUserMove}
            />
  );

  const exploreBanner = (isExploring || canExploreRedo) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-200">
            <span>
              <span className="font-semibold">Explore mode</span>
              <span className="text-amber-200/70"> — drag pieces freely. Engine arrows hide until you return.</span>
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={undoExploreMove}
                disabled={!canExploreUndo}
                className="btn-ghost text-xs px-2 py-1 disabled:opacity-40 disabled:cursor-default"
                title="Undo last free move"
              >
                ← Undo
              </button>
              <button
                onClick={redoExploreMove}
                disabled={!canExploreRedo}
                className="btn-ghost text-xs px-2 py-1 disabled:opacity-40 disabled:cursor-default"
                title="Redo next free move"
              >
                Redo →
              </button>
              <button
                onClick={exitExplore}
                className="btn-secondary text-xs px-2.5 py-1"
                title="Return to the game position"
              >
                Back to game
              </button>
            </div>
          </div>
  );

  const bestPreviewBanner = bestPreview && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-500/10 border border-brand-500/30 px-3 py-2 text-sm text-brand-300">
            <span>
              Previewing engine best: <span className="font-mono font-semibold">{bestPreview.san}</span>{' '}
              <span className="text-brand-400/70">({bestPreview.uci})</span>
            </span>
            <button onClick={() => setBestPreview(null)} className="btn-ghost text-xs px-2 py-1 shrink-0">
              <X size={12} /> Back
            </button>
          </div>
  );

  const moveDetailsCard = move && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink-300">Move Details</h3>
              <QualityBadge quality={displayQuality!} />
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-400">Move</span>
                <span className="font-mono font-medium">{Math.floor(move.index / 2) + 1}. {move.color === 'w' ? '' : '...'}{move.san}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-400">Eval before</span>
                <span className="font-mono">{move.evalBefore ? formatEval(move.evalBefore) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-400">Eval after</span>
                <span className="font-mono">{move.evalAfter ? formatEval(move.evalAfter) : '—'}</span>
              </div>
              {move.evalLoss !== null && (
                <div className="flex justify-between items-center">
                  <span className="text-ink-400 flex items-center gap-1">Loss <Info size={12} className="opacity-50" /></span>
                  <span className="font-mono text-accent-400">{move.evalLoss.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-ink-400">Engine best</span>
                {isPlayedBest ? (
                  <span className="font-mono text-brand-300 flex items-center gap-1.5">
                    {move.evalBefore?.bestMove || '—'}
                    <span className="text-[10px] uppercase tracking-wide text-ink-500 font-sans">(same)</span>
                  </span>
                ) : (
                  <button
                    onClick={() => handleBestMoveClick(move.evalBefore?.bestMove || '')}
                    className="font-mono text-brand-300 hover:text-brand-200 hover:underline decoration-dotted underline-offset-2 cursor-pointer"
                    title="Click to preview this move on the board"
                  >
                    {move.evalBefore?.bestMove || '—'}
                  </button>
                )}
              </div>
            </div>
          </div>
  );

  const accuracyCard = (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1 flex flex-col items-center">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-3 h-3 rounded-full bg-white border border-ink-500" />
                <span className="text-sm font-semibold text-ink-100 truncate max-w-[120px]">{whiteName}</span>
              </div>
              <span className="text-3xl font-bold text-ink-100">{Math.round(whiteAccuracy)}</span>
              <span className="text-[10px] uppercase tracking-wide text-ink-500 mt-0.5">Accuracy</span>
              {whitePlayerRating != null && (
                <span className="text-xs text-ink-400 mt-0.5 font-mono">{whitePlayerRating}</span>
              )}
            </div>
            <div className="flex-1 flex flex-col items-center">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-3 h-3 rounded-full bg-[#2a2e39] border border-ink-500" />
                <span className="text-sm font-semibold text-ink-100 truncate max-w-[120px]">{blackName}</span>
              </div>
              <span className="text-3xl font-bold text-ink-100">{Math.round(blackAccuracy)}</span>
              <span className="text-[10px] uppercase tracking-wide text-ink-500 mt-0.5">Accuracy</span>
              {blackPlayerRating != null && (
                <span className="text-xs text-ink-400 mt-0.5 font-mono">{blackPlayerRating}</span>
              )}
            </div>
          </div>
          <div className="space-y-0.5">
            {qualityRows.map(({ q, label, whiteCount, blackCount, meta }) => (
              <div key={q} className="flex items-center py-1">
                <span className="w-24 text-sm text-ink-300 shrink-0">{label}</span>
                <span className="flex-1 text-right pr-4 text-sm font-bold font-mono" style={{ color: meta.color }}>{whiteCount}</span>
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: meta.color }}>
                  {q === 'brilliant' && <span className="text-[9px] font-bold text-white leading-none">!!</span>}
                  {q === 'great' && <span className="text-[10px] font-bold text-white leading-none">!</span>}
                  {q === 'book' && <BookOpen size={12} className="text-white" />}
                  {q === 'best' && <Star size={12} className="text-white" />}
                  {q === 'excellent' && <ThumbsUp size={12} className="text-white" />}
                  {q === 'good' && <CheckCircle2 size={12} className="text-white" />}
                  {q === 'inaccuracy' && <span className="text-[9px] font-bold text-white leading-none">?!</span>}
                  {q === 'mistake' && <span className="text-[10px] font-bold text-white leading-none">?</span>}
                  {q === 'miss' && <XCircle size={12} className="text-white" />}
                  {q === 'blunder' && <span className="text-[9px] font-bold text-white leading-none">??</span>}
                </div>
                <span className="flex-1 text-left pl-4 text-sm font-bold font-mono" style={{ color: meta.color }}>{blackCount}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-ink-700/50">
            <div className="flex items-center">
              <span className="w-24 text-sm text-ink-400 shrink-0" title="Estimated strength of play in this game">Game Rating</span>
              <span className="flex-1 text-right pr-4 text-sm font-bold text-ink-100 font-mono">
                {whiteGameRating}
                {whitePlayerRating != null && (
                  <span className={`ml-1 text-xs font-normal ${whiteGameRating >= whitePlayerRating ? 'text-brand-400' : 'text-accent-400'}`}>
                    {whiteGameRating >= whitePlayerRating ? '+' : ''}{whiteGameRating - whitePlayerRating}
                  </span>
                )}
              </span>
              <div className="w-6 shrink-0" />
              <span className="flex-1 text-left pl-4 text-sm font-bold text-ink-100 font-mono">
                {blackGameRating}
                {blackPlayerRating != null && (
                  <span className={`ml-1 text-xs font-normal ${blackGameRating >= blackPlayerRating ? 'text-brand-400' : 'text-accent-400'}`}>
                    {blackGameRating >= blackPlayerRating ? '+' : ''}{blackGameRating - blackPlayerRating}
                  </span>
                )}
              </span>
            </div>
            {(whitePlayerRating != null || blackPlayerRating != null) && (
              <p className="text-[10px] text-ink-500 mt-1.5 text-center">Compared to your rating · higher = played above your level</p>
            )}
          </div>
        </div>
  );

  const keyMomentsCard = (() => {
          const blunders = moves.filter(m => correctedQuality(m) === 'blunder');
          const mistakes = moves.filter(m => correctedQuality(m) === 'mistake');
          return (blunders.length > 0 || mistakes.length > 0) ? (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-ink-300 mb-3">Key Moments</h3>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {blunders.slice(0, 5).map((m) => (
                  <button key={m.index} onClick={() => onIndexChange(m.index)} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-700/50 transition-colors text-left">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: QUALITY_META.blunder.color }} />
                    <span className="font-mono">{Math.floor(m.index / 2) + 1}. {m.color === 'w' ? '' : '...'}{m.san}</span>
                    <span className="ml-auto text-xs font-bold" style={{ color: QUALITY_META.blunder.color }}>Blunder</span>
                  </button>
                ))}
                {mistakes.slice(0, 5).map((m) => (
                  <button key={m.index} onClick={() => onIndexChange(m.index)} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-700/50 transition-colors text-left">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: QUALITY_META.mistake.color }} />
                    <span className="font-mono">{Math.floor(m.index / 2) + 1}. {m.color === 'w' ? '' : '...'}{m.san}</span>
                    <span className="ml-auto text-xs font-bold" style={{ color: QUALITY_META.mistake.color }}>Mistake</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null;
  })();

  // ─────────────────────────────────────────────────────────────────────────
  // Theater mode: full-window layout — players | board | tabbed panel
  // ─────────────────────────────────────────────────────────────────────────
  if (theaterMode) {
    const LEFT_W = 176;
    const PANEL_W = 380;
    const EVAL_W = 40;
    const GAP = 24;
    const PAD = 32;

    const isWide = viewport.w >= 1024;
    const theaterBoardPx = Math.max(
      isWide ? 320 : 260,
      Math.floor(
        isWide
          ? Math.min(viewport.h - PAD, viewport.w - LEFT_W - PANEL_W - EVAL_W - GAP * 2 - PAD)
          : viewport.w - PAD - EVAL_W
      )
    );

    const toMove: 'white' | 'black' = fen.split(' ')[1] === 'b' ? 'black' : 'white';
    const ratingFor = (c: 'white' | 'black') => (c === 'white' ? whitePlayerRating : blackPlayerRating);
    const accuracyFor = (c: 'white' | 'black') => (c === 'white' ? whiteAccuracy : blackAccuracy);

    // Totals for both players, e.g. "6 Best · 6 Excellent · 1 Blunder"
    const summaryChips = qualityRows.filter(
      (r) => r.q !== 'good' && r.q !== 'book' && r.whiteCount + r.blackCount > 0
    );

    const bookText =
      liveOpening
        ? `Book move — ${liveOpening.name} (${liveOpening.eco}).`
        : move?.opening
          ? `Book move — ${move.opening.name} (${move.opening.eco}).`
          : 'A known opening move.';

    const theaterCoach = isExploring ? (
      <FreeMoveReviewCard review={exploreReview} />
    ) : move && moveMeta ? (
      <div className="rounded-xl bg-ink-800/80 border border-ink-700/60 p-3">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold"
            style={{ backgroundColor: moveMeta.bg, color: moveMeta.color }}
          >
            <moveMeta.icon size={10} />
            {moveMeta.label}
          </span>
          {move.evalLoss !== null && move.evalLoss > 0.05 && (
            <span className="text-xs font-mono font-semibold text-ink-300">+{move.evalLoss.toFixed(2)}</span>
          )}
          {move.evalAfter && (
            <span className="ml-auto text-xs font-mono text-ink-400">{formatEval(move.evalAfter)}</span>
          )}
        </div>
        <p className="text-sm font-semibold text-ink-100">
          {move.color === 'w' ? 'White' : 'Black'} played {move.san}
        </p>
        <p className="text-xs text-ink-400 mt-0.5">
          {displayQuality === 'book' ? bookText : qualityBlurb(displayQuality!, isPlayedBest)}
        </p>
      </div>
    ) : null;

    const navBtn =
      'flex items-center justify-center rounded-lg bg-ink-700/60 hover:bg-ink-600/70 py-3 text-ink-200 transition-colors disabled:opacity-40 disabled:cursor-default';

    const tabs: { id: 'moves' | 'details' | 'summary'; label: string }[] = [
      { id: 'moves', label: 'Moves' },
      { id: 'details', label: 'Details' },
      { id: 'summary', label: 'Summary' },
    ];

    return (
      <div className="fixed inset-0 z-50 bg-ink-900 overflow-y-auto">
        <div
          className={
            isWide
              ? 'min-h-full flex items-center justify-center gap-6 p-4'
              : 'flex flex-col items-center gap-4 p-4'
          }
        >
          {/* Players — aligned with the board's top and bottom edges */}
          {isWide && (
            <div className="flex flex-col justify-between shrink-0" style={{ width: LEFT_W, height: theaterBoardPx }}>
              <PlayerCard
                name={topName}
                color={topColor}
                rating={ratingFor(topColor)}
                accuracy={accuracyFor(topColor)}
                active={toMove === topColor}
              />
              <PlayerCard
                name={bottomName}
                color={bottomColor}
                rating={ratingFor(bottomColor)}
                accuracy={accuracyFor(bottomColor)}
                active={toMove === bottomColor}
              />
            </div>
          )}

          {/* Board */}
          <div className="flex flex-col gap-2 shrink-0">
            {!isWide && <PlayerBar name={topName} color={topColor} />}
            <div className="flex items-stretch gap-2">
              <EvalBar evaluation={move?.evalAfter ?? null} orientation={orientation} height={theaterBoardPx} />
              <div style={{ width: theaterBoardPx }}>{renderBoard(theaterBoardPx)}</div>
            </div>
            {!isWide && <PlayerBar name={bottomName} color={bottomColor} />}
          </div>

          {/* Side panel */}
          <div
            className="flex flex-col rounded-xl border border-ink-700/60 bg-ink-800/50 overflow-hidden shrink-0"
            style={isWide ? { width: PANEL_W, height: theaterBoardPx } : { width: '100%', maxWidth: 560 }}
          >
            <div className="flex items-center border-b border-ink-700/60 shrink-0">
              <div className="flex flex-1">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTheaterTab(t.id)}
                    className={`flex-1 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
                      theaterTab === t.id
                        ? 'border-brand-400 text-brand-300'
                        : 'border-transparent text-ink-400 hover:text-ink-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button
                onClick={handleToggleTheater}
                className="btn-ghost p-2 mx-1 shrink-0"
                title="Exit theater mode (Esc)"
              >
                <X size={18} />
              </button>
            </div>

            <div className={`flex-1 min-h-0 overflow-y-auto ${isWide ? '' : 'max-h-[50vh]'}`}>
              {theaterTab === 'moves' && (
                <>
                  {liveOpening && !isExploring && (
                    <div className="flex items-center gap-2 px-4 py-2.5 text-xs text-ink-400 border-b border-ink-700/40">
                      <BookOpen size={12} className="text-[#a88865] shrink-0" />
                      <span className="font-mono text-ink-500">{liveOpening.eco}</span>
                      <span className="truncate" title={liveOpening.name}>{liveOpening.name}</span>
                    </div>
                  )}
                  <div className="p-3">
                    <MoveList moves={moves} currentIndex={currentIndex} onSelect={onIndexChange} />
                  </div>
                </>
              )}

              {theaterTab === 'details' && (
                <div className="p-3 space-y-3">
                  {moveDetailsCard || <p className="text-sm text-ink-400 p-2">Select a move to see its details.</p>}
                </div>
              )}

              {theaterTab === 'summary' && (
                <div className="p-3 space-y-3">
                  <div className="card p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-ink-400">Evaluation</span>
                      {move?.evalAfter && (
                        <span className="text-sm font-mono font-semibold">{formatEval(move.evalAfter)}</span>
                      )}
                    </div>
                    <EvalGraph moves={moves} currentIndex={currentIndex} onSelect={onIndexChange} />
                  </div>
                  {accuracyCard}
                  {keyMomentsCard}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-ink-700/60 bg-ink-900/40 p-3 space-y-3">
              {exploreBanner}
              {bestPreviewBanner}

              {summaryChips.length > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
                  {summaryChips.map((r) => (
                    <span
                      key={r.q}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold"
                      style={{ color: r.meta.color }}
                    >
                      <QualityGlyph q={r.q} size={18} />
                      {r.whiteCount + r.blackCount} {r.label}
                    </span>
                  ))}
                </div>
              )}

              {theaterCoach}

              <button
                onClick={() => move && onCoachExplain(move)}
                disabled={!move || isExploring}
                className="btn-primary w-full justify-center py-3 text-base font-bold disabled:opacity-50"
                title={isExploring ? 'Return to the game to ask the coach about a move' : 'Ask the coach to explain this move'}
              >
                <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center">
                  <Star size={14} className="text-brand-600" fill="currentColor" />
                </span>
                Explain this move
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => move && handleBestMoveClick(move.evalBefore?.bestMove || '')}
                  disabled={!move || isPlayedBest || !engineBestUci}
                  className="btn-secondary justify-center py-2.5 text-sm disabled:opacity-40"
                  title={isPlayedBest ? "This move was already the engine's best choice" : "Preview the engine's best move"}
                >
                  <Sparkles size={14} /> {isPlayedBest ? 'Was best' : 'Best move'}
                </button>
                <button onClick={handleFlip} className="btn-secondary justify-center py-2.5 text-sm" title="Flip board">
                  <RotateCcw size={14} /> Flip board
                </button>
              </div>

              <div className="grid grid-cols-5 gap-2">
                <button onClick={() => onIndexChange(0)} disabled={currentIndex === 0} className={navBtn} title="First move (Home)">
                  <ChevronsLeft size={20} />
                </button>
                <button onClick={() => onIndexChange(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} className={navBtn} title="Previous (←)">
                  <ChevronLeft size={20} />
                </button>
                <button
                  onClick={() => setPlaying((p) => !p)}
                  disabled={!playing && currentIndex >= moves.length - 1}
                  className={navBtn}
                  title={playing ? 'Pause' : 'Play through the game'}
                >
                  {playing ? <Pause size={20} /> : <Play size={20} />}
                </button>
                <button onClick={() => onIndexChange(Math.min(moves.length - 1, currentIndex + 1))} disabled={currentIndex >= moves.length - 1} className={navBtn} title="Next (→)">
                  <ChevronRight size={20} />
                </button>
                <button onClick={() => onIndexChange(moves.length - 1)} disabled={currentIndex >= moves.length - 1} className={navBtn} title="Last move (End)">
                  <ChevronsRight size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[minmax(0,580px)_1fr_380px] gap-4 sm:gap-6"
    >
      <div className="flex flex-col gap-4 min-w-0">
        <div className="flex justify-center items-stretch gap-1.5 sm:gap-2 w-full">
          <EvalBar evaluation={move?.evalAfter ?? null} orientation={orientation} height={boardSize} />
          <div ref={boardColRef} className="flex flex-col gap-1.5 flex-1 min-w-0" style={{ maxWidth: boardMaxSize }}>
            <PlayerBar name={topName} color={topColor} />
            {renderBoard(boardMaxSize)}
            <div className="flex items-center justify-between gap-2">
              <PlayerBar name={bottomName} color={bottomColor} />
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={handleToggleTheater}
                  className="btn-secondary px-2.5 py-1.5 hidden lg:inline-flex"
                  title="Theater mode — full-window board"
                >
                  <Maximize2 size={14} />
                </button>
                <button onClick={handleFlip} className="btn-secondary px-2.5 py-1.5" title="Flip board">
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2">
          <button onClick={() => onIndexChange(0)} disabled={currentIndex === 0} className="btn-secondary px-2.5" title="First move (Home)">«</button>
          <button onClick={() => onIndexChange(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} className="btn-secondary px-2.5" title="Previous (←)">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-ink-400 font-mono px-3">{currentIndex + 1} / {moves.length}</span>
          <button onClick={() => onIndexChange(Math.min(moves.length - 1, currentIndex + 1))} disabled={currentIndex === moves.length - 1} className="btn-secondary px-2.5" title="Next (→)">
            <ChevronRight size={16} />
          </button>
          <button onClick={() => onIndexChange(moves.length - 1)} disabled={currentIndex === moves.length - 1} className="btn-secondary px-2.5" title="Last (End)">»</button>
        </div>
        {liveOpening && !isExploring && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-ink-400">
            <BookOpen size={12} className="text-[#a88865] shrink-0" />
            <span className="font-mono text-ink-500">{liveOpening.eco}</span>
            <span className="truncate max-w-[280px]" title={liveOpening.name}>{liveOpening.name}</span>
          </div>
        )}



        {exploreBanner}

        {bestPreviewBanner}

        {/* Mobile: coach card under board (above evaluation) */}
        <div className="lg:hidden">
        {isExploring ? (
          <FreeMoveReviewCard review={exploreReview} />
        ) : move && moveMeta && (
          <div className="card p-0 overflow-hidden">
            <div className="flex items-start gap-3 p-4 pb-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shrink-0 shadow-lg">
                <Zap size={22} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: moveMeta.bg, color: moveMeta.color }}>
                    <moveMeta.icon size={10} />
                    {moveMeta.label}
                  </span>
                  {move.evalLoss !== null && move.evalLoss > 0.05 && (
                    <span className="text-xs font-mono font-semibold text-ink-300">+{move.evalLoss.toFixed(2)}</span>
                  )}
                </div>
                <h3 className="text-base font-semibold text-ink-100">
                  {move.color === 'w' ? 'White' : 'Black'} played {move.san}
                </h3>
                <p className="text-sm text-ink-400 mt-0.5">
                  {displayQuality === 'blunder' && 'This is a serious mistake that changes the evaluation significantly.'}
                  {displayQuality === 'mistake' && 'This move gives away some of the advantage.'}
                  {displayQuality === 'inaccuracy' && 'A better move was available, but this is playable.'}
                  {displayQuality === 'best' && 'The best move in this position!'}
                  {displayQuality === 'brilliant' && 'A stunning move that finds a difficult tactical solution.'}
                  {displayQuality === 'great' && 'An excellent move that finds the best continuation.'}
                  {displayQuality === 'excellent' && (isPlayedBest ? "This was the engine's top choice — excellent play." : 'A very strong move, close to the best.')}
                  {displayQuality === 'good' && 'A solid move that maintains the position.'}
                  {displayQuality === 'book' && (
                    liveOpening
                      ? `Book move — ${liveOpening.name} (${liveOpening.eco}).`
                      : move.opening
                        ? `Book move — ${move.opening.name} (${move.opening.eco}).`
                        : 'A known opening move.'
                  )}
                  {displayQuality === 'miss' && 'A tactical opportunity was missed.'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-px bg-ink-700/50 border-t border-ink-700/50">
              <button onClick={() => onCoachExplain(move)} className="flex items-center justify-center gap-2 py-2.5 text-sm text-ink-200 hover:bg-ink-700/50 transition-colors">
                <MessageSquare size={14} className="text-brand-400" /> Explain
              </button>
              <button
                onClick={() => handleBestMoveClick(move.evalBefore?.bestMove || '')}
                disabled={isPlayedBest || !engineBestUci}
                title={isPlayedBest ? "This move was already the engine's best choice" : engineBestUci ? "Preview the engine's best move" : 'No engine best move'}
                className="flex items-center justify-center gap-2 py-2.5 text-sm text-ink-200 hover:bg-ink-700/50 transition-colors disabled:opacity-40 disabled:cursor-default"
              >
                <Sparkles size={14} className={isPlayedBest ? 'text-brand-400/50' : 'text-brand-400'} />
                {isPlayedBest ? 'Was Best' : 'Best'}
              </button>
              <button
                onClick={() => onIndexChange(Math.min(moves.length - 1, currentIndex + 1))}
                disabled={currentIndex === moves.length - 1}
                className="flex items-center justify-center gap-2 py-2.5 text-sm text-ink-200 hover:bg-ink-700/50 transition-colors disabled:opacity-40"
              >
                <ChevronRight size={14} className="text-brand-400" /> Next
              </button>
            </div>
          </div>
        )}

        </div>

        <div className="card p-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-ink-400 uppercase tracking-wide">Evaluation</span>
            {move?.evalAfter && (
              <span className="text-sm font-mono font-semibold">{formatEval(move.evalAfter)}</span>
            )}
          </div>
          <EvalGraph moves={moves} currentIndex={currentIndex} onSelect={onIndexChange} />
        </div>

      </div>

      <div className="card p-4 max-h-[320px] lg:max-h-[600px] overflow-y-auto">
        <h3 className="text-sm font-semibold text-ink-300 mb-3">Moves</h3>
        <MoveList moves={moves} currentIndex={currentIndex} onSelect={onIndexChange} />
      </div>

      <div className="space-y-4">
        {/* Desktop: coach card in right column */}
        <div className="hidden lg:block">
        {isExploring ? (
          <FreeMoveReviewCard review={exploreReview} />
        ) : move && moveMeta && (
          <div className="card p-0 overflow-hidden">
            <div className="flex items-start gap-3 p-4 pb-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shrink-0 shadow-lg">
                <Zap size={22} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: moveMeta.bg, color: moveMeta.color }}>
                    <moveMeta.icon size={10} />
                    {moveMeta.label}
                  </span>
                  {move.evalLoss !== null && move.evalLoss > 0.05 && (
                    <span className="text-xs font-mono font-semibold text-ink-300">+{move.evalLoss.toFixed(2)}</span>
                  )}
                </div>
                <h3 className="text-base font-semibold text-ink-100">
                  {move.color === 'w' ? 'White' : 'Black'} played {move.san}
                </h3>
                <p className="text-sm text-ink-400 mt-0.5">
                  {displayQuality === 'blunder' && 'This is a serious mistake that changes the evaluation significantly.'}
                  {displayQuality === 'mistake' && 'This move gives away some of the advantage.'}
                  {displayQuality === 'inaccuracy' && 'A better move was available, but this is playable.'}
                  {displayQuality === 'best' && 'The best move in this position!'}
                  {displayQuality === 'brilliant' && 'A stunning move that finds a difficult tactical solution.'}
                  {displayQuality === 'great' && 'An excellent move that finds the best continuation.'}
                  {displayQuality === 'excellent' && (isPlayedBest ? "This was the engine's top choice — excellent play." : 'A very strong move, close to the best.')}
                  {displayQuality === 'good' && 'A solid move that maintains the position.'}
                  {displayQuality === 'book' && (
                    liveOpening
                      ? `Book move — ${liveOpening.name} (${liveOpening.eco}).`
                      : move.opening
                        ? `Book move — ${move.opening.name} (${move.opening.eco}).`
                        : 'A known opening move.'
                  )}
                  {displayQuality === 'miss' && 'A tactical opportunity was missed.'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-px bg-ink-700/50 border-t border-ink-700/50">
              <button onClick={() => onCoachExplain(move)} className="flex items-center justify-center gap-2 py-2.5 text-sm text-ink-200 hover:bg-ink-700/50 transition-colors">
                <MessageSquare size={14} className="text-brand-400" /> Explain
              </button>
              <button
                onClick={() => handleBestMoveClick(move.evalBefore?.bestMove || '')}
                disabled={isPlayedBest || !engineBestUci}
                title={isPlayedBest ? "This move was already the engine's best choice" : engineBestUci ? "Preview the engine's best move" : 'No engine best move'}
                className="flex items-center justify-center gap-2 py-2.5 text-sm text-ink-200 hover:bg-ink-700/50 transition-colors disabled:opacity-40 disabled:cursor-default"
              >
                <Sparkles size={14} className={isPlayedBest ? 'text-brand-400/50' : 'text-brand-400'} />
                {isPlayedBest ? 'Was Best' : 'Best'}
              </button>
              <button
                onClick={() => onIndexChange(Math.min(moves.length - 1, currentIndex + 1))}
                disabled={currentIndex === moves.length - 1}
                className="flex items-center justify-center gap-2 py-2.5 text-sm text-ink-200 hover:bg-ink-700/50 transition-colors disabled:opacity-40"
              >
                <ChevronRight size={14} className="text-brand-400" /> Next
              </button>
            </div>
          </div>
        )}

        </div>

        {moveDetailsCard}

        {accuracyCard}

        {keyMomentsCard}
      </div>
    </div>
  );
}

function FreeMoveReviewCard({ review }: { review: ExploreReview | null }) {
  if (!review) return null;

  if (review.status === 'loading') {
    return (
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 p-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shrink-0 shadow-lg animate-pulse">
            <Zap size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-ink-100">
              {review.color === 'w' ? 'White' : 'Black'} played {review.san}
            </h3>
            <p className="text-sm text-ink-400 mt-0.5">Reviewing this move…</p>
          </div>
        </div>
      </div>
    );
  }

  if (review.status === 'error' || !review.quality) {
    return (
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 p-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shrink-0 shadow-lg">
            <Zap size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-ink-100">
              {review.color === 'w' ? 'White' : 'Black'} played {review.san}
            </h3>
            <p className="text-sm text-ink-400 mt-0.5">Couldn't reach the engine for this move.</p>
          </div>
        </div>
      </div>
    );
  }

  const meta = QUALITY_META[review.quality];
  const Icon = meta.icon;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shrink-0 shadow-lg">
          <Zap size={22} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: meta.bg, color: meta.color }}>
              <Icon size={10} />
              {meta.label}
            </span>
            {review.evalLoss != null && review.evalLoss > 0.05 && (
              <span className="text-xs font-mono font-semibold text-ink-300">+{review.evalLoss.toFixed(2)}</span>
            )}
          </div>
          <h3 className="text-base font-semibold text-ink-100">
            {review.color === 'w' ? 'White' : 'Black'} played {review.san}
          </h3>
          <p className="text-sm text-ink-400 mt-0.5">{qualityBlurb(review.quality, !!review.isBest)}</p>
        </div>
      </div>
    </div>
  );
}

function PlayerBar({ name, color }: { name: string; color: 'white' | 'black' }) {
  return (
    <div className="flex items-center gap-2 px-0.5">
      <span className="w-2.5 h-2.5 rounded-full border border-ink-600 shrink-0" style={{ backgroundColor: color === 'white' ? '#ebecd0' : '#2a2e39' }} />
      <span className="text-sm font-medium text-ink-200 truncate">{name}</span>
    </div>
  );
}

function QualityBadge({ quality }: { quality: MoveQuality }) {
  const meta = QUALITY_META[quality] || QUALITY_META.good;
  const Icon = meta.icon;
  return (
    <span className="chip inline-flex items-center gap-1" style={{ backgroundColor: meta.bg, color: meta.color }}>
      <Icon size={12} />
      {meta.label}
    </span>
  );
}

function QualityGlyph({ q, size = 20 }: { q: MoveQuality; size?: number }) {
  const icon = Math.round(size * 0.6);
  return (
    <span
      className="rounded-full flex items-center justify-center shrink-0"
      style={{ width: size, height: size, backgroundColor: QUALITY_META[q].color }}
    >
      {q === 'brilliant' && <span className="text-[9px] font-bold text-white leading-none">!!</span>}
      {q === 'great' && <span className="text-[10px] font-bold text-white leading-none">!</span>}
      {q === 'book' && <BookOpen size={icon} className="text-white" />}
      {q === 'best' && <Star size={icon} className="text-white" />}
      {q === 'excellent' && <ThumbsUp size={icon} className="text-white" />}
      {q === 'good' && <CheckCircle2 size={icon} className="text-white" />}
      {q === 'inaccuracy' && <span className="text-[9px] font-bold text-white leading-none">?!</span>}
      {q === 'mistake' && <span className="text-[10px] font-bold text-white leading-none">?</span>}
      {q === 'miss' && <XCircle size={icon} className="text-white" />}
      {q === 'blunder' && <span className="text-[9px] font-bold text-white leading-none">??</span>}
    </span>
  );
}

/** Player tile for the left column of theater mode. */
function PlayerCard({
  name, color, rating, accuracy, active,
}: {
  name: string;
  color: 'white' | 'black';
  rating: number | null;
  accuracy: number;
  active: boolean;
}) {
  const isWhite = color === 'white';
  return (
    <div className="flex flex-col items-center gap-2 text-center w-full">
      <div
        className={`w-24 h-24 rounded-xl flex items-center justify-center text-4xl font-bold select-none transition-shadow ${active ? 'ring-2 ring-brand-400' : 'ring-1 ring-ink-700'}`}
        style={{ backgroundColor: isWhite ? '#ebecd0' : '#2a2e39', color: isWhite ? '#2a2e39' : '#ebecd0' }}
        title={active ? 'To move' : undefined}
      >
        {name.trim().charAt(0).toUpperCase() || '?'}
      </div>
      <div className="min-w-0 w-full">
        <p className="text-sm font-semibold text-ink-100 truncate" title={name}>{name}</p>
        {rating != null && <p className="text-xs font-mono text-ink-400">{rating}</p>}
      </div>
      <span className="rounded-full bg-ink-800 px-2.5 py-0.5 text-xs text-ink-300">
        {Math.round(accuracy)}% accuracy
      </span>
    </div>
  );
}