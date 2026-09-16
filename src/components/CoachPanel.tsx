import { useState, useEffect, useRef, useCallback } from 'react';
import { Chess, type Square } from 'chess.js';
import { ChessBoard } from './ChessBoard';
import { EvalBar } from './Evalbar';
import { MoveText, type MovePreview } from './MoveText';
import { getCoachExplanation, getBestLineExplanation } from '@/lib/coach';
import { formatEval } from '@/lib/engine';
import { useElementSize } from '@/lib/useElementSize';
import type { AnalyzedMove, Settings, CoachMessage } from '@/lib/types';
import { Play, Pause, Loader2, Sparkles, FastForward, RotateCcw, MessageSquare, X, AlertTriangle } from 'lucide-react';

interface CoachPanelProps {
  move: AnalyzedMove | null;
  settings: Settings;
}

export function CoachPanel({ move, settings }: CoachPanelProps) {
  const [explanation, setExplanation] = useState('');
  const [loadingExplain, setLoadingExplain] = useState(false);
  const [lineMessages, setLineMessages] = useState<CoachMessage[]>([]);
  const [lineFen, setLineFen] = useState('');
  const [lineIndex, setLineIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [lineExplanation, setLineExplanation] = useState('');
  const [loadingLineExplain, setLoadingLineExplain] = useState(false);
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset when move changes — start from the position AFTER the move was played
  useEffect(() => {
    setExplanation('');
    setLineMessages([]);
    setLineFen(move?.fenAfter || new Chess().fen());
    setLineIndex(0);
    setPlaying(false);
    setLineExplanation('');
    setPreview(null);
    setOrientation(move?.color === 'b' ? 'black' : 'white');
    if (playTimer.current) clearTimeout(playTimer.current);
  }, [move?.index]);

  // Auto-play line from evalAfter (the continuation of the game)
  useEffect(() => {
    if (!playing || !move) return;
    const continuation = move.evalAfter?.continuation?.split(/\s+/).filter(Boolean) || [];
    if (lineIndex >= continuation.length) {
      setPlaying(false);
      return;
    }
    playTimer.current = setTimeout(() => {
      playNextMove();
    }, 900);
    return () => { if (playTimer.current) clearTimeout(playTimer.current); };
  }, [playing, lineIndex, move]);

  const playNextMove = useCallback(() => {
    if (!move) return;
    const continuation = move.evalAfter?.continuation?.split(/\s+/).filter(Boolean) || [];
    if (lineIndex >= continuation.length) {
      setPlaying(false);
      return;
    }
    const uci = continuation[lineIndex];
    try {
      const chess = new Chess(lineFen);
      const result = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
      if (result) {
        setLineFen(chess.fen());
        setLineMessages(prev => [...prev, { role: 'assistant', content: result.san, fen: chess.fen() }]);
        setLineIndex(prev => prev + 1);
      }
    } catch {
      setPlaying(false);
    }
  }, [move, lineFen, lineIndex]);

  async function handleExplain() {
    if (!move) return;
    setLoadingExplain(true);
    try {
      const text = await getCoachExplanation(move, settings);
      setExplanation(text);
    } finally {
      setLoadingExplain(false);
    }
  }

  async function handleExplainLine() {
    if (!move) return;
    setLoadingLineExplain(true);
    try {
      const text = await getBestLineExplanation(move.fenAfter, move.evalAfter?.continuation || '', settings);
      setLineExplanation(text);
    } finally {
      setLoadingLineExplain(false);
    }
  }

  function handlePlayPause() {
    if (playing) {
      setPlaying(false);
    } else {
      if (lineIndex >= (move?.evalAfter?.continuation?.split(/\s+/).filter(Boolean).length || 0)) {
        setLineFen(move?.fenAfter || new Chess().fen());
        setLineMessages([]);
        setLineIndex(0);
      }
      setPlaying(true);
    }
  }

  function handleReset() {
    setLineFen(move?.fenAfter || new Chess().fen());
    setLineMessages([]);
    setLineIndex(0);
    setPlaying(false);
  }

  const handleFlip = () => setOrientation(prev => prev === 'white' ? 'black' : 'white');

  if (!move) {
    return (
      <div className="card p-8 text-center text-ink-400">
        <Sparkles size={32} className="mx-auto mb-3 opacity-50" />
        <p>Select a move in the analysis view to get coaching.</p>
      </div>
    );
  }

  const continuation = move.evalAfter?.continuation?.split(/\s+/).filter(Boolean) || [];
  
  // Mate verification for the resulting position (evalAfter)
  const evalAfterAny = move.evalAfter as any;
  const mateIn = evalAfterAny?.mate != null ? Math.abs(evalAfterAny.mate) : null;
  const mateSide = evalAfterAny?.mate != null ? (evalAfterAny.mate > 0 ? 'White' : 'Black') : null;
  const continuationTooShort = mateIn != null && continuation.length < mateIn;

  const lastMoveCoords = lineMessages.length > 0
    ? (() => {
        try {
          const chess = new Chess(lineMessages[lineMessages.length - 1].fen!);
          const h = chess.history({ verbose: true }) as any[];
          if (h.length === 0) return null;
          const last = h[h.length - 1];
          return { from: last.from as Square, to: last.to as Square };
        } catch { return null; }
      })()
    : null;

  const boardFenToShow = preview ? preview.fen : lineFen;
  const boardLastMove = preview ? { from: preview.from, to: preview.to } : lastMoveCoords;
  // The board sizes itself responsively via CSS up to this cap; we measure
  // its real rendered width so the eval bar's pixel height stays in sync.
  const boardMaxSize = 480;
  const { ref: boardColRef, width: boardRenderedSize } = useElementSize<HTMLDivElement>();
  const boardSize = boardRenderedSize || boardMaxSize;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
      {/* Board + line playback */}
      <div className="flex flex-col gap-4 min-w-0">
        <div className="flex justify-center items-stretch gap-1.5 sm:gap-2 w-full">
          <EvalBar 
            evaluation={move.evalAfter ?? null} 
            orientation={orientation} 
            height={boardSize} 
          />
          <div ref={boardColRef} className="flex flex-col gap-1.5 flex-1 min-w-0" style={{ maxWidth: boardMaxSize }}>
            <div className="flex items-center justify-between px-0.5">
              <span className="text-sm font-medium text-ink-200">
                {orientation === 'white' ? 'Black' : 'White'}
              </span>
            </div>
            <ChessBoard
              fen={boardFenToShow}
              orientation={orientation}
              lastMove={boardLastMove}
              size={boardMaxSize}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink-200">
                {orientation === 'white' ? 'White' : 'Black'}
              </span>
              <button onClick={handleFlip} className="btn-secondary px-2.5 py-1.5 shrink-0" title="Flip board">
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
        </div>

        {preview && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-500/10 border border-brand-500/30 px-3 py-2 text-sm text-brand-300">
            <span>
              Previewing <span className="font-mono font-semibold">{preview.san}</span>{' '}
              <span className="text-brand-400/70">({preview.uci})</span>
            </span>
            <button onClick={() => setPreview(null)} className="btn-ghost text-xs px-2 py-1 shrink-0">
              <X size={12} /> Back
            </button>
          </div>
        )}

        {/* Mate warning for the resulting position */}
        {mateIn != null && (
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            continuationTooShort 
              ? 'bg-accent-400/10 border-accent-400/30 text-accent-400' 
              : 'bg-brand-500/10 border-brand-500/30 text-brand-300'
          }`}>
            {continuationTooShort ? <AlertTriangle size={16} /> : <Sparkles size={16} />}
            <span>
              {mateSide} has mate in {mateIn}
              {continuationTooShort && `, but the engine only provided ${continuation.length} move(s) of the line. Increase analysis depth in Settings to see the full mate.`}
            </span>
          </div>
        )}

        {/* Playback controls */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-ink-300">Best Line Playback</h3>
            <span className="text-xs text-ink-400 font-mono">{lineIndex} / {continuation.length} moves</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <button onClick={handleReset} className="btn-secondary px-2.5" title="Reset">
              <RotateCcw size={16} />
            </button>
            <button onClick={handlePlayPause} disabled={continuation.length === 0} className="btn-primary px-4">
              {playing ? <Pause size={16} /> : <Play size={16} />}
              {playing ? 'Pause' : 'Play'}
            </button>
            <button onClick={playNextMove} disabled={lineIndex >= continuation.length || playing} className="btn-secondary px-2.5" title="Next move">
              <FastForward size={16} />
            </button>
          </div>
          <p className="text-xs text-ink-400 mt-3 text-center">
            Watch the engine's recommended continuation from this position.
          </p>
        </div>

        {/* Line explanation */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-ink-300">Line Strategy</h3>
            <button onClick={handleExplainLine} disabled={loadingLineExplain || !settings.openaiApiKey} className="btn-ghost text-xs px-2 py-1">
              {loadingLineExplain ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              Explain
            </button>
          </div>
          {lineExplanation ? (
            <p className="text-sm text-ink-200 leading-relaxed">
              <MoveText text={lineExplanation} fen={move.fenAfter} onPreview={setPreview} activeUci={preview?.uci} line />
            </p>
          ) : (
            <p className="text-sm text-ink-500">
              {settings.openaiApiKey ? 'Click "Explain" to get the strategic ideas behind this line.' : 'Add your OpenAI API key in Settings to get line explanations.'}
            </p>
          )}
        </div>
      </div>

      {/* Coach explanation */}
      <div className="flex flex-col gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className="text-brand-400" />
              <h3 className="text-sm font-semibold text-ink-200">Coach's Take</h3>
            </div>
            <button onClick={handleExplain} disabled={loadingExplain} className="btn-primary text-xs px-3 py-1.5">
              {loadingExplain ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {explanation ? 'Re-explain' : 'Explain Why'}
            </button>
          </div>

          <div className="rounded-lg bg-ink-900/40 p-3 mb-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-ink-400">Move:</span>
              <span className="font-mono font-medium">{Math.floor(move.index / 2) + 1}. {move.color === 'w' ? '' : '...'}{move.san}</span>
              <span className="ml-auto chip bg-ink-700 text-ink-300">{move.quality}</span>
            </div>
            <div className="flex items-center gap-3 mt-2 text-xs text-ink-400">
              <span>Before: <span className="font-mono">{move.evalBefore ? formatEval(move.evalBefore) : '—'}</span></span>
              <span>After: <span className="font-mono">{move.evalAfter ? formatEval(move.evalAfter) : '—'}</span></span>
            </div>
            {move.evalBefore && (
              <div className="flex items-center gap-3 mt-1 text-xs text-ink-400">
                <span>Best was: <span className="font-mono text-brand-300">{move.evalBefore.bestMove || '—'}</span></span>
              </div>
            )}
            {move.evalAfter && (
              <div className="flex items-center gap-3 mt-1 text-xs text-ink-400">
                <span>Next best: <span className="font-mono text-brand-300">{move.evalAfter.bestMove || '—'}</span></span>
              </div>
            )}
          </div>

          {explanation ? (
            <div className="text-sm text-ink-100 leading-relaxed animate-fade-in">
              <MoveText text={explanation} fen={move.fenBefore} onPreview={setPreview} activeUci={preview?.uci} />
            </div>
          ) : (
            <p className="text-sm text-ink-500">
              {settings.openaiApiKey
                ? 'Click "Explain Why" to hear the coach break down this move.'
                : 'Add your OpenAI API key in Settings to get personalized explanations.'}
            </p>
          )}
        </div>

        {/* Move history of line */}
        {lineMessages.length > 0 && (
          <div className="card p-4">
            <h3 className="text-sm font-semibold text-ink-300 mb-2">Line Moves</h3>
            <div className="flex flex-wrap gap-1.5">
              {lineMessages.map((m, i) => (
                <span key={i} className="chip bg-ink-700 text-ink-200 font-mono">
                  {i + 1}. {m.content}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}