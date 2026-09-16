import { useMemo, useState, useEffect } from 'react';
import { Chess, type Square } from 'chess.js';
import { ChessBoard } from './ChessBoard';
import { EvalBar } from './Evalbar';
import { EvalGraph } from './EvalGraph';
import { MoveList } from './MoveList';
import { formatEval, evalToPawns } from '@/lib/engine';
import { useElementSize } from '@/lib/useElementSize';
import type { AnalysisResult, AnalyzedMove, MoveQuality } from '@/lib/types';
import {
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Target,
  TrendingUp,
  Award,
  CheckCircle2,
  ThumbsUp,
  Minus,
  BookOpen,
  AlertCircle,
  XCircle,
  RotateCcw,
  Info,
  X,
  Star,
  HelpCircle,
  MessageSquare,
  Sparkles,
  Zap,
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

interface AnalysisViewProps {
  analysis: AnalysisResult;
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onCoachExplain: (move: AnalyzedMove) => void;
}

/**
 * Chess.com-style Game Rating (performance rating).
 *
 * Chess.com anchors performance to the player's actual rating and adjusts
 * by how the accuracy compares to what is typical for that rating.
 * Empirical fit from Chess.com rapid data: expected accuracy ≈ rating/100 + 64.
 * Each accuracy point above/below expected is worth ~100 Elo.
 * When no player rating is known we invert the same curve.
 */
function estimateGameRating(accuracy: number, playerRating: number | null): number {
  const acc = Math.max(0, Math.min(100, accuracy));
  if (playerRating != null && playerRating > 0) {
    const expectedAcc = playerRating / 100 + 64;
    // Clamp adjustment so a single wild game doesn't jump by thousands
    const delta = Math.max(-25, Math.min(25, acc - expectedAcc));
    return Math.round(Math.max(100, Math.min(3200, playerRating + delta * 100)));
  }
  // No rating available: invert Accuracy ≈ Elo/100 + 64
  // Soften the low end so 50% doesn't map to negative
  const raw = (acc - 64) * 100;
  return Math.round(Math.max(400, Math.min(3000, raw > 400 ? raw : 400 + (acc / 50) * 400)));
}

export function AnalysisView({ analysis, currentIndex, onIndexChange, onCoachExplain }: AnalysisViewProps) {
  const moves = analysis.moves;
  const move = moves[currentIndex] || null;

  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const handleFlip = () => setOrientation((prev) => (prev === 'white' ? 'black' : 'white'));

  const [bestPreview, setBestPreview] = useState<{
    fen: string;
    from: Square;
    to: Square;
    san: string;
    uci: string;
  } | null>(null);

  useEffect(() => {
    setBestPreview(null);
  }, [currentIndex]);

  // Keyboard navigation
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
      } else if (event.key === 'Home') {
        event.preventDefault();
        onIndexChange(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        onIndexChange(moves.length - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, moves.length, onIndexChange]);

  const fen = useMemo(() => {
    if (bestPreview) return bestPreview.fen;
    if (!move) return new Chess().fen();
    return move.fenAfter;
  }, [move, bestPreview]);

  const moveCoords = useMemo(() => {
    if (bestPreview) return { from: bestPreview.from, to: bestPreview.to };
    if (!move) return null;
    try {
      const chess = new Chess(move.fenBefore);
      const result = chess.move(move.san);
      if (result) return { from: result.from as Square, to: result.to as Square };
    } catch {}
    return null;
  }, [move, bestPreview]);

  // The board itself sizes responsively via CSS (width: 100%, aspect-ratio:
  // 1/1) up to this cap. We still measure its actual rendered width so the
  // eval bar (which needs a real pixel height) can match it on any screen.
  const boardMaxSize = 580;
  const { ref: boardColRef, width: boardRenderedSize } = useElementSize<HTMLDivElement>();
  const boardSize = boardRenderedSize || boardMaxSize;

  const whiteName = analysis.game.white || 'White';
  const blackName = analysis.game.black || 'Black';
  const topName = orientation === 'white' ? blackName : whiteName;
  const bottomName = orientation === 'white' ? whiteName : blackName;
  const topColor: 'white' | 'black' = orientation === 'white' ? 'black' : 'white';
  const bottomColor: 'white' | 'black' = orientation === 'white' ? 'white' : 'black';

  // Safely read accuracy / acpl with fallbacks for old localStorage data
  const whiteAccuracy = analysis.accuracy?.white ?? 0;
  const blackAccuracy = analysis.accuracy?.black ?? 0;
  const whiteAcpl = analysis.acpl?.white ?? 0;
  const blackAcpl = analysis.acpl?.black ?? 0;

  // Player ratings from the imported game (Chess.com / PGN tags), if present
  const gameAny = analysis.game as any;
  const whitePlayerRating: number | null =
    typeof gameAny.whiteRating === 'number' ? gameAny.whiteRating
    : typeof gameAny.whiteElo === 'number' ? gameAny.whiteElo
    : typeof gameAny.white_elo === 'number' ? gameAny.white_elo
    : null;
  const blackPlayerRating: number | null =
    typeof gameAny.blackRating === 'number' ? gameAny.blackRating
    : typeof gameAny.blackElo === 'number' ? gameAny.blackElo
    : typeof gameAny.black_elo === 'number' ? gameAny.black_elo
    : null;

  const whiteGameRating = estimateGameRating(whiteAccuracy, whitePlayerRating);
  const blackGameRating = estimateGameRating(blackAccuracy, blackPlayerRating);

  // Per-player, per-quality counts for the summary table
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
      q,
      label,
      whiteCount: moves.filter(m => m.color === 'w' && m.quality === q).length,
      blackCount: moves.filter(m => m.color === 'b' && m.quality === q).length,
      meta: QUALITY_META[q],
    }));
  }, [moves]);

  function handleBestMoveClick(uci: string) {
    if (!move || uci.length < 4) return;
    try {
      const chess = new Chess(move.fenBefore);
      const result = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (result) {
        setBestPreview({
          fen: chess.fen(),
          from: result.from as Square,
          to: result.to as Square,
          san: result.san,
          uci,
        });
      }
    } catch {}
  }

  const moveMeta = move ? QUALITY_META[move.quality] : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,580px)_1fr_380px] gap-4 sm:gap-6">
      {/* ── LEFT: Board column ── */}
      <div className="flex flex-col gap-4 min-w-0">
        <div className="flex justify-center items-stretch gap-1.5 sm:gap-2 w-full">
          <EvalBar evaluation={move?.evalAfter ?? null} orientation={orientation} height={boardSize} />
          <div ref={boardColRef} className="flex flex-col gap-1.5 flex-1 min-w-0" style={{ maxWidth: boardMaxSize }}>
            <PlayerBar name={topName} color={topColor} />
            <ChessBoard
              fen={fen}
              orientation={orientation}
              lastMove={moveCoords}
              bestMoveUci={move?.evalBefore?.bestMove || null}
              annotationSquare={moveCoords?.to || null}
              annotationColor={move ? QUALITY_META[move.quality]?.color : null}
              moveQuality={move?.quality ?? null}
              size={boardMaxSize}
              whiteName={whiteName}
              blackName={blackName}
            />
            <div className="flex items-center justify-between gap-2">
              <PlayerBar name={bottomName} color={bottomColor} />
              <button onClick={handleFlip} className="btn-secondary px-2.5 py-1.5 shrink-0" title="Flip board">
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Best-move preview banner */}
        {bestPreview && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-500/10 border border-brand-500/30 px-3 py-2 text-sm text-brand-300">
            <span>
              Previewing engine best: <span className="font-mono font-semibold">{bestPreview.san}</span>{' '}
              <span className="text-brand-400/70">({bestPreview.uci})</span>
            </span>
            <button onClick={() => setBestPreview(null)} className="btn-ghost text-xs px-2 py-1 shrink-0">
              <X size={12} /> Back
            </button>
          </div>
        )}

        {/* Eval graph */}
        <div className="card p-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-ink-400 uppercase tracking-wide">Evaluation</span>
            {move?.evalAfter && (
              <span className="text-sm font-mono font-semibold">{formatEval(move.evalAfter)}</span>
            )}
          </div>
          <EvalGraph moves={moves} currentIndex={currentIndex} onSelect={onIndexChange} />
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => onIndexChange(0)} disabled={currentIndex === 0} className="btn-secondary px-2.5" title="First move (Home)">«</button>
          <button onClick={() => onIndexChange(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} className="btn-secondary px-2.5" title="Previous move (← or ↑)">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-ink-400 font-mono px-3">
            {currentIndex + 1} / {moves.length}
          </span>
          <button onClick={() => onIndexChange(Math.min(moves.length - 1, currentIndex + 1))} disabled={currentIndex === moves.length - 1} className="btn-secondary px-2.5" title="Next move (→ or ↓)">
            <ChevronRight size={16} />
          </button>
          <button onClick={() => onIndexChange(moves.length - 1)} disabled={currentIndex === moves.length - 1} className="btn-secondary px-2.5" title="Last move (End)">»</button>
        </div>
      </div>

      {/* ── MIDDLE: Move list ── */}
      <div className="card p-4 max-h-[320px] lg:max-h-[600px] overflow-y-auto">
        <h3 className="text-sm font-semibold text-ink-300 mb-3">Moves</h3>
        <MoveList moves={moves} currentIndex={currentIndex} onSelect={onIndexChange} />
      </div>

      {/* ── RIGHT: Chess.com-style insights panel ── */}
      <div className="space-y-4">
        {/* Coach / Move Quality Banner */}
        {move && moveMeta && (
          <div className="card p-0 overflow-hidden">
            <div className="flex items-start gap-3 p-4 pb-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shrink-0 shadow-lg">
                <Zap size={22} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold"
                    style={{ backgroundColor: moveMeta.bg, color: moveMeta.color }}
                  >
                    <moveMeta.icon size={10} />
                    {moveMeta.label}
                  </span>
                  {move.evalLoss !== null && move.evalLoss > 0.05 && (
                    <span className="text-xs font-mono font-semibold text-ink-300">
                      +{move.evalLoss.toFixed(2)}
                    </span>
                  )}
                </div>
                <h3 className="text-base font-semibold text-ink-100">
                  {move.color === 'w' ? 'White' : 'Black'} played {move.san}
                </h3>
                <p className="text-sm text-ink-400 mt-0.5">
                  {move.quality === 'blunder' && 'This is a serious mistake that changes the evaluation significantly.'}
                  {move.quality === 'mistake' && 'This move gives away some of the advantage.'}
                  {move.quality === 'inaccuracy' && 'A better move was available, but this is playable.'}
                  {move.quality === 'best' && 'The best move in this position!'}
                  {move.quality === 'brilliant' && 'A stunning move that finds a difficult tactical solution.'}
                  {move.quality === 'great' && 'An excellent move that finds the best continuation.'}
                  {move.quality === 'excellent' && 'A very strong move, close to the best.'}
                  {move.quality === 'good' && 'A solid move that maintains the position.'}
                  {move.quality === 'book' && (
                    move.opening ? `Book move — ${move.opening.name} (${move.opening.eco}).` : 'A known opening move.'
                  )}
                  {move.quality === 'miss' && 'A tactical opportunity was missed.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-px bg-ink-700/50 border-t border-ink-700/50">
              <button
                onClick={() => onCoachExplain(move)}
                className="flex items-center justify-center gap-2 py-2.5 text-sm text-ink-200 hover:bg-ink-700/50 transition-colors"
              >
                <MessageSquare size={14} className="text-brand-400" />
                Explain
              </button>
              <button
                onClick={() => handleBestMoveClick(move.evalBefore?.bestMove || '')}
                className="flex items-center justify-center gap-2 py-2.5 text-sm text-ink-200 hover:bg-ink-700/50 transition-colors"
              >
                <Sparkles size={14} className="text-brand-400" />
                Best
              </button>
              <button
                onClick={() => onIndexChange(Math.min(moves.length - 1, currentIndex + 1))}
                disabled={currentIndex === moves.length - 1}
                className="flex items-center justify-center gap-2 py-2.5 text-sm text-ink-200 hover:bg-ink-700/50 transition-colors disabled:opacity-40"
              >
                <ChevronRight size={14} className="text-brand-400" />
                Next
              </button>
            </div>
          </div>
        )}

        {/* Move detail card */}
        {move && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink-300">Move Details</h3>
              <QualityBadge quality={move.quality} />
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
                  <span className="text-ink-400 flex items-center gap-1" title="Evaluation loss from player's perspective">
                    Loss <Info size={12} className="opacity-50" />
                  </span>
                  <span className="font-mono text-accent-400">{move.evalLoss.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-ink-400">Engine best</span>
                <button
                  onClick={() => handleBestMoveClick(move.evalBefore?.bestMove || '')}
                  className="font-mono text-brand-300 hover:text-brand-200 hover:underline decoration-dotted underline-offset-2 cursor-pointer"
                  title="Click to preview this move on the board"
                >
                  {move.evalBefore?.bestMove || '—'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════
            GAME SUMMARY — Chess.com Style
            ═══════════════════════════════════════════════════ */}
        <div className="card p-4">
          {analysis.opening && (
            <div className="flex items-center gap-1.5 mb-3 text-xs text-ink-400">
              <BookOpen size={12} className="text-[#a88865] shrink-0" />
              <span className="truncate">
                <span className="font-mono text-ink-500 mr-1">{analysis.opening.eco}</span>
                {analysis.opening.name}
              </span>
            </div>
          )}

          {/* Player headers with accuracy (Chess.com-style) */}
          <div className="flex items-center justify-between mb-4">
            {/* White */}
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

            {/* Black */}
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

          {/* Quality breakdown rows */}
          <div className="space-y-0.5">
            {qualityRows.map(({ q, label, whiteCount, blackCount, meta }) => (
              <div key={q} className="flex items-center py-1">
                <span className="w-24 text-sm text-ink-300 shrink-0">{label}</span>
                <span
                  className="flex-1 text-right pr-4 text-sm font-bold font-mono"
                  style={{ color: meta.color }}
                >
                  {whiteCount}
                </span>
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: meta.color }}
                >
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
                <span
                  className="flex-1 text-left pl-4 text-sm font-bold font-mono"
                  style={{ color: meta.color }}
                >
                  {blackCount}
                </span>
              </div>
            ))}
          </div>

          {/* Game Rating — Chess.com-style performance rating */}
          <div className="mt-4 pt-3 border-t border-ink-700/50">
            <div className="flex items-center">
              <span
                className="w-24 text-sm text-ink-400 shrink-0"
                title="Estimated strength of play in this game (Chess.com-style)"
              >
                Game Rating
              </span>
              <span className="flex-1 text-right pr-4 text-sm font-bold text-ink-100 font-mono">
                {whiteGameRating}
                {whitePlayerRating != null && (
                  <span
                    className={`ml-1 text-xs font-normal ${
                      whiteGameRating >= whitePlayerRating ? 'text-brand-400' : 'text-accent-400'
                    }`}
                  >
                    {whiteGameRating >= whitePlayerRating ? '+' : ''}
                    {whiteGameRating - whitePlayerRating}
                  </span>
                )}
              </span>
              <div className="w-6 shrink-0" />
              <span className="flex-1 text-left pl-4 text-sm font-bold text-ink-100 font-mono">
                {blackGameRating}
                {blackPlayerRating != null && (
                  <span
                    className={`ml-1 text-xs font-normal ${
                      blackGameRating >= blackPlayerRating ? 'text-brand-400' : 'text-accent-400'
                    }`}
                  >
                    {blackGameRating >= blackPlayerRating ? '+' : ''}
                    {blackGameRating - blackPlayerRating}
                  </span>
                )}
              </span>
            </div>
            {(whitePlayerRating != null || blackPlayerRating != null) && (
              <p className="text-[10px] text-ink-500 mt-1.5 text-center">
                Compared to your rating · higher = played above your level
              </p>
            )}
          </div>
        </div>

        {/* Key moments */}
        {(() => {
          const blunders = moves.filter(m => m.quality === 'blunder');
          const mistakes = moves.filter(m => m.quality === 'mistake');
          return (blunders.length > 0 || mistakes.length > 0) ? (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-ink-300 mb-3">Key Moments</h3>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {blunders.slice(0, 5).map((m) => (
                  <button
                    key={m.index}
                    onClick={() => onIndexChange(m.index)}
                    className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-700/50 transition-colors text-left"
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: QUALITY_META.blunder.color }} />
                    <span className="font-mono">{Math.floor(m.index / 2) + 1}. {m.color === 'w' ? '' : '...'}{m.san}</span>
                    <span className="ml-auto text-xs font-bold" style={{ color: QUALITY_META.blunder.color }}>Blunder</span>
                  </button>
                ))}
                {mistakes.slice(0, 5).map((m) => (
                  <button
                    key={m.index}
                    onClick={() => onIndexChange(m.index)}
                    className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-700/50 transition-colors text-left"
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: QUALITY_META.mistake.color }} />
                    <span className="font-mono">{Math.floor(m.index / 2) + 1}. {m.color === 'w' ? '' : '...'}{m.san}</span>
                    <span className="ml-auto text-xs font-bold" style={{ color: QUALITY_META.mistake.color }}>Mistake</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null;
        })()}
      </div>
    </div>
  );
}

function PlayerBar({ name, color }: { name: string; color: 'white' | 'black' }) {
  return (
    <div className="flex items-center gap-2 px-0.5">
      <span
        className="w-2.5 h-2.5 rounded-full border border-ink-600 shrink-0"
        style={{ backgroundColor: color === 'white' ? '#ebecd0' : '#2a2e39' }}
      />
      <span className="text-sm font-medium text-ink-200 truncate">{name}</span>
    </div>
  );
}

function QualityBadge({ quality }: { quality: MoveQuality }) {
  const meta = QUALITY_META[quality] || QUALITY_META.good;
  const Icon = meta.icon;
  return (
    <span
      className="chip inline-flex items-center gap-1"
      style={{ backgroundColor: meta.bg, color: meta.color }}
    >
      <Icon size={12} />
      {meta.label}
    </span>
  );
}