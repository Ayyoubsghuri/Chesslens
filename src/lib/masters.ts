// Master-level games for an opening line, from the Lichess masters database
// (https://lichess.org/api#tag/Opening-Explorer). Lichess requires a free personal
// API token (no scopes) for explorer requests; we keep it in localStorage.
// Place in src/lib/masters.ts

import { Chess, type Square } from 'chess.js';

const BASE = 'https://explorer.lichess.ovh';
const TOKEN_KEY = 'chesslens-lichess-token';

export interface MasterGame {
  id: string;
  white: string;
  whiteRating?: number;
  black: string;
  blackRating?: number;
  winner: 'white' | 'black' | null; // null = draw
  year?: number;
}

export interface MastersResult {
  games: MasterGame[];
  total: number; // all master games that reached this position
}

export interface ParsedGame {
  fens: string[]; // fens[k] = position after k plies
  sans: string[];
  moves: { from: Square; to: Square }[];
}

export type MastersErrorKind = 'no-token' | 'auth' | 'rate' | 'network' | 'other';

export class MastersError extends Error {
  kind: MastersErrorKind;
  constructor(kind: MastersErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export function getLichessToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}
export function setLichessToken(t: string) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked */ }
}

async function explorerGet(path: string): Promise<Response> {
  const token = getLichessToken();
  if (!token) throw new MastersError('no-token', 'Add a Lichess token to load master games.');
  let res: Response;
  try {
    res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new MastersError('network', "Couldn't reach the Lichess explorer. Check your connection and try again.");
  }
  if (res.status === 401 || res.status === 403) throw new MastersError('auth', 'Lichess rejected the token. Check it and save it again.');
  if (res.status === 429) throw new MastersError('rate', 'Lichess is rate-limiting requests. Wait a minute and try again.');
  if (!res.ok) throw new MastersError('other', `Lichess returned an error (${res.status}).`);
  return res;
}

const listCache = new Map<string, MastersResult>();
const gameCache = new Map<string, ParsedGame>();

/** Top master games (by rating, max 15) that passed through the end of this line. */
export async function fetchMastersGames(uci: string[]): Promise<MastersResult> {
  const key = uci.join(' ');
  const hit = listCache.get(key);
  if (hit) return hit;

  const chess = new Chess();
  for (const u of uci) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });

  const res = await explorerGet(`/masters?fen=${encodeURIComponent(chess.fen())}&moves=0&topGames=15`);
  const data = await res.json();
  const games: MasterGame[] = (data.topGames ?? []).map((g: any) => ({
    id: g.id,
    white: g.white?.name ?? '?',
    whiteRating: g.white?.rating,
    black: g.black?.name ?? '?',
    blackRating: g.black?.rating,
    winner: g.winner === 'white' || g.winner === 'black' ? g.winner : null,
    year: g.year,
  }));
  const out = { games, total: (data.white ?? 0) + (data.draws ?? 0) + (data.black ?? 0) };
  listCache.set(key, out);
  return out;
}

/** Full move list of one master game. */
export async function fetchMasterGame(id: string): Promise<ParsedGame> {
  const hit = gameCache.get(id);
  if (hit) return hit;

  const res = await explorerGet(`/masters/pgn/${encodeURIComponent(id)}`);
  const text = await res.text();

  const parsed = new Chess();
  try { parsed.loadPgn(text); } catch { throw new MastersError('other', 'Could not read this game.'); }

  const replay = new Chess();
  const fens = [replay.fen()];
  const sans: string[] = [];
  const moves: ParsedGame['moves'] = [];
  for (const m of parsed.history({ verbose: true })) {
    const r = replay.move({ from: m.from, to: m.to, promotion: m.promotion });
    fens.push(replay.fen());
    sans.push(r.san);
    moves.push({ from: r.from as Square, to: r.to as Square });
  }
  const out = { fens, sans, moves };
  gameCache.set(id, out);
  return out;
}
