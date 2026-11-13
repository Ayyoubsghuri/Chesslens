/**
 * coach-compare.ts
 * "Why is the better move better?" — the way a real coach answers it.
 *
 * A weak explanation says "the engine prefers Bd3 (+0.8)". A coach puts the two moves side by side and says what
 * changes on the board:
 *   - what the opponent was threatening, and which move deals with it,
 *   - what the played move stopped guarding (every move leaves something behind),
 *   - which of YOUR pieces was the worst one, and whether the move improved it,
 *   - how king safety, piece activity and pawn structure differ a few moves later,
 *   - who comes out with more material once the exchanges are over,
 *   - which long-term plan the position was asking for (the strategic thing you missed),
 *   - and one rule of thumb to keep.
 *
 * Every sentence is built from something checked on the board with chess.js, or from the engine's own lines.
 * Pure (no engine calls, no DOM): the caller passes the engine lines in, so everything here is testable.
 */
import { Chess, type Square } from 'chess.js';
import { VAL, NAME, other, movesFor, winnableCaptures, type Side } from './tactics';
import { positionFacts, coachPlan, analyzePhase, type Fact, type FactKind } from './positional';
import { settleLine } from './claim-check';
import { v } from './coach-voice';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CompareArrow { from: Square; to: Square; color: 'green' | 'red' | 'blue' | 'yellow' }

/** How a move is put into words elsewhere in the coach (fork, pin, "takes the rook"...). Passed in to avoid a cycle. */
export type Narrator = (fen: string, uci: string, line?: string[]) => { san: string; does: string; kind: string; tactical: boolean } | null;

export interface CompareInput {
  fenBefore: string;
  mover: Side;
  /** The move that was played (UCI) and the engine's line after it. */
  playedUci: string;
  playedLine: string[];
  /** The engine's best move (UCI) and the engine's line after it. */
  bestUci: string;
  bestLine: string[];
  /** Mover's point of view, in pawns. */
  evalBefore: number | null;
  evalAfter: number | null;
  /** Inaccuracy / mistake / blunder... (true) or a fine move that was just not the top one (false). */
  bad: boolean;
  /** The opponent's best move if the mover had passed: what they were threatening before the move. */
  threat?: { uci: string; gain: number } | null;
  narrate?: Narrator;
  level?: 'beginner' | 'intermediate' | 'advanced';
  /** Key-moments review: the two strongest arguments only, no recap sentence. */
  terse?: boolean;
}

export interface Comparison {
  /** "Why it's better" scene text (markup: **key** ++good++ ~~bad~~). */
  text: string;
  arrows: CompareArrow[];
  squares: Square[];
  /** "The idea you missed": the strategic plan the position was asking for, when the board shows one. */
  strategy?: { text: string; arrows: CompareArrow[]; squares: Square[] } | null;
  /** The criteria where the better move wins (for the eval-free summary). */
  wins: Criterion[];
}

type Criterion = 'threat' | 'material' | 'king' | 'activity' | 'structure' | 'tactic';

interface Reason {
  crit: Criterion;
  /** Importance; the coach only says the top two or three. */
  weight: number;
  /** A sentence (or clause) about the better move. */
  best?: string;
  /** A sentence (or clause) about the played move. */
  played?: string;
  lesson?: string;
  arrows: CompareArrow[];
  squares: Square[];
}

// ---------------------------------------------------------------------------
// Small board helpers
// ---------------------------------------------------------------------------
const FILES = 'abcdefgh';
const uciMove = (u: string) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
const sideName = (s: Side) => (s === 'w' ? 'White' : 'Black');
const article = (w: string) => (/^[aeiou]/.test(w) ? 'an' : 'a');

function play(fen: string, uci: string): { fen: string; move: any } | null {
  try {
    const c = new Chess(fen);
    const m = c.move(uciMove(uci));
    return { fen: c.fen(), move: m };
  } catch { return null; }
}

function playLine(fen: string, ucis: string[], n: number): string {
  try {
    const c = new Chess(fen);
    for (const u of ucis.slice(0, n)) { try { c.move(uciMove(u)); } catch { break; } }
    return c.fen();
  } catch { return fen; }
}

/** Squares attacked by `by`'s pawns (pieces avoid them: a square a pawn hits is not a real square for a piece). */
function pawnHits(fen: string, by: Side): Set<string> {
  const out = new Set<string>();
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      const isPawn = ch === (by === 'w' ? 'P' : 'p');
      if (isPawn) {
        const r = 7 - i;
        const rr = r + (by === 'w' ? 1 : -1);
        if (rr >= 0 && rr < 8) for (const df of [-1, 1]) if (f + df >= 0 && f + df < 8) out.add(FILES[f + df] + (rr + 1));
      }
      f++;
    }
  });
  return out;
}

/** Safe squares each of `side`'s pieces can go to (not counting squares an enemy pawn hits). Pawns and the king are skipped. */
function mobility(fen: string, side: Side): Map<string, { type: string; n: number }> {
  const hits = pawnHits(fen, other(side));
  const out = new Map<string, { type: string; n: number }>();
  try {
    const c = new Chess(fen);
    for (const row of c.board()) for (const p of row) {
      if (p && p.color === side && 'nbrq'.includes(p.type)) out.set(p.square, { type: p.type, n: 0 });
    }
  } catch { return out; }
  for (const m of movesFor(fen, side)) {
    const e = out.get(m.from);
    if (!e) continue;
    if (hits.has(m.to) && !(m.captured && VAL[m.captured] >= VAL[m.piece])) continue;
    e.n++;
  }
  return out;
}

/** How many plies into a line to look: about four, but never in the middle of an exchange. */
function quietPly(fen: string, line: string[]): number {
  let n = Math.min(line.length, 4);
  try {
    const c = new Chess(fen);
    for (const u of line.slice(0, n)) c.move(uciMove(u));
    while (n < Math.min(line.length, 8)) {
      const m = c.move(uciMove(line[n]));
      n++;
      if (!m.captured) { c.undo(); n--; break; }
    }
  } catch { /* use what we have */ }
  return n;
}

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
/** "Your 2 minor pieces" -> "Your two minor pieces" (reads and sounds better). */
const numberWords = (s: string) => s.replace(/\b([2-8]) (minor|of|pawns|pieces|islands)\b/g, (_m, d: string, w: string) => `${NUM[Number(d)]} ${w}`);

const totalMobility = (m: Map<string, { n: number }>) => [...m.values()].reduce((a, x) => a + x.n, 0);

/** Pieces of `side` on the board that defend `sq` (pseudo-legal recapture on that square). */
function defenders(fen: string, sq: string, side: Side): string[] {
  // Put an enemy pawn on the square so "captures onto it" become legal for `side`.
  try {
    const c = new Chess(fen);
    const p = c.get(sq as Square);
    if (!p || p.color !== side) return [];
    const parts = fen.split(' ');
    const flipped = new Chess([parts[0], parts[1], '-', '-', '0', '1'].join(' '));
    flipped.remove(sq as Square);
    flipped.put({ type: 'n', color: other(side) }, sq as Square);
    const f2 = flipped.fen().split(' ');
    f2[1] = side; f2[3] = '-';
    const t = new Chess(f2.join(' '));
    return t.moves({ verbose: true }).filter((m) => m.to === sq && m.captured).map((m) => m.from);
  } catch { return []; }
}

/** The coach's four criteria (plus the threat and the tactic, the wild cards), as nouns. */
const CRIT_WORD: Record<Criterion, string> = {
  threat: 'meeting the threat', material: 'material', king: 'king safety',
  activity: 'piece activity', structure: 'pawn structure', tactic: 'tactics',
};

const KING_KINDS = new Set<FactKind>(['castled', 'king-center', 'shield', 'king-zone', 'back-rank', 'file-king']);
const ACTIVITY_KINDS = new Set<FactKind>(['development', 'rook-7th', 'rook-battery', 'open-file', 'half-open', 'diagonal', 'bishop-pair', 'bad-bishop', 'rim-knight', 'outpost', 'outpost-available', 'early-queen', 'trapped', 'loose', 'pin', 'endgame-king']);
const critOf = (k: FactKind): Criterion => (KING_KINDS.has(k) ? 'king' : ACTIVITY_KINDS.has(k) ? 'activity' : 'structure');

/** "White's rook on d1 controls..." -> "your rook on d1 controls..." (the coach talks to the player). */
function personal(text: string, mover: Side, factSide?: Side | null): string {
  const me = sideName(mover), them = sideName(other(mover));
  // "the enemy king" in a fact about the opponent's piece is YOUR king.
  if (factSide && factSide !== mover) text = text.replace(/\bthe enemy king\b/g, 'your king').replace(/\benemy king\b/g, 'your king');
  else if (factSide === mover) text = text.replace(/\bthe enemy king\b/g, "your opponent's king");
  return text
    .replace(new RegExp(`\\b${me}'s\\b`, 'g'), 'your')
    .replace(new RegExp(`\\b${them}'s\\b`, 'g'), "your opponent's")
    .replace(/^your/, 'Your')
    .replace(/^your opponent's/, "Your opponent's");
}
const lowerFirst = (s: string) => (/^(White|Black)/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const stripDot = (s: string) => s.replace(/[.!]\s*$/, '');
const bold = (s: string) => s.replace(/\b([a-h][1-8])\b/g, '**$1**');

// ---------------------------------------------------------------------------
// The reasons
// ---------------------------------------------------------------------------

/** 1. The opponent's threat: which move stops it. */
function threatReason(i: CompareInput, playedFen: string, bestFen: string): Reason | null {
  const t = i.threat;
  if (!t || t.gain < 0.9 || !i.narrate) return null;
  const opp = other(i.mover);
  const passFen = (() => { const f = i.fenBefore.split(' '); f[1] = opp; f[3] = '-'; return f.join(' '); })();
  const n = i.narrate(passFen, t.uci);
  if (!n) return null;
  const tm = uciMove(t.uci);
  const isCap = (() => { try { return !!new Chess(passFen).get(tm.to as Square); } catch { return false; } })();
  // Does the threat still work after each move? Captures: is it still a winning capture? Other threats: does the engine still play it?
  const works = (fen: string, line: string[]) => {
    if (isCap) return winnableCaptures(fen, opp).some((c) => c.from === tm.from && c.to === tm.to);
    return !!line[0] && line[0].slice(0, 4) === t.uci.slice(0, 4);
  };
  const afterPlayed = works(playedFen, i.playedLine);
  const afterBest = works(bestFen, i.bestLine);
  if (!afterPlayed || afterBest) return null;
  return {
    crit: 'threat', weight: 40 + t.gain * 4,
    played: `${v(i.fenBefore + 'th', ['Before anything else, ask what your opponent wants.', 'First question, always: what does your opponent want?', 'Look at what your opponent was threatening.'])} They wanted **${n.san}**, which ${n.does}, and your move does nothing about it.`,
    best: 'it takes care of that threat first',
    lesson: 'If your opponent has a threat, deal with it before you start your own plans.',
    arrows: [{ from: tm.from as Square, to: tm.to as Square, color: 'red' }],
    squares: [tm.to as Square],
  };
}

/** 2. Continuity: what the played piece stopped guarding when it left. */
function continuityReason(i: CompareInput, played: any, playedFen: string, bestFen: string): Reason | null {
  if (!played || played.flags.includes('k') || played.flags.includes('q')) return null;
  const opp = other(i.mover);
  const before = winnableCaptures(i.fenBefore, opp);
  const nowHanging = winnableCaptures(playedFen, opp).filter((c) => c.to !== played.to && !before.some((b) => b.to === c.to));
  for (const c of nowHanging) {
    const defBefore = defenders(i.fenBefore, c.to, i.mover);
    if (!defBefore.includes(played.from)) continue;
    // After the better move this target must still be safe, or the comparison proves nothing.
    if (winnableCaptures(bestFen, opp).some((x) => x.to === c.to)) continue;
    // The engine has to actually go for it (or the piece is simply loose and attacked).
    const hit = i.playedLine.slice(0, 5).some((u, k) => k % 2 === 0 && u.slice(2, 4) === c.to);
    if (!hit && c.gain < 2) continue;
    return {
      crit: 'material', weight: 30 + c.gain * 5,
      played: `Every move stops guarding something. Your ${NAME[played.piece]} on ${played.from} was the piece protecting the ${NAME[c.victim]} on ${c.to}, and once it moves, that ${NAME[c.victim]} is loose.`,
      lesson: 'Before you move a piece, ask what it was protecting.',
      arrows: [{ from: c.from, to: c.to, color: 'red' }],
      squares: [c.to],
    };
  }
  return null;
}

/** 3. Your worst piece, and what each move does for it. Coaches say it all the time: improve your worst piece. */
function activityReason(i: CompareInput, played: any, best: any, playedFen: string, bestFen: string): Reason[] {
  const out: Reason[] = [];
  const mBefore = mobility(i.fenBefore, i.mover);
  const mPlayed = mobility(playedFen, i.mover);
  const mBest = mobility(bestFen, i.mover);
  const phase = analyzePhase(i.fenBefore);

  // The worst piece: fewest safe squares (minor pieces and rooks; the queen is rarely "the worst piece").
  const ranked = [...mBefore.entries()].filter(([, x]) => x.type !== 'q').sort((a, b) => a[1].n - b[1].n || VAL[a[1].type] - VAL[b[1].type]);
  const worst = ranked[0];
  if (worst && best && best.from === worst[0] && (!played || played.from !== worst[0])) {
    const now = mBest.get(best.to)?.n ?? 0;
    if (worst[1].n <= 3 && now >= worst[1].n + 3) {
      out.push({
        crit: 'activity', weight: 22 + Math.min(10, now - worst[1].n),
        best: `it brings your worst piece into the game: the ${NAME[worst[1].type]} on ${worst[0]} had ${worst[1].n === 0 ? 'no safe squares at all' : worst[1].n === 1 ? 'just one safe square' : `only ${worst[1].n} safe squares`}, and on ${best.to} it has ${now}`,
        lesson: phase === 'opening' ? 'Get every piece out before you start anything.' : 'When nothing is happening, find your worst piece and improve it.',
        arrows: [{ from: best.from, to: best.to, color: 'green' }],
        squares: [worst[0] as Square],
      });
    }
  }

  // The moved piece itself: did the played move put it somewhere worse?
  if (played && 'nbrq'.includes(played.piece) && !played.captured) {
    const was = mBefore.get(played.from)?.n ?? 0;
    const now = mPlayed.get(played.to)?.n ?? 0;
    if (was - now >= 3 && now <= 3) {
      out.push({
        crit: 'activity', weight: 16 + (was - now),
        played: `On ${played.to} your ${NAME[played.piece]} has ${now === 0 ? 'no safe squares' : now === 1 ? 'one safe square' : `only ${now} safe squares`}, where it had ${was} before. You made your own piece worse.`,
        lesson: 'Put pieces where they control the most squares, not where they look busy.',
        arrows: [{ from: played.from, to: played.to, color: 'red' }],
        squares: [played.to],
      });
    }
  }

  // Overall breathing room: count the safe squares of all pieces after each move.
  const tp = totalMobility(mPlayed), tb = totalMobility(mBest);
  if (!out.length && tb - tp >= 6) {
    out.push({
      crit: 'activity', weight: 10 + Math.min(8, tb - tp),
      best: `your pieces get more room: about ${tb - tp} more safe squares between them`,
      arrows: [], squares: [],
    });
  }
  return out;
}

/** 4. A few moves down each line: what is different about king safety, activity and structure. */
function factReasons(i: CompareInput, playedFen: string, bestFen: string): Reason[] {
  const opp = other(i.mover);
  const endP = positionFacts(playLine(playedFen, i.playedLine, quietPly(playedFen, i.playedLine)), undefined, false);
  const endB = positionFacts(playLine(bestFen, i.bestLine, quietPly(bestFen, i.bestLine)), undefined, false);
  // Also the immediate positions: a line can drift away from the point of the move.
  const nowP = positionFacts(playedFen, undefined, false);
  const nowB = positionFacts(bestFen, undefined, false);
  const keys = (fs: Fact[]) => new Set(fs.map((f) => f.key));
  const kNowP = keys(nowP), kNowB = keys(nowB), kEndP = keys(endP), kEndB = keys(endB);
  const good = (f: Fact) => (f.polarity === 'asset' && f.side === i.mover) || (f.polarity === 'weakness' && f.side === opp);
  const badF = (f: Fact) => (f.polarity === 'weakness' && f.side === i.mover) || (f.polarity === 'asset' && f.side === opp);
  // Tactical facts (loose / pinned / trapped pieces) in the middle of a line are noise: the tactics scenes cover them.
  const skip = new Set<FactKind>(['castled', 'islands', 'file-info', 'loose', 'pin', 'trapped']);
  // Only lasting things count when they appear at the END of a line (a rook "pressing a pawn" mid-line is not an argument).
  const LASTING = new Set<FactKind>(['open-file', 'rook-7th', 'outpost', 'passed', 'unstoppable', 'isolated', 'doubled', 'backward',
    'king-center', 'shield', 'king-zone', 'back-rank', 'file-king', 'development', 'bishop-pair', 'center']);
  const uniq = (fs: Fact[]) => [...new Map(fs.map((f) => [f.key, f])).values()];
  // Compare like with like: right after each move, and at the (quiet) end of each line.
  const diff = (nowA: Fact[], endA: Fact[], kNowO: Set<string>, kEndO: Set<string>, want: (f: Fact) => boolean) => uniq([
    ...nowA.filter((f) => f.score >= 10 && !kNowO.has(f.key)),
    ...endA.filter((f) => f.score >= 12 && LASTING.has(f.kind) && !kEndO.has(f.key) && !kNowO.has(f.key)),
  ]).filter((f) => f.side && !skip.has(f.kind) && want(f)).sort((a, b) => b.score - a.score);
  const gains = diff(nowB, endB, kNowP, kEndP, good);
  const costs = diff(nowP, endP, kNowB, kEndB, badF);

  const out: Reason[] = [];
  const seenCrit = new Set<Criterion>();
  for (const f of gains.slice(0, 2)) {
    const crit = critOf(f.kind);
    if (seenCrit.has(crit)) continue;
    seenCrit.add(crit);
    out.push({
      crit, weight: f.score,
      best: lowerFirst(stripDot(numberWords(personal(f.text, i.mover, f.side)))),
      // A rule of thumb is only YOUR lesson when the fact is about your own pieces / pawns.
      lesson: f.side === i.mover ? f.lesson : undefined,
      arrows: f.arrows.slice(0, 2).map((a) => ({ ...a, color: 'green' as const })),
      squares: f.squares.slice(0, 2),
    });
  }
  for (const f of costs.slice(0, 2)) {
    const crit = critOf(f.kind);
    if (out.some((r) => r.crit === crit && r.played)) continue;
    out.push({
      crit, weight: f.score,
      played: numberWords(personal(f.text, i.mover, f.side)),
      lesson: f.side === i.mover ? f.lesson : undefined,
      arrows: f.arrows.slice(0, 2).map((a) => ({ ...a, color: 'red' as const })),
      squares: f.squares.slice(0, 2),
    });
  }
  return out;
}

/** 5. Material once the exchanges settle, on both lines. */
function materialReason(i: CompareInput): Reason | null {
  const p = settleLine(i.fenBefore, [i.playedUci, ...i.playedLine], i.mover, 5, 14);
  const b = settleLine(i.fenBefore, [i.bestUci, ...i.bestLine], i.mover, 5, 14);
  if (!p.settled || !b.settled) return null;
  const d = b.swing - p.swing;
  if (d < 1) return null;
  const lostWord = p.worst && p.swing <= -1 ? `${article(NAME[p.worst])} ${NAME[p.worst]}` : null;
  const wonWord = b.best && b.swing >= 1 ? `${article(NAME[b.best])} ${NAME[b.best]}` : null;
  let best: string | undefined;
  let played: string | undefined;
  if (wonWord) best = `when the dust settles you are ++up ${wonWord}++`;
  else if (b.swing >= 0) best = 'when the dust settles, the material is still even';
  if (lostWord) played = `After your move, once the trades are done, you are ~~down ${lostWord}~~.`;
  if (!best && !played) return null;
  return { crit: 'material', weight: 20 + d * 6, best, played, arrows: [], squares: [] };
}

/** 6. The plan the position was asking for, and whether the better move starts it. */
function strategyOf(i: CompareInput, best: any, played: any): Comparison['strategy'] {
  try {
    const plans = coachPlan(i.fenBefore, i.mover, undefined, 3);
    if (!plans.length) return null;
    const touches = (p: { arrows: { from: Square; to: Square }[]; squares: Square[] }, m: any) =>
      !!m && (p.squares.includes(m.from) || p.squares.includes(m.to) || p.arrows.some((a) => a.from === m.from || a.to === m.to));
    const fit = plans.find((p) => touches(p, best) && !touches(p, played));
    const fileWord = (t: string) => t.match(/open ([a-h])-file/)?.[1];
    // Rook to the open file: the plan names a file, the better move puts a rook / queen on it.
    const fileFit = !fit ? plans.find((p) => {
      const f = fileWord(p.text);
      return !!f && best && (best.piece === 'r' || best.piece === 'q') && best.to[0] === f && !(played && played.to[0] === f && (played.piece === 'r' || played.piece === 'q'));
    }) : undefined;
    const plan = fit ?? fileFit;
    if (!plan) return null;
    const planText = stripDot(personal(plan.text, i.mover, i.mover));
    const lead = v(i.fenBefore + 'plan', [
      'Here is the bigger picture you missed.',
      'Step back from the tactics for a second.',
      'Now the strategic part, and this is the important one.',
    ]);
    const text = `${lead} The position was asking for a plan: ${bold(lowerFirst(planText))}. ${best.san.replace(/[+#]/g, '')} is the first step of exactly that plan. ${played ? `${played.san.replace(/[+#]/g, '')} does not move it forward.` : ''} Good players do not just look for moves, they ask what the position needs and then pick the move that serves it.`;
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      arrows: [{ from: best.from, to: best.to, color: 'green' }, ...plan.arrows.slice(0, 2).map((a) => ({ ...a, color: 'blue' as const }))],
      squares: plan.squares.slice(0, 3),
    };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Putting it into words
// ---------------------------------------------------------------------------
function evalWords(diff: number): string {
  if (diff >= 3) return 'That is the difference between a normal game and a lost one.';
  if (diff >= 1.5) return 'That is worth more than a pawn, the kind of difference that decides games.';
  if (diff >= 0.8) return 'That is roughly a whole pawn of difference.';
  if (diff >= 0.4) return 'That is about half a pawn. Small, but these small things add up over a game.';
  return '';
}

/** The criteria the better move wins, in plain words: "a safer king and more active pieces". */
const joinWords = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? '' : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

export function compareMoves(i: CompareInput): Comparison | null {
  const P = play(i.fenBefore, i.playedUci);
  const B = play(i.fenBefore, i.bestUci);
  if (!B) return null;
  const playedFen = P?.fen ?? i.fenBefore;
  const played = P?.move ?? null;
  const best = B.move;
  const seed = i.fenBefore + best.san;

  const reasons: Reason[] = [];
  const th = threatReason(i, playedFen, B.fen); if (th) reasons.push(th);
  const ct = P ? continuityReason(i, played, playedFen, B.fen) : null; if (ct) reasons.push(ct);
  const mat = materialReason(i); if (mat) reasons.push(mat);
  reasons.push(...activityReason(i, played, best, playedFen, B.fen));
  reasons.push(...factReasons(i, playedFen, B.fen));

  // A tactic in the better move is its own reason (fork, pin...), named by the coach's narrator.
  const bn = i.narrate?.(i.fenBefore, i.bestUci, i.bestLine) ?? null;
  if (bn && bn.tactical && bn.kind !== 'plan') {
    reasons.push({ crit: 'tactic', weight: 35, best: `it ${bn.does}`, arrows: [], squares: [] });
  }

  reasons.sort((a, b) => b.weight - a.weight);
  if (i.terse) {
    // When there is something concrete (a threat, material, a tactic), that IS the reason: no positional small talk next to it.
    const concrete = reasons.filter((r) => r.crit === 'threat' || r.crit === 'material' || r.crit === 'tactic');
    if (concrete.length) {
      reasons.length = 0;
      // what the played move loses has already been said by the verdict
      reasons.push(...concrete.map((r) => (r.crit === 'material' && r.best ? { ...r, played: undefined } : r)).filter((r) => r.best || r.played));
    }
  }
  const bestSays = reasons.filter((r) => r.best).slice(0, 2);
  const playedSays = reasons.filter((r) => r.played).slice(0, i.terse ? 1 : 2);
  if (!bestSays.length && !playedSays.length) return null;

  const bSan = best.san.replace(/[+#]/g, '');
  const pSan = played ? played.san.replace(/[+#]/g, '') : '';
  const parts: string[] = [];

  // Opening line: a coach compares, he does not just announce the engine's move.
  parts.push(i.bad
    ? v(seed, [
        `Let me show you the difference between your move and **${bSan}**.`,
        `Put the two moves side by side, yours and **${bSan}**.`,
        `So why is **${bSan}** better? Let's actually compare them.`,
      ])
    : v(seed, [
        `Your move is fine, but let me show you why **${bSan}** is a little stronger.`,
        `Good move. There was a slightly better one though, **${bSan}**, and here is why.`,
      ]));

  // What was wrong with the played move (the threat it ignored comes first, it is the most important habit).
  for (const r of playedSays) parts.push(bold(r.played!));

  // What the better move does, in one flowing sentence.
  if (bestSays.length) {
    const clauses = bestSays.map((r) => bold(r.best!));
    parts.push(`${playedSays.length ? 'Now look at' : 'Look at'} **${bSan}**: ${clauses.length > 1 ? `${clauses[0]}, and ${clauses.slice(1).join(', and ')}` : clauses[0]}.`);
  } else {
    parts.push(`**${bSan}** avoids all of that.`);
  }

  // The verdict in human terms: which of the four criteria tip the balance, then the size of it.
  const wins = [...new Set([...playedSays, ...bestSays].sort((a, b) => b.weight - a.weight).map((r) => r.crit))].slice(0, 3);
  const words = wins.map((c) => CRIT_WORD[c]);
  if (words.length && i.level !== 'beginner' && !i.terse) {
    parts.push(v(seed + 'W', [
      `So ${bSan} wins on ${joinWords(words)}${pSan ? `, and that is the whole difference from ${pSan}` : ''}.`,
      `Add it up: ${bSan} is better on ${joinWords(words)}.`,
    ]));
  }
  if (i.evalBefore != null && i.evalAfter != null && !i.terse) {
    const ew = evalWords(i.evalBefore - i.evalAfter);
    if (ew) parts.push(ew);
  }

  // One rule to keep.
  const lesson = reasons.find((r) => r.lesson)?.lesson;
  if (lesson) parts.push(`${v(seed + 'L', ['The lesson:', 'Remember this:', 'Rule of thumb:', 'Take this with you:'])} ${lesson}`);

  const arrows: CompareArrow[] = [{ from: best.from, to: best.to, color: 'green' }];
  if (played) arrows.push({ from: played.from, to: played.to, color: 'red' });
  for (const r of [...playedSays, ...bestSays]) arrows.push(...r.arrows);
  const squares = [...new Set([...playedSays, ...bestSays].flatMap((r) => r.squares))].slice(0, 4);

  return {
    text: parts.join(' ').replace(/\s+/g, ' ').trim(),
    arrows: dedupeArrows(arrows).slice(0, 5),
    squares,
    strategy: i.level === 'beginner' ? null : strategyOf(i, best, played),
    wins,
  };
}

function dedupeArrows(a: CompareArrow[]): CompareArrow[] {
  const seen = new Set<string>();
  return a.filter((x) => { const k = x.from + x.to; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * For a move that IS the best one: a human reason it was right, beyond "the engine agrees".
 * Returns a clause ("it brings your worst piece into play: ...") or null.
 */
export function bestMoveVirtue(fenBefore: string, uci: string, mover: Side): string | null {
  const P = play(fenBefore, uci);
  if (!P) return null;
  const m = P.move;
  const before = mobility(fenBefore, mover);
  const ranked = [...before.entries()].filter(([, x]) => x.type !== 'q').sort((a, b) => a[1].n - b[1].n);
  const worst = ranked[0];
  if (worst && worst[0] === m.from && worst[1].n <= 3) {
    const now = mobility(P.fen, mover).get(m.to)?.n ?? 0;
    if (now >= worst[1].n + 3) return `it improves your worst piece: the ${NAME[worst[1].type]} goes from ${worst[1].n} safe square${worst[1].n === 1 ? '' : 's'} to ${now}`;
  }
  // Took care of something that was hanging.
  const opp = other(mover);
  const hangingBefore = winnableCaptures(fenBefore, opp).filter((c) => VAL[c.victim] >= 3);
  const hangingAfter = winnableCaptures(P.fen, opp);
  const saved = hangingBefore.find((c) => !hangingAfter.some((x) => x.to === c.to || x.to === m.to));
  if (saved) return `it takes care of your ${NAME[saved.victim]}, which was under attack`;
  return null;
}
