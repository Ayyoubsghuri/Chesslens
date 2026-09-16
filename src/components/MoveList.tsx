import type { AnalyzedMove, MoveQuality } from '@/lib/types';
import { formatEval } from '@/lib/engine';
import { CheckCircle2, ThumbsUp, Minus, BookOpen, AlertCircle, AlertTriangle, XCircle, Star, HelpCircle } from 'lucide-react';

interface MoveListProps {
  moves: AnalyzedMove[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

const QUALITY_META: Record<MoveQuality, { color: string; bg: string; icon: any; label: string }> = {
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

export function MoveList({ moves, currentIndex, onSelect }: MoveListProps) {
  const pairs: { white?: AnalyzedMove; black?: AnalyzedMove }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({ white: moves[i], black: moves[i + 1] });
  }

  return (
    <div className="space-y-0.5">
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-1 rounded-lg hover:bg-ink-800/40 transition-colors">
          <span className="w-7 text-right text-xs text-ink-400 pr-1 shrink-0">{i + 1}.</span>
          {pair.white && (
            <MoveButton move={pair.white} isCurrent={pair.white.index === currentIndex} onSelect={onSelect} />
          )}
          {pair.black && (
            <MoveButton move={pair.black} isCurrent={pair.black.index === currentIndex} onSelect={onSelect} />
          )}
        </div>
      ))}
    </div>
  );
}

function MoveButton({ move, isCurrent, onSelect }: { move: AnalyzedMove; isCurrent: boolean; onSelect: (i: number) => void }) {
  const meta = QUALITY_META[move.quality];
  const Icon = meta.icon;

  return (
    <button
      onClick={() => onSelect(move.index)}
      className={`flex items-center gap-1.5 flex-1 rounded-md px-2 py-1 text-sm transition-all ${isCurrent ? 'bg-brand-500/20 ring-1 ring-brand-400/40' : 'hover:bg-ink-700/50'}`}
    >
      <span
        className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: meta.bg }}
        title={meta.label}
      >
        <Icon size={10} style={{ color: meta.color }} />
      </span>
      <span className="font-mono">{move.san}</span>
      {move.evalAfter && (
        <span className="ml-auto text-xs text-ink-400 font-mono">{formatEval(move.evalAfter)}</span>
      )}
    </button>
  );
}