/**
 * twist-bots.ts
 * "Chess, but…" bots: Stockfish with one twist each (it always plays its 2nd best move, it must give check when it can,
 * it gets weaker every time you check it...). Every choice is made from Stockfish's own ranking of the moves.
 * Pure logic + engine calls; no React.
 */
import { Chess } from 'chess.js';
import { analyzeLines, analyzePosition, playMove, type EngineLine } from './engine';

export type BotId =
  | 'collector' | 'butterfingers' | 'coinflip' | 'jekyll' | 'nervous' | 'marathon' | 'student' | 'peacemaker'
  | 'runnerup' | 'slowburn' | 'mirror' | 'zebra' | 'queenhunter' | 'checkaddict' | 'paranoid';

export interface BotInfo {
  id: BotId;
  name: string;
  /** One line: the twist. */
  twist: string;
  group: 'strength' | 'choice' | 'habit';
  /** Starting rating shown on the card ('?' when it depends on the twist). */
  rating: string;
}

export const BOTS: BotInfo[] = [
  { id: 'nervous', name: 'Nervous Wreck', group: 'strength', rating: '3600', twist: 'Starts at 3600 and loses 300 Elo every time you check it.' },
  { id: 'marathon', name: 'Marathon Runner', group: 'strength', rating: '3600', twist: 'Starts at 3600 and loses 50 Elo with every move it makes.' },
  { id: 'student', name: 'The Student', group: 'strength', rating: '250', twist: "Starts at 250 and gains 200 Elo every time you don't play the best move." },
  { id: 'jekyll', name: 'Jekyll & Hyde', group: 'strength', rating: '3600', twist: 'Switches between full strength and a 250-rated beginner every time it captures.' },
  { id: 'slowburn', name: 'Slow Burner', group: 'strength', rating: '?', twist: 'Gets stronger while you think: 720 Elo per second you spend, full strength after 5 seconds.' },
  { id: 'butterfingers', name: 'Butterfingers', group: 'strength', rating: '3600', twist: 'Full strength, but a 5% chance of a terrible blunder on every move.' },
  { id: 'runnerup', name: 'Runner-up', group: 'choice', rating: '?', twist: 'Always plays its second-best move.' },
  { id: 'coinflip', name: 'Coin Flipper', group: 'choice', rating: '?', twist: 'Best move half the time, 2nd best a quarter of the time, 3rd best an eighth… ' },
  { id: 'mirror', name: 'The Mirror', group: 'choice', rating: '?', twist: 'If your last move was your nth best, it plays its nth best.' },
  { id: 'peacemaker', name: 'The Peacemaker', group: 'choice', rating: '?', twist: 'Plays the move that keeps the evaluation closest to 0.00.' },
  { id: 'zebra', name: 'Zebra', group: 'habit', rating: '?', twist: 'Alternates: one move onto a light square, the next onto a dark square.' },
  { id: 'checkaddict', name: 'Check Addict', group: 'habit', rating: '?', twist: 'If it can give check, it must.' },
  { id: 'queenhunter', name: 'Queen Hunter', group: 'habit', rating: '?', twist: 'Goes after your queen before it tries to checkmate you.' },
  { id: 'collector', name: 'The Collector', group: 'habit', rating: '?', twist: 'Wants every one of your pieces before it checkmates you.' },
  { id: 'paranoid', name: 'Paranoid', group: 'habit', rating: '?', twist: 'Thinks every one of your pawns is a queen.' },
];
export const botById = (id: string) => BOTS.find((b) => b.id === id) ?? BOTS[0];

/** What the bot remembers between moves. */
export interface BotMemory {
  /** Jekyll & Hyde: true = the beginner is playing. */
  hyde?: boolean;
  /** Zebra: the colour of the square its next move must land on. */
  nextLight?: boolean;
  /** Counters for the rating bots. */
  checks?: number;
  moves?: number;
  misses?: number;
}

/** What happened on your last move (the component works it out). */
export interface UserInfo {
  /** Your last move gave check. */
  gaveCheck: boolean;
  /** Rank of your last move in the engine's list (1 = best), when known. */
  rank: number | null;
  /** How long you thought about it (ms). */
  thinkMs: number;
}

export interface BotChoice {
  uci: string;
  memory: BotMemory;
  /** A short line about what the bot just did ("Played its 3rd best move."). */
  note: string;
}

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const toUci = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? '');
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** Score of an engine line for `side`, in centipawns (mates are huge, quicker mates bigger). */
export function lineScore(l: Pick<EngineLine, 'evaluation' | 'mate'>, side: 'w' | 'b'): number {
  const s = side === 'w' ? 1 : -1;
  if (l.mate != null) return s * Math.sign(l.mate) * (100000 - Math.abs(l.mate) * 100);
  return s * Math.round((l.evaluation ?? 0) * 100);
}

const legalCount = (fen: string) => { try { return new Chess(fen).moves().length; } catch { return 0; } };

/** All legal moves ranked by the engine (best first). */
export async function rankAll(fen: string, depth = 9): Promise<EngineLine[]> {
  return analyzeLines(fen, depth, Math.max(3, legalCount(fen)));
}

/** A move at roughly `elo`. Below Stockfish's lowest setting (1320) it mixes in random moves, more of them the lower it goes. */
export async function eloMove(fen: string, elo: number, rnd: () => number = Math.random): Promise<string | null> {
  if (elo >= 1320) return playMove(fen, Math.min(3600, elo));
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  const pRandom = Math.min(0.9, (1320 - Math.max(0, elo)) / 1320 + 0.05);
  if (rnd() < pRandom) {
    // a beginner grabs material when it is right there, otherwise anything goes
    const caps = moves.filter((m) => m.captured);
    const pool = caps.length && rnd() < 0.45 ? caps : moves;
    return toUci(pool[Math.floor(rnd() * pool.length)]);
  }
  return playMove(fen, 1320);
}

const bestMove = async (fen: string) => (await analyzePosition(fen, 14)).bestMove;

function sanOf(fen: string, uci: string): string {
  try { return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; } catch { return uci; }
}
const isLight = (sq: string) => ('abcdefgh'.indexOf(sq[0]) + Number(sq[1]) - 1) % 2 === 1;

/** The bot's move. */
export async function botMove(id: BotId, fen: string, mem: BotMemory, user: UserInfo, rnd: () => number = Math.random): Promise<BotChoice | null> {
  const chess = new Chess(fen);
  const me = chess.turn();
  const legal = chess.moves({ verbose: true });
  if (!legal.length) return null;
  const done = (uci: string | null, memory: BotMemory, note: string): BotChoice | null => (uci ? { uci, memory, note } : null);

  switch (id) {
    case 'nervous': {
      const checks = (mem.checks ?? 0) + (user.gaveCheck ? 1 : 0);
      const elo = Math.max(100, 3600 - 300 * checks);
      return done(await eloMove(fen, elo, rnd), { ...mem, checks }, `Playing at ${elo} Elo${user.gaveCheck ? ' (your check cost it 300)' : ''}.`);
    }
    case 'marathon': {
      const moves = (mem.moves ?? 0) + 1;
      const elo = Math.max(100, 3600 - 50 * (moves - 1));
      return done(await eloMove(fen, elo, rnd), { ...mem, moves }, `Playing at ${elo} Elo, and 50 lower next move.`);
    }
    case 'student': {
      const missed = user.rank != null && user.rank > 1;
      const misses = (mem.misses ?? 0) + (missed ? 1 : 0);
      const elo = Math.min(3600, 250 + 200 * misses);
      return done(await eloMove(fen, elo, rnd), { ...mem, misses }, missed ? `You missed the best move: it learns, now ${elo} Elo.` : user.rank === 1 ? `You found the best move: it stays at ${elo} Elo.` : `Playing at ${elo} Elo.`);
    }
    case 'slowburn': {
      const elo = Math.min(3600, Math.round((user.thinkMs / 1000) * 720));
      return done(await eloMove(fen, elo, rnd), mem, `You thought for ${(user.thinkMs / 1000).toFixed(1)} s, so it plays at ${elo} Elo.`);
    }
    case 'jekyll': {
      const hyde = !!mem.hyde;
      const uci = hyde ? await eloMove(fen, 250, rnd) : await bestMove(fen);
      if (!uci) return null;
      const captured = legal.find((m) => toUci(m) === uci || toUci(m) === uci.slice(0, 4) + (m.promotion ?? ''))?.captured;
      const next = captured ? !hyde : hyde;
      return done(uci, { ...mem, hyde: next }, `${hyde ? 'The 250-rated beginner' : 'Full-strength Stockfish'} played this.${captured ? ` It captured, so ${next ? 'the beginner' : 'Stockfish'} takes over.` : ''}`);
    }
    case 'butterfingers': {
      if (rnd() < 0.05) {
        const lines = await rankAll(fen, 8);
        const worst = lines[lines.length - 1];
        return done(worst?.uci ?? null, mem, 'Butterfingers! It dropped the ball and played its worst move.');
      }
      return done(await playMove(fen, 3600), mem, 'Full strength this move.');
    }
    case 'runnerup': {
      const lines = await analyzeLines(fen, 13, 3);
      const pick = lines[1] ?? lines[0];
      return done(pick?.uci ?? null, mem, lines.length > 1 ? `Its best was ${sanOf(fen, lines[0].uci)}; it played the 2nd best.` : 'Only one move, so it had to play it.');
    }
    case 'coinflip': {
      const lines = await analyzeLines(fen, 12, 8);
      let n = 0;
      while (n < lines.length - 1 && rnd() >= 0.5) n++;
      return done(lines[n]?.uci ?? null, mem, `The coin said: its ${ordinal(n + 1)} best move.`);
    }
    case 'mirror': {
      const n = Math.max(1, user.rank ?? 1);
      const lines = await analyzeLines(fen, 12, Math.min(n, Math.max(3, legal.length)));
      const pick = lines[Math.min(n, lines.length) - 1];
      return done(pick?.uci ?? null, mem, user.rank ? `Your move was your ${ordinal(user.rank)} best, so it played its ${ordinal(Math.min(n, lines.length))} best.` : 'It plays its best until it can copy you.');
    }
    case 'peacemaker': {
      const lines = await rankAll(fen, 9);
      const pick = [...lines].sort((a, b) => Math.abs(lineScore(a, me)) - Math.abs(lineScore(b, me)))[0];
      const ev = pick ? (pick.mate != null ? `mate in ${Math.abs(pick.mate)}` : (pick.evaluation ?? 0).toFixed(2)) : '';
      return done(pick?.uci ?? null, mem, `It kept the evaluation as close to 0.00 as it could (${ev}).`);
    }
    case 'zebra': {
      const wantLight = mem.nextLight ?? true;
      const lines = await rankAll(fen, 9);
      const fit = lines.filter((l) => isLight(l.uci.slice(2, 4)) === wantLight);
      const pick = fit[0] ?? lines[0];
      return done(pick?.uci ?? null, { ...mem, nextLight: !wantLight }, fit.length ? `This move had to land on a ${wantLight ? 'light' : 'dark'} square. Next: ${wantLight ? 'dark' : 'light'}.` : `No move landed on a ${wantLight ? 'light' : 'dark'} square, so it played freely.`);
    }
    case 'checkaddict': {
      const checks = legal.filter((m) => m.san.includes('+') || m.san.includes('#'));
      if (!checks.length) return done(await bestMove(fen), mem, 'No check available, so it played normally.');
      if (checks.length === 1) return done(toUci(checks[0]), mem, 'It could give check, so it had to.');
      const lines = await rankAll(fen, 9);
      const set = new Set(checks.map(toUci));
      const pick = lines.find((l) => set.has(l.uci)) ?? { uci: toUci(checks[0]) };
      return done(pick.uci, mem, `It had ${checks.length} checks to choose from and played the best one.`);
    }
    case 'queenhunter': {
      const opp = me === 'w' ? 'b' : 'w';
      const hasQueen = chess.board().some((r) => r.some((p) => p && p.type === 'q' && p.color === opp));
      if (!hasQueen) return done(await bestMove(fen), mem, 'Your queen is gone, so now it goes for the king.');
      const takeQueen = legal.filter((m) => m.captured === 'q');
      if (takeQueen.length) {
        const lines = await analyzeLines(fen, 10, Math.max(3, legal.length));
        const set = new Set(takeQueen.map(toUci));
        const pick = lines.find((l) => set.has(l.uci)) ?? { uci: toUci(takeQueen[0]) };
        return done(pick.uci, mem, 'It grabbed your queen. Now the real game starts.');
      }
      const lines = await analyzeLines(fen, 11, 10);
      const pick = lines.find((l) => !sanOf(fen, l.uci).includes('#')) ?? lines[0];
      return done(pick?.uci ?? null, mem, 'Your queen is still on the board, so it will not checkmate you yet.');
    }
    case 'collector': {
      const opp = me === 'w' ? 'b' : 'w';
      const left = chess.board().flat().filter((p) => p && p.color === opp && p.type !== 'k').length;
      if (left === 0) return done(await bestMove(fen), mem, 'It has collected everything. Now it goes for mate.');
      const lines = await analyzeLines(fen, 10, 12);
      const ok = lines.filter((l) => !sanOf(fen, l.uci).includes('#'));
      const best = ok[0] ?? lines[0];
      if (!best) return null;
      const top = lineScore(best, me);
      // prefer a capture when it costs little
      const caps = ok
        .map((l) => ({ l, cap: legal.find((m) => toUci(m) === l.uci)?.captured }))
        .filter((x) => x.cap && top - lineScore(x.l, me) <= 150)
        .sort((a, b) => VAL[b.cap!] - VAL[a.cap!]);
      const pick = caps[0]?.l ?? best;
      return done(pick.uci, mem, `You still have ${left} piece${left === 1 ? '' : 's'} besides your king, so no checkmate yet.`);
    }
    case 'paranoid': {
      // Same position, but every one of your pawns is a queen in its mind.
      const opp = me === 'w' ? 'b' : 'w';
      const parts = fen.split(' ');
      const pawn = opp === 'w' ? 'P' : 'p', queen = opp === 'w' ? 'Q' : 'q';
      const scary = [parts[0].split(pawn).join(queen), parts[1], '-', '-', '0', '1'].join(' ');
      const real = new Set(legal.map(toUci));
      try {
        const lines = await rankAll(scary, 8);
        const pick = lines.find((l) => real.has(l.uci));
        if (pick) return done(pick.uci, mem, 'It sees queens where your pawns are, and plays to stay safe from them.');
      } catch { /* fall through */ }
      return done(await bestMove(fen), mem, 'Even in its nightmare it had no safe move, so it played normally.');
    }
  }
}
