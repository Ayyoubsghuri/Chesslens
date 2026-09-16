import { useMemo } from 'react';
import { evalToPawns, formatEval } from '@/lib/engine';
import type { AnalyzedMove } from '@/lib/types';

type Eval = AnalyzedMove['evalAfter'];

interface EvalBarProps {
  evaluation: Eval;
  orientation?: 'white' | 'black';
  height?: number;
}

export function EvalBar({ evaluation, orientation = 'white', height = 480 }: EvalBarProps) {
  const { whitePercent, label } = useMemo(() => {
    if (!evaluation) return { whitePercent: 50, label: '0.0' };
    const anyEval = evaluation as any;
    if (anyEval.mate !== undefined && anyEval.mate !== null) {
      const mateForWhite = anyEval.mate > 0;
      return { whitePercent: mateForWhite ? 100 : 0, label: `M${Math.abs(anyEval.mate)}` };
    }
    const pawns = evalToPawns(evaluation);
    const clamped = Math.max(-15, Math.min(15, pawns));
    const pct = 50 + 50 * (2 / (1 + Math.exp(-0.55 * clamped)) - 1);
    return { whitePercent: pct, label: formatEval(evaluation) };
  }, [evaluation]);

  const isWhiteBottom = orientation === 'white';
  const fillPercent = isWhiteBottom ? whitePercent : 100 - whitePercent;
  const fillColor = isWhiteBottom ? '#ebecd0' : '#2a2e39';
  const bgColor = isWhiteBottom ? '#2a2e39' : '#ebecd0';
  const labelOnFill = fillPercent > 50;

  return (
    <div
      className="relative w-6 shrink-0 rounded-md overflow-hidden shadow-inner"
      style={{ height, backgroundColor: bgColor }}
      title={label}
    >
      <div
        className="absolute left-0 right-0 bottom-0 transition-[height] duration-300 ease-out"
        style={{ height: `${fillPercent}%`, backgroundColor: fillColor }}
      />
      <div
        className={`absolute left-0 right-0 text-center text-[9px] font-bold py-0.5 ${
          labelOnFill
            ? isWhiteBottom
              ? 'text-[#2a2e39] bottom-0'
              : 'text-[#ebecd0] bottom-0'
            : isWhiteBottom
              ? 'text-[#ebecd0] top-0'
              : 'text-[#2a2e39] top-0'
        }`}
      >
        {label}
      </div>
    </div>
  );
}