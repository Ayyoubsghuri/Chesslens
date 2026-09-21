import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  brilliant: { color: '#26c4c4', icon: Star, symbol: '!!' },
  best:      { color: '#81b64c', icon: Star, symbol: '' },
  great:     { color: '#7cb342', icon: ThumbsUp, symbol: '' },
  excellent: { color: '#96bc4b', icon: ThumbsUp, symbol: '' },
  good:      { color: '#95b3b8', icon: ThumbsUp, symbol: '' },
  book:      { color: '#c9a96e', icon: BookOpen, symbol: '' },
  inaccuracy:{ color: '#f7c631', icon: AlertCircle, symbol: '?!' },
  mistake:   { color: '#ffa459', icon: AlertTriangle, symbol: '?' },
  blunder:   { color: '#fa412d', icon: XCircle, symbol: '??' },
  miss:      { color: '#e040fb', icon: HelpCircle, symbol: '!?' },
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
      lastMove: lastMove ? [lastMove.from as Key, lastMove.to as Key] : undefined,
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
    highlightSquare,
    bestMoveUci,
    annotationSquare,
    annotationColor,
    gameState.inCheck,
    gameState.turnColor,
    interactive,
  ]);

  const badgeSquare = lastMove?.to ?? annotationSquare;
  const collidesWithResultBadge =
    !!badgeSquare &&
    (badgeSquare === gameState.checkedKingSquare || badgeSquare === gameState.winnerKingSquare) &&
    gameState.isCheckmate;
  const showBadge = badgeSquare && moveQuality && moveQuality !== 'good' && !collidesWithResultBadge;

  const winnerName = gameState.turnColor === 'w' ? blackName : whiteName;
  const showCheckmateOverlay = showCelebration && gameState.isCheckmate && !celebrationDismissed;

  return (
    <div className="relative w-full" style={{ maxWidth: size, containerType: 'inline-size' }}>
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
      {gameState.checkedKingSquare && (
        <CheckRing
          square={gameState.checkedKingSquare}
          orientation={orientation}
          severe={gameState.isCheckmate}
        />
      )}
      {gameState.isCheckmate && gameState.checkedKingSquare && (
        <CheckmateKingAnimation
          key={fen}
          square={gameState.checkedKingSquare}
          orientation={orientation}
        />
      )}
      {gameState.isCheckmate && gameState.checkedKingSquare && (
        <KingResultBadge
          square={gameState.checkedKingSquare}
          orientation={orientation}
          variant="loser"
        />
      )}
      {gameState.isCheckmate && gameState.winnerKingSquare && (
        <KingResultBadge
          square={gameState.winnerKingSquare}
          orientation={orientation}
          variant="winner"
        />
      )}
      {showBadge && (
        <BoardBadge square={badgeSquare} quality={moveQuality} orientation={orientation} />
      )}
      {showCheckmateOverlay && (
        <CheckmateCelebration
          winnerName={winnerName}
          pieces={confettiPieces}
          onDismiss={() => setCelebrationDismissed(true)}
        />
      )}
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
          0% { transform: translateY(-16px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(240px) rotate(360deg); opacity: 0; }
        }
        @keyframes cb-mate-flash {
          0% { opacity: 0; }
          8% { opacity: 1; }
          60% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes cb-mate-topple {
          0% { opacity: 0; transform: rotate(90deg) scale(0.55); }
          8% { opacity: 1; }
          26% { opacity: 1; transform: rotate(-8deg) scale(1.1); }
          36% { transform: rotate(0deg) scale(1); }
          46% { transform: rotate(0deg) scale(1.05); }
          56% { transform: rotate(0deg) scale(1); }
          78% { opacity: 1; transform: rotate(0deg) scale(1); }
          100% { opacity: 0; transform: rotate(0deg) scale(0.85); }
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
        @media (prefers-reduced-motion: reduce) {
          .cb-mate-transient { display: none; }
          .cb-mate-delayed { animation: none !important; }
        }
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
const MATE_BADGE_DELAY_S = 1.6;

const RESULT_BADGE_COLORS = { winner: '#81b64c', loser: '#e02828' } as const;

/** Solid white crown, shown on the winning king. */
function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path
        d="M5 8.6L9.2 11.1L12 6L14.8 11.1L19 8.6L19 16.5Q12 19.2 5 16.5Z"
        fill="#fff"
        stroke="#fff"
        strokeWidth=".7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Toppled king silhouette, shown on the checkmated king. */
function ToppledKingIcon({ fill = '#fff' }: { fill?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <g fill={fill} fillRule="evenodd">
        <rect x="4.4" y="11.15" width="4.2" height="1.7" rx=".3" />
        <rect x="5.3" y="9.6" width="1.7" height="4.8" rx=".3" />
        <path d="M8.3 12C8.4 8 9.7 4.9 12.2 4.7C14 4.6 15.2 5.6 15.7 7L15.7 17C15.2 18.4 14 19.4 12.2 19.3C9.7 19.1 8.4 16 8.3 12Z M10.3 8.7L12.7 9.9L10.6 11.4Z M10.3 15.3L12.7 14.1L10.6 12.6Z" />
        <path d="M15.5 8L19.6 6.6L19.6 17.4L15.5 16Z" />
      </g>
    </svg>
  );
}

/**
 * Plays on the checkmated king's square: the square flashes red (the real piece stays
 * visible underneath), the king topples onto its side, and a "Checkmate" pill pops in.
 * Remount it (via `key`) to replay.
 */
function CheckmateKingAnimation({
  square,
  orientation,
}: {
  square: Square;
  orientation: 'white' | 'black';
}) {
  const pos = getSquarePosition(square, orientation);
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = parseInt(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;

  // Keep the pill on the board: centered normally, pinned to the side on the edge files
  const pillPos: CSSProperties =
    col === 0
      ? { left: 0 }
      : col === 7
        ? { right: 0 }
        : { left: '50%', transform: 'translateX(-50%)' };

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: pos.left, top: pos.top, width: '12.5%', height: '12.5%', zIndex: 12 }}
      aria-hidden="true"
    >
      <div
        className="cb-mate-transient absolute inset-0"
        style={{
          backgroundColor: 'rgba(224, 40, 40, 0.74)',
          animation: `cb-mate-flash ${MATE_FX_S}s ease-out forwards`,
        }}
      />
      <div className="cb-mate-transient absolute inset-0 flex items-center justify-center">
        <div
          style={{
            width: '72%',
            height: '72%',
            animation: `cb-mate-topple ${MATE_FX_S}s cubic-bezier(0.3, 0.7, 0.4, 1) forwards`,
          }}
        >
          <ToppledKingIcon fill="#111" />
        </div>
      </div>
      <div
        className="cb-mate-transient absolute"
        style={{ top: row === 0 ? '2%' : '-16%', whiteSpace: 'nowrap', ...pillPos }}
      >
        <div
          style={{
            backgroundColor: '#fff',
            color: '#e02828',
            fontWeight: 800,
            fontSize: '3.4cqw',
            lineHeight: 1.15,
            padding: '1cqw 2.8cqw',
            borderRadius: 999,
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
            animation: `cb-mate-pill ${MATE_FX_S}s ease-out 0.1s both`,
          }}
        >
          Checkmate
        </div>
      </div>
    </div>
  );
}

function KingResultBadge({
  square,
  orientation,
  variant,
}: {
  square: Square;
  orientation: 'white' | 'black';
  variant: 'winner' | 'loser';
}) {
  const pos = getSquarePosition(square, orientation);
  const isWinner = variant === 'winner';
  const label = isWinner ? 'Checkmate — winner' : 'Checkmated';
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: pos.left,
        top: pos.top,
        width: '12.5%',
        height: '12.5%',
        zIndex: 11,
      }}
    >
      {/* Sits on the top-right corner of the square and overhangs it slightly, like Chess.com */}
      <div
        className="cb-mate-delayed"
        role="img"
        aria-label={label}
        title={label}
        style={{
          position: 'absolute',
          top: '-8%',
          right: '-8%',
          width: 'max(22px, 40%)',
          aspectRatio: '1 / 1',
          borderRadius: '50%',
          backgroundColor: RESULT_BADGE_COLORS[variant],
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          animation: `cb-celebration-pop 0.35s ease-out ${MATE_BADGE_DELAY_S}s both`,
        }}
      >
        {isWinner ? <CrownIcon /> : <ToppledKingIcon />}
      </div>
    </div>
  );
}

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

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: pos.left,
        top: pos.top,
        width: '12.5%',
        height: '12.5%',
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'flex-start',
        padding: '3px',
        zIndex: 10,
      }}
    >
      <div
        className="rounded-full flex items-center justify-center shadow-lg border border-white/10"
        style={{
          width: 22,
          height: 22,
          backgroundColor: meta.color,
          minWidth: 22,
          minHeight: 22,
        }}
        title={quality}
      >
        {meta.symbol ? (
          <span className="text-[9px] font-bold text-white leading-none select-none">
            {meta.symbol}
          </span>
        ) : (
          <Icon size={12} className="text-white" strokeWidth={2.5} />
        )}
      </div>
    </div>
  );
}