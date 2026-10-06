import { Chess, type Square } from 'chess.js';

const API = 'https://tablebase.lichess.ovh/standard?fen=';
/** Lichess serves up to 7-piece endgames. */
export const TABLEBASE_MAX_PIECES = 7;

export type TbCategory =
  | 'win' | 'unknown' | 'maybe-win' | 'cursed-win' | 'draw'
  | 'blessed-loss' | 'maybe-loss' | 'loss';

export interface TbMove {
  uci: string;
  san: string;
  category: TbCategory;
  dtz: number | null;
  dtm: number | null;
}

export interface TbResult {
  category: TbCategory;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficient_material?: boolean;
  /** Sorted best first. */
  moves: TbMove[];
}

export interface TbFrame {
  fen: string;
  from: Square;
  to: Square;
  san: string;
  uci: string;
}

export function pieceCount(fen: string): number {
  return (fen.split(' ')[0].match(/[a-zA-Z]/g) ?? []).length;
}

/** 7 pieces or fewer. (Castling rights are stripped before asking, see normalizeFen.) */
export function tablebaseEligible(fen: string): boolean {
  return pieceCount(fen) <= TABLEBASE_MAX_PIECES;
}

/** The tablebase has no castling; leftover rights in the FEN (e.g. K+R vs K) would make the request fail. */
function normalizeFen(fen: string): string {
  const parts = fen.split(' ');
  if (parts.length >= 3) parts[2] = '-';
  return parts.join(' ');
}

const cache = new Map<string, Promise<TbResult>>();

/** Resolves with the tablebase entry, or rejects with a readable error (network, rate limit, ...). */
export function fetchTablebase(fen: string): Promise<TbResult> {
  const key = normalizeFen(fen);
  let p = cache.get(key);
  if (!p) {
    p = fetch(API + encodeURIComponent(key))
      .then(async (r) => {
        if (r.status === 429) throw new Error('Rate limited by Lichess — try again in a moment');
        if (!r.ok) throw new Error(`Tablebase returned HTTP ${r.status}`);
        return (await r.json()) as TbResult;
      })
      .catch((e) => {
        cache.delete(key); // never cache a failure
        throw e instanceof Error && e.message ? e : new Error('Could not reach the tablebase');
      });
    cache.set(key, p);
  }
  return p;
}

export interface TbSummary {
  text: string;
  tone: 'win' | 'draw' | 'unknown';
  /** true when there is a forced win/loss line worth walking through */
  hasLine: boolean;
}

/** `fen` is the position that was looked up (side to move = whoever's turn it is there). */
export function describeTablebase(res: TbResult, fen: string): TbSummary {
  const turn = fen.split(' ')[1] === 'b' ? 'Black' : 'White';
  const other = turn === 'White' ? 'Black' : 'White';

  if (res.checkmate) return { text: `Checkmate — ${other} wins.`, tone: 'win', hasLine: false };
  if (res.stalemate) return { text: 'Stalemate — draw.', tone: 'draw', hasLine: false };

  const mateIn = res.dtm != null ? Math.ceil(Math.abs(res.dtm) / 2) : null;
  const detail =
    mateIn != null
      ? ` — mate in ${mateIn}`
      : res.dtz != null
        ? ` — DTZ ${Math.abs(res.dtz)}`
        : '';

  switch (res.category) {
    case 'win':
      return { text: `Tablebase: ${turn} wins${detail}.`, tone: 'win', hasLine: true };
    case 'loss':
      return { text: `Tablebase: ${other} wins${detail}.`, tone: 'win', hasLine: true };
    case 'cursed-win':
      return { text: `Tablebase: ${turn} is winning on paper, but the 50-move rule makes it a draw.`, tone: 'draw', hasLine: true };
    case 'blessed-loss':
      return { text: `Tablebase: ${other} is winning on paper, but the 50-move rule saves ${turn}. Draw.`, tone: 'draw', hasLine: true };
    case 'draw':
      return { text: 'Tablebase: theoretical draw.', tone: 'draw', hasLine: false };
    default:
      return { text: 'Tablebase: result not available for this position.', tone: 'unknown', hasLine: false };
  }
}

/**
 * Follow the tablebase's best move from `fen` until mate (or the game ends).
 * The loser's replies are the tablebase's top reply too, i.e. the longest resistance.
 */
export async function buildTablebaseLine(
  startFen: string,
  onProgress?: (plies: number) => void,
  maxPlies = 120,
): Promise<TbFrame[]> {
  const frames: TbFrame[] = [];
  let fen = startFen;

  for (let i = 0; i < maxPlies; i++) {
    let res: TbResult;
    try { res = await fetchTablebase(fen); } catch (e) { if (frames.length === 0) throw e; break; }
    if (res.checkmate || res.stalemate || res.moves.length === 0) break;

    const best = res.moves[0];
    const chess = new Chess(fen);
    let r;
    try {
      r = chess.move({ from: best.uci.slice(0, 2), to: best.uci.slice(2, 4), promotion: best.uci.length > 4 ? best.uci[4] : undefined });
    } catch { break; }
    if (!r) break;

    fen = chess.fen();
    frames.push({ fen, from: r.from as Square, to: r.to as Square, san: r.san, uci: best.uci });
    onProgress?.(frames.length);
    if (chess.isGameOver()) break;
    if (!tablebaseEligible(fen)) break;
  }
  return frames;
}