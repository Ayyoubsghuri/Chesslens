/**
 * coach-game.ts
 * WHOLE-GAME coach. Walks the analyzed game from move 1 to the end and narrates it like a streamer
 * watching a game for the first time:
 *   - book moves        -> ONE short beat ("first 8 moves are theory")
 *   - good moves        -> a quick reaction + WHY it is good + what the opponent wants now
 *   - brilliant / great -> reaction + the full sacrifice / only-move explanation
 *   - bad moves         -> slow down: what it allows (engine line), why it works, the better move,
 *                          what they could have played (missed tactic), the habit that fixes it.
 *                          Optionally deepened later with the engine (deepenBeat) = the look-ahead.
 *   - end               -> mate line + turning point + summary + homework
 *
 * Every FACT comes from chess.js / Stockfish through coach-explain.ts, tactics.ts, tactics-lookahead.ts and
 * positional.ts. This file only orders the facts and wraps them in coach-streamer.ts words.
 *
 * Pure + synchronous except deepenBeat() and prepareGameBeats() (which only slices the same work so the page stays responsive). Beats never call the engine (the game is already analyzed).
 */
import { Chess, type Square } from 'chess.js';
import type { AnalyzedMove, MoveQuality } from '@/lib/types';
import { evalToPawns, formatEval } from '@/lib/engine';
import { verifyClaim } from '@/lib/claim-check';
import { computeAccuracy, countByQuality } from '@/lib/analysis';
import { describeTactics, winnableCaptures, other, NAME, type PlyMove, type Side } from '@/lib/tactics';
import { lookAhead, missedTactic, threats } from '@/lib/tactics-lookahead';
import { analyzePhase, movePurpose, moveInsights } from '@/lib/positional';
import {
  buildCoreScenes, buildAdvancedExplanation, moveCause, causeSummary, parseSegs,
  type Scene, type SceneArrow, type SceneEval, type ExplainInput, type CoachLevel,
} from '@/lib/coach-explain';
import {
  say, vary, hash, reactFor, phaseThink, planFor, habitFor, evalTalk, evalBand, fill,
  SCAN_DANGER, SCAN_CLEAR, NO_THREAT_OWN, OWN_THREAT, PUNISHED, WASTED_GIFT, ABSORB, SNOWBALL, STREAK_GOOD,
  COMEBACK, BOOK_RUN, BOOK_RUN_NONAME, BOOK_ENDS, MATE_DELIVERED, MATE_RECEIVED, GAME_INTRO, TURNING_POINT,
  BIG_SWING, SUMMARY_LEAD, SUMMARY_GOOD_GAME, SUMMARY_ROLLERCOASTER, SUMMARY_ROUGH, HOMEWORK,
  analogyFor, dramaFor, type Phase,
} from '@/lib/coach-streamer';

// ===========================================================================
// Types
// ===========================================================================

/** A scene the player can show. `plain` = do not put a preview on the board, just move the game to that move. */
export type GameScene = Scene & { plain?: boolean };

export type BeatKind = 'intro' | 'book' | 'good' | 'bad' | 'end' | 'summary';

export interface GameBeat {
  id: string;
  /** Which game move the board should be on while this beat plays. */
  moveIndex: number;
  kind: BeatKind;
  quality?: MoveQuality;
  /** Played by the student (true) or the opponent (false). */
  byStudent: boolean;
  /** Scenes before / the explanation / scenes after. `body` is what deepenBeat() replaces. */
  head: GameScene[];
  body: GameScene[];
  tail: GameScene[];
  /** Set on bad beats: everything the engine-assisted look-ahead needs. */
  deepInput?: ExplainInput;
}

/** 'every' = explain every move; 'highlights' = only brilliant / great / mistakes (good moves are skipped). */
export type GameDetail = 'every' | 'highlights';

export interface GameCoachOptions {
  /** The side the student played. null = narrate "White" and "Black". */
  you: Side | null;
  level?: CoachLevel;
  depth: number;
  detail: GameDetail;
}

export interface TimelineItem {
  key: string;
  beatId: string;
  beatIndex: number;
  moveIndex: number;
  scene: GameScene;
  firstOfBeat: boolean;
}

// ===========================================================================
// Small helpers
// ===========================================================================

const BAD: MoveQuality[] = ['inaccuracy', 'mistake', 'miss', 'blunder'];
const STRONG: MoveQuality[] = ['brilliant', 'great'];
const isBad = (q: MoveQuality) => BAD.includes(q);

const joinList = (parts: string[]) =>
  parts.length <= 1 ? parts[0] ?? '' : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];

const moverPawns = (ev: any, c: Side): number | null => {
  if (!ev) return null;
  try {
    const p = evalToPawns(ev);
    return Number.isFinite(p) ? (c === 'w' ? p : -p) : null;
  } catch { return null; }
};

const evalInfoOf = (ev: any): SceneEval | undefined => {
  if (!ev) return undefined;
  try {
    const p = evalToPawns(ev);
    return { pawns: Number.isFinite(p) ? p : 0, mate: typeof ev.mate === 'number' && ev.mate !== 0 ? ev.mate : null, label: formatEval(ev) };
  } catch { return undefined; }
};

const standingOf = (p: number | null): 'ahead' | 'behind' | 'even' => (p == null ? 'even' : p >= 1.5 ? 'ahead' : p <= -1.5 ? 'behind' : 'even');

const label = (m: AnalyzedMove) => `${Math.floor(m.index / 2) + 1}${m.color === 'w' ? '.' : '...'} ${m.san}`;

function uciOf(fenBefore: string, san: string): { from: Square; to: Square; uci: string; ply: PlyMove | null } | null {
  try {
    const r: any = new Chess(fenBefore).move(san);
    return { from: r.from, to: r.to, uci: r.from + r.to + (r.promotion ?? ''), ply: r as PlyMove };
  } catch { return null; }
}

const inputFor = (m: AnalyzedMove, depth: number, level?: CoachLevel): ExplainInput => ({
  fenBefore: m.fenBefore,
  fenAfter: m.fenAfter,
  san: m.san,
  color: m.color,
  quality: m.quality,
  isPlayedBest: m.isBestMove,
  bestUci: m.evalBefore?.bestMove ?? null,
  evalBefore: m.evalBefore,
  evalAfter: m.evalAfter,
  depth,
  level,
  // Whole-game review: after an inaccuracy / mistake / miss / blunder the "why" is already told, so the line is only played when it ends in a fork, a valuable piece or mate.
  sequence: 'forcing',
});

interface Ctx {
  you: Side | null;
  depth: number;
  level?: CoachLevel;
}

const isStudent = (c: Ctx, color: Side) => c.you === null || c.you === color;
const whoName = (c: Ctx, color: Side, cap = false) => {
  const s = c.you === null ? (color === 'w' ? 'White' : 'Black') : c.you === color ? 'you' : 'your opponent';
  return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s;
};
/** "they" / "you" for sentences. */
const pron = (c: Ctx, color: Side) => (c.you === null ? (color === 'w' ? 'White' : 'Black') : c.you === color ? 'you' : 'they');

function scene(
  m: AnalyzedMove, text: string, opts: { fen?: string; arrows?: SceneArrow[]; chip?: string; plain?: boolean; withEval?: boolean; quality?: string } = {},
): GameScene {
  const mv = uciOf(m.fenBefore, m.san);
  return {
    fen: opts.fen ?? m.fenAfter,
    from: mv?.from ?? ('e2' as Square),
    to: mv?.to ?? ('e4' as Square),
    san: m.san,
    uci: mv?.uci ?? '',
    text: parseSegs(text.replace(/\s{2,}/g, ' ').trim()),
    arrows: opts.arrows ?? [],
    chip: opts.chip,
    plain: opts.plain,
    quality: opts.quality,
    evalInfo: opts.withEval === false ? undefined : evalInfoOf(m.evalAfter),
  };
}

/** The tactic this move REALLY created (forks must win something; promotion threats are skipped). */
function solidTactic(m: AnalyzedMove) {
  const mv = uciOf(m.fenBefore, m.san);
  if (!mv?.ply) return null;
  const list = describeTactics(m.fenBefore, mv.ply, m.fenAfter);
  const gaveCheck = m.san.includes('+');
  for (const t of list) {
    if (t.kind === 'promotion') continue;
    if (t.kind === 'fork') {
      const wins = winnableCaptures(m.fenAfter, m.color).filter((x) => x.from === mv.to && x.gain >= 3);
      if (!(wins.length >= 2 || (gaveCheck && wins.length >= 1))) continue;
      // Same rule as coach-explain: say "fork" only when the engine's line really collects something afterwards.
      const line = ((m.evalAfter?.continuation ?? '') as string).split(/\s+/).filter(Boolean);
      if (!verifyClaim(m.fenAfter, line, { kind: 'fork', side: m.color }).ok) continue;
    }
    if (t.kind === 'mate-threat' || t.kind === 'trapped' || t.kind === 'remove-defender' || t.kind === 'discovered'
      || t.kind === 'pin' || t.kind === 'skewer' || t.kind === 'fork' || t.kind === 'mate' || t.kind === 'double-check'
      || t.kind === 'greek-gift') return t;
  }
  return null;
}

const NAMED: Record<string, string> = {
  mate: 'checkmate', 'double-check': 'a double check', 'greek-gift': 'the Greek gift', fork: 'a fork', pin: 'a pin', skewer: 'a skewer',
  discovered: 'a discovered attack', 'remove-defender': 'removing the defender', trapped: 'a trapped piece', 'mate-threat': 'a mate threat',
};

function bestSan(m: AnalyzedMove): string | null {
  const u = m.evalBefore?.bestMove;
  if (!u || u.length < 4) return null;
  try { return new Chess(m.fenBefore).move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined }).san; } catch { return null; }
}

// ===========================================================================
// Running state (continuity between moves)
// ===========================================================================
interface Run {
  studentGoodStreak: number;
  streakShown: boolean;
  lastBand: string | null;
  recent: number[]; // student's eval, last 8 plies
  comebackShown: boolean;
  bookEnded: boolean;
}

// ===========================================================================
// One move -> one beat
// ===========================================================================

/** Arrows for the moves the coach talks about: the move itself in red, the squares it hits (pins, targets) in yellow. */
function threatArrows(list: { arrows?: { from: Square; to: Square }[] }[]): SceneArrow[] {
  const out: SceneArrow[] = [];
  for (const t of list) {
    (t.arrows ?? []).forEach((a, i) => out.push({ from: a.from, to: a.to, color: i === 0 ? 'red' : 'yellow' }));
  }
  return out;
}

function scanLine(m: AnalyzedMove, c: Ctx, seed: string, force: boolean): { text: string; arrows: SceneArrow[] } {
  const opp = other(m.color);
  const mine = isStudent(c, m.color);
  if (mine) {
    // the student just moved: what can the opponent do now?
    const danger = threats(m.fenAfter, opp, 3).filter((t) => t.score >= 20 || t.kind === 'mate');
    if (danger.length) {
      const shown = danger.slice(0, 2);
      const what = joinList(shown.map((t) => `**${t.san}** (${t.does})`));
      return {
        text: say(seed, SCAN_DANGER, { opp: c.you === null ? (opp === 'w' ? 'White' : 'Black') : 'your opponent', what }, 'scan'),
        arrows: threatArrows(shown as any),
      };
    }
    return { text: force ? say(seed, SCAN_CLEAR, { opp: c.you === null ? (opp === 'w' ? 'White' : 'Black') : 'your opponent' }, 'scan') : '', arrows: [] };
  }
  // the opponent just moved: what do THEY threaten now?
  const plan = lookAhead(m.fenAfter, m.color).plan.filter((t) => t.score >= 20 || t.kind === 'mate');
  if (plan.length) {
    const shown = plan.slice(0, 2);
    return {
      text: `Watch out: ${whoName(c, m.color)} now threatens ${joinList(shown.map((t) => `**${t.san}** (${t.does})`))}.`,
      arrows: threatArrows(shown as any),
    };
  }
  return { text: '', arrows: [] };
}

function whatItDoes(m: AnalyzedMove, c: Ctx, seed: string): { text: string; arrows: SceneArrow[]; tactic: string | null } {
  const mv = uciOf(m.fenBefore, m.san);
  const arrows: SceneArrow[] = mv ? [{ from: mv.from, to: mv.to, color: 'green' }] : [];
  const sub = pron(c, m.color);
  const tac = solidTactic(m);
  if (tac) {
    for (const a of tac.arrows) arrows.push({ from: a.from, to: a.to, color: 'blue' });
    if (tac.kind === 'mate') return { text: `${tac.name === 'Checkmate' ? 'That is' : 'That is ' + tac.name.toLowerCase() + ':'} **checkmate**. ${tac.text.split(': ')[1] ?? ''}`.replace(/\s+\./, '.'), arrows, tactic: 'mate' };
    return { text: `That is ${NAMED[tac.kind] ? '**' + NAMED[tac.kind] + '**' : tac.name}: it ${tac.text}.`, arrows, tactic: tac.kind };
  }
  if (mv?.ply?.captured) {
    const cap = NAME[mv.ply.captured];
    const base = `It takes the ${cap} on ${mv.to}.`;
    return { text: base, arrows, tactic: null };
  }
  const why = mv?.ply ? movePurpose(m.fenBefore, mv.ply as any, m.fenAfter) : null;
  if (why) return { text: `It ${why}.`, arrows, tactic: null };
  if (mv?.ply) {
    const ins = moveInsights(m.fenBefore, mv.ply as any, m.fenAfter, c.you ?? undefined, 3, true).find((i) => i.verdict === 'good' && i.side === m.color);
    if (ins) return { text: ins.text.replace(/^(Good|Nice|Also good):\s*/, ''), arrows, tactic: null };
  }
  if (m.san.startsWith('O-O')) return { text: `${sub === 'you' ? 'You castle' : 'Castling'}: the king is tucked away and the rook joins in.`, arrows, tactic: null };
  const own = lookAhead(m.fenAfter, m.color).plan[0];
  if (own && own.score >= 20) {
    return { text: say(seed, OWN_THREAT, { what: `**${own.san}** (${own.does})`, who: sub }, 'own'), arrows: [...arrows, ...own.arrows.slice(1).map((a) => ({ from: a.from, to: a.to, color: 'blue' as const }))], tactic: null };
  }
  return { text: say(seed, NO_THREAT_OWN, {}, 'nothreat'), arrows, tactic: null };
}

function buildGood(m: AnalyzedMove, c: Ctx, run: Run, prev: AnalyzedMove | null, prev2: AnalyzedMove | null): GameBeat {
  const seed = `${m.index}:${m.san}`;
  const byStudent = isStudent(c, m.color);
  const q = m.quality;
  const phase = analyzePhase(m.fenAfter) as Phase;
  const mp = moverPawns(m.evalAfter, m.color);

  const parts: string[] = [];
  if (run.bookEnded === false && !m.opening) { parts.push(vary(seed, BOOK_ENDS, 'bookend')); run.bookEnded = true; }
  parts.push(reactFor(seed, q, byStudent, { san: label(m), who: whoName(c, m.color), n: Math.floor(m.index / 2) + 1 }));

  // continuity: did the student just punish a gift?
  if (byStudent && prev && !isStudent(c, prev.color) && (prev.quality === 'blunder' || prev.quality === 'mistake') && (m.isBestMove || STRONG.includes(q) || q === 'best' || q === 'excellent')) {
    parts.push(vary(seed, PUNISHED, 'punish'));
  }

  const doing = whatItDoes(m, c, seed);
  parts.push(doing.text);

  const bs = bestSan(m);
  if (!m.isBestMove && bs && (q === 'good' || q === 'excellent') && (m.winPercentLoss ?? 0) > 0.8) {
    parts.push(`The engine would have picked **${bs}** by a hair, but this is close enough.`);
  }

  const scan = scanLine(m, c, seed, hash(seed + 'scan') % 3 === 0);
  if (scan.text) parts.push(scan.text);

  // streaks, comeback
  if (byStudent) {
    run.studentGoodStreak += 1;
    if (run.studentGoodStreak >= 4 && !run.streakShown) { parts.push(vary(seed, STREAK_GOOD, 'streak')); run.streakShown = true; }
  }
  const band = mp == null ? null : evalBand(mp);
  if (byStudent && !run.comebackShown && mp != null && run.recent.length >= 4 && Math.min(...run.recent) <= -1 && mp >= Math.min(...run.recent) + 2.5) {
    parts.push(vary(seed, COMEBACK, 'comeback')); run.comebackShown = true;
  }
  if (band && band !== run.lastBand && mp != null && (m.evalAfter) && (m.index % 4 === 3 || Math.abs((mp ?? 0)) >= 2.5)) {
    parts.push(evalTalk(seed, mp, formatEval(m.evalAfter)));
  } else if (!scan.text && hash(seed + 'plan') % 4 === 1 && byStudent) {
    parts.push(planFor(seed, phase, standingOf(mp)));
  }
  run.lastBand = band;

  // The scene must show everything the text names: the move's own arrows plus the opponent's options.
  const allArrows = [...doing.arrows, ...scan.arrows];
  const head = scene(m, parts.join(' '), {
    arrows: allArrows, chip: `${label(m)} · ${q[0].toUpperCase() + q.slice(1)}`, quality: q,
    // plain = clear the board preview; only do that when the text has nothing to draw.
    plain: allArrows.length <= 1 && !STRONG.includes(q),
  });

  // brilliant / great: add the full explanation from coach-explain (sacrifice, only move, follow-up)
  let body: GameScene[] = [];
  if (STRONG.includes(q)) {
    const core = buildCoreScenes(inputFor(m, c.depth, c.level)).slice(0, 3);
    body = core;
    // The head already reacted, so the first core scene only adds its chip + arrows when it has more to say.
    if (body.length) head.chip = `${label(m)} · ${q === 'brilliant' ? 'Brilliant' : 'Great'}`;
  }
  return { id: `m${m.index}`, moveIndex: m.index, kind: 'good', quality: q, byStudent, head: [head], body, tail: [] };
}

function buildBad(m: AnalyzedMove, c: Ctx, run: Run, prev: AnalyzedMove | null, prev2: AnalyzedMove | null): GameBeat {
  const seed = `${m.index}:${m.san}`;
  const byStudent = isStudent(c, m.color);
  const q = m.quality;
  const inp = inputFor(m, c.depth, c.level);
  const mv = uciOf(m.fenBefore, m.san);
  const phase = analyzePhase(m.fenAfter) as Phase;
  run.studentGoodStreak = byStudent ? 0 : run.studentGoodStreak;

  // ---- head: the reaction, with the continuity line first
  const intro: string[] = [];
  if (run.bookEnded === false && !m.opening) { intro.push(vary(seed, BOOK_ENDS, 'bookend')); run.bookEnded = true; }
  intro.push(reactFor(seed, q, byStudent, { san: label(m), who: whoName(c, m.color), n: Math.floor(m.index / 2) + 1 }));
  if (byStudent && prev && !isStudent(c, prev.color) && (prev.quality === 'blunder' || prev.quality === 'mistake')) intro.push(vary(seed, WASTED_GIFT, 'gift'));
  if (byStudent && prev2 && isStudent(c, prev2.color) && isBad(prev2.quality) && (q === 'blunder' || q === 'mistake')) intro.push(vary(seed, SNOWBALL, 'snow'));
  if (byStudent) intro.push(`I am going to slow down here, because ${q === 'inaccuracy' ? 'small slips add up' : 'this is where the game changes'}.`);
  else intro.push('Look at what they left behind.');
  const headScene = scene(m, intro.join(' '), {
    arrows: mv ? [{ from: mv.from, to: mv.to, color: 'red' }] : [], chip: `${label(m)} · ${q[0].toUpperCase() + q.slice(1)}`, quality: q,
  });

  // ---- body: the engine line + why + result + better move (all verified in coach-explain)
  const body: GameScene[] = buildCoreScenes(inp);

  // ---- tail: what was missed, what they can do now, the habit
  const tail: GameScene[] = [];
  const miss = (q === 'miss' || q === 'mistake' || q === 'blunder') ? missedTactic(m.fenBefore, m.color, m.san) : null;
  if (miss) {
    tail.push({
      fen: miss.fen, from: miss.from, to: miss.to, san: miss.san, uci: miss.from + miss.to + (miss.promotion ?? ''),
      text: parseSegs(`${byStudent ? 'Here is what was on the board before your move' : 'And here is what they had instead'}: **${miss.san}**, which ${miss.does}. ${say(seed, ['This is why you run checks, captures and attacks for yourself too, not only for them.', 'The board is a big place. Shots like this hide in plain sight.', 'Not easy to spot, so do not beat yourself up. Just add it to the scan.'], {}, 'missed')}`),
      arrows: miss.arrows.map((a, i) => ({ from: a.from, to: a.to, color: i === 0 ? 'green' as const : 'blue' as const })),
      chip: 'Missed shot', plain: false,
    });
  }

  // the opponent's best options right after the move
  const dangerNow = threats(m.fenAfter, other(m.color), 3).filter((t) => t.score >= 20 || t.kind === 'mate');
  const cause = moveCause(inp);
  const habitSeed = seed + ':h';
  const closing: string[] = [];
  if (dangerNow.length && byStudent) {
    closing.push(`Right now, ${whoName(c, other(m.color))} can play ${joinList(dangerNow.slice(0, 2).map((t) => `**${t.san}** (${t.does})`))}.`);
  }
  if (q === 'blunder' && byStudent) closing.push(hash(seed + 'an') % 2 === 0 ? analogyFor(seed) : dramaFor(seed));
  closing.push(habitFor(habitSeed, cause?.id));
  if (q === 'blunder' && byStudent) closing.push(vary(seed, ABSORB, 'absorb'));
  closing.push(planFor(seed + 'p', phase, standingOf(moverPawns(m.evalAfter, m.color))));

  // Draw the opponent's options the text names ("Right now, they can play ...").
  const closingArrows = dangerNow.length && byStudent ? threatArrows(dangerNow.slice(0, 2) as any) : [];
  tail.push(scene(m, closing.join(' '), { arrows: closingArrows, chip: 'Takeaway', plain: false, withEval: true }));

  return { id: `m${m.index}`, moveIndex: m.index, kind: 'bad', quality: q, byStudent, head: [headScene], body, tail, deepInput: inp };
}

// ===========================================================================
// The whole game
// ===========================================================================

function bookBeat(book: AnalyzedMove[], c: Ctx): GameBeat {
  const last = book[book.length - 1];
  const n = book.length;
  const name = last.opening?.name ? `${last.opening.name}${last.opening.eco ? ' (' + last.opening.eco + ')' : ''}` : '';
  const seed = `book:${n}`;
  const text = name
    ? say(seed, BOOK_RUN, { n: Math.ceil(n / 2), name })
    : say(seed, BOOK_RUN_NONAME, { n: Math.ceil(n / 2) });
  const s = scene(last, text, { chip: `Opening · ${n} book moves`, plain: true, quality: 'book' });
  return { id: `book`, moveIndex: last.index, kind: 'book', quality: 'book', byStudent: true, head: [s], body: [], tail: [] };
}

function endBeat(last: AnalyzedMove, c: Ctx): GameBeat | null {
  let over = false, mate = false;
  try { const ch = new Chess(last.fenAfter); over = ch.isGameOver(); mate = ch.isCheckmate(); } catch { /* ignore */ }
  if (!over) return null;
  const seed = `end:${last.index}`;
  const byStudent = isStudent(c, last.color);
  const text = mate
    ? (byStudent ? vary(seed, MATE_DELIVERED) : vary(seed, MATE_RECEIVED))
    : 'The game ends in a draw. Always check if a draw was the right result in that position.';
  return { id: 'end', moveIndex: last.index, kind: 'end', byStudent, head: [scene(last, text, { chip: mate ? 'Checkmate' : 'Draw', plain: true })], body: [], tail: [] };
}

function summaryBeat(moves: AnalyzedMove[], c: Ctx): GameBeat {
  const last = moves[moves.length - 1];
  const acc = computeAccuracy(moves);
  const counts = (color: Side) => countByQuality(moves.filter((m) => m.color === color));
  const stu: Side = c.you ?? 'w';
  const sc = counts(stu);
  const badN = sc.blunders * 3 + sc.mistakes * 2 + sc.inaccuracies + sc.missMoves * 2;
  const seed = 'summary';
  // turning point = biggest win-chance drop
  let tp: AnalyzedMove | null = null;
  for (const m of moves) if (m.winPercentLoss != null && (!tp || m.winPercentLoss > (tp.winPercentLoss ?? 0))) tp = m;
  const mood = sc.blunders + sc.mistakes === 0 ? SUMMARY_GOOD_GAME : badN >= 10 ? SUMMARY_ROUGH : SUMMARY_ROLLERCOASTER;
  const parts: string[] = [vary(seed, SUMMARY_LEAD, 'lead'), vary(seed, mood, 'mood')];
  if (c.you) parts.push(`Your accuracy was **${acc[stu === 'w' ? 'white' : 'black']}%** against **${acc[stu === 'w' ? 'black' : 'white']}%** for your opponent.`);
  else parts.push(`White finished at **${acc.white}%** accuracy, Black at **${acc.black}%**.`);
  parts.push(`You had ${sc.blunders} blunder${sc.blunders === 1 ? '' : 's'}, ${sc.mistakes} mistake${sc.mistakes === 1 ? '' : 's'} and ${sc.inaccuracies} inaccurac${sc.inaccuracies === 1 ? 'y' : 'ies'}${sc.brilliantMoves + sc.greatMoves ? `, plus ${sc.brilliantMoves + sc.greatMoves} brilliant or great move${sc.brilliantMoves + sc.greatMoves === 1 ? '' : 's'}` : ''}.`.replace('You had', c.you ? 'You had' : `${stu === 'w' ? 'White' : 'Black'} had`));
  if (tp && (tp.winPercentLoss ?? 0) >= 8) {
    parts.push(`${vary(seed, TURNING_POINT, 'tp')} It was **${label(tp)}**: ${fill(vary(seed, BIG_SWING, 'swing'), { swing: Math.round(tp.winPercentLoss ?? 0) })}`);
  }
  // most common cause among the student's mistakes
  const ids = moves.filter((m) => isStudent(c, m.color) && isBad(m.quality) && m.quality !== 'inaccuracy')
    .map((m) => moveCause(inputFor(m, c.depth, c.level))?.id).filter(Boolean) as any[];
  const cs = ids.length ? causeSummary(ids) : null;
  if (cs) parts.push(cs);
  parts.push(vary(seed, HOMEWORK, 'hw'));
  const s = scene(tp && (tp.winPercentLoss ?? 0) >= 8 ? tp : last, parts.join(' '), {
    fen: tp && (tp.winPercentLoss ?? 0) >= 8 ? tp.fenBefore : last.fenAfter, chip: 'Game summary', plain: false,
    arrows: tp && tp.evalBefore?.bestMove && tp.evalBefore.bestMove.length >= 4
      ? [{ from: tp.evalBefore.bestMove.slice(0, 2) as Square, to: tp.evalBefore.bestMove.slice(2, 4) as Square, color: 'green' }] : [],
  });
  return { id: 'summary', moveIndex: tp && (tp.winPercentLoss ?? 0) >= 8 ? Math.max(0, tp.index - 1) : last.index, kind: 'summary', byStudent: true, head: [s], body: [], tail: [] };
}

/** Builds every beat of the game (no engine calls: the game is already analyzed). */
function* beatSteps(moves: AnalyzedMove[], opt: GameCoachOptions): Generator<number, GameBeat[], void> {
  if (!moves.length) return [];
  const c: Ctx = { you: opt.you, depth: opt.depth, level: opt.level };
  const beats: GameBeat[] = [];
  const run: Run = { studentGoodStreak: 0, streakShown: false, lastBand: null, recent: [], comebackShown: false, bookEnded: false };
  const first = moves[0];

  // intro
  const side = c.you === 'w' ? 'You are White.' : c.you === 'b' ? 'You are Black.' : '';
  const opening = [...moves].reverse().find((m) => m.opening)?.opening;
  beats.push({
    id: 'intro', moveIndex: 0, kind: 'intro', byStudent: true, body: [], tail: [],
    head: [scene(first, [vary('intro', GAME_INTRO, 'i'), side, opening ? `Opening: **${opening.name}**.` : ''].filter(Boolean).join(' '), { chip: 'Game review', plain: true, withEval: false })],
  });

  // leading book moves collapse into ONE beat
  let i = 0;
  while (i < moves.length && moves[i].quality === 'book') i++;
  if (i >= 2) beats.push(bookBeat(moves.slice(0, i), c));
  else i = 0;
  if (i > 0) run.bookEnded = false;
  else run.bookEnded = true;

  for (; i < moves.length; i++) {
    yield i / moves.length; // lets prepareGameBeats() hand the thread back to the page between moves
    const m = moves[i];
    const prev = i > 0 ? moves[i - 1] : null;
    const prev2 = i > 1 ? moves[i - 2] : null;
    const student = isStudent(c, m.color);
    if (student && m.evalAfter) { const p = moverPawns(m.evalAfter, m.color); if (p != null) { run.recent.push(p); if (run.recent.length > 8) run.recent.shift(); } }

    if (m.quality === 'book') {
      // a stray book move after the collapsed run: keep it silent, it is theory
      continue;
    }
    const bad = isBad(m.quality);
    const strong = STRONG.includes(m.quality);
    if (opt.detail === 'highlights' && !bad && !strong) { if (!m.opening) run.bookEnded = true; continue; }

    beats.push(bad ? buildBad(m, c, run, prev, prev2) : buildGood(m, c, run, prev, prev2));
    if (!m.opening) run.bookEnded = true;
  }

  const end = endBeat(moves[moves.length - 1], c);
  if (end) beats.push(end);
  beats.push(summaryBeat(moves, c));
  return beats;
}

/** Synchronous version (blocks the page on long games: prefer prepareGameBeats in the UI). */
export function buildGameBeats(moves: AnalyzedMove[], opt: GameCoachOptions): GameBeat[] {
  const g = beatSteps(moves, opt);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/**
 * Same beats, built in small slices (about one frame each) so the page keeps painting and a loading bar can move.
 * `onProgress` gets 0..1. Resolves to null when cancelled.
 */
export async function prepareGameBeats(
  moves: AnalyzedMove[], opt: GameCoachOptions,
  onProgress?: (fraction: number) => void, isCancelled: () => boolean = () => false,
): Promise<GameBeat[] | null> {
  const g = beatSteps(moves, opt);
  let sliceStart = performance.now();
  for (;;) {
    const r = g.next();
    if (r.done) return isCancelled() ? null : r.value;
    if (isCancelled()) return null;
    if (performance.now() - sliceStart > 12) {
      onProgress?.(r.value);
      await new Promise<void>((res) => setTimeout(res, 0));
      sliceStart = performance.now();
    }
  }
}

// ===========================================================================
// Timeline + engine-assisted deepening (the look-ahead on bad moves)
// ===========================================================================

/** One flat list of everything the player plays, with `deep` overriding the body of bad beats. */
export function flattenBeats(beats: GameBeat[], deep: Record<string, GameScene[]> = {}): TimelineItem[] {
  const out: TimelineItem[] = [];
  beats.forEach((b, bi) => {
    const scenes = [...b.head, ...(deep[b.id] ?? b.body), ...b.tail];
    scenes.forEach((s, si) => out.push({
      key: `${b.id}:${si}`, beatId: b.id, beatIndex: bi, moveIndex: b.moveIndex, scene: s, firstOfBeat: si === 0,
    }));
  });
  return out;
}

/**
 * Engine look-ahead for ONE bad move: threats, danger, missed tactics, the opponent's plan, why-not-the-others,
 * positional notes (all inside buildAdvancedExplanation). Returns the new body, or null if cancelled / nothing found.
 * The caller swaps it in with flattenBeats(beats, { [beat.id]: body }).
 */
export async function deepenBeat(beat: GameBeat, isCancelled: () => boolean): Promise<GameScene[] | null> {
  if (!beat.deepInput) return null;
  try {
    const all = await buildAdvancedExplanation(beat.deepInput, isCancelled);
    if (isCancelled() || !all.length) return null;
    return all as GameScene[]; // every scene, including the "extra" ones: this is the deep dive on a mistake
  } catch { return null; }
}

/** The beats that are worth deepening, in game order (bad moves by the student first, then the opponent's). */
export const deepCandidates = (beats: GameBeat[]) => beats.filter((b) => b.kind === 'bad' && b.deepInput);

/** Same scene on the board? (Keeps the learner on the same step when the body is replaced mid-playback.) */
export const sameGameScene = (a: Scene, b: Scene) =>
  a.fen === b.fen && a.uci === b.uci && a.text.map((s) => s.t).join('') === b.text.map((s) => s.t).join('');
