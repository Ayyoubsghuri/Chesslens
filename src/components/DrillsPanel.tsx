import { useState, useMemo } from 'react';
import { Chess, type Square } from 'chess.js';
import { ChessBoard } from './ChessBoard';
import { MoveText, type MovePreview } from './MoveText';
import type { AnalyzedMove, Drill, Settings } from '@/lib/types';
import { generateDrills } from '@/lib/drills';
import { getCoachExplanation } from '@/lib/coach';
import { Target, Loader2, Check, X, RefreshCw, Sparkles, ChevronRight } from 'lucide-react';

interface DrillsPanelProps {
  moves: AnalyzedMove[];
  settings: Settings;
}

export function DrillsPanel({ moves, settings }: DrillsPanelProps) {
  const drills = useMemo(() => generateDrills(moves), [moves]);
  const [activeDrill, setActiveDrill] = useState<Drill | null>(null);
  const [boardFen, setBoardFen] = useState('');
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [solution, setSolution] = useState<string[]>([]);
  const [showSolution, setShowSolution] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [loadingExplain, setLoadingExplain] = useState(false);
  // When the user clicks a move mentioned in the coach's explanation text
  // (e.g. "e6c7"), this holds the resulting position to show on the board.
  const [preview, setPreview] = useState<MovePreview | null>(null);

  function startDrill(drill: Drill) {
    setActiveDrill(drill);
    setBoardFen(drill.fen);
    setSelectedSquare(null);
    setFeedback(null);
    setSolution([]);
    setShowSolution(false);
    setExplanation('');
    setPreview(null);
  }

  async function handleSquareClick(square: Square) {
    if (!activeDrill || feedback) return;
    const chess = new Chess(boardFen);
    const piece = chess.get(square);
    if (!piece) {
      setSelectedSquare(null);
      return;
    }
    setSelectedSquare(square);

    // Check if this is the correct first move
    const bestUci = activeDrill.solutionMoves[0];
    if (!bestUci) return;

    try {
      setLoading(true);
      // Verify by making the move and comparing to engine
      const from = bestUci.slice(0, 2);
      const to = bestUci.slice(2, 4);
      const promotion = bestUci.length > 4 ? bestUci[4] : undefined;

      if (square === (to as Square)) {
        // They moved to the right square - check if piece was selected from right square
        if (selectedSquare === (from as Square)) {
          const result = chess.move({ from, to, promotion });
          if (result) {
            setBoardFen(chess.fen());
            setFeedback('correct');
            setSolution([result.san, ...activeDrill.solutionMoves.slice(1)]);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }

  function handleShowSolution() {
    if (!activeDrill) return;
    setShowSolution(true);
    setSolution(activeDrill.solutionMoves);
    // Play the solution on the board
    const chess = new Chess(activeDrill.fen);
    for (const uci of activeDrill.solutionMoves) {
      try {
        chess.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci[4] : undefined,
        });
      } catch { break; }
    }
    setBoardFen(chess.fen());
  }

  async function handleExplain() {
    if (!activeDrill || !settings.openaiApiKey) return;
    setLoadingExplain(true);
    try {
      const move = moves[activeDrill.sourceMoveIndex];
      if (move) {
        const text = await getCoachExplanation(move, settings);
        setExplanation(text);
      }
    } finally {
      setLoadingExplain(false);
    }
  }

  if (drills.length === 0) {
    return (
      <div className="card p-8 text-center text-ink-400">
        <Target size={32} className="mx-auto mb-3 opacity-50" />
        <p>No drills available. Analyze a game with blunders or mistakes to generate tactical drills.</p>
      </div>
    );
  }

  if (!activeDrill) {
    return (
      <div className="space-y-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Target size={18} className="text-brand-400" />
            <h3 className="text-sm font-semibold text-ink-200">Tactical Drills</h3>
          </div>
          <p className="text-sm text-ink-400">
            Practice the positions where you made mistakes. Find the engine's best move to improve your game.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {drills.map((drill, i) => {
            const move = moves[drill.sourceMoveIndex];
            return (
              <button
                key={drill.id}
                onClick={() => startDrill(drill)}
                className="card p-4 text-left hover:border-brand-400/40 transition-colors group"
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="chip bg-ink-700 text-ink-300">Drill {i + 1}</span>
                  <span className={`chip ${drill.difficulty === 'hard' ? 'bg-red-500/20 text-red-400' : 'bg-accent-400/20 text-accent-400'}`}>
                    {drill.difficulty}
                  </span>
                </div>
                <h4 className="text-sm font-medium text-ink-100 mb-1">{drill.theme}</h4>
                <p className="text-xs text-ink-400">{drill.description}</p>
                <div className="flex items-center gap-1 mt-3 text-xs text-ink-400 group-hover:text-brand-400 transition-colors">
                  Start drill <ChevronRight size={12} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="flex flex-col gap-4 min-w-0">
        <div className="flex justify-center w-full">
          <div className="w-full max-w-[480px]">
            <ChessBoard
              fen={preview ? preview.fen : boardFen}
              orientation={moves[activeDrill.sourceMoveIndex]?.color === 'b' ? 'black' : 'white'}
              highlightSquare={preview ? null : selectedSquare}
              lastMove={preview ? { from: preview.from, to: preview.to } : null}
              onSquareClick={preview ? undefined : handleSquareClick}
              size={480}
            />
          </div>
        </div>

        {preview && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-500/10 border border-brand-500/30 px-3 py-2 text-sm text-brand-300">
            <span>
              Previewing <span className="font-mono font-semibold">{preview.san}</span>{' '}
              <span className="text-brand-400/70">({preview.uci})</span>
            </span>
            <button onClick={() => setPreview(null)} className="btn-ghost text-xs px-2 py-1 shrink-0">
              <X size={12} /> Back to drill
            </button>
          </div>
        )}

        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-ink-200">{activeDrill.theme}</h3>
            <button onClick={() => startDrill(activeDrill)} className="btn-ghost text-xs px-2 py-1">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
          <p className="text-sm text-ink-300 mb-3">{activeDrill.description}</p>

          {feedback === 'correct' && (
            <div className="flex items-center gap-2 rounded-lg bg-brand-500/15 border border-brand-500/30 px-3 py-2 text-sm text-brand-300 mb-3">
              <Check size={16} /> Correct! That's the engine's best move.
            </div>
          )}
          {showSolution && feedback !== 'correct' && (
            <div className="flex items-center gap-2 rounded-lg bg-accent-400/15 border border-accent-400/30 px-3 py-2 text-sm text-accent-400 mb-3">
              <X size={16} /> Solution shown below.
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={handleShowSolution} disabled={showSolution} className="btn-secondary text-xs">
              Show Solution
            </button>
            <button onClick={handleExplain} disabled={loadingExplain || !settings.openaiApiKey} className="btn-ghost text-xs">
              {loadingExplain ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Explain
            </button>
          </div>

          {(solution.length > 0) && (
            <div className="mt-3">
              <div className="text-xs text-ink-400 mb-1.5">Solution:</div>
              <div className="flex flex-wrap gap-1.5">
                {solution.map((s, i) => (
                  <span key={i} className="chip bg-ink-700 text-ink-200 font-mono">{i + 1}. {s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-semibold text-ink-200 mb-3">Coach Explanation</h3>
        {explanation ? (
          <p className="text-sm text-ink-100 leading-relaxed">
            <MoveText
              text={explanation}
              fen={moves[activeDrill.sourceMoveIndex]?.fenBefore || activeDrill.fen}
              onPreview={setPreview}
              activeUci={preview?.uci}
            />
          </p>
        ) : (
          <p className="text-sm text-ink-500">
            {settings.openaiApiKey
              ? 'Click "Explain" to understand why this is the best move.'
              : 'Add your OpenAI API key in Settings for drill explanations.'}
          </p>
        )}
      </div>
    </div>
  );
}