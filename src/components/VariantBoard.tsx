import { useEffect, useRef } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { DrawShape } from '@lichess-org/chessground/draw';

export interface VariantBoardProps {
  /** Piece placement (the first field of a FEN is enough). */
  fen: string;
  orientation: 'white' | 'black';
  turn: 'w' | 'b';
  /** Who may drag pieces right now (null = nobody: the computer is thinking, or a power-up is being aimed). */
  movable: 'w' | 'b' | null;
  dests: Map<Key, Key[]>;
  lastMove: [Key, Key] | null;
  shapes?: DrawShape[];
  /** Extra square highlights: square -> CSS class (styled below). */
  marks?: Map<Key, string>;
  onMove: (from: Key, to: Key) => void;
  /** A square was clicked or tapped (used to aim power-ups). */
  onSelect?: (sq: Key) => void;
}

/**
 * A plain chessground board for the variants. Unlike the main board, it does not decide which moves are legal:
 * the variant passes the moves it allows in `dests` (moving into check, capturing the king, portals...).
 */
export function VariantBoard({ fen, orientation, turn, movable, dests, lastMove, shapes = [], marks, onMove, onSelect }: VariantBoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      coordinates: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: false },
      premovable: { enabled: false },
      drawable: { enabled: true, visible: true },
      movable: { free: false, showDests: true, events: { after: (o, d) => moveRef.current(o, d) } },
      events: { select: (k) => selectRef.current?.(k) },
    });
    const ro = new ResizeObserver(() => api.current?.redrawAll());
    ro.observe(el.current);
    return () => { ro.disconnect(); api.current?.destroy(); api.current = null; };
  }, []);

  useEffect(() => {
    api.current?.set({
      fen,
      orientation,
      turnColor: turn === 'w' ? 'white' : 'black',
      lastMove: lastMove ?? undefined,
      check: false,
      movable: { color: movable ? (movable === 'w' ? 'white' : 'black') : undefined, dests },
      highlight: { lastMove: true, check: false, custom: marks ?? new Map() },
    });
    api.current?.setAutoShapes(shapes);
  }, [fen, orientation, turn, movable, dests, lastMove, shapes, marks]);

  return (
    <>
      <style>{`
        .vb-board square.vb-target { background: radial-gradient(circle, rgba(239,68,68,.55) 26%, rgba(239,68,68,0) 30%); }
        .vb-board square.vb-pick { background: rgba(250,204,21,.45); }
        .vb-board square.vb-land { background: radial-gradient(circle, rgba(250,204,21,.6) 24%, rgba(250,204,21,0) 28%); }
        .vb-board square.vb-portal-blue { box-shadow: inset 0 0 0 4px #38bdf8, inset 0 0 18px #38bdf8; }
        .vb-board square.vb-portal-orange { box-shadow: inset 0 0 0 4px #fb923c, inset 0 0 18px #fb923c; }
        .vb-board square.vb-drop { background: radial-gradient(circle, rgba(129,182,76,.55) 20%, rgba(129,182,76,0) 24%); }
      `}</style>
      <div ref={el} className="vb-board w-full aspect-square" />
    </>
  );
}
