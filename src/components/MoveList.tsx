import { useEffect, useRef } from 'react';
import type { AnalyzedMove, MoveQuality } from '@/lib/types';
import { formatEval } from '@/lib/engine';
import { CheckCircle2, ThumbsUp, Minus, BookOpen, AlertCircle, AlertTriangle, XCircle, Star, HelpCircle, Sparkles } from 'lucide-react';

interface MoveListProps {
  moves: AnalyzedMove[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

const QUALITY_META: Record<MoveQuality, { color: string; bg: string; icon: any; label: string }> = {
  brilliant: { color: '#26c2a3', bg: '#26c2a320', icon: Sparkles, label: 'Brilliant' },
  best:      { color: '#81b64c', bg: '#81b64c20', icon: Star, label: 'Best' },
  great:     { color: '#749bbf', bg: '#749bbf20', icon: ThumbsUp, label: 'Great' },
  excellent: { color: '#96bc4b', bg: '#96bc4b20', icon: CheckCircle2, label: 'Excellent' },
  good:      { color: '#95b3b8', bg: '#95b3b820', icon: Minus, label: 'Good' },
  book:      { color: '#a88865', bg: '#a8886520', icon: BookOpen, label: 'Book' },
  inaccuracy:{ color: '#f7c631', bg: '#f7c63120', icon: AlertCircle, label: 'Inaccuracy' },
  mistake:   { color: '#ffa459', bg: '#ffa45920', icon: AlertTriangle, label: 'Mistake' },
  blunder:   { color: '#fa412d', bg: '#fa412d20', icon: XCircle, label: 'Blunder' },
  miss:      { color: '#e040fb', bg: '#e040fb20', icon: HelpCircle, label: 'Miss' },
};

export function MoveList({ moves, currentIndex, onSelect }: MoveListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pairs: { white?: AnalyzedMove; black?: AnalyzedMove }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({ white: moves[i], black: moves[i + 1] });
  }

  // Keep the current move visible inside the list (scrolls only the list, never the page).
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-current]');
    const box = el?.closest<HTMLElement>('.overflow-y-auto');
    if (!el || !box) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop + 8 || top + el.offsetHeight > box.scrollTop + box.clientHeight - 8) {
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 2), behavior: 'smooth' });
    }
  }, [currentIndex]);

  return (
    <div ref={ref} className="w-full min-w-0 overflow-x-hidden space-y-0.5">
      {pairs.map((pair, i) => (
        // Fixed number column + two equal columns: white and black line up on every row and nothing can overflow.
        <div
          key={i}
          className={`grid grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-1 rounded-lg transition-colors hover:bg-ink-800/40 ${i % 2 ? 'bg-ink-800/25' : ''}`}
        >
          <span className="text-right text-xs text-ink-400 pr-1">{i + 1}.</span>
          {pair.white ? <MoveButton move={pair.white} isCurrent={pair.white.index === currentIndex} onSelect={onSelect} /> : <span />}
          {pair.black ? <MoveButton move={pair.black} isCurrent={pair.black.index === currentIndex} onSelect={onSelect} /> : <span />}
        </div>
      ))}
    </div>
  );
}

function MoveButton({ move, isCurrent, onSelect }: { move: AnalyzedMove; isCurrent: boolean; onSelect: (i: number) => void }) {
  // Fallback so an unexpected quality value can never crash the list.
  const meta = QUALITY_META[move.quality] ?? QUALITY_META.good;
  const Icon = meta.icon;

  return (
    <button
      data-current={isCurrent || undefined}
      onClick={() => onSelect(move.index)}
      className={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-all ${isCurrent ? 'bg-brand-500/20 ring-1 ring-brand-400/40' : 'hover:bg-ink-700/50'}`}
    >
      <span
        className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: move.quality === 'brilliant' || move.quality === 'great' ? meta.color : meta.bg }}
        title={meta.label}
      >
        {move.quality === 'brilliant' ? (
          // Chess.com-style solid teal circle with a white "!!"
          <span className="text-[8px] font-black text-white leading-none tracking-tighter">!!</span>
        ) : move.quality === 'great' ? (
          // Solid blue circle with a white "!"
          <span className="text-[9px] font-black text-white leading-none">!</span>
        ) : (
          <Icon size={10} style={{ color: meta.color }} />
        )}
      </span>
      <span className={`min-w-0 truncate font-mono ${isCurrent ? 'font-semibold text-white' : ''}`}>{move.san}</span>
      {move.evalAfter && (
        <span className="ml-auto shrink-0 pl-1 text-[11px] text-ink-400 font-mono">{formatEval(move.evalAfter)}</span>
      )}
    </button>
  );
}
