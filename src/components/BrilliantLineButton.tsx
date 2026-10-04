import { Sparkles } from 'lucide-react';

/** Shown under the coach bubble on brilliant moves. Plays the engine line on the board. */
export function BrilliantLineButton({ onClick, compact }: { onClick: () => void; compact?: boolean }) {
  return (
    <div className={compact ? 'px-2 pb-2' : 'px-4 pb-3'}>
      <button
        onClick={onClick}
        className={`w-full flex items-center justify-center gap-2 rounded-lg border border-[#26c2a3]/40 bg-[#26c2a3]/10 hover:bg-[#26c2a3]/20 font-semibold text-[#26c2a3] transition-colors ${compact ? 'py-2 text-xs' : 'py-2.5 text-sm'}`}
      >
        <Sparkles size={compact ? 14 : 16} /> Show the line on board
      </button>
    </div>
  );
}
