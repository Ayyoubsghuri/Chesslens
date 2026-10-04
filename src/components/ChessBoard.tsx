import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Key } from '@lichess-org/chessground/types';
import { Chess, type Square, type Color } from 'chess.js';
import type { MoveQuality } from '@/lib/types';
import { BookOpen, ThumbsUp, AlertCircle, AlertTriangle, XCircle, Star, HelpCircle, PartyPopper, X } from 'lucide-react';

interface ChessBoardProps {
  fen: string;
  orientation?: 'white' | 'black';
  highlightSquare?: Square | null;
  lastMove?: { from: Square; to: Square } | null;
  bestMoveUci?: string | null;
  onSquareClick?: (square: Square) => void;
  size?: number;
  annotationSquare?: Square | null;
  annotationColor?: string | null;
  moveQuality?: MoveQuality | null;
  id?: string;
  whiteName?: string;
  blackName?: string;
  showCelebration?: boolean;
  /** Allow dragging pieces to legal squares (explore / free play). */
  interactive?: boolean;
  /** Called when the user makes a legal move on the board. */
  onUserMove?: (move: {
    from: Square;
    to: Square;
    promotion?: string;
    san: string;
    fen: string;
  }) => void;
}

function colorToBrush(color: string): string {
  return `custom-${color.replace('#', '')}`;
}

const BADGE_META: Record<MoveQuality, { color: string; icon: any; symbol: string }> = {
  brilliant: { color: '#26c2a3', icon: Star, symbol: '!!' },
  best:      { color: '#81b64c', icon: Star, symbol: '' },
  great:     { color: '#749bbf', icon: ThumbsUp, symbol: '!' },
  excellent: { color: '#96bc4b', icon: ThumbsUp, symbol: '' },
  good:      { color: '#95b3b8', icon: ThumbsUp, symbol: '' },
  book:      { color: '#c9a96e', icon: BookOpen, symbol: '' },
  inaccuracy:{ color: '#f7c631', icon: AlertCircle, symbol: '?!' },
  mistake:   { color: '#ffa459', icon: AlertTriangle, symbol: '?' },
  blunder:   { color: '#fa412d', icon: XCircle, symbol: '??' },
  miss:      { color: '#e040fb', icon: HelpCircle, symbol: '!?' },
};

/** Qualities that get the square tint and a popup pill, like Chess.com. */
const SPOTLIGHT: Partial<Record<MoveQuality, { label: string; tint: string; text: string }>> = {
  brilliant: { label: 'Brilliant', tint: 'rgba(38, 194, 163, 0.78)', text: '#1a9e83' },
  great:     { label: 'Great Move', tint: 'rgba(116, 155, 191, 0.78)', text: '#5b86ad' },
};

function getSquarePosition(square: Square, orientation: 'white' | 'black') {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = parseInt(square[1]) - 1;
  if (orientation === 'white') {
    return { left: `${(file / 8) * 100}%`, top: `${((7 - rank) / 8) * 100}%` };
  }
  return { left: `${((7 - file) / 8) * 100}%`, top: `${(rank / 8) * 100}%` };
}

function findKingSquare(chess: Chess, color: Color): Square | null {
  const board = chess.board();
  for (const row of board) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === color) {
        return cell.square as Square;
      }
    }
  }
  return null;
}

function buildDests(fen: string): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  try {
    const chess = new Chess(fen);
    for (const m of chess.moves({ verbose: true })) {
      const from = m.from as Key;
      const arr = dests.get(from) || [];
      arr.push(m.to as Key);
      dests.set(from, arr);
    }
  } catch { /* invalid fen */ }
  return dests;
}

export function ChessBoard({
  fen,
  orientation = 'white',
  highlightSquare = null,
  lastMove = null,
  bestMoveUci = null,
  onSquareClick,
  size = 480,
  annotationSquare = null,
  annotationColor = null,
  moveQuality = null,
  whiteName = 'White',
  blackName = 'Black',
  showCelebration = true,
  interactive = false,
  onUserMove,
}: ChessBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const onSquareClickRef = useRef(onSquareClick);
  onSquareClickRef.current = onSquareClick;
  const onUserMoveRef = useRef(onUserMove);
  onUserMoveRef.current = onUserMove;
  const fenRef = useRef(fen);
  fenRef.current = fen;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  const gameState = useMemo(() => {
    try {
      const chess = new Chess(fen);
      const inCheck = chess.inCheck();
      const isCheckmate = chess.isCheckmate();
      const turnColor = chess.turn();
      const checkedKingSquare = inCheck ? findKingSquare(chess, turnColor) : null;
      const winnerKingSquare = isCheckmate
        ? findKingSquare(chess, turnColor === 'w' ? 'b' : 'w')
        : null;
      return { inCheck, isCheckmate, turnColor, checkedKingSquare, winnerKingSquare };
    } catch {
      return { inCheck: false, isCheckmate: false, turnColor: 'w' as Color, checkedKingSquare: null, winnerKingSquare: null };
    }
  }, [fen]);

  // Checkmate: the winner's king dances (CSS on the real piece), the checkmated king shatters.
  const mateClass = gameState.isCheckmate
    ? ` cb-mate-wave cb-dance-${gameState.turnColor === 'w' ? 'black' : 'white'}`
    : '';

  // The piece that delivered mate (it pulls out a gun and shoots the king).
  const checkerSquare = useMemo<Square | null>(() => {
    if (!gameState.isCheckmate || !gameState.checkedKingSquare) return null;
    const king = gameState.checkedKingSquare;
    let found: Square | null = null;
    try {
      const chess = new Chess(fen);
      const winner: Color = gameState.turnColor === 'w' ? 'b' : 'w';
      const attackers = (chess as unknown as { attackers?: (sq: Square, by?: Color) => Square[] }).attackers;
      const list = typeof attackers === 'function' ? attackers.call(chess, king, winner) : [];
      if (list.length > 0) found = lastMove && list.includes(lastMove.to) ? lastMove.to : list[0];
    } catch {
      /* fall through to lastMove */
    }
    if (!found && lastMove) found = lastMove.to;
    return found && found !== king ? found : null;
  }, [fen, lastMove, gameState]);
  // With the gun: everything else (shatter, wave, dance) waits for the bullet to land.
  const mateDelayS = checkerSquare ? 1.2 : 0.4;

  // Easter eggs: press F for a fist that smashes the board, D for a dragon that burns it.
  // They are triggered by the person pressing a key, so they play even with reduced motion on.
  const [boardFx, setBoardFx] = useState<{ kind: 'smash' | 'burn'; id: number } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return;
      }
      // Match the physical key too, so it works on non-Latin layouts (e.g. Arabic) as well.
      const k = e.key?.toLowerCase();
      const isF = e.code === 'KeyF' || k === 'f';
      const isD = e.code === 'KeyD' || k === 'd';
      if (!isF && !isD) return;
      setBoardFx((prev) => ({ kind: isF ? 'smash' : 'burn', id: (prev?.id ?? 0) + 1 }));
    };
    // Capture phase, so nothing else on the page can swallow the key first.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    if (!boardFx) return;
    const t = window.setTimeout(() => setBoardFx(null), boardFx.kind === 'smash' ? SMASH_MS : BURN_MS);
    return () => window.clearTimeout(t);
  }, [boardFx]);
  const flames = useMemo(
    () =>
      boardFx?.kind === 'burn'
        ? Array.from({ length: 64 }).map((_, i) => {
            const row = Math.floor(i / 8);
            const delay = 0.5 + row * 0.09 + Math.random() * 0.25;
            return { i, row, col: i % 8, delay, life: BURN_MS / 1000 - 0.2 - delay, flicker: Math.random() * 0.4 };
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardFx?.kind, boardFx?.id]
  );

  const [celebrationDismissed, setCelebrationDismissed] = useState(false);
  useEffect(() => {
    setCelebrationDismissed(false);
  }, [fen]);

  const confettiPieces = useMemo(() => {
    if (!gameState.isCheckmate) return [];
    const colors = ['#81b64c', '#f7c631', '#4fb083', '#e54444', '#5b8def', '#e040fb', '#ffa459'];
    return Array.from({ length: 26 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100,
      color: colors[i % colors.length],
      delay: Math.random() * 0.5,
      duration: 1.8 + Math.random() * 1.2,
      size: 5 + Math.random() * 6,
      drift: (Math.random() - 0.5) * 60,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.isCheckmate, fen]);

  useEffect(() => {
    if (!containerRef.current) return;
    const turnColor = (() => {
      try {
        return new Chess(fen).turn() === 'w' ? 'white' : 'black';
      } catch {
        return 'white';
      }
    })() as 'white' | 'black';

    const config: Config = {
      fen,
      orientation,
      viewOnly: false,
      coordinates: true,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        color: interactive ? turnColor : undefined,
        dests: interactive ? buildDests(fen) : new Map(),
        showDests: true,
        events: {
          after: (orig: Key, dest: Key) => {
            if (!onUserMoveRef.current || !interactiveRef.current) return;
            try {
              const chess = new Chess(fenRef.current);
              const candidates = chess.moves({ verbose: true }).filter(
                (m) => m.from === orig && m.to === dest
              );
              if (!candidates.length) return;
              const needsPromo = candidates.some((m) => m.promotion);
              const result = chess.move({
                from: orig,
                to: dest,
                promotion: needsPromo ? 'q' : undefined,
              });
              if (!result) return;
              onUserMoveRef.current({
                from: result.from as Square,
                to: result.to as Square,
                promotion: result.promotion,
                san: result.san,
                fen: chess.fen(),
              });
            } catch {
              /* ignore */
            }
          },
        },
      },
      drawable: { enabled: true, visible: true },
      events: {
        select: (key: Key) => {
          onSquareClickRef.current?.(key as Square);
        },
      },
    };
    const api = Chessground(containerRef.current, config);
    apiRef.current = api;
    return () => {
      api.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badgeSquare = lastMove?.to ?? annotationSquare;
  const collidesWithResultBadge =
    !!badgeSquare &&
    (badgeSquare === gameState.checkedKingSquare || badgeSquare === gameState.winnerKingSquare) &&
    gameState.isCheckmate;
  const showBadge = badgeSquare && moveQuality && moveQuality !== 'good' && !collidesWithResultBadge;

  const spotlight = showBadge && moveQuality ? SPOTLIGHT[moveQuality] : undefined;
  const spotlightOn = !!spotlight;

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    if (annotationColor) {
      const brush = colorToBrush(annotationColor);
      api.state.drawable.brushes[brush] = {
        key: brush,
        color: annotationColor,
        opacity: 1,
        lineWidth: 8,
      };
    }

    const autoShapes: any[] = [];
    if (bestMoveUci && bestMoveUci.length >= 4) {
      autoShapes.push({
        orig: bestMoveUci.slice(0, 2) as Key,
        dest: bestMoveUci.slice(2, 4) as Key,
        brush: 'green',
      });
    }
    if (annotationSquare && annotationColor) {
      autoShapes.push({
        orig: annotationSquare as Key,
        brush: colorToBrush(annotationColor),
      });
    }

    const turnColor = gameState.turnColor === 'w' ? 'white' : 'black';
    api.set({
      fen,
      orientation,
      lastMove: lastMove
        ? spotlightOn
          ? [lastMove.to as Key]
          : [lastMove.from as Key, lastMove.to as Key]
        : undefined,
      selected: highlightSquare ? (highlightSquare as Key) : undefined,
      check: gameState.inCheck ? gameState.turnColor : false,
      drawable: { autoShapes },
      movable: {
        free: false,
        color: interactive ? (turnColor as 'white' | 'black') : undefined,
        dests: interactive ? buildDests(fen) : new Map(),
        showDests: true,
      },
      turnColor: turnColor as 'white' | 'black',
    });
  }, [
    fen,
    orientation,
    lastMove,
    spotlightOn,
    highlightSquare,
    bestMoveUci,
    annotationSquare,
    annotationColor,
    gameState.inCheck,
    gameState.turnColor,
    interactive,
  ]);


  const winnerName = gameState.turnColor === 'w' ? blackName : whiteName;
  const showCheckmateOverlay = SHOW_MATE_CARD && showCelebration && gameState.isCheckmate && !celebrationDismissed;

  return (
    <div
      className={`relative w-full cb-green-board${spotlight ? ' cb-spotlight' : ''}${mateClass}${boardFx ? ` cb-fx-${boardFx.kind}` : ''}`}
      style={
        {
          maxWidth: size,
          containerType: 'inline-size',
          '--cb-tint': spotlight?.tint,
          '--cb-fade-ms': `${MATE_FADE_MS}ms`,
          '--cb-mate-ms': `${MATE_STYLE_MS}ms`,
          '--cb-mate-delay': `${mateDelayS}s`,
        } as CSSProperties
      }
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          aspectRatio: '1 / 1',
          maxWidth: size,
          borderRadius: '8px',
          overflow: 'hidden',
          boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
        }}
      />
      {gameState.checkedKingSquare && !gameState.isCheckmate && (
        <CheckRing
          square={gameState.checkedKingSquare}
          orientation={orientation}
          severe={false}
        />
      )}
      {gameState.isCheckmate && gameState.checkedKingSquare && (
        <ShatteredKing
          key={`shatter-${fen}`}
          square={gameState.checkedKingSquare}
          orientation={orientation}
          color={gameState.turnColor === 'w' ? 'white' : 'black'}
          boardRef={containerRef}
          delayMs={Math.round(mateDelayS * 1000) - (checkerSquare ? 0 : 50)}
        />
      )}
      {gameState.isCheckmate && gameState.winnerKingSquare && (
        <DancingKing key={`dance-${fen}`} square={gameState.winnerKingSquare} orientation={orientation} delayS={mateDelayS} />
      )}
      {gameState.isCheckmate && gameState.checkedKingSquare && checkerSquare && (
        <MateShot key={`shot-${fen}`} from={checkerSquare} to={gameState.checkedKingSquare} orientation={orientation} />
      )}
      {showBadge && (
        <BoardBadge square={badgeSquare} quality={moveQuality} orientation={orientation} />
      )}
      {spotlight && badgeSquare && (
        <SpotlightPill
          key={`${fen}-${badgeSquare}-${moveQuality}`}
          label={spotlight.label}
          textColor={spotlight.text}
          marks={moveQuality ? marksFor(moveQuality) : 0}
          square={badgeSquare}
          orientation={orientation}
        />
      )}
      {showCheckmateOverlay && (
        <CheckmateCelebration
          winnerName={winnerName}
          pieces={confettiPieces}
          onDismiss={() => setCelebrationDismissed(true)}
        />
      )}
      {boardFx?.kind === 'smash' && <SmashFx key={boardFx.id} />}
      {boardFx?.kind === 'burn' && <BurnFx key={boardFx.id} flames={flames} />}
      <style>{`
        @keyframes cb-check-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(250, 65, 45, 0.55), inset 0 0 12px 2px rgba(250, 65, 45, 0.35); }
          50% { box-shadow: 0 0 0 8px rgba(250, 65, 45, 0), inset 0 0 20px 4px rgba(250, 65, 45, 0.55); }
        }
        @keyframes cb-mate-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(250, 65, 45, 0.8), inset 0 0 16px 4px rgba(250, 65, 45, 0.6); }
          50% { box-shadow: 0 0 0 12px rgba(250, 65, 45, 0), inset 0 0 26px 8px rgba(250, 65, 45, 0.85); }
        }
        @keyframes cb-confetti-fall {
          0% { transform: translateY(-16px); opacity: 1; }
          100% { transform: translateY(240px); opacity: 0; }
        }
        @keyframes cb-mate-flash {
          0% { opacity: 0; }
          8% { opacity: 1; }
          60% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes cb-mate-topple {
          0% { opacity: 0; transform: scale(0.55); }
          8% { opacity: 1; }
          26% { opacity: 1; transform: scale(1.1); }
          36% { transform: scale(1); }
          46% { transform: scale(1.05); }
          56% { transform: scale(1); }
          78% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.85); }
        }
        @keyframes cb-mate-pill {
          0% { opacity: 0; transform: translateY(8px) scale(0.6); }
          12% { opacity: 1; transform: translateY(0) scale(1.08); }
          18% { transform: translateY(0) scale(1); }
          80% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-4px) scale(0.96); }
        }
        @keyframes cb-overlay-in {
          0% { opacity: 0; visibility: hidden; }
          100% { opacity: 1; visibility: visible; }
        }
        /* Tint the last-move squares while a brilliant / great move is shown */
        .cb-spotlight .cg-wrap cg-board square.last-move {
          background-color: var(--cb-tint);
        }
        /* Checkmate restyle. The board itself is never redrawn, moved or rotated: a colour layer
           is blended over it (light squares stay light, dark stay dark) and its colour fades
           through several themes, so the squares keep exactly the same layout. */
        @property --cb-board-tint { syntax: '<color>'; inherits: false; initial-value: rgba(0, 0, 0, 0); }
        @keyframes cb-mate-board {
          0%   { --cb-board-tint: rgba(160, 98, 58, 0); }
          15%  { --cb-board-tint: rgba(160, 98, 58, 1); }
          35%  { --cb-board-tint: rgba(61, 127, 208, 1); }
          55%  { --cb-board-tint: rgba(138, 79, 208, 1); }
          75%  { --cb-board-tint: rgba(208, 80, 122, 1); }
          100% { --cb-board-tint: rgba(208, 80, 122, 0); }
        }
        .cb-mate-on .cg-wrap cg-board::before {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          mix-blend-mode: color;
          background: var(--cb-board-tint);
          animation: cb-mate-board var(--cb-mate-ms) ease-in-out both;
        }
        /* Pieces never move, rotate or scale: each style swap is a quick fade out, then a fade in. */
        @keyframes cb-piece-fade-out { from { opacity: 1; } to { opacity: 0; } }
        @keyframes cb-piece-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cb-holo {
          from { filter: sepia(1) saturate(5) hue-rotate(0deg); }
          to { filter: sepia(1) saturate(5) hue-rotate(360deg); }
        }
        .cb-anim-out .cg-wrap piece { animation: cb-piece-fade-out var(--cb-fade-ms) ease-in both; }
        .cb-anim-in .cg-wrap piece { animation: cb-piece-fade-in var(--cb-fade-ms) ease-out both; }
        /* style 2: gold vs obsidian (the normal piece art, recoloured) */
        .cb-pstyle-2 .cg-wrap piece.white {
          filter: sepia(1) saturate(2.6) hue-rotate(-10deg) brightness(1.08) contrast(1.05)
            drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6));
        }
        .cb-pstyle-2 .cg-wrap piece.black {
          filter: brightness(0.5) contrast(1.5) drop-shadow(0 0 2px rgba(255, 214, 150, 0.9));
        }
        /* style 3: neon glow on figurine glyphs */
        .cb-pstyle-3 .cg-wrap piece.white { filter: drop-shadow(0 0 5px #22e6ff); }
        .cb-pstyle-3 .cg-wrap piece.black { filter: drop-shadow(0 0 5px #ff3df2); }
        /* style 4: ice vs ember glyphs (colours only, see MATE_PIECE_CSS) */
        /* style 5: rainbow-cycling normal pieces (colour only, nothing moves) */
        .cb-pstyle-5 .cg-wrap piece { filter: sepia(1) saturate(5); }
        .cb-pstyle-5.cb-anim-in .cg-wrap piece {
          animation: cb-piece-fade-in var(--cb-fade-ms) ease-out both, cb-holo 1.1s linear infinite;
        }
        .cb-pstyle-5.cb-anim-out .cg-wrap piece {
          animation: cb-piece-fade-out var(--cb-fade-ms) ease-in both, cb-holo 1.1s linear infinite;
        }
        /* style 6: negative (light pieces dark, dark pieces light) */
        .cb-pstyle-6 .cg-wrap piece { filter: invert(1) hue-rotate(180deg); }
        /* Checkmate: dancing winner king, shattering checkmated king */
        @keyframes cb-kfx-in { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: scale(1); } }
        /* uses the independent translate/rotate/scale properties so it stacks on chessground's inline transform */
        /* Board theme: green and white (a1 dark, top-left light), like Chess.com */
        .cb-green-board .cg-wrap cg-board {
          background-color: #ebecd0 !important;
          background-image: repeating-conic-gradient(#779556 0 25%, #ebecd0 0 50%) !important;
          background-size: 25% 25% !important;
        }
        /* Checkmate: the top half of the board turns red & black, sweeping down from the top edge to the middle.
           It is drawn on cg-board's ::before, so it sits above the squares but under the pieces. */
        .cb-mate-wave cg-board::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 50%;
          z-index: 1;
          pointer-events: none;
          background: repeating-conic-gradient(#0d0d10 0 25%, #c1121f 0 50%) 0 0 / 25% 50%;
          opacity: 0.92;
          animation: cb-wave-down 1.1s cubic-bezier(0.4, 0, 0.2, 1) var(--cb-mate-delay, 0.35s) both;
        }
        @keyframes cb-wave-down { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0 0 0 0); } }
        @keyframes cb-king-dance {
          0%, 100% { translate: 0 0; scale: 1 1; }
          20% { translate: 0 2%; scale: 1.03 0.95; }
          45% { translate: 0 -4%; scale: 0.98 1.02; }
          65% { translate: 0 2%; scale: 1.04 0.95; }
          80% { translate: 0 0; scale: 1 1; }
        }
        .cb-dance-white .cg-wrap piece.king.white,
        .cb-dance-black .cg-wrap piece.king.black {
          animation: cb-king-dance 1s ease-in-out var(--cb-mate-delay, 0.4s) infinite;
          z-index: 6;
        }
        @keyframes cb-king-shadow {
          0%, 100% { transform: scaleX(1); opacity: 1; }
          45% { transform: scaleX(0.8); opacity: 0.75; }
        }
        /* the shards burst out a little further, then settle where they stay */
        @keyframes cb-shard {
          0% { transform: translate(0, 0) rotate(0deg); }
          22% { transform: translate(0, 0) rotate(0deg); }
          50% { transform: translate(calc(var(--dx) * 1.8), calc(var(--dy) * 1.8 - 8%)) rotate(calc(var(--rot) * 1.5)); }
          100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); }
        }
        @keyframes cb-crack-flash { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes cb-shatter-flash { 0% { opacity: 0; transform: scale(0.5); } 30% { opacity: 1; } 100% { opacity: 0; transform: scale(1.4); } }
        /* Gun: pops in at 0.35s, fires at 0.95s, bullet lands at 1.2s */
        @keyframes cb-gun-in { from { opacity: 0; transform: scale(0.3); } to { opacity: 1; transform: scale(1); } }
        @keyframes cb-gun-recoil {
          0%, 100% { transform: translateX(0) rotate(0deg); }
          30% { transform: translateX(-22%) rotate(-9deg); }
        }
        @keyframes cb-muzzle {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
          25% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.5); }
        }
        @keyframes cb-bullet {
          0% { left: var(--x0); top: var(--y0); opacity: 0; }
          2% { opacity: 1; }
          92% { opacity: 1; }
          100% { left: var(--x1); top: var(--y1); opacity: 0; }
        }
        @keyframes cb-smoke {
          0% { opacity: 0.7; translate: 0 0; scale: 0.4; }
          100% { opacity: 0; translate: 0 -160%; scale: 1.8; }
        }
        @keyframes cb-shah-pop {
          0% { opacity: 0; transform: translateY(8px) scale(0.5); }
          60% { opacity: 1; transform: translateY(0) scale(1.12); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) { .cb-kfx, .cb-kfx * { animation: none !important; } .cb-dance-white .cg-wrap piece.king.white, .cb-dance-black .cg-wrap piece.king.black { animation: none !important; } .cb-mate-wave cg-board::before { animation: none; } }
        ${MATE_PIECE_CSS}
        @media (prefers-reduced-motion: reduce) {
          .cb-anim-out .cg-wrap piece,
          .cb-anim-in .cg-wrap piece { animation: none !important; }
          .cb-mate-on .cg-wrap cg-board::before {
            animation: none;
            --cb-board-tint: rgba(160, 98, 58, 1);
          }
          .cb-spotlight-transient { display: none; }
          .cb-mate-transient { display: none; }
          .cb-mate-delayed { animation: none !important; }
        }
        /* F key: fist smash (2.6s) */
        @keyframes cb-fx-hand {
          0%   { transform: translateY(-75cqw); opacity: 0; }
          12%  { transform: translateY(-40cqw); opacity: 1; }
          28%  { transform: translateY(-46cqw); animation-timing-function: cubic-bezier(0.7, 0, 1, 0.5); }
          33%  { transform: translateY(0); }
          40%  { transform: translateY(2cqw); }
          62%  { transform: translateY(0); opacity: 1; }
          85%  { transform: translateY(-30cqw); opacity: 1; }
          100% { transform: translateY(-55cqw); opacity: 0; }
        }
        @keyframes cb-fx-open { 0%, 28% { opacity: 1; } 28.1%, 100% { opacity: 0; } }
        @keyframes cb-fx-fist { 0%, 28% { opacity: 0; } 28.1%, 100% { opacity: 1; } }
        @keyframes cb-fx-flash { 0%, 32% { opacity: 0; } 34% { opacity: 0.55; } 48%, 100% { opacity: 0; } }
        @keyframes cb-fx-ring {
          0%, 32% { opacity: 0; transform: scale(0.2); }
          34% { opacity: 1; transform: scale(0.3); }
          60%, 100% { opacity: 0; transform: scale(3.2); }
        }
        @keyframes cb-fx-crack { 0%, 32% { stroke-dashoffset: 1; } 42%, 100% { stroke-dashoffset: 0; } }
        @keyframes cb-fx-cracks-fade { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes cb-fx-shake {
          0%, 32% { transform: translate(0, 0); }
          33%  { transform: translate(0, 2cqw); }
          36%  { transform: translate(-1.6cqw, -1cqw); }
          40%  { transform: translate(1.4cqw, 1cqw); }
          44%  { transform: translate(-1cqw, 0.6cqw); }
          48%  { transform: translate(0.8cqw, -0.5cqw); }
          54%  { transform: translate(-0.4cqw, 0.3cqw); }
          60%, 100% { transform: translate(0, 0); }
        }
        .cb-fx-smash .cg-wrap { animation: cb-fx-shake 2.6s linear both; }
        /* D key: dragon fire (4.5s) */
        @keyframes cb-fx-dragon {
          0%   { transform: translate(-50%, -110%); opacity: 0; }
          10%  { transform: translate(-50%, -8%); opacity: 1; }
          25%  { transform: translate(-50%, -14%); }
          40%  { transform: translate(-50%, -8%); }
          55%  { transform: translate(-50%, -14%); }
          70%  { transform: translate(-50%, -8%); opacity: 1; }
          88%  { transform: translate(-50%, -40%); opacity: 1; }
          100% { transform: translate(-50%, -110%); opacity: 0; }
        }
        @keyframes cb-fx-sweep {
          0%, 8%  { clip-path: inset(0 0 100% 0); opacity: 1; }
          30%     { clip-path: inset(0 0 0 0); opacity: 1; }
          72%     { clip-path: inset(0 0 0 0); opacity: 1; }
          100%    { clip-path: inset(0 0 0 0); opacity: 0; }
        }
        @keyframes cb-fx-flame-life {
          0%   { opacity: 0; transform: scale(0.2) translateY(20%); }
          10%  { opacity: 1; transform: scale(1.1) translateY(0); }
          16%  { transform: scale(1) translateY(0); }
          82%  { opacity: 1; }
          100% { opacity: 0; transform: scale(0.9) translateY(-6%); }
        }
        @keyframes cb-fx-flicker {
          from { transform: scale(0.94, 0.96); }
          to   { transform: scale(1.06, 1.16); }
        }
        @keyframes cb-fx-char {
          0%, 100% { filter: none; }
          25%, 70% { filter: sepia(1) saturate(3) hue-rotate(-25deg) brightness(0.55) contrast(1.2); }
        }
        .cb-fx-burn .cg-wrap piece { animation: cb-fx-char 4.5s ease-in-out both; }
        @keyframes cb-celebration-pop {
          0% { transform: scale(0.85) translateY(6px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}


function CheckRing({
  square,
  orientation,
  severe,
}: {
  square: Square;
  orientation: 'white' | 'black';
  severe: boolean;
}) {
  const pos = getSquarePosition(square, orientation);
  return (
    <div
      className="absolute pointer-events-none rounded-sm"
      style={{
        left: pos.left,
        top: pos.top,
        width: '12.5%',
        height: '12.5%',
        animation: `${severe ? 'cb-mate-pulse' : 'cb-check-pulse'} ${severe ? '0.9s' : '1.3s'} ease-in-out infinite`,
        zIndex: 8,
      }}
    />
  );
}

/** Checkmate sequence timing (seconds). Badges and the celebration card wait for it. */
const MATE_FX_S = 2;
/** The dark "Checkmate - X wins!" card. Off so the burning / frozen kings stay visible. */
const SHOW_MATE_CARD = false;
/** Total length of the checkmate restyle (ms), each swap's fade (ms), and number of piece styles. */
const MATE_STYLE_MS = 6000;
const MATE_FADE_MS = 150;

/**
 * Alternate piece sets for the checkmate restyle. Styles 1, 3 and 4 draw figurine glyphs
 * (\u265A-\u265F) as SVG using system fonts, so exact shapes vary a little by platform.
 * Styles 2, 5 and 6 recolour the normal piece art with filters (see the CSS above).
 */
const MATE_PIECE_CSS = (() => {
  const glyphs: Record<string, string> = {
    king: '\u265A', queen: '\u265B', rook: '\u265C', bishop: '\u265D', knight: '\u265E', pawn: '\u265F',
  };
  const looks: Record<number, Record<'white' | 'black', { fill: string; stroke: string; width: number }>> = {
    1: {
      white: { fill: '#fff6e0', stroke: '#3a2a14', width: 4 },
      black: { fill: '#1a1a1a', stroke: '#e6c98c', width: 3.5 },
    },
    3: {
      white: { fill: '#0b1a2b', stroke: '#22e6ff', width: 4 },
      black: { fill: '#1a0b22', stroke: '#ff3df2', width: 4 },
    },
    4: {
      white: { fill: '#e8f6ff', stroke: '#1f4f7a', width: 4 },
      black: { fill: '#5a1010', stroke: '#ff9a3c', width: 3.5 },
    },
  };
  const font = "'Noto Sans Symbols 2','Segoe UI Symbol','Apple Symbols','DejaVu Sans',serif";
  let out = '';
  for (const [style, byColor] of Object.entries(looks)) {
    for (const color of ['white', 'black'] as const) {
      for (const [role, ch] of Object.entries(glyphs)) {
        const l = byColor[color];
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
          `<text x="50" y="80" font-size="92" text-anchor="middle" font-family="${font}" ` +
          `fill="${l.fill}" stroke="${l.stroke}" stroke-width="${l.width}" paint-order="stroke" ` +
          `stroke-linejoin="round">${ch}\uFE0E</text></svg>`;
        out +=
          `.cb-pstyle-${style} .cg-wrap piece.${color}.${role} { ` +
          `background-image: url("data:image/svg+xml,${encodeURIComponent(svg)}"); ` +
          `background-size: contain; background-repeat: no-repeat; }\n`;
      }
    }
  }
  return out;
})();
/** Easter-egg effect lengths (ms): F = smash, D = dragon fire. Keep in sync with the CSS above. */
const SMASH_MS = 2600;
const BURN_MS = 4500;

/** Jagged crack lines (0-100 board coordinates) radiating from the centre for the smash effect. */
const CRACKS = [
  'M50 50 L46 41 L49 33 L43 24 L46 14 L41 4',
  'M50 50 L58 43 L57 34 L65 28 L64 18 L72 8',
  'M50 50 L60 52 L69 47 L77 51 L86 45 L96 48',
  'M50 50 L58 60 L56 69 L64 76 L61 86 L69 96',
  'M50 50 L42 58 L44 67 L36 73 L38 83 L30 95',
  'M50 50 L40 51 L31 46 L23 51 L14 46 L4 50',
  'M43 24 L34 22 L27 15',
  'M65 28 L74 30 L82 26',
  'M69 47 L72 57 L79 62',
  'M44 67 L52 78',
  'M31 46 L28 36 L20 31',
];

function CheckmateCelebration({
  winnerName,
  pieces,
  onDismiss,
}: {
  winnerName: string;
  pieces: { id: number; left: number; color: string; delay: number; duration: number; size: number; drift: number }[];
  onDismiss: () => void;
}) {
  return (
    <div
      className="cb-mate-delayed absolute inset-0 z-20 flex items-center justify-center rounded-lg overflow-hidden"
      style={{
        background: 'rgba(10, 11, 14, 0.55)',
        backdropFilter: 'blur(1px)',
        animation: `cb-overlay-in 0.4s ease-out ${MATE_FX_S}s both`,
      }}
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute top-0"
          style={{ left: `${p.left}%`, transform: `translateX(${p.drift}px)` }}
        >
          <span
            className="block rounded-sm"
            style={{
              width: p.size,
              height: p.size * 1.6,
              backgroundColor: p.color,
              animation: `cb-confetti-fall ${p.duration}s linear ${p.delay}s infinite`,
            }}
          />
        </span>
      ))}
      <div
        className="relative flex flex-col items-center gap-2 rounded-xl px-6 py-5 mx-4 text-center shadow-2xl"
        style={{
          background: 'linear-gradient(160deg, #1c2028, #0f1115)',
          border: '1px solid rgba(255,255,255,0.08)',
          animation: 'cb-celebration-pop 0.35s ease-out',
        }}
      >
        <button
          onClick={onDismiss}
          className="absolute -top-2 -right-2 rounded-full bg-ink-800 border border-white/10 p-1 text-ink-300 hover:text-white"
          title="Dismiss"
        >
          <X size={12} />
        </button>
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg">
          <PartyPopper size={20} className="text-white" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Checkmate</p>
        <p className="text-lg font-bold text-white leading-tight">{winnerName} wins!</p>
      </div>
    </div>
  );
}

/**
 * Winning king: the real piece jumps up and down in place (see .cb-dance-* CSS).
 * This overlay only adds the floor shadow that shrinks while the king is in the air.
 */
function DancingKing({ square, orientation, delayS }: { square: Square; orientation: 'white' | 'black'; delayS: number }) {
  const pos = getSquarePosition(square, orientation);
  return (
    <div
      className="cb-kfx absolute pointer-events-none"
      style={{ left: pos.left, top: pos.top, width: '12.5%', height: '12.5%', zIndex: 12 }}
      aria-hidden="true"
    >
      <div
        className="absolute"
        style={{
          left: '20%',
          right: '20%',
          bottom: '2%',
          height: '9%',
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.35)',
          animation: `cb-king-shadow 1s ease-in-out ${delayS}s infinite`,
        }}
      />
    </div>
  );
}

/** The mating piece pulls out a gun, aims at the king and shoots (cartoon, no gore). */
function MateShot({ from, to, orientation }: { from: Square; to: Square; orientation: 'white' | 'black' }) {
  const center = (sq: Square) => {
    const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(sq[1]) - 1;
    const col = orientation === 'white' ? file : 7 - file;
    const row = orientation === 'white' ? 7 - rank : rank;
    return { x: (col + 0.5) * 12.5, y: (row + 0.5) * 12.5 };
  };
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const flip = Math.abs(ang) > 90; // keep the pistol upright when aiming left

  const gun = { x: a.x + ux * 4.5, y: a.y + uy * 4.5 };
  const muzzle = { x: a.x + ux * 10, y: a.y + uy * 10 };
  const hit = { x: b.x - ux * 1.5, y: b.y - uy * 1.5 };
  const pct = (n: number) => `${n}%`;

  return (
    <div className="cb-kfx absolute inset-0 pointer-events-none" style={{ zIndex: 13 }} aria-hidden="true">
      {/* the pistol (outer = aim direction, middle = pop-in, inner = recoil) */}
      <div
        className="absolute"
        style={{
          left: pct(gun.x),
          top: pct(gun.y),
          width: '12%',
          transform: `translate(-50%, -50%) rotate(${ang}deg)${flip ? ' scaleY(-1)' : ''}`,
        }}
      >
        <div style={{ animation: 'cb-gun-in 0.3s ease-out 0.35s both' }}>
          <div style={{ animation: 'cb-gun-recoil 0.35s ease-out 0.95s both' }}>
            <svg viewBox="0 0 64 40" style={{ display: 'block', width: '100%', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}>
              <polygon points="10,18 27,18 23,38 8,38" fill="#6b4226" stroke="#1a1109" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M27 18 V25 Q27 29 23 29 H19" fill="none" stroke="#1a1d22" strokeWidth="2.5" strokeLinecap="round" />
              <rect x="6" y="5" width="50" height="14" rx="3" fill="#3a4049" stroke="#101216" strokeWidth="1.5" />
              <rect x="54" y="8" width="9" height="8" rx="1.5" fill="#1b1e23" stroke="#101216" strokeWidth="1.2" />
              <rect x="11" y="8" width="30" height="3" rx="1.5" fill="#7a8493" />
              <rect x="12" y="2" width="5" height="4" rx="1" fill="#1b1e23" />
              <rect x="50" y="2" width="3" height="4" rx="1" fill="#1b1e23" />
            </svg>
          </div>
        </div>
      </div>
      {/* muzzle flash */}
      <div
        className="absolute"
        style={{
          left: pct(muzzle.x),
          top: pct(muzzle.y),
          width: '8%',
          aspectRatio: '1 / 1',
          borderRadius: '50%',
          opacity: 0,
          background: 'radial-gradient(circle, #fff 0%, #ffd34a 38%, rgba(255,120,0,0) 70%)',
          animation: 'cb-muzzle 0.22s ease-out 0.95s both',
        }}
      />
      {/* smoke puffs */}
      {[0, 1].map((i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            left: pct(muzzle.x + (i ? 1.2 : -1.2)),
            top: pct(muzzle.y),
            width: '3%',
            aspectRatio: '1 / 1',
            background: 'rgba(210,210,215,0.85)',
            opacity: 0,
            animation: `cb-smoke 1.2s ease-out ${1.0 + i * 0.1}s both`,
          }}
        />
      ))}
      {/* the bullet */}
      <div
        className="absolute"
        style={
          {
            width: '3.4%',
            height: '0.9%',
            borderRadius: 999,
            background: 'linear-gradient(90deg, rgba(255,210,90,0), #ffd34a 40%, #fff)',
            boxShadow: '0 0 6px 1px rgba(255,200,80,0.9)',
            transform: `translate(-50%, -50%) rotate(${ang}deg)`,
            opacity: 0,
            '--x0': pct(muzzle.x),
            '--y0': pct(muzzle.y),
            '--x1': pct(hit.x),
            '--y1': pct(hit.y),
            animation: 'cb-bullet 0.25s linear 0.95s both',
          } as CSSProperties
        }
      />
    </div>
  );
}

/** 6 jagged pieces that tile the square. dx/dy/rot = where each one comes to rest (small, so the king stays broken in place). */
const SHARDS = [
  { clip: 'polygon(0% 0%, 55% 0%, 45% 40%, 0% 30%)', dx: -9, dy: 3, rot: -9 },
  { clip: 'polygon(55% 0%, 100% 0%, 100% 35%, 62% 52%, 45% 40%)', dx: 9, dy: 2, rot: 8 },
  { clip: 'polygon(0% 30%, 45% 40%, 38% 75%, 0% 70%)', dx: -11, dy: 7, rot: -12 },
  { clip: 'polygon(45% 40%, 62% 52%, 65% 80%, 38% 75%)', dx: 1, dy: 10, rot: 5 },
  { clip: 'polygon(62% 52%, 100% 35%, 100% 100%, 60% 100%, 65% 80%)', dx: 11, dy: 7, rot: 12 },
  { clip: 'polygon(0% 70%, 38% 75%, 65% 80%, 60% 100%, 0% 100%)', dx: -4, dy: 12, rot: -6 },
];

/**
 * Checkmated king: after the mating move lands, the real piece is hidden and
 * replaced by shards cut from the same piece image, which crack and fly apart.
 */
function ShatteredKing({
  square,
  orientation,
  color,
  boardRef,
  delayMs,
}: {
  square: Square;
  orientation: 'white' | 'black';
  color: 'white' | 'black';
  boardRef: RefObject<HTMLDivElement | null>;
  /** When the king breaks (after the bullet lands). */
  delayMs: number;
}) {
  const pos = getSquarePosition(square, orientation);
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = parseInt(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  const [bg, setBg] = useState<string | null>(null);

  useEffect(() => {
    let el: HTMLElement | null = null;
    // Wait for the mating move to finish sliding in, then grab the real king piece.
    const t = window.setTimeout(() => {
      el = boardRef.current?.querySelector<HTMLElement>(`piece.king.${color}`) ?? null;
      if (!el) return;
      const img = getComputedStyle(el).backgroundImage;
      if (!img || img === 'none') return;
      el.style.visibility = 'hidden';
      setBg(img);
    }, delayMs);
    return () => {
      window.clearTimeout(t);
      if (el) el.style.visibility = '';
    };
  }, [boardRef, color, square, delayMs]);

  // Keep the label on the board: centred normally, pinned to the side on the edge files
  const labelPos: CSSProperties =
    col === 0 ? { left: 0 } : col === 7 ? { right: 0 } : { left: '50%', transform: 'translateX(-50%)' };

  return (
    <div
      className="cb-kfx absolute pointer-events-none"
      style={{ left: pos.left, top: pos.top, width: '12.5%', height: '12.5%', zIndex: 12 }}
      aria-hidden="true"
    >
      {bg && (
        <>
          {SHARDS.map((sh, i) => (
            <div
              key={i}
              className="absolute inset-0"
              style={
                {
                  backgroundImage: bg,
                  backgroundSize: '100% 100%',
                  backgroundRepeat: 'no-repeat',
                  clipPath: sh.clip,
                  '--dx': `${sh.dx}%`,
                  '--dy': `${sh.dy}%`,
                  '--rot': `${sh.rot}deg`,
                  animation: `cb-shard 0.9s ease-out ${i * 0.03}s both`,
                } as CSSProperties
              }
            />
          ))}
          {/* cracks flash across the king right before it breaks */}
          <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 w-full h-full"
            style={{ opacity: 0, animation: 'cb-crack-flash 0.5s ease-out both' }}
          >
            <path
              d="M0 30 L45 40 L62 52 L100 35 M45 40 L55 0 M38 75 L45 40 M62 52 L65 80 L60 100 M38 75 L0 70 M65 80 L38 75"
              stroke="#fff"
              strokeWidth="3"
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <div
            className="absolute"
            style={{
              inset: '-20%',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 65%)',
              opacity: 0,
              animation: 'cb-shatter-flash 0.6s ease-out 0.25s both',
            }}
          />
        </>
      )}
      {/* label */}
      <div
        className="absolute"
        style={{ top: row === 0 ? '104%' : '-38%', whiteSpace: 'nowrap', ...labelPos }}
      >
        <div
          dir="rtl"
          lang="ar"
          style={{
            color: '#fff',
            fontWeight: 800,
            fontSize: '4cqw',
            lineHeight: 1.2,
            textShadow: '0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.7)',
            fontFamily: '"Segoe UI", Tahoma, system-ui, sans-serif',
            animation: `cb-shah-pop 0.5s ease-out ${delayMs / 1000 + 0.2}s both`,
          }}
        >
          شاه مات
        </div>
      </div>
    </div>
  );
}

/** Bold "!" / "!!" glyph drawn as shapes so it scales cleanly (badge and ghost mark). */
function MarkGlyph({ count, height, opacity = 1 }: { count: 1 | 2; height: string; opacity?: number }) {
  const vw = count === 2 ? 48 : 20;
  const xs = count === 2 ? [0, 28] : [0];
  return (
    <svg
      viewBox={`0 0 ${vw} 64`}
      style={{ height, aspectRatio: `${vw} / 64`, opacity, display: 'block' }}
      aria-hidden="true"
    >
      {xs.map((x) => (
        <g key={x} fill="#fff">
          <rect x={x} y={0} width={20} height={40} rx={8} />
          <rect x={x} y={47} width={20} height={17} rx={7} />
        </g>
      ))}
    </svg>
  );
}

function marksFor(quality: MoveQuality): 0 | 1 | 2 {
  return quality === 'brilliant' ? 2 : quality === 'great' ? 1 : 0;
}

function BoardBadge({
  square,
  quality,
  orientation,
}: {
  square: Square;
  quality: MoveQuality;
  orientation: 'white' | 'black';
}) {
  const pos = getSquarePosition(square, orientation);
  const meta = BADGE_META[quality];
  const Icon = meta.icon;
  const marks = marksFor(quality);

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: pos.left, top: pos.top, width: '12.5%', height: '12.5%', zIndex: 10 }}
    >
      {/* Sits on the top-right corner of the square and overhangs it slightly, like Chess.com */}
      <div
        role="img"
        aria-label={quality}
        title={quality}
        className="flex items-center justify-center rounded-full"
        style={{
          position: 'absolute',
          top: '-8%',
          right: '-8%',
          width: 'max(22px, 40%)',
          aspectRatio: '1 / 1',
          backgroundColor: meta.color,
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        }}
      >
        {marks ? (
          <MarkGlyph count={marks} height="56%" />
        ) : meta.symbol ? (
          <span
            className="font-black text-white leading-none select-none"
            style={{ fontSize: 'max(9px, 2.4cqw)' }}
          >
            {meta.symbol}
          </span>
        ) : (
          <Icon size="58%" className="text-white" strokeWidth={2.5} />
        )}
      </div>
    </div>
  );
}

/**
 * White quality pill ("Brilliant", "Great Move") that pops in next to the destination square, then fades.
 * Sits above the square (below it on the top rank) and is pinned to the board on edge files.
 * Remount via `key` to replay.
 */
function SpotlightPill({
  label,
  textColor,
  marks,
  square,
  orientation,
}: {
  label: string;
  textColor: string;
  marks: 0 | 1 | 2;
  square: Square;
  orientation: 'white' | 'black';
}) {
  // Brilliant: show English first, then switch to Arabic "مقودة" after 2s
  const isBrilliant = label === 'Brilliant';
  const [displayLabel, setDisplayLabel] = useState(label);
  useEffect(() => {
    if (!isBrilliant) {
      setDisplayLabel(label);
      return;
    }
    setDisplayLabel('Brilliant');
    const t = window.setTimeout(() => setDisplayLabel('مقودة'), 2000);
    return () => window.clearTimeout(t);
  }, [label, isBrilliant]);

  // Longer pill duration for brilliant so the 2s label switch is visible
  const pillAnim = isBrilliant ? 'cb-mate-pill 3.6s ease-out both' : 'cb-mate-pill 1.8s ease-out both';

  const pos = getSquarePosition(square, orientation);
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = parseInt(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;

  const pillPos: CSSProperties =
    col === 0
      ? { left: 0 }
      : col === 7
        ? { right: 0 }
        : { left: '50%', transform: 'translateX(-50%)' };

  return (
    <div
      className="cb-spotlight-transient absolute pointer-events-none"
      style={{ left: pos.left, top: pos.top, width: '12.5%', height: '12.5%', zIndex: 12 }}
      aria-hidden="true"
    >
      {marks > 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ animation: pillAnim }}
        >
          <MarkGlyph count={marks as 1 | 2} height="66%" opacity={0.95} />
        </div>
      )}
      <div
        className="absolute"
        style={{
          ...(row === 0 ? { top: '92%' } : { bottom: '92%' }),
          whiteSpace: 'nowrap',
          ...pillPos,
        }}
      >
        <div
          style={{
            backgroundColor: '#fff',
            color: textColor,
            fontWeight: 900,
            fontSize: '3.9cqw',
            lineHeight: 1.15,
            padding: '1.1cqw 3.2cqw',
            borderRadius: 999,
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
            animation: pillAnim,
          }}
        >
          {displayLabel}
        </div>
      </div>
    </div>
  );
}

/** F key: an open hand lowers, turns into a fist, slams the board; it shakes and cracks. */
function SmashFx() {
  const emoji: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '36cqw',
    lineHeight: 1,
    filter: 'drop-shadow(0 2cqw 2cqw rgba(0,0,0,0.45))',
  };
  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg"
      style={{ zIndex: 30 }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 w-full h-full"
        style={{ animation: `cb-fx-cracks-fade ${SMASH_MS}ms linear both` }}
      >
        {CRACKS.map((d, i) => (
          <g key={i} fill="none" strokeLinejoin="round" strokeLinecap="round">
            <path
              d={d}
              pathLength={1}
              stroke="#000"
              strokeOpacity={0.55}
              strokeWidth={1.8}
              style={{ strokeDasharray: 1, animation: `cb-fx-crack ${SMASH_MS}ms ease-out ${i * 12}ms both` }}
            />
            <path
              d={d}
              pathLength={1}
              stroke="#fff"
              strokeWidth={0.7}
              style={{ strokeDasharray: 1, animation: `cb-fx-crack ${SMASH_MS}ms ease-out ${i * 12}ms both` }}
            />
          </g>
        ))}
      </svg>
      <div
        className="absolute inset-0"
        style={{ background: '#fff', animation: `cb-fx-flash ${SMASH_MS}ms linear both` }}
      />
      <div
        className="absolute"
        style={{
          left: '35%',
          top: '35%',
          width: '30%',
          height: '30%',
          borderRadius: '50%',
          border: '0.9cqw solid rgba(255,255,255,0.9)',
          animation: `cb-fx-ring ${SMASH_MS}ms ease-out both`,
        }}
      />
      <div
        className="absolute"
        style={{
          left: '50%',
          top: '50%',
          width: '44cqw',
          height: '44cqw',
          marginLeft: '-22cqw',
          marginTop: '-22cqw',
          animation: `cb-fx-hand ${SMASH_MS}ms ease-in-out both`,
        }}
      >
        <span style={{ ...emoji, animation: `cb-fx-open ${SMASH_MS}ms linear both` }}>{'\u270B'}</span>
        <span style={{ ...emoji, animation: `cb-fx-fist ${SMASH_MS}ms linear both` }}>{'\u270A'}</span>
      </div>
    </div>
  );
}

/** D key: a dragon hovers above the board and sets every square on fire, then it burns out. */
function BurnFx({
  flames,
}: {
  flames: { i: number; row: number; col: number; delay: number; life: number; flicker: number }[];
}) {
  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg"
      style={{ zIndex: 30 }}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(255, 120, 0, 0.7), rgba(255, 60, 0, 0.4) 60%, rgba(40, 10, 0, 0.45))',
          animation: `cb-fx-sweep ${BURN_MS}ms ease-out both`,
        }}
      />
      {flames.map((f) => (
        <div
          key={f.i}
          className="absolute flex items-center justify-center"
          style={{
            left: `${f.col * 12.5}%`,
            top: `${f.row * 12.5}%`,
            width: '12.5%',
            height: '12.5%',
            animation: `cb-fx-flame-life ${f.life}s ease-out ${f.delay}s both`,
          }}
        >
          <span
            style={{
              fontSize: '11cqw',
              lineHeight: 1,
              transformOrigin: '50% 90%',
              animation: `cb-fx-flicker 0.35s ease-in-out ${f.flicker}s infinite alternate`,
            }}
          >
            {'\uD83D\uDD25'}
          </span>
        </div>
      ))}
      <div
        className="absolute"
        style={{
          left: '50%',
          top: 0,
          fontSize: '40cqw',
          lineHeight: 1,
          filter: 'drop-shadow(0 2cqw 2cqw rgba(0,0,0,0.5))',
          animation: `cb-fx-dragon ${BURN_MS}ms ease-in-out both`,
        }}
      >
        {'\uD83D\uDC09'}
      </div>
    </div>
  );
}