import { useMemo, useRef, useState, useEffect } from 'react';
import type { AnalyzedMove } from '@/lib/types';
import { evalToPawns } from '@/lib/engine';

interface EvalGraphProps {
  moves: AnalyzedMove[];
  currentIndex: number;
  onSelect: (index: number) => void;
  height?: number;
}

export function EvalGraph({ moves, currentIndex, onSelect, height = 120 }: EvalGraphProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    function update() {
      if (wrapperRef.current) {
        setWidth(wrapperRef.current.clientWidth);
      }
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const hPad = 4;
  const vPadTop = 6;
  const vPadBottom = 18;
  const graphHeight = height - vPadTop - vPadBottom;
  const midY = vPadTop + graphHeight / 2;
  const scale = (graphHeight / 2) / 10;

  // Shrink dots so they don't overlap when the graph is compressed
  const baseRadius = moves.length > 100 ? 1.2 : moves.length > 60 ? 1.6 : moves.length > 30 ? 2 : 2.5;

  const { points, pathD, areaD, stepX, cursorX } = useMemo(() => {
    const pts = moves.map((m) => {
      const ev = m.evalAfter;
      if (!ev) return 0;
      const pawns = evalToPawns(ev);
      return Math.max(-10, Math.min(10, pawns));
    });

    const denom = Math.max(moves.length - 1, 1);
    const step = (width - hPad * 2) / denom;

    const path = pts
      .map((p, i) => {
        const x = hPad + i * step;
        const y = midY - p * scale;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    const area =
      pts.length > 0
        ? `${path} L ${hPad + (pts.length - 1) * step} ${midY} L ${hPad} ${midY} Z`
        : '';

    const cursor = hPad + currentIndex * step;

    return { points: pts, pathD: path, areaD: area, stepX: step, cursorX: cursor };
  }, [moves, width, midY, scale, hPad, currentIndex]);

  const labelInterval = moves.length <= 30 ? 5 : moves.length <= 70 ? 10 : 20;

  return (
    <div ref={wrapperRef} className="w-full select-none">
      <svg width={width} height={height} className="block">
        <defs>
          <linearGradient id="evalGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4fb083" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#7a8294" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#e54444" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {/* Alternating bands per full move (white+black pair) */}
        {Array.from({ length: Math.ceil(moves.length / 2) }).map((_, i) => {
          const x1 = hPad + i * 2 * stepX;
          const x2 = hPad + Math.min((i + 1) * 2, moves.length) * stepX;
          if (x1 >= width - hPad) return null;
          return (
            <rect
              key={`band-${i}`}
              x={x1}
              y={vPadTop}
              width={Math.min(x2, width - hPad) - x1}
              height={graphHeight}
              fill={i % 2 === 0 ? '#ffffff03' : '#ffffff08'}
            />
          );
        })}

        {/* Center zero line */}
        <line
          x1={hPad}
          y1={midY}
          x2={width - hPad}
          y2={midY}
          stroke="#3d4351"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        {areaD && <path d={areaD} fill="url(#evalGrad)" />}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="#d1d5dd"
            strokeWidth="1.5"
            strokeLinejoin="round"
            opacity={moves.length > 80 ? 0.7 : 1}
          />
        )}

        {/* Move number labels under white moves */}
        {moves.map((m, i) => {
          if (m.color !== 'w') return null;
          const moveNum = Math.floor(i / 2) + 1;
          if (moveNum % labelInterval !== 0 && moveNum !== 1) return null;
          const x = hPad + i * stepX;
          if (x < hPad || x > width - hPad) return null;
          return (
            <text
              key={`lbl-${i}`}
              x={x}
              y={height - 4}
              textAnchor="middle"
              fill="#5a6274"
              fontSize="9"
              fontFamily="monospace"
            >
              {moveNum}
            </text>
          );
        })}

        {points.map((p, i) => {
          const x = hPad + i * stepX;
          const y = midY - p * scale;
          const isCurrent = i === currentIndex;
          const move = moves[i];
          const isWhite = move?.color === 'w';
          // FIX: black dots are now light grey so they actually show up on dark bg
          const fill = isCurrent ? '#4fb083' : isWhite ? '#f8f8f8' : '#9aa3b8';
          const stroke = isCurrent ? '#2f9468' : isWhite ? '#3d4351' : '#7a8294';
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={isCurrent ? baseRadius + 1.5 : baseRadius}
              fill={fill}
              stroke={stroke}
              strokeWidth="1"
              className="cursor-pointer"
              onClick={() => onSelect(i)}
            />
          );
        })}

        {points.length > 0 && (
          <line
            x1={cursorX}
            y1={vPadTop}
            x2={cursorX}
            y2={height - vPadBottom}
            stroke="#4fb083"
            strokeWidth="1"
            strokeDasharray="2 2"
            opacity="0.6"
          />
        )}
      </svg>
    </div>
  );
}