/**
 * coach-story.ts
 * The STORY of a game, and which moves deserve a comment.
 *
 * A good coach does not talk over every move. They say how the game went in a few sentences, stop at the handful of
 * moments that decided it, and finish with what lost (or won) the game and the one thing to work on.
 *
 * This file works that out from the analysis that already exists (no engine calls):
 *   - the win-chance curve, cut into chapters ("level", "you were better", "lost"),
 *   - the POINT OF NO RETURN: the last move after which the loser never got back into the game,
 *   - where the trouble STARTED (often much earlier than the move that finally lost),
 *   - the biggest chance that was thrown away,
 *   - and the short list of moves worth stopping at.
 * Every sentence is built from the engine's evaluations and from mistakeGist() (facts checked on the board).
 */
import type { AnalyzedMove } from './types';
import { Chess } from 'chess.js';
import { evalToWinChance } from './engine';
import { mistakeGist, type ExplainInput } from './coach-explain';

export type Side = 'w' | 'b';

/** Why a move is worth stopping at. */
export type MomentRole =
  | 'decisive'     // the point of no return for the side that lost
  | 'slip'         // where that side's trouble started
  | 'thrown-away'  // a winning position let go
  | 'error'        // any other costly mistake
  | 'gift'         // the opponent's mistake that handed the student the game
  | 'strong';      // a brilliant / great move

export interface GameStory {
  /** Whose story this is: the student, else the side that lost, else White. */
  focus: Side;
  /** Did the caller tell us who the student is? (false = talk about "White" / "Black") */
  personal: boolean;
  outcome: 'won' | 'lost' | 'draw' | 'unknown';
  /** move index -> why it is a key moment. */
  picks: Map<number, MomentRole>;
  decisive: AnalyzedMove | null;
  slip: AnalyzedMove | null;
  thrownAway: AnalyzedMove | null;
  /** The opponent's mistake that turned the game (when the focus side won). */
  gift: AnalyzedMove | null;
  /** "How the game went", two to four sentences. */
  overview: string;
  /** Winning chances each move gave away (0-100 points), after the consistency repair of winCurve(). */
  loss: number[];
  curve: Curve;
}

const BAD = ['inaccuracy', 'mistake', 'miss', 'blunder'];
const other = (s: Side): Side => (s === 'w' ? 'b' : 'w');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** White's winning chances (0-100) in an evaluation, or null. */
const wcWhite = (ev: AnalyzedMove['evalAfter']): number | null => {
  if (!ev) return null;
  try {
    const w = evalToWinChance(ev);
    return Number.isFinite(w) ? w : null;
  } catch { return null; }
};

export const moveLabel = (m: AnalyzedMove) => `${Math.floor(m.index / 2) + 1}${m.color === 'w' ? '.' : '...'} ${m.san}`;
const moveNo = (m: AnalyzedMove) => Math.floor(m.index / 2) + 1;

export const explainInputOf = (m: AnalyzedMove, depth = 12): ExplainInput => ({
  fenBefore: m.fenBefore, fenAfter: m.fenAfter, san: m.san, color: m.color, quality: m.quality,
  isPlayedBest: m.isBestMove, bestUci: m.evalBefore?.bestMove ?? null, evalBefore: m.evalBefore, evalAfter: m.evalAfter,
  depth, sequence: 'forcing', terse: true,
});

/**
 * The win-chance curve of the game, made CONSISTENT before any story is told from it.
 *
 * Each position was searched on its own, so two neighbouring evaluations can disagree: the engine calls a move best at
 * +1.6 and, one move later (seeing one ply deeper), finds that the same move walks into mate. Read naively, that blames
 * the wrong move ("15...Nxd7 lost the game") when the position was already lost and every move lost.
 * Going backwards from the end of the game:
 *   - a move that IS the engine's choice cannot have cost anything: the position before it was worth what came after it;
 *   - no move can gain winning chances for the side that plays it: if it seems to, the earlier number was too low.
 */
export interface Curve {
  /** White's winning chances before / after each move (0-100), null when the position was not evaluated. */
  before: (number | null)[];
  after: (number | null)[];
  /** Winning chances the mover gave away with each move (0-100 points). */
  loss: number[];
}

export function winCurve(moves: AnalyzedMove[]): Curve {
  const n = moves.length;
  const before: (number | null)[] = new Array(n).fill(null);
  const after: (number | null)[] = new Array(n).fill(null);
  const loss: number[] = new Array(n).fill(0);
  let next: number | null = null; // repaired value of the position after move i
  for (let i = n - 1; i >= 0; i--) {
    const m = moves[i];
    const a: number | null = next ?? wcWhite(m.evalAfter);
    let b: number | null = wcWhite(m.evalBefore);
    if (a != null && b != null) {
      const sign = m.color === 'w' ? 1 : -1;
      if (m.isBestMove || sign * (b - a) < 0) b = a;
      loss[i] = Math.max(0, sign * (b - a));
    } else if (b == null) b = a;
    before[i] = b; after[i] = a;
    next = b;
  }
  return { before, after, loss };
}

const forSide = (w: number | null, side: Side) => (w == null ? null : side === 'w' ? w : 100 - w);

type Band = 'winning' | 'better' | 'level' | 'worse' | 'losing';
const bandOf = (w: number): Band => (w >= 78 ? 'winning' : w >= 62 ? 'better' : w > 38 ? 'level' : w > 22 ? 'worse' : 'losing');
const RANK: Record<Band, number> = { losing: 0, worse: 1, level: 2, better: 3, winning: 4 };

/** The side's last move that took it from "still in the game" to "lost" for good. */
function pointOfNoReturn(moves: AnalyzedMove[], cv: Curve, side: Side): AnalyzedMove | null {
  const end = forSide(cv.after[moves.length - 1] ?? null, side);
  if (end == null || end >= 35) return null;
  for (let i = moves.length - 1; i >= 0; i--) {
    const m = moves[i];
    if (m.color !== side) continue;
    const b = forSide(cv.before[i], side), a = forSide(cv.after[i], side);
    if (b != null && a != null && b >= 35 && a < 35 && cv.loss[i] >= 5) return m;
  }
  return null;
}

/** The side's first costly move from an acceptable position (where the trouble started). */
function firstSlip(moves: AnalyzedMove[], cv: Curve, side: Side): AnalyzedMove | null {
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.color !== side || m.quality === 'book') continue;
    const b = forSide(cv.before[i], side), a = forSide(cv.after[i], side);
    if (b != null && a != null && b >= 45 && a < 45 && cv.loss[i] >= 7) return m;
  }
  return null;
}

/** The biggest winning position the side let go. */
function biggestThrownAway(moves: AnalyzedMove[], cv: Curve, side: Side, skip: (number | undefined)[] = []): AnalyzedMove | null {
  let best: AnalyzedMove | null = null;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.color !== side || skip.includes(m.index)) continue;
    const b = forSide(cv.before[i], side), a = forSide(cv.after[i], side);
    if (b == null || a == null || b < 70 || a >= 58) continue;
    if (!best || cv.loss[i] > cv.loss[best.index - moves[0].index]) best = m;
  }
  return best;
}

interface Segment { band: Band; from: number; to: number }

/** The win-chance curve (focus side's view) cut into chapters; blips shorter than three plies are folded into their neighbours. */
function chapters(cv: Curve, focus: Side): Segment[] {
  const bands: (Band | null)[] = cv.after.map((x) => { const w = forSide(x, focus); return w == null ? null : bandOf(w); });
  const segs: Segment[] = [];
  bands.forEach((b, i) => {
    if (!b) return;
    const last = segs[segs.length - 1];
    if (last && last.band === b) last.to = i;
    else segs.push({ band: b, from: i, to: i });
  });
  // fold short blips (but never the final stretch: how the game ENDS always counts)
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i].to - segs[i].from + 1 >= 3 || segs.length <= 1) continue;
    if (i > 0) { segs[i - 1].to = segs[i].to; segs.splice(i, 1); i -= 1; }
    else { segs[1].from = segs[0].from; segs.splice(0, 1); i -= 1; }
  }
  // merge neighbours that ended up with the same band
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].band === segs[i - 1].band) { segs[i - 1].to = segs[i].to; segs.splice(i, 1); i -= 1; }
  }
  return segs;
}

export interface StoryNames {
  /** "you" / "White": subject of a sentence about `side`. */
  who: (side: Side) => string;
  /** "your" / "White's". */
  whose: (side: Side) => string;
}

export const storyNames = (you: Side | null): StoryNames => ({
  who: (s) => (you === null ? (s === 'w' ? 'White' : 'Black') : s === you ? 'you' : 'your opponent'),
  whose: (s) => (you === null ? (s === 'w' ? "White's" : "Black's") : s === you ? 'your' : "your opponent's"),
});

const STANDING: Record<Band, (me: string, be: string) => string> = {
  winning: (me, be) => `${me} ${be} winning`,
  better: (me, be) => `${me} ${be} better`,
  level: () => 'the game was level',
  worse: (me, be) => `${me} ${be} worse`,
  losing: (me, be) => `${me} ${be} losing`,
};

/** What a mistake did, in a few words ("lost a knight"), or null when nothing concrete can be proven on the board. */
export function gistOf(m: AnalyzedMove): string | null {
  // The engine's own choice is never "the mistake", whatever the first-pass label says (see winCurve).
  if (!BAD.includes(m.quality) || m.isBestMove) return null;
  return mistakeGist(explainInputOf(m));
}

/** The engine's move in the position before `m` ("Qc7"), or null. */
export function bestSanOf(m: AnalyzedMove): string | null {
  const u = m.evalBefore?.bestMove;
  if (!u || u.length < 4 || m.isBestMove) return null;
  try { return new Chess(m.fenBefore).move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined }).san; } catch { return null; }
}

/** "you lost a knight with **Nd5**", or "**Nd5** cost you ground" when there is no single thing to point at. */
function told(m: AnalyzedMove, names: StoryNames): string {
  const g = gistOf(m);
  const who = names.who(m.color);
  return g ? `${who} ${g} (**${m.san}**)` : `**${m.san}** cost ${who === 'you' ? 'you' : who} ground`;
}

/**
 * Works out the story of the game.
 * `you` = the student's side (null = unknown: both sides are treated alike); `winner` from the game result when known.
 * `maxMoments` caps how many moves get a comment.
 */
export function buildStory(moves: AnalyzedMove[], you: Side | null, winner: Side | 'draw' | null, maxMoments = 6): GameStory {
  const names = storyNames(you);
  const last = moves[moves.length - 1];
  // Who lost? The result when we have it; otherwise whoever is clearly lost in the final position.
  let loser: Side | null = winner === 'w' ? 'b' : winner === 'b' ? 'w' : null;
  if (!loser && winner !== 'draw' && last) {
    const w = wcWhite(last.evalAfter);
    if (w != null && (w >= 80 || w <= 20)) loser = w >= 80 ? 'b' : 'w';
  }
  const focus: Side = you ?? loser ?? 'w';
  const outcome: GameStory['outcome'] = winner === 'draw' ? 'draw' : !loser ? 'unknown' : loser === focus ? 'lost' : 'won';

  const cv = winCurve(moves);
  const decisive = loser ? pointOfNoReturn(moves, cv, loser) : null;
  const slipRaw = loser ? firstSlip(moves, cv, loser) : null;
  const slip = slipRaw && decisive && slipRaw.index < decisive.index ? slipRaw : null;
  const taken = [decisive?.index, slip?.index];
  const thrownAway = biggestThrownAway(moves, cv, focus, taken) ?? (you === null && loser ? biggestThrownAway(moves, cv, other(focus), taken) : null);
  const gift = outcome === 'won' ? decisive : null;

  // ---- which moves get a comment
  const picks = new Map<number, MomentRole>();
  const isMine = (m: AnalyzedMove) => you === null || m.color === you;
  if (decisive) picks.set(decisive.index, isMine(decisive) ? 'decisive' : 'gift');
  if (slip && isMine(slip)) picks.set(slip.index, 'slip');
  if (thrownAway && isMine(thrownAway)) picks.set(thrownAway.index, 'thrown-away');
  for (const m of moves) if (isMine(m) && (m.quality === 'brilliant' || m.quality === 'great')) picks.set(m.index, 'strong');
  // Too many brilliancies to stop at each one: keep the first three.
  const strong = [...picks.entries()].filter(([, r]) => r === 'strong').map(([i]) => i);
  for (const i of strong.slice(3)) picks.delete(i);
  // the other costly mistakes, biggest first, until the review is full
  const errors = moves
    .filter((m, i) => {
      if (!isMine(m) || picks.has(m.index) || !BAD.includes(m.quality) || m.isBestMove || cv.loss[i] < 8) return false;
      // Not when the game was already lost before the move, nor when it stays completely won after it: those change nothing.
      const b = forSide(cv.before[i], m.color), a = forSide(cv.after[i], m.color);
      return b != null && a != null && b > 22 && a < 85;
    })
    .sort((a, b) => cv.loss[b.index - moves[0].index] - cv.loss[a.index - moves[0].index]);
  for (const m of errors) {
    if ([...picks.values()].filter((r) => r !== 'strong').length >= maxMoments) break;
    picks.set(m.index, 'error');
  }
  // The opponent's big mistakes when the student did NOT pounce are covered by the student's own "miss" on the next move.
  // The ones the student punished get a short word, biggest two only.
  if (you !== null) {
    const gifts = moves
      .filter((m, i) => m.color !== you && !picks.has(m.index) && !m.isBestMove && (m.quality === 'blunder' || m.quality === 'mistake')
        && cv.loss[i] >= 16 && !!moves[i + 1] && !BAD.includes(moves[i + 1].quality))
      .sort((a, b) => cv.loss[b.index - moves[0].index] - cv.loss[a.index - moves[0].index])
      .slice(0, 2);
    for (const m of gifts) picks.set(m.index, 'gift');
  }

  // ---- how the game went
  const be = you === null ? 'was' : 'were';
  const me = names.who(focus);
  const segs = chapters(cv, focus);
  const parts: string[] = [];
  if (segs.length) {
    const first = segs[0];
    const outOfBook = moves.findIndex((m) => m.quality !== 'book');
    parts.push(first.band === 'level'
      ? (outOfBook > 2 ? 'The opening was level.' : 'The game started level.')
      : `${cap(STANDING[first.band](me, be))} from early on.`);
    // each real change of chapter, with the move that caused it
    const shifts = segs.slice(1).map((s, k) => ({ s, prev: segs[k] }));
    const kept = shifts.length > 4
      ? [...shifts].sort((a, b) => Math.abs(RANK[b.s.band] - RANK[b.prev.band]) - Math.abs(RANK[a.s.band] - RANK[a.prev.band])).slice(0, 4).sort((a, b) => a.s.from - b.s.from)
      : shifts;
    for (const { s, prev } of kept) {
      const up = RANK[s.band] > RANK[prev.band];
      // the move that caused the shift: the costliest move by the side that lost ground, just before the new chapter
      const blamed: Side = up ? other(focus) : focus;
      let trig: AnalyzedMove | null = null;
      let trigLoss = 4;
      for (let i = Math.max(0, s.from - 3); i <= s.from; i++) {
        if (moves[i].color === blamed && !moves[i].isBestMove && cv.loss[i] > trigLoss) { trig = moves[i]; trigLoss = cv.loss[i]; }
      }
      const now = STANDING[s.band](me, be);
      parts.push(trig ? `On move ${moveNo(trig)}, ${told(trig, names)}, and ${now}.` : `By move ${moveNo(moves[s.from])} ${now}.`);
    }
  }
  const overview = parts.join(' ');
  return { focus, personal: you !== null, outcome, picks, decisive, slip, thrownAway, gift, overview, loss: cv.loss, curve: cv };
}

/** "Why you lost" / "How you won": the closing verdict on the game, in the order a coach tells it. */
export function verdictText(story: GameStory, you: Side | null, moves: AnalyzedMove[]): string {
  const names = storyNames(you);
  const me = names.who(story.focus);
  const be = you === null ? 'was' : 'were';
  const parts: string[] = [];
  const d = story.decisive;
  const i0 = moves[0]?.index ?? 0;
  /** " (about 60% winning chances)" for `side` before move m. */
  const chance = (m: AnalyzedMove, side: Side) => forSide(story.curve.before[m.index - i0] ?? null, side);
  const odds = (m: AnalyzedMove, side: Side) => {
    const w = chance(m, side);
    return w == null ? '' : ` (about ${Math.min(99, Math.round(w))}% winning chances)`;
  };
  /** "you were winning" / "you were still in the game", from the chances before move m. */
  const stood = (m: AnalyzedMove) => {
    const w = chance(m, m.color) ?? 50;
    return w > 38 && w < 62 ? 'the game was level' : `${me} ${be} ${w >= 78 ? 'winning' : w >= 62 ? 'better' : 'still in the game'}`;
  };
  const did = (m: AnalyzedMove) => { const g = gistOf(m); return g ? `${names.who(m.color)} ${g}` : `it gave away about ${Math.round(story.loss[m.index - i0] ?? 0)}% winning chances`; };
  if (story.outcome === 'lost' || (story.outcome === 'unknown' && d && d.color === story.focus)) {
    if (d) {
      parts.push(`The game was decided on move ${moveNo(d)}. Before **${moveLabel(d)}** ${stood(d)}${odds(d, d.color)}. With that move ${did(d)}, and there was no way back.${bestSanOf(d) ? ` The move to play was **${bestSanOf(d)}**.` : ''}`);
    } else {
      parts.push('There is no single losing move in this game: the position went downhill a little at a time.');
    }
    if (story.slip) parts.push(`But the trouble started earlier, with **${moveLabel(story.slip)}**: ${did(story.slip)}. That is the move to remember, because it made everything after it harder.`);
    if (story.thrownAway) parts.push(`${cap(names.whose(story.focus))} best chance came on move ${moveNo(story.thrownAway)}: ${me} ${be} winning${odds(story.thrownAway, story.focus)} and **${story.thrownAway.san}** let it go.`);
  } else if (story.outcome === 'won') {
    if (d) parts.push(`The game turned on move ${moveNo(d)}, with **${moveLabel(d)}**: ${did(d)}, and ${me} never let go after that.`);
    else parts.push(`${cap(me)} won this without one big swing: the advantage grew move by move.`);
    if (story.thrownAway) parts.push(`It was not all smooth: on move ${moveNo(story.thrownAway)} ${me} ${be} winning${odds(story.thrownAway, story.focus)} and **${story.thrownAway.san}** nearly threw it away. Against a stronger opponent that costs the game.`);
  } else {
    const t = story.thrownAway;
    if (t) parts.push(`The half point that got away: on move ${moveNo(t)} ${names.who(t.color)} ${names.who(t.color) === 'you' ? 'were' : 'was'} winning${odds(t, t.color)} and **${t.san}** let it go.`);
    else parts.push('Neither side ever had a decisive advantage, so the result is a fair one.');
  }
  return parts.join(' ');
}
