import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/*  Game-end detection                                                 */
/* ------------------------------------------------------------------ */

export type GameEndKind = 'resign' | 'timeout';
export interface GameEnd {
  kind: GameEndKind;
  /** Colour of the player who lost (resigned / ran out of time). */
  loser: 'w' | 'b';
}

/**
 * Works out whether the game ended by resignation or on time, and who lost.
 * It reads the game metadata defensively (termination / reason / status fields and a
 * PGN `[Termination "..."]` header), because the exact shape of `analysis.game` can vary.
 * Checkmate is never an effect.
 */
export function detectGameEnd(game: any, moves: { san?: string }[]): GameEnd | null {
  if (!game || moves.length === 0) return null;
  if (moves[moves.length - 1]?.san?.includes('#')) return null;

  const parts: string[] = [];
  for (const [key, value] of Object.entries(game)) {
    if (typeof value !== 'string') continue;
    if (/pgn/i.test(key)) {
      const m = value.match(/\[Termination\s+"([^"]*)"\]/i);
      if (m) parts.push(m[1]);
      continue;
    }
    if (/term|reason|status|outcome|ending|endedby|result_?detail/i.test(key)) parts.push(value);
  }
  const text = parts.join(' | ').toLowerCase();

  let kind: GameEndKind | null = null;
  if (/resign/.test(text)) kind = 'resign';
  else if (/on time|timeout|time out|time forfeit|timeforfeit|outoftime|out of time|flag/.test(text)) kind = 'timeout';
  if (!kind) return null;

  // Who lost?
  const result = typeof game.result === 'string' ? game.result.trim() : '';
  let loser: 'w' | 'b' | null = null;
  if (result.startsWith('1-0')) loser = 'b';
  else if (result.startsWith('0-1')) loser = 'w';
  if (!loser) {
    const white = String(game.white || '').toLowerCase();
    const black = String(game.black || '').toLowerCase();
    if (white && text.includes(`${white} won`)) loser = 'b';
    else if (black && text.includes(`${black} won`)) loser = 'w';
    else if (/white won/.test(text)) loser = 'b';
    else if (/black won/.test(text)) loser = 'w';
  }
  return loser ? { kind, loser } : null;
}

/* ------------------------------------------------------------------ */
/*  FEN helpers                                                        */
/* ------------------------------------------------------------------ */

function stripPieces(fen: string, shouldRemove: (ch: string) => boolean): string {
  const [board, ...rest] = fen.split(' ');
  const ranks = board.split('/').map((rank) => {
    let out = '';
    let empty = 0;
    for (const ch of rank) {
      if (/\d/.test(ch)) { empty += Number(ch); continue; }
      if (shouldRemove(ch)) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      out += ch;
    }
    if (empty) out += empty;
    return out;
  });
  return [ranks.join('/'), ...rest].join(' ');
}

interface Placed { ch: string; col: number; row: number }

/** Pieces with their on-screen column/row (0-7) for the given orientation. */
function parseBoard(fen: string, orientation: 'white' | 'black'): Placed[] {
  const out: Placed[] = [];
  fen.split(' ')[0].split('/').forEach((rank, i) => {
    let file = 0;
    for (const ch of rank) {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      out.push({
        ch,
        col: orientation === 'white' ? file : 7 - file,
        row: orientation === 'white' ? i : 7 - i,
      });
      file++;
    }
  });
  return out;
}

/* ------------------------------------------------------------------ */
/*  Sprites (45x45 box, drawn to match the piece colour)               */
/* ------------------------------------------------------------------ */

const palette = (white: boolean) => ({
  fill: white ? '#f5f5f2' : '#2b2b2b',
  stroke: white ? '#1a1a1a' : '#ebebeb',
});

function PawnSprite({ white }: { white: boolean }) {
  const { fill, stroke } = palette(white);
  return (
    <g fill={fill} stroke={stroke} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round">
      <g className="ge-leg ge-leg-a"><line x1="19.5" y1="36" x2="19.5" y2="42.5" strokeWidth={2.2} /></g>
      <g className="ge-leg ge-leg-b"><line x1="25.5" y1="36" x2="25.5" y2="42.5" strokeWidth={2.2} /></g>
      <path d="M17 36 C17 29 19.5 25 22.5 22 C25.5 25 28 29 28 36 Z" />
      <rect x="14.5" y="34" width="16" height="3.6" rx="1.6" />
      <ellipse cx="22.5" cy="21.5" rx="5" ry="1.8" />
      <circle cx="22.5" cy="14" r="5.4" />
      <circle cx="20.5" cy="13.5" r="0.9" fill={stroke} stroke="none" />
      <circle cx="24.5" cy="13.5" r="0.9" fill={stroke} stroke="none" />
    </g>
  );
}

type Mood = 'sad' | 'sleep' | 'panic' | 'done';

function KingFace({ mood, stroke }: { mood: Mood; stroke: string }) {
  switch (mood) {
    case 'sleep':
      return (
        <g fill="none" stroke={stroke} strokeWidth={1.1} strokeLinecap="round">
          <path d="M18.6 19.2 Q20 20.6 21.4 19.2" />
          <path d="M23.6 19.2 Q25 20.6 26.4 19.2" />
          <ellipse cx="22.5" cy="23" rx="1" ry="1.2" fill={stroke} />
        </g>
      );
    case 'panic':
      return (
        <g>
          <circle cx="19.8" cy="18.6" r="2.1" fill="#fff" stroke={stroke} strokeWidth={0.8} />
          <circle cx="25.2" cy="18.6" r="2.1" fill="#fff" stroke={stroke} strokeWidth={0.8} />
          <circle cx="19.8" cy="18.9" r="0.8" fill="#000" />
          <circle cx="25.2" cy="18.9" r="0.8" fill="#000" />
          <ellipse cx="22.5" cy="23.3" rx="1.7" ry="2.3" fill={stroke} />
        </g>
      );
    case 'done':
      return (
        <g fill="none" stroke={stroke} strokeWidth={1.1} strokeLinecap="round">
          <path d="M18.6 17.8 l2.4 2.4 M21 17.8 l-2.4 2.4" />
          <path d="M24 17.8 l2.4 2.4 M26.4 17.8 l-2.4 2.4" />
          <path d="M20.5 23.4 h4" />
        </g>
      );
    default: // sad
      return (
        <g fill="none" stroke={stroke} strokeWidth={1} strokeLinecap="round">
          <circle cx="20" cy="19.2" r="0.9" fill={stroke} stroke="none" />
          <circle cx="25" cy="19.2" r="0.9" fill={stroke} stroke="none" />
          <path d="M18.4 17.2 L21.4 16.4 M26.6 17.2 L23.6 16.4" />
          <path d="M20.5 23.6 Q22.5 22.1 24.5 23.6" />
          <path d="M26.3 21 q-0.9 1.6 0 2.4 q0.9 -0.8 0 -2.4 z" fill="#6ec1ff" stroke="none" />
        </g>
      );
  }
}

function Crown({ falling }: { falling?: boolean }) {
  return (
    <g className={falling ? 'ge-crown-drop' : undefined}>
      <path
        d="M16 13.8 L17.4 5.6 L20.5 10 L22.5 4.4 L24.5 10 L27.6 5.6 L29 13.8 Z"
        fill="#f2c230" stroke="#8a6a00" strokeWidth={1} strokeLinejoin="round"
      />
    </g>
  );
}

function KingSprite({
  white, mood, flag, crown,
}: {
  white: boolean;
  mood: Mood;
  flag?: boolean;
  /** 'on' = worn, 'drop' = falling to the floor, 'none' = not drawn */
  crown: 'on' | 'drop';
}) {
  const { fill, stroke } = palette(white);
  const bodyClass =
    mood === 'sleep' ? 'ge-king-sleep'
    : mood === 'panic' ? 'ge-king-panic'
    : mood === 'done' ? 'ge-king-done'
    : 'ge-king-sad';

  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      <g className={bodyClass}>
        <g fill={fill} stroke={stroke} strokeWidth={1.4}>
          <path d="M13 40 C13.5 30 17 25 22.5 25 C28 25 31.5 30 32 40 Z" />
          <rect x="12" y="38.4" width="21" height="3.6" rx="1.6" />
          <circle cx="22.5" cy="19" r="6.3" />
        </g>

        {/* arms */}
        <g fill="none" stroke={stroke} strokeWidth={2.2}>
          {flag && (
            <>
              <line x1="16" y1="29" x2="13" y2="36" />
              <g className="ge-arm-wave">
                <line x1="29" y1="29" x2="36" y2="17" />
                <line x1="36" y1="18" x2="36" y2="2" strokeWidth={1.4} />
                <g className="ge-flag">
                  <path
                    d="M36 2 C40 0 43 4 48 2 L48 11 C43 13 40 9 36 11 Z"
                    fill="#fff" stroke="#9aa0a6" strokeWidth={0.9}
                  />
                </g>
              </g>
            </>
          )}
          {mood === 'panic' && (
            <>
              <g className="ge-arm-l"><line x1="16" y1="29" x2="8" y2="17" /></g>
              <g className="ge-arm-r"><line x1="29" y1="29" x2="37" y2="17" /></g>
            </>
          )}
          {(mood === 'sleep' || mood === 'done') && (
            <>
              <line x1="16" y1="29" x2="13" y2="37" />
              <line x1="29" y1="29" x2="32" y2="37" />
            </>
          )}
        </g>

        <KingFace mood={mood} stroke={stroke} />
        {crown === 'on' && <Crown />}
      </g>
      {/* once dropped, the crown lies on the floor independent of the king's motion */}
      {crown === 'drop' && <Crown falling />}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const CSS = `
@keyframes ge-walk { from { transform: translateX(0); } to { transform: translateX(var(--dx)); } }
@keyframes ge-bob { 0%,100% { transform: translateY(0) rotate(-5deg); } 50% { transform: translateY(-4px) rotate(5deg); } }
@keyframes ge-leg { from { transform: rotate(30deg); } to { transform: rotate(-30deg); } }
.ge-pawn-walk { animation: ge-walk var(--dur) linear var(--delay) both; }
.ge-bob { transform-origin: 22.5px 42px; animation: ge-bob .36s ease-in-out infinite; animation-delay: var(--delay); }
.ge-leg { animation: ge-leg .36s ease-in-out infinite alternate; animation-delay: var(--delay); }
.ge-leg-a { transform-origin: 19.5px 36px; }
.ge-leg-b { transform-origin: 25.5px 36px; animation-direction: alternate-reverse; }

@keyframes ge-sway { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.ge-king-sad { transform-origin: 22.5px 42px; animation: ge-sway 2.2s ease-in-out infinite; }
@keyframes ge-arm-wave { from { transform: rotate(-14deg); } to { transform: rotate(16deg); } }
.ge-arm-wave { transform-origin: 29px 29px; animation: ge-arm-wave .45s ease-in-out infinite alternate; }
@keyframes ge-flag { from { transform: skewY(-9deg) scaleX(1); } to { transform: skewY(9deg) scaleX(.82); } }
.ge-flag { transform-origin: 36px 6px; animation: ge-flag .22s ease-in-out infinite alternate; }

@keyframes ge-snooze { 0%,100% { transform: rotate(11deg) scale(1,1); } 50% { transform: rotate(13deg) scale(1.02,.98); } }
.ge-king-sleep { transform-origin: 22.5px 42px; animation: ge-snooze 2.4s ease-in-out infinite; }
@keyframes ge-z {
  0% { opacity: 0; transform: translate(0,12px) scale(.6); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--zx),-80px) scale(1.15); }
}
.ge-z { animation: ge-z 2.4s ease-out infinite; }

@keyframes ge-panic {
  0% { transform: translate(-2px,0) rotate(-7deg); }
  25% { transform: translate(2px,-3px) rotate(6deg); }
  50% { transform: translate(-3px,0) rotate(-5deg); }
  75% { transform: translate(3px,-2px) rotate(7deg); }
  100% { transform: translate(-2px,0) rotate(-7deg); }
}
.ge-king-panic { transform-origin: 22.5px 42px; animation: ge-panic .28s linear infinite; }
@keyframes ge-flail { from { transform: rotate(-25deg); } to { transform: rotate(20deg); } }
.ge-arm-l { transform-origin: 16px 29px; animation: ge-flail .18s ease-in-out infinite alternate; }
.ge-arm-r { transform-origin: 29px 29px; animation: ge-flail .18s ease-in-out infinite alternate-reverse; }
@keyframes ge-crown {
  0% { transform: translate(0,0) rotate(0); }
  40% { transform: translate(3px,27px) rotate(28deg); }
  55% { transform: translate(6px,20px) rotate(50deg); }
  75% { transform: translate(10px,27px) rotate(84deg); }
  100% { transform: translate(13px,27px) rotate(95deg); }
}
.ge-crown-drop { transform-origin: 22.5px 10px; animation: ge-crown 1.1s ease-in forwards; }
@keyframes ge-fall { to { transform: translate(6px,2px) rotate(88deg); } }
.ge-king-done { transform-origin: 22.5px 42px; animation: ge-fall .9s ease-in forwards; }

@keyframes ge-pop { from { transform: scale(.2); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.ge-clock-pop { transform-origin: 0 0; animation: ge-pop .35s cubic-bezier(.3,1.6,.5,1) both; }
@keyframes ge-pulse { 50% { transform: scale(1.12); } }
.ge-clock-urgent { transform-origin: 0 0; animation: ge-pulse .5s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .ge-bob, .ge-leg, .ge-flag, .ge-arm-wave, .ge-king-panic, .ge-arm-l, .ge-arm-r { animation-duration: 1.2s; }
}
`;

/* ------------------------------------------------------------------ */
/*  Error boundary: if the board can't render with pieces removed,      */
/*  fall back to the untouched position instead of crashing the page.   */
/* ------------------------------------------------------------------ */

class BoardBoundary extends Component<
  { fallback: ReactNode; resetKey: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/* ------------------------------------------------------------------ */
/*  The wrapper                                                        */
/* ------------------------------------------------------------------ */

const SLEEP_MS = 3000; // "ZZZZ" before the king wakes up
const CELL = 100;      // overlay is an 800x800 SVG, one square = 100 units
const SPRITE_SCALE = CELL / 45;

interface GameEndBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  size: number;
  /** Result of detectGameEnd(); null for checkmate / draws / unknown. */
  end: GameEnd | null;
  /** True only while viewing the final position (not exploring / previewing). */
  atFinalPosition: boolean;
  /** Render the real board. `playing` is true while an effect is running (disable dragging then). */
  children: (boardFen: string, playing: boolean) => ReactNode;
}

export function GameEndBoard({ fen, orientation, size, end, atFinalPosition, children }: GameEndBoardProps) {
  const active = !!end && atFinalPosition;
  const [run, setRun] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<'sleep' | 'panic' | 'done'>('sleep');
  const [count, setCount] = useState(10);

  // Each time we arrive at the final position, play from the start.
  useEffect(() => {
    if (active) {
      setDismissed(false);
      setRun((r) => r + 1);
    }
  }, [active, end?.kind, end?.loser]);

  const playing = active && !dismissed;
  const kind = end?.kind;

  // Time-loss timeline: ZZZZ (3s) -> clock counts 10..1 while the board drains of colour.
  useEffect(() => {
    if (!playing || kind !== 'timeout') return;
    setPhase('sleep');
    setCount(10);
    const ids: number[] = [];
    ids.push(window.setTimeout(() => setPhase('panic'), SLEEP_MS));
    for (let i = 1; i <= 10; i++) {
      ids.push(
        window.setTimeout(() => {
          setCount(10 - i);
          if (i === 10) setPhase('done');
        }, SLEEP_MS + i * 1000)
      );
    }
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [playing, kind, run]);

  const kingChar = end?.loser === 'w' ? 'K' : 'k';

  const boardFen = useMemo(() => {
    if (!playing || !end) return fen;
    return end.kind === 'resign'
      ? stripPieces(fen, (ch) => ch === 'p' || ch === 'P' || ch === kingChar)
      : stripPieces(fen, (ch) => ch === kingChar);
  }, [playing, end, fen, kingChar]);

  const fallbackFen = useMemo(() => {
    if (!playing || !end) return fen;
    return end.kind === 'resign' ? stripPieces(fen, (ch) => ch === 'p' || ch === 'P') : fen;
  }, [playing, end, fen]);

  const placed = useMemo(() => (playing ? parseBoard(fen, orientation) : []), [playing, fen, orientation]);
  const king = placed.find((p) => p.ch === kingChar) || null;
  const loserWhite = end?.loser === 'w';

  const gray = playing && kind === 'timeout' && phase !== 'sleep';

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: size }}>
      <style>{CSS}</style>

      <div
        style={{
          filter: gray ? 'grayscale(1)' : 'grayscale(0)',
          transition: gray ? 'filter 10s linear' : 'none',
        }}
      >
        <BoardBoundary
          resetKey={`${playing}-${run}`}
          fallback={children(fallbackFen, playing)}
        >
          {children(boardFen, playing)}
        </BoardBoundary>
      </div>

      {playing && end && (
        <svg
          key={run}
          viewBox="0 0 800 800"
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ overflow: 'hidden' }}
        >
          {/* ---------- resignation: all pawns walk off the board ---------- */}
          {end.kind === 'resign' &&
            placed
              .filter((p) => p.ch === 'p' || p.ch === 'P')
              .map((p, i) => {
                const dir = p.col < 4 ? -1 : 1;
                const dist = dir < 0 ? p.col + 1 : 8 - p.col;
                const delay = 0.5 + ((p.col * 3 + p.row * 5) % 9) * 0.12;
                return (
                  <g key={`pawn-${i}`} transform={`translate(${p.col * CELL},${p.row * CELL})`}>
                    <g
                      className="ge-pawn-walk"
                      style={{
                        ['--dx' as any]: `${dir * dist * CELL}px`,
                        ['--dur' as any]: `${dist * 0.5}s`,
                        ['--delay' as any]: `${delay}s`,
                      }}
                    >
                      <g transform={`scale(${SPRITE_SCALE})`}>
                        <g className="ge-bob" style={{ ['--delay' as any]: `${delay}s` }}>
                          <PawnSprite white={p.ch === 'P'} />
                        </g>
                      </g>
                    </g>
                  </g>
                );
              })}

          {/* ---------- resignation: losing king waves a white flag ---------- */}
          {end.kind === 'resign' && king && (
            <g transform={`translate(${king.col * CELL},${king.row * CELL}) scale(${SPRITE_SCALE})`}>
              <g transform={king.col >= 4 ? 'translate(45,0) scale(-1,1)' : undefined}>
                <KingSprite white={loserWhite} mood="sad" flag crown="on" />
              </g>
            </g>
          )}

          {/* ---------- timeout: sleeping king -> clock + panic ---------- */}
          {end.kind === 'timeout' && king && (
            <>
              <g transform={`translate(${king.col * CELL},${king.row * CELL}) scale(${SPRITE_SCALE})`}>
                <KingSprite
                  white={loserWhite}
                  mood={phase === 'sleep' ? 'sleep' : phase === 'panic' ? 'panic' : 'done'}
                  crown={phase === 'sleep' ? 'on' : 'drop'}
                />
              </g>

              {phase === 'sleep' &&
                [0, 1, 2, 3].map((i) => {
                  const dir = king.col >= 6 ? -1 : 1;
                  return (
                    <g
                      key={`z-${i}`}
                      transform={`translate(${king.col * CELL + 50 + dir * (28 + i * 12)},${king.row * CELL + 28 - i * 6})`}
                    >
                      <text
                        className="ge-z"
                        style={{ ['--zx' as any]: `${dir * 22}px`, animationDelay: `${i * 0.45}s` }}
                        fontSize={34 + i * 9}
                        fontWeight={800}
                        fill="#cfd6e4"
                        stroke="#1b1f2a"
                        strokeWidth={2.5}
                        paintOrder="stroke"
                        fontFamily="ui-sans-serif, system-ui, sans-serif"
                      >
                        Z
                      </text>
                    </g>
                  );
                })}

              {phase !== 'sleep' && (() => {
                const toRight = king.col < 4;
                const cx = toRight ? king.col * CELL + CELL + 54 : king.col * CELL - 54;
                const cy = king.row * CELL + 52;
                const urgent = count <= 3;
                const ring = count === 0 || urgent ? '#fa412d' : '#e8eaed';
                return (
                  <g transform={`translate(${cx},${cy})`}>
                    <g className="ge-clock-pop">
                      <g className={urgent && count > 0 ? 'ge-clock-urgent' : undefined}>
                        <rect x="-8" y="-56" width="16" height="10" rx="3" fill={ring} />
                        <circle r="44" fill="#1b1f2a" stroke={ring} strokeWidth="6" />
                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize="48"
                          fontWeight="800"
                          fill="#fff"
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        >
                          {count}
                        </text>
                      </g>
                    </g>
                  </g>
                );
              })()}
            </>
          )}
        </svg>
      )}

      {/* Skip / replay */}
      {active && (
        <button
          type="button"
          onClick={() => {
            if (playing) setDismissed(true);
            else { setDismissed(false); setRun((r) => r + 1); }
          }}
          className="absolute bottom-2 right-2 z-10 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur hover:bg-black/80"
        >
          {playing ? 'Skip' : '▶ Replay'}
        </button>
      )}
    </div>
  );
}
