import { useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { Chess } from 'chess.js';
import type { ImportedGame } from '@/lib/types';
import {
  Crown as ChessIcon, Download, Swords, Flame, Skull, BookOpen, Trophy, Loader2, Clock, Zap, Search, Sparkles,
  X, ChevronLeft, ChevronRight, Play, Target,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Fetching games (public APIs, no key, CORS enabled)                  */
/* ------------------------------------------------------------------ */

type Platform = 'chesscom' | 'lichess';
type Outcome = 'w' | 'd' | 'l';

interface Game {
  ts: number; // ms
  color: 'w' | 'b';
  outcome: Outcome;
  myRating: number | null;
  oppName: string;
  oppRating: number | null;
  opening: string | null;
  speed: string; // bullet / blitz / rapid / classical / daily
  how: 'mate' | 'resign' | 'time' | 'other'; // how the game ended (for wins and losses)
  /** Checkmate pattern, only set for games I lost by checkmate. */
  mate?: string | null;
}

const MAX_GAMES = 1000;

/* ------------------------------------------------------------------ */
/* Checkmate pattern recognition (best-effort heuristics)              */
/* ------------------------------------------------------------------ */

type Cell = { type: string; color: 'w' | 'b' } | null;
type PieceAt = { type: string; color: 'w' | 'b'; f: number; r: number };

/** Pull SAN moves out of a PGN movetext (clocks, comments, numbers removed). */
function sansFromPgn(pgn: string): string[] {
  const body = pgn
    .split('\n')
    .filter((l) => !l.startsWith('['))
    .join(' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/1-0|0-1|1\/2-1\/2|\*/g, ' ');
  return body.split(/\s+/).filter(Boolean);
}

function clearBetween(grid: Cell[][], f1: number, r1: number, f2: number, r2: number): boolean {
  const sf = Math.sign(f2 - f1), sr = Math.sign(r2 - r1);
  let f = f1 + sf, r = r1 + sr;
  while (f !== f2 || r !== r2) {
    if (grid[f][r]) return false;
    f += sf; r += sr;
  }
  return true;
}

function attacksSq(p: PieceAt, tf: number, tr: number, grid: Cell[][]): boolean {
  const dx = tf - p.f, dy = tr - p.r;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (!ax && !ay) return false;
  switch (p.type) {
    case 'p': return ax === 1 && dy === (p.color === 'w' ? 1 : -1);
    case 'n': return (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
    case 'k': return Math.max(ax, ay) === 1;
    case 'b': return ax === ay && clearBetween(grid, p.f, p.r, tf, tr);
    case 'r': return (ax === 0 || ay === 0) && clearBetween(grid, p.f, p.r, tf, tr);
    case 'q': return (ax === ay || ax === 0 || ay === 0) && clearBetween(grid, p.f, p.r, tf, tr);
    default: return false;
  }
}

/** Name the mating pattern of a position where the side to move is checkmated. */
function classifyMate(chess: Chess, plies: number): string {
  const loser = chess.turn();
  const mater = loser === 'w' ? 'b' : 'w';
  const grid: Cell[][] = Array.from({ length: 8 }, () => Array<Cell>(8).fill(null));
  const pieces: PieceAt[] = [];
  chess.board().forEach((row, i) => row.forEach((c, j) => {
    if (!c) return;
    const p = { type: c.type, color: c.color as 'w' | 'b', f: j, r: 7 - i };
    grid[j][7 - i] = { type: c.type, color: p.color };
    pieces.push(p);
  }));
  const king = pieces.find((p) => p.type === 'k' && p.color === loser);
  if (!king) return 'Other mates';
  const mine = pieces.filter((p) => p.color === mater);
  const checkers = mine.filter((p) => attacksSq(p, king.f, king.r, grid));
  const has = (t: string) => mine.some((p) => p.type === t);
  const count = (t: string) => mine.filter((p) => p.type === t).length;
  const dist = (p: PieceAt) => Math.max(Math.abs(p.f - king.f), Math.abs(p.r - king.r));
  const adjacent = (p: PieceAt) => dist(p) === 1;
  const orth = (p: PieceAt) => p.f === king.f || p.r === king.r;
  const supported = (p: PieceAt, by?: string) =>
    mine.some((q) => q !== p && (!by || q.type === by) && attacksSq(q, p.f, p.r, grid));
  const nbrs: { f: number; r: number; cell: Cell }[] = [];
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    if (!df && !dr) continue;
    const f = king.f + df, r = king.r + dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    nbrs.push({ f, r, cell: grid[f][r] });
  }
  const ownAt = (f: number, r: number) => !!grid[f]?.[r] && grid[f][r]!.color === loser;
  const backRank = loser === 'w' ? 0 : 7;
  const fwd = loser === 'w' ? 1 : -1;
  const corner = (king.f === 0 || king.f === 7) && (king.r === 0 || king.r === 7);
  const onEdgeFile = king.f === 0 || king.f === 7;
  const lastIsQueen = checkers.length === 1 && checkers[0].type === 'q';
  const ck = checkers[0];

  if (plies === 4 && loser === 'w') return "Fool's mate";
  if ((plies === 7 || plies === 8) && lastIsQueen && ck.f === 5 && (ck.r === 6 || ck.r === 1) && adjacent(ck)) return "Scholar's mate";
  if (checkers.length === 1 && ck.type === 'n' && nbrs.every((n) => n.cell && n.cell.color === loser)) return 'Smothered mate';
  const rookAdj = checkers.length === 1 && ck.type === 'r' && adjacent(ck) && orth(ck) ? ck : null;
  if (corner && rookAdj && mine.some((p) => p.type === 'n' && attacksSq(p, rookAdj.f, rookAdj.r, grid))) return 'Arabian mate';
  if (rookAdj && mine.some((p) => p.type === 'n' && attacksSq(p, rookAdj.f, rookAdj.r, grid))
    && mine.some((p) => p.type === 'p' && mine.some((n) => n.type === 'n' && attacksSq(p, n.f, n.r, grid)))) return 'Hook mate';
  if (onEdgeFile && checkers.length === 1 && (ck.type === 'r' || ck.type === 'q') && ck.f === king.f && dist(ck) > 1
    && ownAt(king.f === 0 ? 1 : 6, king.r) && has('n')
    && mine.some((p) => p.type === 'n' && nbrs.some((n) => !n.cell && attacksSq(p, n.f, n.r, grid)))) return "Anastasia's mate";
  if (corner && checkers.length === 1 && ck.type === 'r' && dist(ck) > 1 && mine.some((p) => p.type === 'b' && attacksSq(p, king.f === 0 ? 1 : 6, king.r === 0 ? 1 : 6, grid))) return "Pillsbury's mate";
  if (checkers.length === 1 && ck.type === 'r' && king.r === backRank && adjacent(ck) && ck.r === king.r
    && mine.some((p) => p.type === 'b' && attacksSq(p, ck.f, ck.r, grid))) return 'Opera mate';
  if (checkers.length === 1 && ck.type === 'b' && count('b') >= 2 && king.r === backRank && nbrs.filter((n) => n.cell?.color === loser).length >= 2) return "Boden's mate";
  if (lastIsQueen && adjacent(ck) && !orth(ck) && supported(ck, 'p')) return "Lolli's mate";
  if (lastIsQueen && adjacent(ck) && orth(ck) && onEdgeFile && supported(ck, 'p')) return "Damiano's mate";
  if (lastIsQueen && adjacent(ck) && ck.f === king.f
    && [-1, 1].every((d) => ownAt(king.f + d, king.r) || king.f + d < 0 || king.f + d > 7)
    && nbrs.some((n) => n.cell?.color === loser)) return 'Epaulette mate';
  const ladderLine = (a: PieceAt, b: PieceAt) =>
    (king.r === 0 || king.r === 7) ? a.r === king.r && b.r === king.r - Math.sign(king.r - 3.5)
      : (king.f === 0 || king.f === 7) ? a.f === king.f && b.f === king.f - Math.sign(king.f - 3.5) : false;
  const heavy = mine.filter((p) => p.type === 'r' || p.type === 'q');
  if (heavy.length >= 2 && checkers.length >= 1 && heavy.some((a) => heavy.some((b) => a !== b && attacksSq(a, king.f, king.r, grid) && ladderLine(a, b)))
    && !nbrs.some((n) => n.cell?.color === loser)) return 'Ladder mate';
  if (king.r === backRank && checkers.length >= 1 && checkers.every((p) => (p.type === 'r' || p.type === 'q') && p.r === king.r)
    && nbrs.some((n) => n.r === king.r + fwd && n.cell?.color === loser)) return 'Back-rank mate';
  if (lastIsQueen && adjacent(ck) && supported(ck, 'k') && mine.every((p) => p.type === 'k' || p.type === 'q' || p.type === 'p')) return 'King + queen mate';
  if (lastIsQueen && adjacent(ck) && !orth(ck) && supported(ck)) return 'Dovetail mate';
  if ((lastIsQueen && supported(ck, 'b')) || (checkers.length === 1 && ck.type === 'b' && has('q'))) return 'Queen + bishop mate';
  if ((lastIsQueen && supported(ck, 'r')) || (checkers.length === 1 && ck.type === 'r' && has('q'))) return 'Queen + rook mate';
  return 'Other mates';
}

/** Replay a game from SAN moves and name the final checkmate. */
function mateFromSans(sans: string[]): string | null {
  try {
    const chess = new Chess();
    let n = 0;
    for (const san of sans) {
      chess.move(san);
      n++;
    }
    return chess.isCheckmate() ? classifyMate(chess, n) : null;
  } catch {
    return null;
  }
}

/** Group variations into a family: "Sicilian Defense: Najdorf" -> "Sicilian Defense". */
const FAMILIES = [
  'Ruy Lopez', 'Queens Gambit', "Queen's Gambit", 'Kings Gambit', "King's Gambit", 'Kings Indian', "King's Indian",
  'Queens Indian', 'Nimzo Indian', 'Nimzo-Indian', 'Italian Game', 'Sicilian Defense', 'French Defense', 'Caro-Kann',
  'Caro Kann', 'Scandinavian', 'Pirc', 'Alekhine', 'English Opening', 'Vienna', 'Scotch', 'Petrov', 'London System',
  'Catalan', 'Slav', 'Dutch', 'Grunfeld', 'Grünfeld', 'Benoni', 'Bird', 'Reti', 'Zukertort', 'Philidor', 'Four Knights',
  'Danish Gambit', 'Evans Gambit', 'Two Knights', 'Bishops Opening', "Bishop's Opening", 'Center Game', 'Modern Defense',
];

function family(raw: string): string {
  const name = raw.replace(/-/g, ' ').replace(/%27/g, "'").replace(/\s+\d.*$/, '').replace(/[:,].*$/, '').trim();
  const lower = name.toLowerCase().replace(/-/g, ' ');
  for (const f of FAMILIES) {
    if (lower.startsWith(f.toLowerCase().replace(/-/g, ' '))) return f.replace("Queen's", 'Queens').replace("King's", 'Kings').replace("Bishop's", 'Bishops');
  }
  const m = name.match(/^(.*?\b(?:Defense|Defence|Opening|Game|Gambit|Attack|System))\b/i);
  return ((m ? m[1] : name.split(/\s+/).slice(0, 3).join(' ')).trim()) || 'Unknown';
}

async function fetchChessCom(user: string): Promise<{ games: Game[]; display: string }> {
  const u = user.toLowerCase();
  const arc = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`);
  if (arc.status === 404) throw new Error(`No Chess.com player called "${user}".`);
  if (!arc.ok) throw new Error(`Chess.com returned ${arc.status}. Try again in a moment.`);
  const archives: string[] = ((await arc.json()) as { archives?: string[] }).archives ?? [];

  const games: Game[] = [];
  let display = user;
  for (const url of [...archives].reverse().slice(0, 36)) {
    if (games.length >= MAX_GAMES) break;
    const res = await fetch(url);
    if (!res.ok) continue;
    const month = ((await res.json()) as { games?: any[] }).games ?? [];
    for (const g of [...month].reverse()) {
      if (games.length >= MAX_GAMES) break;
      if (g.rules && g.rules !== 'chess') continue;
      const isWhite = g.white?.username?.toLowerCase() === u;
      const isBlack = g.black?.username?.toLowerCase() === u;
      if (!isWhite && !isBlack) continue;
      const me = isWhite ? g.white : g.black;
      const opp = isWhite ? g.black : g.white;
      display = me.username || display;

      const draws = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];
      let outcome: Outcome;
      if (me.result === 'win') outcome = 'w';
      else if (draws.includes(me.result)) outcome = 'd';
      else outcome = 'l';

      const loserResult = outcome === 'w' ? opp.result : me.result;
      const how: Game['how'] =
        loserResult === 'checkmated' ? 'mate'
        : loserResult === 'resigned' ? 'resign'
        : loserResult === 'timeout' || loserResult === 'abandoned' ? 'time'
        : 'other';

      const ecoUrl = /\[ECOUrl "([^"]+)"\]/.exec(g.pgn ?? '')?.[1];
      const slug = ecoUrl ? decodeURIComponent(ecoUrl.split('/').pop() ?? '') : null;

      games.push({
        ts: (g.end_time ?? 0) * 1000,
        color: isWhite ? 'w' : 'b',
        outcome,
        myRating: typeof me.rating === 'number' ? me.rating : null,
        oppName: opp.username ?? 'Unknown',
        oppRating: typeof opp.rating === 'number' ? opp.rating : null,
        opening: slug ? family(slug) : null,
        speed: g.time_class ?? 'rapid',
        how,
        mate: outcome === 'l' && how === 'mate' && g.pgn ? mateFromSans(sansFromPgn(g.pgn)) : null,
      });
    }
  }
  return { games, display };
}

async function fetchLichess(user: string): Promise<{ games: Game[]; display: string }> {
  const u = user.toLowerCase();
  const res = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(u)}?max=${MAX_GAMES}&opening=true&moves=true&tags=false`,
    { headers: { Accept: 'application/x-ndjson' } },
  );
  if (res.status === 404) throw new Error(`No Lichess player called "${user}".`);
  if (!res.ok) throw new Error(`Lichess returned ${res.status}. Try again in a moment.`);
  const lines = (await res.text()).split('\n').filter(Boolean);

  const games: Game[] = [];
  let display = user;
  for (const line of lines) {
    let g: any;
    try { g = JSON.parse(line); } catch { continue; }
    if (g.variant && g.variant !== 'standard') continue;
    const wName = g.players?.white?.user?.name ?? (g.players?.white?.aiLevel ? `Stockfish ${g.players.white.aiLevel}` : 'Anonymous');
    const bName = g.players?.black?.user?.name ?? (g.players?.black?.aiLevel ? `Stockfish ${g.players.black.aiLevel}` : 'Anonymous');
    const isWhite = wName.toLowerCase() === u;
    const isBlack = bName.toLowerCase() === u;
    if (!isWhite && !isBlack) continue;
    display = isWhite ? wName : bName;
    const me = isWhite ? g.players.white : g.players.black;
    const opp = isWhite ? g.players.black : g.players.white;
    const winner: string | undefined = g.winner;
    const outcome: Outcome = !winner ? 'd' : (winner === 'white') === isWhite ? 'w' : 'l';
    const how: Game['how'] =
      g.status === 'mate' ? 'mate'
      : g.status === 'resign' ? 'resign'
      : g.status === 'outoftime' || g.status === 'timeout' ? 'time'
      : 'other';
    games.push({
      ts: g.lastMoveAt ?? g.createdAt ?? 0,
      color: isWhite ? 'w' : 'b',
      outcome,
      myRating: typeof me?.rating === 'number' ? me.rating : null,
      oppName: isWhite ? bName : wName,
      oppRating: typeof opp?.rating === 'number' ? opp.rating : null,
      opening: g.opening?.name ? family(g.opening.name) : null,
      speed: g.speed ?? 'rapid',
      how,
      mate: outcome === 'l' && how === 'mate' && typeof g.moves === 'string' ? mateFromSans(g.moves.split(' ').filter(Boolean)) : null,
    });
  }
  return { games, display };
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

interface Row { icon: typeof Zap; title: string; value: string }
interface OpeningStat { name: string; n: number; win: number }
interface Bucket { label: string; n: number; score: number }
interface Story {
  name: string;
  platform: Platform;
  count: number;
  rating: number | null;
  /** Time control the displayed rating belongs to (e.g. blitz, rapid). */
  ratingSpeed: string | null;
  winRate: number;
  record: { w: number; d: number; l: number };
  rows: Row[];
  white: OpeningStat[];
  black: OpeningStat[];
  weapon: { name: string; score: number; n: number } | null;
  /** Most-played opening + worst opening to retire (opening identity card). */
  identity: {
    main: string;
    share: number;
    n: number;
    retire: { name: string; score: number; side: string } | null;
  } | null;
  giant: { oppName: string; oppRating: number; myRating: number | null } | null;
  nemesis: { name: string; games: number; w: number; d: number; l: number } | null;
  streak: number;
  times: Bucket[];
  wins: { label: string; n: number }[];
  winTotal: number;
  formats: { speed: string; n: number; score: number }[];
  ratings: number[];
  // New insight fields
  avoid: { name: string; score: number; n: number; side: string }[];
  learn: { name: string; score: number; n: number; reason: string }[];
  colorPerf: { white: { n: number; score: number }; black: { n: number; score: number } };
  losses: { label: string; n: number }[];
  lossTotal: number;
  bestVictim: { name: string; games: number; w: number; d: number; l: number } | null;
  favoriteColor: 'w' | 'b' | null;
  /** What opponents opened with when they had White (I was Black). */
  oppWhite: OppOpening[];
  /** What opponents defended with when they had Black (I was White). */
  oppBlack: OppOpening[];
  oppWhiteGames: number;
  oppBlackGames: number;
  /** Checkmate patterns that beat me. */
  mates: { label: string; n: number }[];
  mateTotal: number;
  /** Opponent-weakness cards by rating band. */
  bands: BandStat[];
}

interface OppOpening { name: string; n: number; share: number; myScore: number }
interface BandStat {
  label: string;
  lo: number;
  hi: number;
  isYours: boolean;
  weaknesses: string[];
  exploit: string;
  n: number;
  score: number;
  /** How you beat players in this band (share of your wins). */
  winWays: { label: string; pct: number }[];
}

/** Rating bands for the opponent-weakness cards. Edit this list to change the scheme. */
const BANDS: { lo: number; hi: number; weaknesses: string[]; exploit: string }[] = [
  { lo: 100, hi: 300, weaknesses: ['Leave pieces hanging for free', 'Miss one-move threats and checks', 'Move the same piece again and again'], exploit: 'Stay solid, grab free material and look for quick mates.' },
  { lo: 300, hi: 600, weaknesses: ['Fall for Scholar\'s mate and early queen raids', 'Forget to protect pieces', 'Skip castling and leave the king open'], exploit: 'Develop fast, castle, and punish loose pieces with forks.' },
  { lo: 600, hi: 900, weaknesses: ['Miss two-move tactics: forks, pins, skewers', 'Weak back rank', 'Trade pieces when they are already behind'], exploit: 'Set up tactical shots and aim at their back rank.' },
  { lo: 900, hi: 1200, weaknesses: ['Passive pieces and slow development', 'Shaky endgame technique', 'Collapse in time trouble'], exploit: 'Build positional pressure and trade into endgames.' },
  { lo: 1200, hi: 1500, weaknesses: ['Rook endgames and the opposition', 'Overextended pawns', 'Repeat the same opening mistakes'], exploit: 'Prepare your opening lines and convert endgames patiently.' },
  { lo: 1500, hi: 1800, weaknesses: ['Calculation slips under the clock', 'Pawn-structure decisions', 'Converting an advantage cleanly'], exploit: 'Keep the position complex and let the clock work for you.' },
  { lo: 1800, hi: 2100, weaknesses: ['Holes outside main-line theory', 'Technical endgames', 'Pressing too hard in equal positions'], exploit: 'Pick offbeat lines and play for a long game.' },
  { lo: 2100, hi: 4000, weaknesses: ['Rare blunders, mostly in bullet and time trouble', 'Unfamiliar sidelines', 'Overconfidence in drawn endings'], exploit: 'Stay accurate, keep the clock healthy and test them in sidelines.' },
];

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const points = (o: Outcome) => (o === 'w' ? 1 : o === 'd' ? 0.5 : 0);

function openingMap(games: Game[], color?: 'w' | 'b') {
  const map = new Map<string, { n: number; w: number; points: number }>();
  for (const g of games) {
    if (!g.opening || (color && g.color !== color)) continue;
    const cur = map.get(g.opening) ?? { n: 0, w: 0, points: 0 };
    cur.n++;
    if (g.outcome === 'w') cur.w++;
    cur.points += points(g.outcome);
    map.set(g.opening, cur);
  }
  return map;
}

function topOpenings(games: Game[], color: 'w' | 'b'): OpeningStat[] {
  return [...openingMap(games, color).entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 3)
    .map(([name, s]) => ({ name, n: s.n, win: pct(s.w, s.n) }));
}

function buildStory(name: string, platform: Platform, all: Game[]): Story {
  const games = [...all].sort((a, b) => a.ts - b.ts); // oldest -> newest
  const record = { w: 0, d: 0, l: 0 };
  games.forEach((g) => record[g.outcome]++);

  const white = topOpenings(games, 'w');
  const black = topOpenings(games, 'b');

  const allOpenings = [...openingMap(games).entries()];
  const weaponEntry = allOpenings
    .filter(([, s]) => s.n >= 3)
    .sort((a, b) => b[1].points / b[1].n - a[1].points / a[1].n || b[1].n - a[1].n)[0];
  const weapon = weaponEntry ? { name: weaponEntry[0], score: pct(weaponEntry[1].points, weaponEntry[1].n), n: weaponEntry[1].n } : null;

  // Opening identity: most played overall + worst opening worth retiring
  const mostPlayedEntry = allOpenings.sort((a, b) => b[1].n - a[1].n)[0];
  const worstOverall = allOpenings
    .filter(([, s]) => s.n >= 3)
    .sort((a, b) => a[1].points / a[1].n - b[1].points / b[1].n || b[1].n - a[1].n)[0];
  // Prefer a weak Black repertoire line when available (matches the screenshot tone)
  const blackMap = openingMap(games, 'b');
  const worstBlack = [...blackMap.entries()]
    .filter(([, s]) => s.n >= 3)
    .sort((a, b) => a[1].points / a[1].n - b[1].points / b[1].n || b[1].n - a[1].n)[0];
  const retireSrc = worstBlack && (worstBlack[1].points / worstBlack[1].n) <= 0.4
    ? { name: worstBlack[0], score: pct(worstBlack[1].points, worstBlack[1].n), side: 'as Black' }
    : worstOverall
      ? { name: worstOverall[0], score: pct(worstOverall[1].points, worstOverall[1].n), side: '' }
      : null;
  const identity = mostPlayedEntry
    ? {
        main: mostPlayedEntry[0],
        share: pct(mostPlayedEntry[1].n, games.length),
        n: mostPlayedEntry[1].n,
        retire: retireSrc && retireSrc.name !== mostPlayedEntry[0] ? retireSrc : null,
      }
    : null;

  const giantGame = games
    .filter((g) => g.outcome === 'w' && g.oppRating != null)
    .sort((a, b) => b.oppRating! - a.oppRating!)[0];
  const giant = giantGame ? { oppName: giantGame.oppName, oppRating: giantGame.oppRating!, myRating: giantGame.myRating } : null;

  const vs = new Map<string, { games: number; w: number; d: number; l: number }>();
  games.forEach((g) => {
    const cur = vs.get(g.oppName) ?? { games: 0, w: 0, d: 0, l: 0 };
    cur.games++;
    cur[g.outcome]++;
    vs.set(g.oppName, cur);
  });
  const nem = [...vs.entries()].filter(([, s]) => s.l >= 2).sort((a, b) => b[1].l - a[1].l || b[1].games - a[1].games)[0];
  const nemesis = nem ? { name: nem[0], ...nem[1] } : null;

  let streak = 0, cur = 0;
  games.forEach((g) => { cur = g.outcome === 'w' ? cur + 1 : 0; streak = Math.max(streak, cur); });

  const bucketOf = (h: number) => (h >= 5 && h < 12 ? 'Mornings' : h >= 12 && h < 17 ? 'Afternoons' : h >= 17 && h < 22 ? 'Evenings' : 'Late nights');
  const tmp: Record<string, { n: number; points: number }> = {};
  games.forEach((g) => {
    if (!g.ts) return;
    const b = bucketOf(new Date(g.ts).getHours());
    const e = tmp[b] ?? { n: 0, points: 0 };
    e.n++;
    e.points += points(g.outcome);
    tmp[b] = e;
  });
  const times: Bucket[] = ['Mornings', 'Afternoons', 'Evenings', 'Late nights']
    .filter((l) => tmp[l])
    .map((label) => ({ label, n: tmp[label].n, score: pct(tmp[label].points, tmp[label].n) }));

  const winGames = games.filter((g) => g.outcome === 'w');
  const wins = [
    { label: 'Checkmate', n: winGames.filter((g) => g.how === 'mate').length },
    { label: 'Resignation', n: winGames.filter((g) => g.how === 'resign').length },
    { label: 'On time', n: winGames.filter((g) => g.how === 'time').length },
    { label: 'Other', n: winGames.filter((g) => g.how === 'other').length },
  ].filter((w) => w.n > 0);

  const fm = new Map<string, { n: number; points: number }>();
  games.forEach((g) => {
    const e = fm.get(g.speed) ?? { n: 0, points: 0 };
    e.n++;
    e.points += points(g.outcome);
    fm.set(g.speed, e);
  });
  const formats = [...fm.entries()].sort((a, b) => b[1].n - a[1].n).map(([speed, s]) => ({ speed, n: s.n, score: pct(s.points, s.n) }));

  // Sparkline: prefer ratings from the most-played format so it matches the headline rating
  const mainSpeed = formats[0]?.speed;
  const ratedFromMain = mainSpeed
    ? games.filter((g) => g.speed === mainSpeed && g.myRating != null).map((g) => g.myRating as number)
    : [];
  const ratedAll = games.filter((g) => g.myRating != null).map((g) => g.myRating as number);
  const rated = ratedFromMain.length >= 5 ? ratedFromMain : ratedAll;
  // Keep the sparkline light: at most ~60 points
  const step = Math.max(1, Math.ceil(rated.length / 60));
  const ratings = rated.filter((_, i) => i % step === 0 || i === rated.length - 1);

  // ---- New insight stats ----
  // Openings to avoid: lowest score rate with enough games (min 4)
  const avoid = allOpenings
    .filter(([, s]) => s.n >= 4)
    .sort((a, b) => a[1].points / a[1].n - b[1].points / b[1].n || b[1].n - a[1].n)
    .slice(0, 4)
    .map(([name, s]) => {
      const sideW = openingMap(games, 'w').get(name);
      const sideB = openingMap(games, 'b').get(name);
      let side = '';
      if (sideW && sideB) side = sideW.n >= sideB.n ? 'as White' : 'as Black';
      else if (sideW) side = 'as White';
      else if (sideB) side = 'as Black';
      return { name, score: pct(s.points, s.n), n: s.n, side };
    });

  // What to learn: openings played often but mediocre score, or high volume with room to improve
  const learn = allOpenings
    .filter(([, s]) => s.n >= 5 && s.points / s.n < 0.55 && s.points / s.n > 0.25)
    .sort((a, b) => b[1].n - a[1].n || a[1].points / a[1].n - b[1].points / b[1].n)
    .slice(0, 4)
    .map(([name, s]) => ({
      name,
      score: pct(s.points, s.n),
      n: s.n,
      reason: s.points / s.n < 0.4 ? 'leaking points' : 'room to improve',
    }));

  // Color performance
  const whiteGames = games.filter((g) => g.color === 'w');
  const blackGames = games.filter((g) => g.color === 'b');
  const colorPerf = {
    white: { n: whiteGames.length, score: pct(whiteGames.reduce((a, g) => a + points(g.outcome), 0), whiteGames.length) },
    black: { n: blackGames.length, score: pct(blackGames.reduce((a, g) => a + points(g.outcome), 0), blackGames.length) },
  };
  const favoriteColor: 'w' | 'b' | null =
    colorPerf.white.n >= 10 && colorPerf.black.n >= 10
      ? colorPerf.white.score >= colorPerf.black.score + 5 ? 'w' : colorPerf.black.score >= colorPerf.white.score + 5 ? 'b' : null
      : null;

  // How you lose
  const lossGames = games.filter((g) => g.outcome === 'l');
  const losses = [
    { label: 'Checkmated', n: lossGames.filter((g) => g.how === 'mate').length },
    { label: 'Resigned', n: lossGames.filter((g) => g.how === 'resign').length },
    { label: 'On time', n: lossGames.filter((g) => g.how === 'time').length },
    { label: 'Other', n: lossGames.filter((g) => g.how === 'other').length },
  ].filter((w) => w.n > 0);
  const lossTotal = lossGames.length;

  // Best victim (most wins against one opponent)
  const vict = [...vs.entries()].filter(([, s]) => s.w >= 2).sort((a, b) => b[1].w - a[1].w || b[1].games - a[1].games)[0];
  const bestVictim = vict ? { name: vict[0], ...vict[1] } : null;

  // What opponents play against me: their opening as White (I'm Black) and their defense as Black (I'm White)
  const oppStats = (myColor: 'w' | 'b'): { list: OppOpening[]; total: number } => {
    const sub = games.filter((g) => g.color === myColor && g.opening);
    const m = new Map<string, { n: number; points: number }>();
    sub.forEach((g) => {
      const e = m.get(g.opening!) ?? { n: 0, points: 0 };
      e.n++;
      e.points += points(g.outcome);
      m.set(g.opening!, e);
    });
    const list = [...m.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 4)
      .map(([name, e]) => ({ name, n: e.n, share: pct(e.n, sub.length), myScore: pct(e.points, e.n) }));
    return { list, total: sub.length };
  };
  const oppW = oppStats('b');
  const oppB = oppStats('w');

  // Checkmate patterns that beat me
  const mateMap = new Map<string, number>();
  lossGames.forEach((g) => { if (g.how === 'mate' && g.mate) mateMap.set(g.mate, (mateMap.get(g.mate) ?? 0) + 1); });
  const mates = [...mateMap.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).slice(0, 5);
  const mateTotal = [...mateMap.values()].reduce((a, b) => a + b, 0);

  // Poster rows (summary)
  const rows: Row[] = [{ icon: Swords, title: 'Record', value: `${record.w}W · ${record.d}D · ${record.l}L` }];
  if (white[0]) rows.push({ icon: BookOpen, title: 'As White', value: `${white[0].name} · ${white[0].win}% (${white[0].n})` });
  if (black[0]) rows.push({ icon: BookOpen, title: 'As Black', value: `${black[0].name} · ${black[0].win}% (${black[0].n})` });
  if (weapon) rows.push({ icon: Sparkles, title: 'Secret weapon', value: `${weapon.name} ${weapon.score}%` });
  if (giant) rows.push({ icon: Trophy, title: 'Giant killer', value: `Beat a ${giant.oppRating}` });
  if (nemesis) rows.push({ icon: Skull, title: 'Nemesis', value: `${nemesis.name} · ${nemesis.l} losses` });
  if (streak >= 3) rows.push({ icon: Flame, title: 'Best streak', value: `${streak} wins in a row` });
  const bestTime = [...times].filter((t) => t.n >= 5).sort((a, b) => b.score - a.score)[0];
  if (bestTime && times.length > 1) rows.push({ icon: Clock, title: 'Plays best', value: `${bestTime.label} · ${bestTime.score}%` });
  if (formats[0]) rows.push({ icon: Zap, title: 'Favorite format', value: `${cap(formats[0].speed)} · ${pct(formats[0].n, games.length)}%` });
  if (favoriteColor) rows.push({ icon: BookOpen, title: 'Stronger as', value: favoriteColor === 'w' ? 'White' : 'Black' });

  // Prefer rating from the player's main time control:
  // most-played format first; if that has no rated games, fall back to rapid → blitz → any.
  const preferredSpeeds: string[] = [];
  if (formats[0]) preferredSpeeds.push(formats[0].speed);
  for (const s of ['rapid', 'blitz', 'bullet', 'classical', 'daily']) {
    if (!preferredSpeeds.includes(s)) preferredSpeeds.push(s);
  }
  let rating: number | null = null;
  let ratingSpeed: string | null = null;
  for (const speed of preferredSpeeds) {
    const hit = [...games].reverse().find((g) => g.speed === speed && g.myRating != null);
    if (hit) {
      rating = hit.myRating;
      ratingSpeed = speed;
      break;
    }
  }
  if (rating == null) {
    const any = [...games].reverse().find((g) => g.myRating != null);
    if (any) {
      rating = any.myRating;
      ratingSpeed = any.speed;
    }
  }

  // Opponent weakness cards: the band you sit in, plus neighbours (5 consecutive bands)
  const refRating = rating ?? (() => {
    const opps = games.filter((g) => g.oppRating != null).map((g) => g.oppRating as number);
    return opps.length ? Math.round(opps.reduce((a, b) => a + b, 0) / opps.length) : 800;
  })();
  let yourIdx = BANDS.findIndex((b) => refRating >= b.lo && refRating < b.hi);
  if (yourIdx < 0) yourIdx = refRating < BANDS[0].lo ? 0 : BANDS.length - 1;
  const startIdx = Math.max(0, Math.min(BANDS.length - 5, yourIdx - 2));
  const bands: BandStat[] = BANDS.slice(startIdx, startIdx + 5).map((b, i) => {
    const vsBand = games.filter((g) => g.oppRating != null && g.oppRating >= b.lo && g.oppRating < b.hi);
    const bandWins = vsBand.filter((g) => g.outcome === 'w');
    const ways = [
      { label: 'Checkmate', n: bandWins.filter((g) => g.how === 'mate').length },
      { label: 'Resignation', n: bandWins.filter((g) => g.how === 'resign').length },
      { label: 'On time', n: bandWins.filter((g) => g.how === 'time').length },
    ].filter((w) => w.n > 0).sort((a, c) => c.n - a.n);
    return {
      label: b.hi >= 4000 ? `${b.lo}+` : `${b.lo}–${b.hi}`,
      lo: b.lo, hi: b.hi, isYours: startIdx + i === yourIdx,
      weaknesses: b.weaknesses, exploit: b.exploit,
      n: vsBand.length,
      score: pct(vsBand.reduce((a, g) => a + points(g.outcome), 0), vsBand.length),
      winWays: ways.map((w) => ({ label: w.label, pct: pct(w.n, bandWins.length) })),
    };
  });

  return {
    name, platform, count: games.length, rating, ratingSpeed,
    winRate: pct(record.w + record.d / 2, games.length), record, rows,
    white, black, weapon, identity, giant, nemesis, streak, times, wins, winTotal: winGames.length, formats, ratings,
    avoid, learn, colorPerf, losses, lossTotal, bestVictim, favoriteColor,
    oppWhite: oppW.list, oppBlack: oppB.list, oppWhiteGames: oppW.total, oppBlackGames: oppB.total,
    mates, mateTotal, bands,
  };
}

/* ------------------------------------------------------------------ */
/* UI pieces                                                           */
/* ------------------------------------------------------------------ */

const GRADS = {
  green: 'linear-gradient(165deg, #1f6b4f 0%, #14412f 55%, #0e2b21 100%)',
  blue: 'linear-gradient(165deg, #1f5d7a 0%, #133a52 55%, #0c2234 100%)',
  amber: 'linear-gradient(165deg, #7a5a1f 0%, #4f3913 55%, #2f220b 100%)',
  plum: 'linear-gradient(165deg, #6a3a78 0%, #432451 55%, #2a1633 100%)',
  red: 'linear-gradient(165deg, #7a2f2f 0%, #4f1d1d 55%, #2f1111 100%)',
};
const GOLD = '#f2c862';

function Ring({ value }: { value: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden>
      <circle cx="38" cy="38" r={r} fill="none" stroke="#e5e7eb" strokeWidth="7" />
      <circle
        cx="38" cy="38" r={r} fill="none" stroke="#16a34a" strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${c * Math.max(0, Math.min(1, value / 100))} ${c}`} transform="rotate(-90 38 38)"
      />
      <text x="38" y="44" textAnchor="middle" fontSize="19" fontWeight="800" fill="#111827">{value}%</text>
    </svg>
  );
}

function Bar({ label, value, fill, sub }: { label: string; value: string; fill: number; sub?: string }) {
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold truncate">{label}</span>
        <span className="shrink-0 text-[13px] font-semibold" style={{ color: GOLD }}>{value}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-white/15 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, fill))}%`, background: GOLD }} />
      </div>
      {sub && <p className="text-[11px] text-white/55 mt-0.5">{sub}</p>}
    </div>
  );
}

/** Shared frame for the secondary cards. */
function Shell({
  grad, kicker, story, children, footer,
}: { grad: string; kicker: string; story: Story; children: React.ReactNode; footer?: string }) {
  return (
    <div className="w-full max-w-[340px] rounded-[28px] p-5 text-white shadow-2xl flex flex-col" style={{ background: grad, minHeight: 420 }}>
      <div className="flex items-center justify-between text-[11px] text-white/70">
        <span className="flex items-center gap-1.5 font-semibold text-white/90">
          <span className="w-6 h-6 rounded-md bg-white/15 flex items-center justify-center"><ChessIcon size={14} /></span>
          ChessLens
        </span>
        <span>{story.name} · {story.count} games</span>
      </div>
      <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: GOLD }}>{kicker}</p>
      <div className="mt-2 flex-1">{children}</div>
      {footer && <p className="mt-4 text-[11px] text-white/55">{footer}</p>}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 290, h = 110, pad = 6;
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (w - pad * 2), h - pad - ((v - min) / span) * (h - pad * 2)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" aria-hidden>
      <path d={`${d} L${last[0]} ${h} L${pts[0][0]} ${h} Z`} fill="rgba(242,200,98,0.15)" />
      <path d={d} fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="4" fill={GOLD} />
    </svg>
  );
}

const STORE_KEY = 'chesslens:story-user';

function loadLast(): { platform: Platform; user: string } | null {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Most frequent player name across imported games: a good default for the username box. */
function guessPlayer(games: ImportedGame[]): string {
  const counts = new Map<string, number>();
  games.forEach((g) => [g.white, g.black].forEach((n) => n && n !== 'You' && counts.set(n, (counts.get(n) ?? 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/* ------------------------------------------------------------------ */
/* Instagram-style full-screen story viewer                            */
/* ------------------------------------------------------------------ */

const CARD_W = 340;
const CARD_H = Math.round((CARD_W * 16) / 9); // 9:16 story format
const STORY_MS = 7000;

type StoryCard = { id: string; label: string; node: React.ReactNode };

function StoryViewer({
  cards, index, setIndex, onClose, onSave, saving,
}: {
  cards: StoryCard[];
  index: number;
  setIndex: (i: number) => void;
  onClose: () => void;
  onSave: (id: string) => void;
  saving: string | null;
}) {
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const swiped = useRef(false);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const last = cards.length - 1;

  const next = () => (index < last ? setIndex(index + 1) : onClose());
  const prev = () => setIndex(Math.max(0, index - 1));

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('resize', onResize);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => { setProgress(0); }, [index]);

  // Auto-advance like Instagram; hold the screen to pause.
  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => setProgress((p) => Math.min(1, p + 50 / STORY_MS)), 50);
    return () => window.clearInterval(t);
  }, [paused, index]);

  useEffect(() => {
    if (progress >= 1 && index < last) setIndex(index + 1);
  }, [progress, index, last, setIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const frameH = Math.min(vp.h, (vp.w * 16) / 9);
  const frameW = (frameH * 9) / 16;
  const scale = frameW / CARD_W;
  const card = cards[index];

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none" role="dialog" aria-modal="true" aria-label="Your chess story">
      <button onClick={onClose} aria-label="Close story" className="hidden sm:flex absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center z-10">
        <X size={20} />
      </button>
      <button onClick={prev} disabled={index === 0} aria-label="Previous card" className="hidden sm:flex absolute left-[max(1rem,calc(50%-var(--half)-4rem))] w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white items-center justify-center"
        style={{ ['--half' as string]: `${frameW / 2}px` }}>
        <ChevronLeft size={22} />
      </button>
      <button onClick={next} aria-label="Next card" className="hidden sm:flex absolute right-[max(1rem,calc(50%-var(--half)-4rem))] w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center"
        style={{ ['--half' as string]: `${frameW / 2}px` }}>
        <ChevronRight size={22} />
      </button>

      <div className="relative overflow-hidden sm:rounded-2xl bg-black" style={{ width: frameW, height: frameH }}>
        {/* the card, rendered at design size and scaled to fill the frame */}
        <div style={{ width: CARD_W, height: CARD_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <div key={card.id} className="w-full h-full [&>div]:w-full [&>div]:h-full [&>div]:max-w-none [&>div]:rounded-none [&>div]:shadow-none">
            {card.node}
          </div>
        </div>

        {/* progress bars */}
        <div className="absolute top-2 left-2 right-2 flex gap-1 pointer-events-none">
          {cards.map((c, i) => (
            <div key={c.id} className="h-[3px] flex-1 rounded-full bg-white/30 overflow-hidden">
              <div className="h-full bg-white" style={{ width: `${i < index ? 100 : i === index ? progress * 100 : 0}%` }} />
            </div>
          ))}
        </div>

        {/* gestures: tap left = back, tap right = next, hold = pause, swipe left/right = next/back, swipe down = close */}
        <div
          className="absolute inset-x-0 top-6 bottom-14 flex"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            touch.current = { x: e.clientX, y: e.clientY, t: Date.now() };
            swiped.current = false;
            setPaused(true);
          }}
          onPointerUp={(e) => {
            setPaused(false);
            const st = touch.current;
            touch.current = null;
            if (!st) return;
            const dx = e.clientX - st.x;
            const dy = e.clientY - st.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) {
              swiped.current = true;
              if (dx < 0) next(); else prev();
            } else if (dy > 90 && dy > Math.abs(dx) * 1.3) {
              swiped.current = true;
              onClose();
            }
          }}
          onPointerLeave={() => setPaused(false)}
          onPointerCancel={() => { touch.current = null; setPaused(false); }}
        >
          <button className="w-1/3 h-full cursor-w-resize" aria-label="Previous" onClick={() => { if (!swiped.current) prev(); swiped.current = false; }} />
          <button className="w-2/3 h-full cursor-e-resize" aria-label="Next" onClick={() => { if (!swiped.current) next(); swiped.current = false; }} />
        </div>

        {/* controls */}
        <div className="absolute bottom-3 right-3 flex gap-2">
          <button
            onClick={() => onSave(card.id)}
            disabled={saving !== null}
            aria-label={`Save ${card.label}`}
            className="w-9 h-9 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center"
          >
            {saving === card.id ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          </button>
          <button onClick={onClose} aria-label="Close story" className="sm:hidden w-9 h-9 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center">
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChessStory({ games: imported }: { games: ImportedGame[] }) {
  const last = useMemo(loadLast, []);
  const [platform, setPlatform] = useState<Platform>(last?.platform ?? 'chesscom');
  const [user, setUser] = useState(last?.user ?? guessPlayer(imported));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [story, setStory] = useState<Story | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [openAt, setOpenAt] = useState<number | null>(null);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  async function generate(e?: React.FormEvent) {
    e?.preventDefault();
    const name = user.trim();
    if (!name) return;
    setLoading(true);
    setError('');
    try {
      const { games, display } = platform === 'chesscom' ? await fetchChessCom(name) : await fetchLichess(name);
      if (games.length === 0) throw new Error(`No standard games found for "${name}" yet.`);
      setStory(buildStory(display, platform, games));
      setOpenAt(0);
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ platform, user: name })); } catch { /* ignore */ }
    } catch (err) {
      setStory(null);
      setError(err instanceof TypeError ? 'Could not reach the site. Check your connection and try again.' : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function save(id: string) {
    const node = refs.current[id];
    if (!node || !story) return;
    setSaving(id);
    try {
      const url = await toPng(node, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement('a');
      a.href = url;
      a.download = `chesslens-${id}-${story.name}.png`;
      a.click();
    } catch (err) {
      console.error('Could not export the card', err);
    } finally {
      setSaving(null);
    }
  }

  const cards = useMemo(() => {
    if (!story) return [];
    const s = story;
    const list: { id: string; label: string; node: React.ReactNode; tilt?: boolean }[] = [];

    // 1. Poster
    list.push({
      id: 'poster', label: 'Summary', tilt: true,
      node: (
        <div className="w-full max-w-[340px] rounded-[28px] p-5 text-white shadow-2xl flex flex-col" style={{ background: GRADS.green, minHeight: 560 }}>
          <div className="flex items-center justify-between text-[11px] text-white/70">
            <span className="flex items-center gap-1.5 font-semibold text-white/90">
              <span className="w-6 h-6 rounded-md bg-white/15 flex items-center justify-center"><ChessIcon size={14} /></span>
              ChessLens
            </span>
            <span>Last {s.count} games</span>
          </div>
          <h3 className="mt-6 text-3xl font-extrabold tracking-tight leading-tight break-words">{s.name}</h3>
          <p className="text-xs text-white/60 mt-0.5">
            {s.platform === 'chesscom' ? 'Chess.com' : 'Lichess'}
            {s.rating != null && ` · ${s.ratingSpeed ? cap(s.ratingSpeed) + ' ' : ''}${s.rating}`}
          </p>
          <div className="mt-4 rounded-2xl bg-white p-3 flex items-center gap-3 shadow-lg" style={{ color: '#111827' }}>
            <Ring value={s.winRate} />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Score rate</p>
              <p className="text-lg font-extrabold leading-tight" style={{ color: '#15803d' }}>{s.record.w}–{s.record.d}–{s.record.l}</p>
              <p className="text-[11px] text-gray-500">wins · draws · losses</p>
            </div>
          </div>
          <ul className="mt-4 flex-1">
            {s.rows.map(({ icon: Icon, title, value }) => (
              <li key={title} className="flex items-center gap-3 py-2.5 border-t border-white/10 first:border-t-0">
                <Icon size={16} className="shrink-0 text-white/70" />
                <span className="text-sm font-semibold shrink-0">{title}</span>
                <span className="ml-auto text-right text-[13px] font-semibold" style={{ color: GOLD }}>{value}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-2xl px-4 py-3" style={{ background: GOLD, color: '#1f2937' }}>
            <p className="text-[11px] opacity-70">What's your chess story?</p>
            <p className="text-lg font-extrabold leading-tight">Analyze. Learn. Improve.</p>
          </div>
        </div>
      ),
    });

    // 2. Opening identity (light story card)
    if (s.identity) {
      const id = s.identity;
      list.push({
        id: 'identity', label: 'Identity',
        node: (
          <div
            className="w-full max-w-[340px] rounded-[28px] p-5 flex flex-col shadow-2xl"
            style={{ background: '#f4f0e8', color: '#111827', minHeight: 560 }}
          >
            <div className="flex items-center justify-between text-[11px] text-gray-500">
              <span className="flex items-center gap-1.5 font-semibold text-gray-800">
                <span className="w-6 h-6 rounded-md bg-gray-900/5 flex items-center justify-center">
                  <ChessIcon size={14} className="text-gray-800" />
                </span>
                ChessLens
              </span>
              <span>{s.name} · {s.count} games</span>
            </div>

            <p className="mt-8 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">
              Your opening identity
            </p>
            <h3 className="mt-2 text-[2rem] font-extrabold tracking-tight leading-[1.15]">
              You&apos;re a{/[aeiou]/i.test(id.main) ? 'n' : ''} {id.main} player.
            </h3>
            <p className="mt-3 text-sm text-gray-500 leading-relaxed">
              {id.n} of your last {s.count} games were in the <span className="font-semibold text-gray-700">{id.main}</span>.
            </p>

            <div className="mt-6 flex flex-col gap-2.5 flex-1">
              <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Most played</p>
                  <p className="text-sm font-bold text-gray-900 leading-tight">{id.main}</p>
                </div>
                <span className="text-lg font-extrabold text-gray-900">{id.share}%</span>
              </div>

              {s.weapon && (
                <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: '#1f6b4f' }}>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/70">Secret weapon</p>
                    <p className="text-sm font-bold text-white leading-tight">{s.weapon.name}</p>
                  </div>
                  <span className="text-lg font-extrabold text-white">{s.weapon.score}%</span>
                </div>
              )}

              {id.retire && (
                <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: '#fde8e8' }}>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-red-400">Time to retire</p>
                    <p className="text-sm font-bold text-red-700 leading-tight">
                      {id.retire.name}{id.retire.side ? `, ${id.retire.side}` : ''}
                    </p>
                  </div>
                  <span className="text-lg font-extrabold text-red-600">{id.retire.score}%</span>
                </div>
              )}
            </div>

            <p className="mt-5 text-[11px] text-gray-400 leading-relaxed">
              Most played is the share of your games. The others are the share of points you scored with that opening.
            </p>
          </div>
        ),
      });
    }

    // 3. Openings
    if (s.white.length > 0 || s.black.length > 0) {
      const maxN = Math.max(...[...s.white, ...s.black].map((o) => o.n));
      list.push({
        id: 'openings', label: 'Openings',
        node: (
          <Shell grad={GRADS.blue} kicker="Your repertoire" story={s} footer="Bars show how often you played it; the percentage is your win rate.">
            <h4 className="text-2xl font-extrabold leading-tight">
              {(s.weapon?.name ?? s.white[0]?.name ?? s.black[0]?.name)}
            </h4>
            {s.weapon && <p className="text-xs text-white/60">Your secret weapon · {s.weapon.score}% score over {s.weapon.n} games</p>}
            {s.white.length > 0 && <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-white/60">As White</p>}
            {s.white.map((o) => <Bar key={`w${o.name}`} label={o.name} value={`${o.win}% · ${o.n}`} fill={(o.n / maxN) * 100} />)}
            {s.black.length > 0 && <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-white/60">As Black</p>}
            {s.black.map((o) => <Bar key={`b${o.name}`} label={o.name} value={`${o.win}% · ${o.n}`} fill={(o.n / maxN) * 100} />)}
          </Shell>
        ),
      });
    }

    // 3. Giant killer
    if (s.giant) {
      const diff = s.giant.myRating != null ? s.giant.oppRating - s.giant.myRating : null;
      list.push({
        id: 'giant-killer', label: 'Giant killer',
        node: (
          <Shell grad={GRADS.amber} kicker="Giant killer" story={s}>
            <p className="text-sm text-white/70">Your biggest upset</p>
            <p className="mt-2 text-6xl font-extrabold tracking-tight" style={{ color: GOLD }}>{s.giant.oppRating}</p>
            <p className="mt-1 text-lg font-bold">beaten: {s.giant.oppName}</p>
            {diff != null && diff > 0 && <p className="mt-3 text-sm text-white/70">That's <b className="text-white">{diff} points</b> above your rating at the time.</p>}
          </Shell>
        ),
      });
    }

    // 4. Nemesis
    if (s.nemesis) {
      list.push({
        id: 'nemesis', label: 'Nemesis',
        node: (
          <Shell grad={GRADS.red} kicker="Your nemesis" story={s}>
            <p className="text-sm text-white/70">The player who beats you most</p>
            <p className="mt-2 text-4xl font-extrabold tracking-tight break-words">{s.nemesis.name}</p>
            <p className="mt-4 text-5xl font-extrabold" style={{ color: GOLD }}>{s.nemesis.w}–{s.nemesis.d}–{s.nemesis.l}</p>
            <p className="text-sm text-white/70">your wins · draws · losses against them ({s.nemesis.games} games)</p>
          </Shell>
        ),
      });
    }

    // 5. Rating journey
    if (s.ratings.length >= 5) {
      const first = s.ratings[0], lastR = s.ratings[s.ratings.length - 1];
      const delta = lastR - first;
      list.push({
        id: 'rating', label: 'Rating',
        node: (
          <Shell grad={GRADS.plum} kicker="Rating journey" story={s} footer={`Peak ${Math.max(...s.ratings)} · Lowest ${Math.min(...s.ratings)}`}>
            <p className="text-6xl font-extrabold tracking-tight">{lastR}</p>
            <p className="text-sm font-semibold" style={{ color: delta >= 0 ? '#86efac' : '#fca5a5' }}>
              {delta >= 0 ? '+' : ''}{delta} over these {s.count} games
            </p>
            <div className="mt-5"><Sparkline values={s.ratings} /></div>
          </Shell>
        ),
      });
    }

    // 6. Winning ways + streak
    if (s.winTotal >= 3) {
      list.push({
        id: 'winning-ways', label: 'Winning ways',
        node: (
          <Shell grad={GRADS.green} kicker="How you win" story={s}>
            <div className="flex items-end gap-3">
              <p className="text-6xl font-extrabold tracking-tight" style={{ color: GOLD }}>{s.winTotal}</p>
              <p className="pb-2 text-sm text-white/70">wins, {s.streak >= 2 ? `best run ${s.streak} in a row` : 'no long streaks yet'}</p>
            </div>
            <div className="mt-4">
              {s.wins.map((w) => <Bar key={w.label} label={w.label} value={`${pct(w.n, s.winTotal)}%`} fill={pct(w.n, s.winTotal)} />)}
            </div>
          </Shell>
        ),
      });
    }

    // 7. When you play
    if (s.times.length > 1) {
      const best = [...s.times].filter((t) => t.n >= 5).sort((a, b) => b.score - a.score)[0];
      list.push({
        id: 'when', label: 'When you play',
        node: (
          <Shell grad={GRADS.blue} kicker="When you play best" story={s} footer="Percentages are your score rate in that part of the day.">
            <h4 className="text-3xl font-extrabold leading-tight">{best ? best.label : 'Not enough data'}</h4>
            <div className="mt-4">
              {s.times.map((t) => <Bar key={t.label} label={t.label} value={`${t.score}%`} sub={`${t.n} games`} fill={t.score} />)}
            </div>
          </Shell>
        ),
      });
    }

    // 8. Formats
    if (s.formats.length > 0) {
      list.push({
        id: 'formats', label: 'Formats',
        node: (
          <Shell grad={GRADS.amber} kicker="Your format" story={s} footer="Bars show how many games you played; the percentage is your score rate.">
            <h4 className="text-4xl font-extrabold leading-tight">{cap(s.formats[0].speed)}</h4>
            <p className="text-sm text-white/70">{pct(s.formats[0].n, s.count)}% of your games</p>
            <div className="mt-4">
              {s.formats.map((f) => <Bar key={f.speed} label={cap(f.speed)} value={`${f.score}% · ${f.n}`} fill={pct(f.n, s.count)} />)}
            </div>
          </Shell>
        ),
      });
    }

    // 9. What to avoid
    if (s.avoid.length > 0) {
      list.push({
        id: 'avoid', label: 'What to avoid',
        node: (
          <Shell grad={GRADS.red} kicker="What to avoid" story={s} footer="Lowest score rates among openings you've played at least 4 times.">
            <h4 className="text-2xl font-extrabold leading-tight">Drop these lines</h4>
            <p className="text-sm text-white/70 mt-1">Openings that cost you points</p>
            <div className="mt-4">
              {s.avoid.map((a) => (
                <Bar
                  key={a.name}
                  label={a.name}
                  value={`${a.score}%`}
                  sub={`${a.n} games${a.side ? ` · ${a.side}` : ''}`}
                  fill={Math.max(8, a.score)}
                />
              ))}
            </div>
          </Shell>
        ),
      });
    }

    // 10. What to learn
    if (s.learn.length > 0) {
      list.push({
        id: 'learn', label: 'What to learn',
        node: (
          <Shell grad={GRADS.plum} kicker="What to study" story={s} footer="High-volume openings with room to improve your score rate.">
            <h4 className="text-2xl font-extrabold leading-tight">Study these next</h4>
            <p className="text-sm text-white/70 mt-1">You play them a lot — make them weapons</p>
            <div className="mt-4">
              {s.learn.map((l) => (
                <Bar
                  key={l.name}
                  label={l.name}
                  value={`${l.score}%`}
                  sub={`${l.n} games · ${l.reason}`}
                  fill={Math.max(8, l.score)}
                />
              ))}
            </div>
          </Shell>
        ),
      });
    }

    // 11. Color performance
    if (s.colorPerf.white.n >= 5 && s.colorPerf.black.n >= 5) {
      const stronger = s.favoriteColor === 'w' ? 'White' : s.favoriteColor === 'b' ? 'Black' : 'Balanced';
      list.push({
        id: 'colors', label: 'Colors',
        node: (
          <Shell grad={GRADS.blue} kicker="White vs Black" story={s}>
            <h4 className="text-3xl font-extrabold leading-tight">{stronger}</h4>
            <p className="text-sm text-white/70 mt-1">
              {s.favoriteColor ? `You score better as ${stronger}` : 'No big color edge yet'}
            </p>
            <div className="mt-5">
              <Bar label="As White" value={`${s.colorPerf.white.score}%`} sub={`${s.colorPerf.white.n} games`} fill={s.colorPerf.white.score} />
              <Bar label="As Black" value={`${s.colorPerf.black.score}%`} sub={`${s.colorPerf.black.n} games`} fill={s.colorPerf.black.score} />
            </div>
          </Shell>
        ),
      });
    }

    // 12. How you lose
    if (s.lossTotal >= 3) {
      list.push({
        id: 'losing-ways', label: 'How you lose',
        node: (
          <Shell grad={GRADS.red} kicker="How you lose" story={s}>
            <div className="flex items-end gap-3">
              <p className="text-6xl font-extrabold tracking-tight" style={{ color: GOLD }}>{s.lossTotal}</p>
              <p className="pb-2 text-sm text-white/70">losses</p>
            </div>
            <div className="mt-4">
              {s.losses.map((w) => <Bar key={w.label} label={w.label} value={`${pct(w.n, s.lossTotal)}%`} fill={pct(w.n, s.lossTotal)} />)}
            </div>
          </Shell>
        ),
      });
    }

    // 13. Best victim
    if (s.bestVictim) {
      list.push({
        id: 'victim', label: 'Best victim',
        node: (
          <Shell grad={GRADS.green} kicker="Your favorite opponent" story={s}>
            <p className="text-sm text-white/70">Most wins against one player</p>
            <p className="mt-2 text-4xl font-extrabold tracking-tight break-words">{s.bestVictim.name}</p>
            <p className="mt-4 text-5xl font-extrabold" style={{ color: GOLD }}>{s.bestVictim.w}–{s.bestVictim.d}–{s.bestVictim.l}</p>
            <p className="text-sm text-white/70">your wins · draws · losses ({s.bestVictim.games} games)</p>
          </Shell>
        ),
      });
    }

    // 14. What opponents open with against you
    if (s.oppWhite.length > 0 || s.oppBlack.length > 0) {
      const topWhite = s.oppWhite[0];
      const topBlack = s.oppBlack[0];
      list.push({
        id: 'opp-openings', label: "Opponents' openings",
        node: (
          <Shell grad={GRADS.blue} kicker="What they play against you" story={s} footer="Share of your games. The second number is your score against it.">
            <h4 className="text-2xl font-extrabold leading-tight">{(topWhite ?? topBlack).name}</h4>
            <p className="text-xs text-white/60">The opening your opponents pick most</p>
            {s.oppWhite.length > 0 && <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-white/60">When they have White</p>}
            {s.oppWhite.slice(0, 3).map((o) => (
              <Bar key={`ow${o.name}`} label={o.name} value={`${o.share}% · you ${o.myScore}%`} sub={`${o.n} of ${s.oppWhiteGames} games`} fill={o.share} />
            ))}
            {s.oppBlack.length > 0 && <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-white/60">When they have Black</p>}
            {s.oppBlack.slice(0, 3).map((o) => (
              <Bar key={`ob${o.name}`} label={o.name} value={`${o.share}% · you ${o.myScore}%`} sub={`${o.n} of ${s.oppBlackGames} games`} fill={o.share} />
            ))}
          </Shell>
        ),
      });
    }

    // 15. What checkmated you
    if (s.mateTotal >= 1 && s.mates.length > 0) {
      const top = s.mates[0];
      list.push({
        id: 'mated-by', label: 'Checkmated by',
        node: (
          <Shell grad={GRADS.red} kicker="What checkmated you" story={s} footer="Pattern names are a best-effort match on the final position.">
            <h4 className="text-3xl font-extrabold leading-tight">{top.label}</h4>
            <p className="text-sm text-white/70 mt-1">{top.n} of your {s.mateTotal} checkmate losses</p>
            <div className="mt-5">
              {s.mates.map((m) => (
                <Bar key={m.label} label={m.label} value={`${pct(m.n, s.mateTotal)}% · ${m.n}`} fill={pct(m.n, s.mateTotal)} />
              ))}
            </div>
          </Shell>
        ),
      });
    }

    // 16-20. Opponent weaknesses by rating band
    s.bands.forEach((b, i) => {
      list.push({
        id: `band-${b.lo}`, label: `${b.label} weaknesses`,
        node: (
          <Shell
            grad={[GRADS.plum, GRADS.amber, GRADS.green, GRADS.blue, GRADS.red][i % 5]}
            kicker={b.isYours ? 'Opponents · your level' : 'Opponents · by rating'}
            story={s}
            footer={b.n > 0 ? `Your record against ${b.label} rated opponents in this sample.` : 'No games against this rating range in this sample.'}
          >
            <h4 className="text-4xl font-extrabold leading-tight">{b.label}</h4>
            <p className="text-sm text-white/70">{b.isYours ? 'Players at your own level' : 'Typical weak spots at this rating'}</p>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-white/60">Their weaknesses</p>
            <ul className="mt-1 space-y-1.5">
              {b.weaknesses.map((w) => (
                <li key={w} className="flex gap-2 text-sm leading-snug"><span style={{ color: GOLD }}>•</span><span>{w}</span></li>
              ))}
            </ul>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-white/60">How to exploit it</p>
            <p className="mt-1 text-sm font-semibold leading-snug" style={{ color: GOLD }}>{b.exploit}</p>
            {b.n > 0 && (
              <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Your results vs {b.label}</p>
                <p className="text-2xl font-extrabold" style={{ color: GOLD }}>{b.score}% <span className="text-xs font-semibold text-white/60">score · {b.n} games</span></p>
                {b.winWays.length > 0 && (
                  <p className="text-[11px] text-white/60 mt-0.5">You win by {b.winWays.map((w) => `${w.label.toLowerCase()} ${w.pct}%`).join(' · ')}</p>
                )}
              </div>
            )}
          </Shell>
        ),
      });
    });

    return list;
  }, [story]);

  async function saveAll() {
    for (const c of cards) {
      await save(c.id);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return (
    <section className="mb-10 w-full" aria-labelledby="story-heading">
      <div className="mb-5">
        <h2 id="story-heading" className="text-xl font-bold">Your chess, as a story</h2>
        <p className="text-sm text-ink-400 mt-0.5">
          Enter any Chess.com or Lichess username to get a full-screen story from up to 1000 recent games: openings, what checkmated you, what opponents play, their weaknesses by rating and more.
        </p>
      </div>

      <form onSubmit={generate} className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex gap-1 p-1 rounded-lg bg-ink-800/70 text-sm">
          {(['chesscom', 'lichess'] as const).map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => setPlatform(p)}
              className={`px-3 py-1.5 rounded-md transition-colors ${platform === p ? 'bg-ink-600 text-white' : 'text-ink-400 hover:text-ink-200'}`}
            >
              {p === 'chesscom' ? 'Chess.com' : 'Lichess'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-lg bg-ink-800 border border-ink-700 text-ink-100 text-sm pl-8 pr-3 py-2 placeholder:text-ink-500"
          />
        </div>
        <button type="submit" disabled={loading || !user.trim()} className="btn-primary text-sm">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Tell my chess story
        </button>
        {cards.length > 1 && (
          <button type="button" onClick={saveAll} disabled={saving !== null} className="btn-secondary text-sm">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Save all ({cards.length})
          </button>
        )}
      </form>
      {error && <p className="text-sm text-red-300 mb-2" role="alert">{error}</p>}
      {loading && <p className="text-sm text-ink-400 mb-2">Fetching recent games…</p>}

      {cards.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button type="button" onClick={() => setOpenAt(0)} className="btn-primary text-sm">
              <Play size={14} /> Play story
            </button>
            <span className="text-xs text-ink-400">{cards.length} cards · tap right/left or use the arrow keys · hold to pause</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cards.map((c, i) => (
              <button key={c.id} type="button" onClick={() => setOpenAt(i)}
                className="chip bg-ink-800 text-ink-300 hover:text-ink-100 border border-ink-700">
                {i + 1}. {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {openAt !== null && cards.length > 0 && (
        <StoryViewer
          cards={cards}
          index={Math.min(openAt, cards.length - 1)}
          setIndex={setOpenAt}
          onClose={() => setOpenAt(null)}
          onSave={save}
          saving={saving}
        />
      )}

      {/* Off-screen copies at the exact story size, used only for PNG export */}
      <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
        {cards.map((c) => (
          <div
            key={c.id}
            ref={(el) => { refs.current[c.id] = el; }}
            className="[&>div]:w-full [&>div]:h-full [&>div]:max-w-none"
            style={{ width: CARD_W, height: CARD_H }}
          >
            {c.node}
          </div>
        ))}
      </div>
    </section>
  );
}