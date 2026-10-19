import { useLayoutEffect, useRef, useState } from 'react';

interface Props {
  /** Squares the coach is talking about right now, e.g. ['a1', 'e5']. */
  squares: string[];
  /** Whole lines (a file, the 7th rank, a diagonal) the coach is talking about. */
  lines?: { label: string; squares: string[] }[];
  orientation: 'white' | 'black';
}
interface Box { sq: string; x: number; y: number; w: number; h: number }

/**
 * Lights up the squares the coach mentions, with the square's name in the corner, so the learner
 * can see "a1" or "e5" on the board while it is being spoken.
 *
 * Place it INSIDE a `relative` wrapper around the board. It finds each square by the board's own
 * `data-square="e4"` attribute when it exists (exact). Otherwise it assumes the wrapper is exactly
 * the 8x8 board (square, centred if the wrapper is taller).
 */
export function CoachSquares({ squares, lines = [], orientation }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const key = squares.join(',') + '|' + lines.map((l) => l.squares.join('')).join(';') + '|' + orientation;

  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const measure = () => {
      const hr = host.getBoundingClientRect();
      const side = Math.min(hr.width, hr.height);
      const cell = side / 8;
      const offX = (hr.width - side) / 2, offY = (hr.height - side) / 2;
      const all = [...new Set([...squares, ...lines.flatMap((l) => l.squares)])];
      const next: Record<string, Box> = {};
      all.forEach((sq) => {
        const el = host.querySelector<HTMLElement>(`[data-square="${sq}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          next[sq] = { sq, x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
          return;
        }
        const f = sq.charCodeAt(0) - 97, rk = Number(sq[1]) - 1;
        const col = orientation === 'white' ? f : 7 - f;
        const row = orientation === 'white' ? 7 - rk : rk;
        next[sq] = { sq, x: offX + col * cell, y: offY + row * cell, w: cell, h: cell };
      });
      setBoxes(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-20" aria-hidden>
      {/* whole lines: soft blue band + the line's name */}
      {lines.map((ln) => {
        const bs = ln.squares.map((q) => boxes[q]).filter(Boolean);
        const tag = bs[bs.length - 1];
        return (
          <div key={ln.label}>
            {bs.map((b) => (
              <div
                key={b.sq}
                className="absolute"
                style={{ left: b.x, top: b.y, width: b.w, height: b.h, background: 'rgba(56, 189, 248, 0.26)', boxShadow: 'inset 0 0 0 1px rgba(56, 189, 248, 0.55)' }}
              />
            ))}
            {tag && (
              <span
                className="absolute rounded bg-sky-400 px-1 font-mono font-bold leading-tight text-ink-900"
                style={{ left: tag.x + tag.w - 2, top: tag.y + 2, transform: 'translateX(-100%)', fontSize: Math.max(9, Math.min(12, tag.w * 0.26)) }}
              >
                {ln.label}
              </span>
            )}
          </div>
        );
      })}
      {/* individual squares: pulsing yellow box + the square's name */}
      {squares.map((sq) => boxes[sq]).filter(Boolean).map((b) => (
        <div
          key={b.sq}
          className="absolute animate-pulse rounded-sm"
          style={{
            left: b.x, top: b.y, width: b.w, height: b.h,
            background: 'rgba(250, 204, 21, 0.38)',
            boxShadow: 'inset 0 0 0 3px rgba(250, 204, 21, 0.95)',
          }}
        >
          <span
            className="absolute left-0 top-0 rounded-br bg-amber-400 px-1 font-mono font-bold leading-tight text-ink-900"
            style={{ fontSize: Math.max(9, Math.min(13, b.w * 0.28)) }}
          >
            {b.sq}
          </span>
        </div>
      ))}
    </div>
  );
}
