import { Component, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Chess } from 'chess.js';

/* ------------------------------------------------------------------ */
/*  Game-end detection                                                 */
/* ------------------------------------------------------------------ */

export type GameEndKind = 'resign' | 'timeout' | 'abandon' | 'draw' | 'stalemate';
export interface GameEnd {
  kind: GameEndKind;
  /** Colour of the player who lost (resigned / ran out of time) or who is stalemated. Unused for draws. */
  loser: 'w' | 'b';
}

/**
 * Works out whether the game ended by resignation or on time, and who lost.
 * It reads the game metadata defensively (termination / reason / status fields and a
 * PGN `[Termination "..."]` header), because the exact shape of `analysis.game` can vary.
 * Checkmate is never an effect.
 */
export function detectGameEnd(game: any, moves: { san?: string; fenAfter?: string }[]): GameEnd | null {
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

  // Stalemate: the side to move in the final position has no legal move and is not in check.
  const lastFen = moves[moves.length - 1]?.fenAfter;
  let turn: 'w' | 'b' = 'w';
  let stale = false;
  if (lastFen) {
    try {
      const c = new Chess(lastFen);
      turn = c.turn();
      stale = c.isStalemate();
    } catch { /* ignore */ }
  }
  if (stale || /stalemate/.test(text)) return { kind: 'stalemate', loser: turn };

  // Any other draw (agreement, repetition, insufficient material, 50-move rule...)
  const res0 = typeof game.result === 'string' ? game.result.trim() : '';
  if (
    /^(1\/2|½)/.test(res0) ||
    /\bdraw|agreed|repetition|repeat|threefold|three.fold|3.fold|insufficient|fifty|50.move/.test(text)
  ) {
    return { kind: 'draw', loser: 'w' };
  }

  // No explicit result/termination: work it out from the moves (threefold repetition, insufficient material, 50-move rule).
  const decisive = /^(1-0|0-1)/.test(res0);
  if (!decisive && !/resign|abandon|time|flag/.test(text)) {
    try {
      const replay = new Chess();
      let ok = true;
      for (const m of moves) {
        if (!m.san || !replay.move(m.san)) { ok = false; break; }
      }
      if (ok && (replay.isThreefoldRepetition() || replay.isInsufficientMaterial() || replay.isDrawByFiftyMoves())) {
        return { kind: 'draw', loser: 'w' };
      }
    } catch { /* ignore */ }
  }

  let kind: GameEndKind | null = null;
  if (/resign/.test(text)) kind = 'resign';
  else if (/abandon|left the game|disconnect/.test(text)) kind = 'abandon';
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
/*  Announcement: the text that pops up before the animation           */
/* ------------------------------------------------------------------ */

/** How long the announcement is on screen before the end-of-game animation starts. */
const ANNOUNCE_MS = 2200;

type AnnounceKind = GameEndKind | 'checkmate';

interface Announcement {
  icon: string;
  title: string;
  sub: string;
  accent: string;
}

function announcementFor(
  kind: AnnounceKind,
  loser: 'w' | 'b',
  names: { w: string; b: string }
): Announcement {
  const who = loser === 'w' ? names.w : names.b;
  const winner = loser === 'w' ? names.b : names.w;
  const were = who === 'You' ? 'were' : 'was';
  switch (kind) {
    case 'resign':
      return { icon: '\u{1F3F3}\uFE0F', title: `${who} resigned`, sub: `${winner} wins`, accent: '#f7c631' };
    case 'checkmate':
      return { icon: '\u265A\uFE0E', title: `${who} ${were} checkmated`, sub: `${winner} wins by checkmate`, accent: '#fa412d' };
    case 'timeout':
      return { icon: '\u23F1\uFE0F', title: `${who} lost on time`, sub: `${winner} wins on time`, accent: '#ffa459' };
    case 'abandon':
      return { icon: '\u{1F6AA}', title: `${who} abandoned the game`, sub: `${winner} wins`, accent: '#a78bfa' };
    case 'stalemate':
      return { icon: '\u{1F6A7}', title: 'Stalemate', sub: `${who} has no legal moves`, accent: '#81b64c' };
    default:
      return { icon: '\u{1F91D}', title: 'Draw', sub: 'The game ended in a draw', accent: '#81b64c' };
  }
}

/**
 * Same position, other side to move. Used to hold back the board's checkmate effects until the
 * announcement has finished (the board only plays them when it sees a mate position).
 */
function holdMateFen(fen: string): string {
  const parts = fen.split(' ');
  if (parts.length < 4) return fen;
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return parts.join(' ');
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

/** Shortest 8-direction path over empty squares from `from` to `to` (the goal square itself may be occupied). */
function findPath(
  from: { col: number; row: number },
  to: { col: number; row: number },
  blocked: Set<number>
): { col: number; row: number }[] | null {
  const key = (c: number, r: number) => c * 8 + r;
  const start = key(from.col, from.row);
  const goal = key(to.col, to.row);
  const prev = new Map<number, number>([[start, -1]]);
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === goal) break;
    const c = Math.floor(cur / 8);
    const r = cur % 8;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc > 7 || nr < 0 || nr > 7) continue;
        const k = key(nc, nr);
        if (prev.has(k)) continue;
        if (k !== goal && blocked.has(k)) continue;
        prev.set(k, cur);
        queue.push(k);
      }
    }
  }
  if (!prev.has(goal)) return null;
  const path: { col: number; row: number }[] = [];
  for (let k = goal; k !== -1; k = prev.get(k)!) path.push({ col: Math.floor(k / 8), row: k % 8 });
  return path.reverse();
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

type Mood = 'sad' | 'sleep' | 'panic' | 'done' | 'angry' | 'happy' | 'dance';

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
    case 'dance':
    case 'happy':
      return (
        <g fill="none" stroke={stroke} strokeWidth={1.1} strokeLinecap="round">
          <circle cx="20" cy="18.8" r="0.9" fill={stroke} stroke="none" />
          <circle cx="25" cy="18.8" r="0.9" fill={stroke} stroke="none" />
          <path d="M19.4 22.2 Q22.5 25.6 25.6 22.2" />
        </g>
      );
    case 'angry':
      return (
        <g fill="none" stroke={stroke} strokeWidth={1.1} strokeLinecap="round">
          <circle cx="20" cy="19.4" r="0.9" fill={stroke} stroke="none" />
          <circle cx="25" cy="19.4" r="0.9" fill={stroke} stroke="none" />
          <path d="M18 16.4 L21.6 18 M27 16.4 L23.4 18" strokeWidth={1.4} />
          <ellipse cx="22.5" cy="23.6" rx="1.9" ry="2.4" fill={stroke} />
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

function Crown({ falling, className, style }: { falling?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <g className={className ?? (falling ? 'ge-crown-drop' : undefined)} style={style}>
      <path
        d="M16 13.8 L17.4 5.6 L20.5 10 L22.5 4.4 L24.5 10 L27.6 5.6 L29 13.8 Z"
        fill="#f2c230" stroke="#8a6a00" strokeWidth={1} strokeLinejoin="round"
      />
    </g>
  );
}

function KingSprite({
  white, mood, flag, crown, walking,
}: {
  white: boolean;
  mood: Mood;
  flag?: boolean;
  /** 'on' = worn, 'drop' = falling to the floor, 'none' = not drawn */
  crown: 'on' | 'drop' | 'none';
  walking?: boolean;
}) {
  const { fill, stroke } = palette(white);
  const bodyClass =
    mood === 'dance' ? 'ge-king-dance'
    : mood === 'sleep' ? 'ge-king-sleep'
    : mood === 'panic' || (mood === 'angry' && !walking) ? 'ge-king-panic'
    : mood === 'done' ? 'ge-king-done'
    : mood === 'angry' ? undefined
    : 'ge-king-sad';

  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      <g className={bodyClass}>
        {walking && (
          <g stroke={stroke} strokeWidth={2.4} fill="none">
            <g className="ge-leg ge-leg-a"><line x1="19.5" y1="38" x2="19.5" y2="44.5" /></g>
            <g className="ge-leg ge-leg-b"><line x1="25.5" y1="38" x2="25.5" y2="44.5" /></g>
          </g>
        )}
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
          {mood === 'dance' && (
            <>
              <g className="ge-dance-l"><line x1="16" y1="29" x2="8" y2="17" /></g>
              <g className="ge-dance-r"><line x1="29" y1="29" x2="37" y2="17" /></g>
            </>
          )}
          {(mood === 'panic' || (mood === 'angry' && !walking)) && (
            <>
              <g className="ge-arm-l"><line x1="16" y1="29" x2="8" y2="17" /></g>
              <g className="ge-arm-r"><line x1="29" y1="29" x2="37" y2="17" /></g>
            </>
          )}
          {(mood === 'sleep' || mood === 'done' || mood === 'happy' || (mood === 'angry' && walking)) && (
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

@keyframes ge-throw {
  0% { transform: translate(0,0) rotate(0); }
  30% { transform: translate(calc(var(--tx) * .45),-34px) rotate(300deg); }
  65% { transform: translate(calc(var(--tx) * .9),27px) rotate(560deg); }
  78% { transform: translate(var(--tx),20px) rotate(640deg); }
  100% { transform: translate(calc(var(--tx) * 1.05),27px) rotate(720deg); }
}
.ge-crown-throw { transform-origin: 22.5px 10px; animation: ge-throw 1.2s ease-in-out .4s both; }
@keyframes ge-shout { from { transform: rotate(-2.5deg); } to { transform: rotate(2.5deg); } }
.ge-shout { transform-origin: 0 0; animation: ge-shout .18s linear infinite alternate; }
@keyframes ge-dance {
  0%,100% { transform: translate(0,0) rotate(-9deg); }
  25% { transform: translate(0,-9px) rotate(0); }
  50% { transform: translate(0,0) rotate(9deg); }
  75% { transform: translate(0,-9px) rotate(0); }
}
.ge-king-dance { transform-origin: 22.5px 42px; animation: ge-dance .6s ease-in-out infinite; }
@keyframes ge-dance-arm { from { transform: rotate(-35deg); } to { transform: rotate(15deg); } }
.ge-dance-l { transform-origin: 16px 29px; animation: ge-dance-arm .3s ease-in-out infinite alternate; }
.ge-dance-r { transform-origin: 29px 29px; animation: ge-dance-arm .3s ease-in-out infinite alternate-reverse; }
@keyframes ge-bump {
  0%,16%,32%,48%,64%,80%,100% { transform: translate(0,0); }
  8% { transform: translate(-18px,0); } 24% { transform: translate(18px,0); }
  40% { transform: translate(0,-18px); } 56% { transform: translate(0,18px); }
  72% { transform: translate(-16px,-16px); } 90% { transform: translate(16px,16px); }
}
.ge-bump { animation: ge-bump 2.6s ease-in-out both; }
@keyframes ge-sink { from { transform: translateY(0); } to { transform: translateY(125px); } }
.ge-sink { animation: ge-sink 2.2s ease-in forwards; }
@keyframes ge-rise { from { transform: scaleY(0); opacity: 0; } to { transform: scaleY(1); opacity: .6; } }
.ge-water { transform-origin: 0 100px; animation: ge-rise 2.2s ease-in forwards; }
@keyframes ge-ripple { from { transform: scale(.3); opacity: .9; } to { transform: scale(2.2); opacity: 0; } }
.ge-ripple { transform-origin: 50px 62px; animation: ge-ripple 1.8s ease-out infinite; }
@keyframes ge-bubble { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(-70px); opacity: 0; } }
.ge-bubble { animation: ge-bubble 1.6s ease-in infinite; }
@keyframes ge-clasp { from { transform: rotate(-6deg); } to { transform: rotate(6deg); } }
.ge-clasp { transform-origin: 0 0; animation: ge-clasp .22s ease-in-out infinite alternate; }
@keyframes ge-scribble { from { transform: translate(0,0); } to { transform: translate(3px,-3px); } }
.ge-scribble { animation: ge-scribble .14s linear infinite alternate; }
@keyframes ge-sig { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
.ge-sig { stroke-dasharray: 100; animation: ge-sig 1.2s ease-in-out both; }
@keyframes ge-stamp { from { transform: scale(2.6); opacity: 0; } to { transform: scale(1); opacity: .92; } }
.ge-stamp { transform-origin: 0 0; animation: ge-stamp .3s ease-in 3.1s both; }
@keyframes ge-pop { from { transform: scale(.2); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.ge-clock-pop { transform-origin: 0 0; animation: ge-pop .35s cubic-bezier(.3,1.6,.5,1) both; }
@keyframes ge-pulse { 50% { transform: scale(1.12); } }
.ge-clock-urgent { transform-origin: 0 0; animation: ge-pulse .5s ease-in-out infinite; }

@keyframes ge-ann-fade { 0% { opacity: 0; } 8% { opacity: 1; } 88% { opacity: 1; } 100% { opacity: 0; } }
@keyframes ge-ann-pop {
  0% { opacity: 0; transform: scale(.6) translateY(10px); }
  12% { opacity: 1; transform: scale(1.07) translateY(0); }
  20%, 100% { opacity: 1; transform: scale(1) translateY(0); }
}
.ge-ann { animation-name: ge-ann-fade; animation-timing-function: ease-out; animation-fill-mode: both; }
.ge-ann-card { animation-name: ge-ann-pop; animation-timing-function: ease-out; animation-fill-mode: both; }
@media (prefers-reduced-motion: reduce) { .ge-ann-card { animation-name: none; } }

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
  /** Names used in the announcement ("Ayyoub resigned"). Default to White / Black. */
  whiteName?: string;
  blackName?: string;
  /** Render the real board. `playing` is true while an effect is running (disable dragging then). */
  children: (boardFen: string, playing: boolean) => ReactNode;
}

export function GameEndBoard({ fen, orientation, size, end, atFinalPosition, whiteName, blackName, children }: GameEndBoardProps) {
  // Checkmate has no sprite animation here (the board plays its own), but it still gets the announcement.
  const mate = useMemo(() => {
    if (end) return null;
    try {
      const c = new Chess(fen);
      return c.isCheckmate() ? { loser: c.turn() as 'w' | 'b' } : null;
    } catch {
      return null;
    }
  }, [fen, end]);
  const active = (!!end || !!mate) && atFinalPosition;
  const [announced, setAnnounced] = useState(false);
  const [run, setRun] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<'sleep' | 'panic' | 'done'>('sleep');
  const [count, setCount] = useState(10);
  const [leaving, setLeaving] = useState(false);
  const [dphase, setDphase] = useState<'walk' | 'shake' | 'sign' | 'done'>('walk');
  const [step, setStep] = useState(0);
  const [sphase, setSphase] = useState<'trapped' | 'scream' | 'dance'>('trapped');

  // Each time we arrive at the final position, play from the start (announcement first).
  // Layout effect so the reset happens before the browser paints.
  useLayoutEffect(() => {
    setAnnounced(false);
    if (active) {
      setDismissed(false);
      setRun((r) => r + 1);
    }
  }, [active, end?.kind, end?.loser, mate?.loser]);

  const playing = active && !dismissed;
  const announcing = playing && !announced;
  const animating = !!end && playing && announced; // the sprite animation runs only after the announcement
  const kind = end?.kind;

  useEffect(() => {
    if (!announcing) return;
    const id = window.setTimeout(() => setAnnounced(true), ANNOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [announcing, run]);

  const announcement = useMemo<Announcement | null>(() => {
    const names = { w: whiteName || 'White', b: blackName || 'Black' };
    if (end) return announcementFor(end.kind, end.loser, names);
    if (mate) return announcementFor('checkmate', mate.loser, names);
    return null;
  }, [end, mate, whiteName, blackName]);

  // Time-loss timeline: ZZZZ (3s) -> clock counts 10..1 while the board drains of colour.
  useEffect(() => {
    if (!animating || kind !== 'timeout') return;
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
  }, [animating, kind, run]);

  // Abandonment: yell "I QUIT!" and throw the crown (2.4s), then walk off the board.
  useEffect(() => {
    if (!animating || kind !== 'abandon') return;
    setLeaving(false);
    const id = window.setTimeout(() => setLeaving(true), 2400);
    return () => window.clearTimeout(id);
  }, [animating, kind, run]);

  const kingChar = end?.loser === 'w' ? 'K' : 'k';
  const pawnChar = end?.loser === 'w' ? 'P' : 'p';

  const boardFen = useMemo(() => {
    if (announcing && mate) return holdMateFen(fen);
    if (!animating || !end) return fen;
    if (end.kind === 'resign') return stripPieces(fen, (ch) => ch === pawnChar || ch === kingChar);
    if (end.kind === 'draw') return stripPieces(fen, (ch) => ch === 'K' || ch === 'k');
    return stripPieces(fen, (ch) => ch === kingChar);
  }, [announcing, animating, mate, end, fen, kingChar, pawnChar]);

  const fallbackFen = useMemo(() => {
    if (!animating || !end) return fen;
    return end.kind === 'resign' ? stripPieces(fen, (ch) => ch === pawnChar) : fen;
  }, [animating, end, fen, pawnChar]);

  const placed = useMemo(() => (animating ? parseBoard(fen, orientation) : []), [animating, fen, orientation]);
  const king = placed.find((p) => p.ch === kingChar) || null;
  const loserWhite = end?.loser === 'w';

  const kings = useMemo(
    () => ({ wk: placed.find((p) => p.ch === 'K') || null, bk: placed.find((p) => p.ch === 'k') || null }),
    [placed]
  );

  // Draw: both kings walk toward each other over empty squares only and meet in the middle.
  const drawPlan = useMemo(() => {
    if (!animating || kind !== 'draw' || !kings.wk || !kings.bk) return null;
    const blocked = new Set(placed.map((p) => p.col * 8 + p.row));
    const path = findPath(kings.wk, kings.bk, blocked);
    if (!path) return null;
    const m = path.length - 2; // squares strictly between the two kings
    const a = Math.floor(m / 2);
    return { path, m, a, maxSteps: Math.max(a, m - a) };
  }, [animating, kind, placed, kings]);

  useEffect(() => {
    if (!animating || kind !== 'draw') return;
    setStep(0);
    const ids: number[] = [];
    const SIGN_MS = 4200;
    if (!drawPlan) {
      setDphase('sign');
      ids.push(window.setTimeout(() => setDphase('done'), SIGN_MS));
    } else {
      setDphase('walk');
      const n = drawPlan.maxSteps;
      for (let i = 1; i <= n; i++) ids.push(window.setTimeout(() => setStep(i), 300 + (i - 1) * 450));
      const shakeAt = 300 + n * 450 + 150;
      ids.push(window.setTimeout(() => setDphase('shake'), shakeAt));
      ids.push(window.setTimeout(() => setDphase('sign'), shakeAt + 2000));
      ids.push(window.setTimeout(() => setDphase('done'), shakeAt + 2000 + SIGN_MS));
    }
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [animating, kind, run, drawPlan]);

  // Stalemate: bump into the walls shouting "Call an ambulance!", scream "But not for me!", then dance.
  useEffect(() => {
    if (!animating || kind !== 'stalemate') return;
    setSphase('trapped');
    const ids = [
      window.setTimeout(() => setSphase('scream'), 2800),
      window.setTimeout(() => setSphase('dance'), 2800 + 2000),
    ];
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [animating, kind, run]);

  const gray = animating && kind === 'timeout' && phase !== 'sleep';

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: size, containerType: 'inline-size' }}>
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

      {animating && end && (
        <svg
          key={run}
          viewBox="0 0 800 800"
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ overflow: 'hidden' }}
        >
          {/* ---------- resignation: the losing side's pawns walk off the board ---------- */}
          {end.kind === 'resign' &&
            placed
              .filter((p) => p.ch === pawnChar)
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

          {/* ---------- abandonment: throws crown, yells "I QUIT!", walks away ---------- */}
          {end.kind === 'abandon' && king && (() => {
            const kx = king.col * CELL;
            const ky = king.row * CELL;
            const exitDir = king.col < 4 ? -1 : 1;
            const dist = exitDir < 0 ? king.col + 1 : 8 - king.col;
            const above = king.row > 0;
            const bx = Math.max(105, Math.min(695, kx + 50));
            const by = above ? ky - 52 : ky + CELL + 52;
            return (
              <>
                {!leaving ? (
                  <g transform={`translate(${kx},${ky}) scale(${SPRITE_SCALE})`}>
                    <KingSprite white={loserWhite} mood="angry" crown="none" />
                  </g>
                ) : (
                  <g transform={`translate(${kx},${ky})`}>
                    <g
                      className="ge-pawn-walk"
                      style={{
                        ['--dx' as any]: `${exitDir * dist * CELL}px`,
                        ['--dur' as any]: `${dist * 0.6}s`,
                        ['--delay' as any]: '0s',
                      }}
                    >
                      <g transform={`scale(${SPRITE_SCALE})`}>
                        <g className="ge-bob" style={{ ['--delay' as any]: '0s' }}>
                          <KingSprite white={loserWhite} mood="angry" crown="none" walking />
                        </g>
                      </g>
                    </g>
                  </g>
                )}

                {/* the thrown crown stays on the board */}
                <g transform={`translate(${kx},${ky}) scale(${SPRITE_SCALE})`}>
                  <Crown
                    className="ge-crown-throw"
                    style={{ ['--tx' as any]: `${-exitDir * 65}px` }}
                  />
                </g>

                {!leaving && (
                  <g transform={`translate(${bx},${by})`}>
                    <g className="ge-clock-pop">
                      <g className="ge-shout">
                        <rect x="-100" y="-30" width="200" height="60" rx="16" fill="#fff" stroke="#1b1f2a" strokeWidth="4" />
                        <polygon
                          points={above ? '-14,29 14,29 0,50' : '-14,-29 14,-29 0,-50'}
                          fill="#fff" stroke="#1b1f2a" strokeWidth="4" strokeLinejoin="round"
                        />
                        <rect x="-16" y={above ? 24 : -32} width="32" height="8" fill="#fff" />
                        <text
                          textAnchor="middle" dominantBaseline="central" fontSize="38" fontWeight="900"
                          fill="#d92d20" fontFamily="ui-sans-serif, system-ui, sans-serif"
                        >
                          I QUIT!
                        </text>
                      </g>
                    </g>
                  </g>
                )}
              </>
            );
          })()}

          {/* ---------- draw: kings walk to each other, shake hands, sign the peace treaty ---------- */}
          {end.kind === 'draw' && kings.wk && kings.bk && (() => {
            const plan = drawPlan;
            const w = kings.wk!;
            const b = kings.bk!;
            const p1 = plan ? plan.path[Math.min(step, plan.a)] : w;
            const p2 = plan ? plan.path[plan.m + 1 - Math.min(step, plan.m - plan.a)] : b;
            const walking1 = !!plan && dphase === 'walk' && step < plan.a;
            const walking2 = !!plan && dphase === 'walk' && step < plan.m - plan.a;
            const s1 = { x: p1.col * CELL + 50, y: p1.row * CELL + 64 };
            const s2 = { x: p2.col * CELL + 50, y: p2.row * CELL + 64 };
            const mid = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
            const pc = { x: clamp(mid.x, 95, 705), y: clamp(mid.y, 125, 675) };
            const firstIsLeft = s1.x <= s2.x;
            const sig = [
              { x: pc.x - 50, y: pc.y + 72 },
              { x: pc.x + 50, y: pc.y + 72 },
            ];
            const t1 = firstIsLeft ? sig[0] : sig[1];
            const t2 = firstIsLeft ? sig[1] : sig[0];
            const armStyle = { strokeWidth: 6, strokeLinecap: 'round' as const };
            const kingNode = (p: { col: number; row: number }, white: boolean, walking: boolean, id: string) => (
              <g
                key={id}
                style={{
                  transform: `translate(${p.col * CELL}px,${p.row * CELL}px)`,
                  transition: 'transform .45s linear',
                }}
              >
                <g transform={`scale(${SPRITE_SCALE})`}>
                  <g className={walking ? 'ge-bob' : undefined} style={{ ['--delay' as any]: '0s' }}>
                    <KingSprite white={white} mood="happy" crown="on" walking={walking} />
                  </g>
                </g>
              </g>
            );
            return (
              <>
                {kingNode(p1, true, walking1, 'dk-w')}
                {kingNode(p2, false, walking2, 'dk-b')}

                {dphase === 'shake' && (
                  <g transform={`translate(${mid.x},${mid.y})`}>
                    <g className="ge-clasp">
                      <line x1={s1.x - mid.x} y1={s1.y - mid.y} x2={0} y2={0} stroke="#1a1a1a" {...armStyle} />
                      <line x1={s2.x - mid.x} y1={s2.y - mid.y} x2={0} y2={0} stroke="#ebebeb" {...armStyle} />
                      <circle r="9" fill="#f2c9a0" stroke="#7a5a3a" strokeWidth="2" />
                    </g>
                  </g>
                )}

                {dphase === 'sign' && (
                  <>
                    <g className="ge-scribble"><line x1={s1.x} y1={s1.y} x2={t1.x} y2={t1.y} stroke="#1a1a1a" {...armStyle} /></g>
                    <g className="ge-scribble"><line x1={s2.x} y1={s2.y} x2={t2.x} y2={t2.y} stroke="#ebebeb" {...armStyle} /></g>
                  </>
                )}

                {(dphase === 'sign' || dphase === 'done') && (
                  <g transform={`translate(${pc.x},${pc.y})`}>
                    <g className="ge-clock-pop">
                      <rect x="-90" y="-115" width="180" height="230" rx="6" fill="#fffdf5" stroke="#bfb8a5" strokeWidth="3" />
                      <text
                        y="-85" textAnchor="middle" fontSize="21" fontWeight="800" fill="#2a2e39"
                        fontFamily="ui-serif, Georgia, serif"
                      >
                        PEACE TREATY
                      </text>
                      {[-55, -33, -11, 11, 33].map((y) => (
                        <line key={y} x1="-68" y1={y} x2="68" y2={y} stroke="#cfc9b8" strokeWidth="3" />
                      ))}
                      <line x1="-80" y1="72" x2="-20" y2="72" stroke="#2a2e39" strokeWidth="2" />
                      <line x1="20" y1="72" x2="80" y2="72" stroke="#2a2e39" strokeWidth="2" />
                      <g transform="translate(-50,66)">
                        <path className="ge-sig" pathLength={100} style={{ animationDelay: '.6s' }}
                          d="M-34,0 q8,-26 14,0 t14,0 t14,0 t14,-4" fill="none" stroke="#1d4ed8" strokeWidth="3" strokeLinecap="round" />
                      </g>
                      <g transform="translate(50,66)">
                        <path className="ge-sig" pathLength={100} style={{ animationDelay: '1.9s' }}
                          d="M-34,0 q8,-26 14,0 t14,0 t14,0 t14,-4" fill="none" stroke="#1d4ed8" strokeWidth="3" strokeLinecap="round" />
                      </g>
                      <g transform="translate(0,10) rotate(-14)">
                        <g className="ge-stamp">
                          <circle r="40" fill="none" stroke="#d92d20" strokeWidth="5" />
                          <text textAnchor="middle" dominantBaseline="central" fontSize="32" fontWeight="900" fill="#d92d20"
                            fontFamily="ui-sans-serif, system-ui, sans-serif">½–½</text>
                        </g>
                      </g>
                    </g>
                  </g>
                )}
              </>
            );
          })()}

          {/* ---------- stalemate: "Call an ambulance!" -> "But not for me!" -> dance ---------- */}
          {end.kind === 'stalemate' && king && (() => {
            const kx = king.col * CELL;
            const ky = king.row * CELL;
            const above = king.row >= 2;
            const bx = clamp(kx + 50, 135, 665);
            const by = above ? ky - 60 : ky + CELL + 60;
            const screaming = sphase === 'scream';
            const lines = screaming ? ['But not', 'for me!'] : ['Call an', 'ambulance!'];
            const mood: Mood = sphase === 'trapped' ? 'panic' : sphase === 'scream' ? 'angry' : 'dance';
            return (
              <>
                <g transform={`translate(${kx},${ky})`}>
                  <g className={sphase === 'trapped' ? 'ge-bump' : undefined}>
                    <g transform={`scale(${SPRITE_SCALE})`}>
                      <KingSprite white={loserWhite} mood={mood} crown="on" walking={sphase === 'dance'} />
                    </g>
                  </g>
                </g>

                {sphase !== 'dance' && (
                  <g transform={`translate(${bx},${by})`} key={sphase}>
                    <g className="ge-clock-pop">
                      <g className="ge-shout" style={screaming ? { animationDuration: '.09s' } : undefined}>
                        <rect x="-125" y="-42" width="250" height="84" rx="18" fill="#fff" stroke="#1b1f2a" strokeWidth="4" />
                        <polygon
                          points={above ? '-16,41 16,41 0,62' : '-16,-41 16,-41 0,-62'}
                          fill="#fff" stroke="#1b1f2a" strokeWidth="4" strokeLinejoin="round"
                        />
                        <rect x="-18" y={above ? 36 : -44} width="36" height="8" fill="#fff" />
                        <text
                          textAnchor="middle" fontSize={screaming ? 34 : 29} fontWeight="900"
                          fill={screaming ? '#d92d20' : '#1b1f2a'}
                          fontFamily="ui-sans-serif, system-ui, sans-serif"
                        >
                          <tspan x="0" dy="-8">{lines[0]}</tspan>
                          <tspan x="0" dy="36">{lines[1]}</tspan>
                        </text>
                      </g>
                    </g>
                  </g>
                )}

                {sphase === 'dance' &&
                  ['♪', '♫', '♪', '♫'].map((note, i) => {
                    const dir = i % 2 === 0 ? 1 : -1;
                    return (
                      <g key={`note-${i}`} transform={`translate(${kx + 50 + dir * 62},${ky + 36})`}>
                        <text
                          className="ge-z"
                          style={{ ['--zx' as any]: `${dir * 18}px`, animationDelay: `${i * 0.6}s` }}
                          fontSize="40" fontWeight="800" textAnchor="middle"
                          fill={i % 2 ? '#f2c230' : '#26c2a3'} stroke="#1b1f2a" strokeWidth="2" paintOrder="stroke"
                          fontFamily="ui-sans-serif, system-ui, sans-serif"
                        >
                          {note}
                        </text>
                      </g>
                    );
                  })}
              </>
            );
          })()}

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

      {/* Announcement: says how the game ended, before the animation starts */}
      {announcing && announcement && (
        <div
          key={`ann-${run}`}
          role="status"
          aria-live="assertive"
          className="ge-ann pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg"
          style={{ background: 'rgba(8, 9, 12, 0.42)', animationDuration: `${ANNOUNCE_MS}ms` }}
        >
          <div
            className="ge-ann-card flex max-w-[88%] flex-col items-center text-center"
            style={{
              animationDuration: `${ANNOUNCE_MS}ms`,
              background: 'linear-gradient(160deg, #1c2028, #0f1115)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderTop: `0.8cqw solid ${announcement.accent}`,
              borderRadius: '2.4cqw',
              padding: '3.4cqw 6cqw',
              boxShadow: '0 1.6cqw 5cqw rgba(0,0,0,0.55)',
              fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            }}
          >
            <span style={{ fontSize: '9cqw', lineHeight: 1 }} aria-hidden="true">{announcement.icon}</span>
            <p style={{ margin: '1.6cqw 0 0', fontSize: '6.4cqw', lineHeight: 1.1, fontWeight: 800, color: '#fff' }}>
              {announcement.title}
            </p>
            <p style={{ margin: '1cqw 0 0', fontSize: '3.4cqw', fontWeight: 600, color: announcement.accent }}>
              {announcement.sub}
            </p>
          </div>
        </div>
      )}

      {/* Skip / replay */}
      {active && (
        <button
          type="button"
          onClick={() => {
            if (playing) setDismissed(true);
            else { setDismissed(false); setAnnounced(false); setRun((r) => r + 1); }
          }}
          className="absolute bottom-2 right-2 z-10 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur hover:bg-black/80"
        >
          {playing ? 'Skip' : '▶ Replay'}
        </button>
      )}
    </div>
  );
}