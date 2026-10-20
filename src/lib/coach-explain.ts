/**
 * Advanced coach: turns a reviewed move into a short "movie" of scenes.
 * Every sentence is built from facts verified with chess.js + the engine (no guessing, no API key needed).
 *
 * Scene text markup:  **key**   ++good++   ~~bad~~
 */
import { Chess, type Square } from 'chess.js';
import { analyzePosition, evalToPawns, formatEval } from '@/lib/engine';
import { classifyMove } from '@/lib/analysis';
import { detectKnightFork } from '@/lib/knight-fork';
import { describeTactics, winnableCaptures } from '@/lib/tactics';
import { tacticalMoves } from '@/lib/tactics-lookahead';
import { moveInsights, movePurpose, positionFacts, coachPlan, analyzePhase, type Fact, type FactKind } from '@/lib/positional';
import { material, netMaterial, lineOutcome, settleLine, verifyClaim, type LineEnd } from '@/lib/claim-check';
// The coach's personality for the sentences below (deterministic, so the same move always gets the same wording).
import {
  goodOpen, badOpen, topChoice, answerVerb, thenLead, resultLead, blunderAnalogy, betterText,
  causeLead, habitFor, missedVerb, whereLead, retryPrompt, retryOk, whyNotLead,
} from '@/lib/coach-voice';
// HOW the coach explains: the order of thought (react, read, sweep, compare, if-then, score, translate, rule).
import { ccaText, criteriaIntro, criteriaClose, wantsText, watchLead, principleTail } from '@/lib/coach-method';
// The line checks live in claim-check.ts (pure chess.js, unit-tested); re-exported so existing imports keep working.
export { lineOutcome };
export type { LineEnd };

export type Seg = { t: string; hl?: 'key' | 'good' | 'bad' };
/** What the eval bar shows for a scene (white's point of view, like the main bar). */
export interface SceneEval { pawns: number; mate: number | null; label: string }
export type ArrowColor = 'green' | 'red' | 'blue' | 'yellow';
export interface SceneArrow { from: Square; to: Square; color: ArrowColor }

export interface Scene {
  fen: string;
  from: Square;
  to: Square;
  san: string;
  uci: string;
  text: Seg[];
  arrows: SceneArrow[];
  /** Small label above the text, e.g. "Better move", "Why not Qxd5?" */
  chip?: string;
  /** Extra squares to light up on the board (besides the ones named in the text). */
  squares?: Square[];
  /** Set on "Threat" scenes: the move that is threatened, so later scenes can point at it again. */
  threat?: { san: string; does: string; afterCheck: boolean; arrows: SceneArrow[] };
  /** Extra detail: hidden by default, shown when the player taps "Show more" (see visibleScenes). */
  extra?: boolean;
  /** Set on the "Why" scene of a mistake, so the app can count the player's typical mistakes over a game. */
  cause?: { id: CauseId; label: string };
  /** Engine evaluation of THIS scene's position: the eval bar follows it while the scene is on the board. */
  evalInfo?: SceneEval;
  /** Engine verdict on the move this scene shows: brilliant / best / great / excellent / good / inaccuracy / mistake / miss / blunder. */
  quality?: string;
  /** Stockfish's best move from this scene's position (also drawn as a blue arrow). */
  best?: { san: string; uci: string };
  /**
   * Set by the player while the coach is SPEAKING this scene: only squares the voice has already named should light up
   * (instead of every square in the text at once). `done` = the sentence is finished. Absent = light everything (paused / muted).
   */
  spoken?: { named: Square[]; current: Square[]; done: boolean };
}

export type CauseId = 'hung-piece' | 'ignored-threat' | 'missed-tactic' | 'allowed-tactic' | 'greedy' | 'positional' | 'stalemate-trap';

export interface ExplainInput {
  fenBefore: string;
  fenAfter: string;
  san: string;
  color: 'w' | 'b';
  quality: string;
  isPlayedBest: boolean;
  bestUci?: string | null;
  evalBefore?: any;
  evalAfter?: any;
  depth: number;
  /** Who is learning: beginners get the short, simple version; advanced players get everything. Default: intermediate. */
  level?: CoachLevel;
}

export type CoachLevel = 'beginner' | 'intermediate' | 'advanced';
/** Rating -> level (rough: under 1000 beginner, 1000-1800 intermediate, above advanced). */
export const levelFromRating = (rating?: number | null): CoachLevel =>
  rating == null ? 'intermediate' : rating < 1000 ? 'beginner' : rating < 1800 ? 'intermediate' : 'advanced';
/** Advanced players want all the detail straight away; others get the short version with "Show more". */
export const showAllByDefault = (level?: CoachLevel) => level === 'advanced';

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const BAD = ['blunder', 'mistake', 'inaccuracy', 'miss'];
const WORD: Record<string, string> = {
  brilliant: 'a brilliant move', best: 'the best move', great: 'a great move', excellent: 'an excellent move',
  good: 'a good move', book: 'a book move', inaccuracy: 'an ~~inaccuracy~~', mistake: 'a ~~mistake~~',
  miss: 'a ~~miss~~', blunder: 'a ~~blunder~~',
};

const sideName = (c: 'w' | 'b') => (c === 'w' ? 'White' : 'Black');
const other = (c: 'w' | 'b'): 'w' | 'b' => (c === 'w' ? 'b' : 'w');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const article = (w: string) => (/^[aeiou]/.test(w) ? 'an' : 'a');
/** "a **fork**", "an **x-ray**", "**checkmate**": the tactic's name as a coach would say it. */
const named = (name: string) => {
  const n = name.toLowerCase();
  if (n === 'checkmate' || n.startsWith('removing')) return `**${n}**`;
  if (n.startsWith('greek')) return 'the classic **Greek gift**';
  return `${article(n)} **${n}**`;
};
/** Turns a tactic's verb phrase into a clause that does not repeat the tactic's name ("That's a fork: it attacks ..."). */
const howClause = (t: { kind: string; text: string }) => {
  switch (t.kind) {
    case 'fork': return `it attacks the ${t.text.replace(/^forks the /, '')} at once`;
    case 'skewer': return `it attacks the ${t.text.replace(/^skewers the /, '')}`;
    case 'pin': return `it ties the ${t.text.replace(/^pins the /, '')}`;
    case 'mate-threat': return `it sets up ${t.text.replace(/^threatens /, '')}`;
    case 'double-check': return 'two pieces attack the king at once, so it has to move';
    case 'trapped': return `it ${t.text.replace(/^traps /, 'attacks ').replace(': it is attacked and has no safe square to go to', ', and it has nowhere safe to go')}`;
    default: return `it ${t.text}`;
  }
};

export function parseSegs(s: string): Seg[] {
  return s.split(/(\*\*.+?\*\*|\+\+.+?\+\+|~~.+?~~)/g).filter(Boolean).map((p) => {
    if (p.startsWith('**')) return { t: p.slice(2, -2), hl: 'key' as const };
    if (p.startsWith('++')) return { t: p.slice(2, -2), hl: 'good' as const };
    if (p.startsWith('~~')) return { t: p.slice(2, -2), hl: 'bad' as const };
    return { t: p };
  });
}
export const plainText = (segs: Seg[]) => segs.map((s) => s.t).join('');
/**
 * Squares a scene's text talks about ("a1", "the knight on e5", "Rxb7" -> b7), so the board can light them up.
 * The lookbehind skips letters inside words but allows capital piece letters and the "x" of a capture.
 */
export function sceneSquares(scene: Scene, max = 8): Square[] {
  // While the voice is speaking, light only what has been said so far (extra squares appear when the sentence ends).
  if (scene.spoken) {
    return [...new Set([...(scene.spoken.done ? scene.squares ?? [] : []), ...scene.spoken.named])].slice(0, max) as Square[];
  }
  const found = plainText(scene.text).match(/(?<![a-wyz0-9])[a-h][1-8](?![a-z0-9])/g) ?? [];
  return [...new Set([...(scene.squares ?? []), ...found])].slice(0, max) as Square[];
}
/** The square the voice is saying right now (for a brighter highlight), or [] when not speaking. */
export const sceneCurrentSquares = (scene: Scene): Square[] => scene.spoken?.current ?? [];
export interface SceneLine { label: string; squares: Square[] }

/**
 * Lines (files, the 7th rank, diagonals) a scene's text talks about, so the board can colour the whole line.
 *  - "the d-file" / "open e-file"        -> every square of that file
 *  - "seventh rank"                       -> that rank (the one of the first square named: 7 or 2)
 *  - "...bishop on b7 rakes a diagonal"   -> the open rays of the bishop / queen on the first square named
 */
export function sceneLines(scene: Scene): SceneLine[] {
  // Files / ranks / diagonals appear once the sentence has been spoken, not when the text shows up.
  if (scene.spoken && !scene.spoken.done) return [];
  const text = plainText(scene.text);
  const named = (text.match(/(?<![a-wyz0-9])[a-h][1-8](?![a-z0-9])/g) ?? []) as string[];
  const out: SceneLine[] = [];
  for (const f of new Set([...text.matchAll(/\b([a-h])-file\b/g)].map((m) => m[1]))) {
    out.push({ label: `${f}-file`, squares: [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${f}${r}` as Square) });
  }
  if (/\b(seventh|7th) rank\b/.test(text)) {
    const r = named.map((q) => Number(q[1])).find((n) => n === 7 || n === 2) ?? 7;
    out.push({ label: `${r === 7 ? '7th' : '2nd'} rank`, squares: 'abcdefgh'.split('').map((f) => `${f}${r}` as Square) });
  }
  if (/diagonal/.test(text) && named.length) {
    try {
      const c = new Chess(scene.fen);
      const start = named[0];
      const piece = c.get(start as Square);
      if (piece && (piece.type === 'b' || piece.type === 'q')) {
        const f0 = start.charCodeAt(0) - 97, r0 = Number(start[1]) - 1;
        const rays: Square[][] = [];
        for (const [df, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const ray: Square[] = [];
          let f = f0 + df, r = r0 + dr;
          while (f >= 0 && f < 8 && r >= 0 && r < 8) {
            const q = ('abcdefgh'[f] + (r + 1)) as Square;
            ray.push(q);
            if (c.get(q)) break;
            f += df; r += dr;
          }
          if (ray.length >= 2) rays.push(ray);
        }
        const best = rays.sort((a, b) => b.length - a.length).slice(0, 2).flat();
        if (best.length) out.push({ label: /long diagonal/.test(text) ? 'long diagonal' : 'diagonal', squares: best });
      }
    } catch { /* ignore */ }
  }
  return out.slice(0, 3);
}
/** Reading time for a scene (ms). */
export const sceneDuration = (s: Scene) => Math.min(9000, Math.max(3200, plainText(s.text).length * 62));

// ---------- chess helpers ----------

/** Same position, but with `side` to move (so we can ask "what could this side capture?"). */
function movesFor(fen: string, side: 'w' | 'b') {
  try {
    const f = fen.split(' ');
    f[1] = side;
    f[3] = '-';
    return new Chess(f.join(' ')).moves({ verbose: true });
  } catch {
    return [];
  }
}

function materialPhrase(n: ReturnType<typeof netMaterial>): string | null {
  if (n.swing <= -1 && n.worst) return `ends up ~~down ${article(NAME[n.worst])} ${NAME[n.worst]}~~`;
  if (n.swing >= 1 && n.best) return `ends up ++up ${article(NAME[n.best])} ${NAME[n.best]}++`;
  return null;
}

/** Can the opponent win the piece that just moved to `sq`? */
function hangingInfo(fenAfter: string, sq: Square, mover: 'w' | 'b') {
  const opp = other(mover);
  let best: { from: Square; victim: string; attacker: string; free: boolean; gain: number } | null = null;
  for (const m of movesFor(fenAfter, opp)) {
    if (m.to !== sq || !m.captured || m.captured === 'k') continue;
    let recapture = false;
    try {
      const c = new Chess(fenAfter.split(' ').map((x, i) => (i === 1 ? opp : i === 3 ? '-' : x)).join(' '));
      c.move(m.san);
      recapture = movesFor(c.fen(), mover).some((r) => r.to === sq && r.captured);
    } catch { /* ignore */ }
    const gain = recapture ? VAL[m.captured] - VAL[m.piece] : VAL[m.captured];
    if (gain >= 1 && (!best || gain > best.gain)) {
      best = { from: m.from as Square, victim: m.captured, attacker: m.piece, free: !recapture, gain };
    }
  }
  return best;
}

/** Enemy pieces the piece on `sq` attacks and could win (bigger piece, or undefended). */
function threatsFrom(fenAfter: string, sq: Square, mover: 'w' | 'b') {
  const out: { square: Square; piece: string }[] = [];
  for (const m of movesFor(fenAfter, mover)) {
    if (m.from !== sq || !m.captured || m.captured === 'k') continue;
    let defended = false;
    try {
      const c = new Chess(fenAfter.split(' ').map((x, i) => (i === 1 ? mover : i === 3 ? '-' : x)).join(' '));
      c.move(m.san);
      defended = movesFor(c.fen(), other(mover)).some((r) => r.to === m.to && r.captured);
    } catch { /* ignore */ }
    if (!defended || VAL[m.captured] > VAL[m.piece]) out.push({ square: m.to as Square, piece: m.captured });
  }
  return out.sort((x, y) => VAL[y.piece] - VAL[x.piece]);
}

type PlyMove = { from: string; to: string; san: string; piece: string; captured?: string; promotion?: string; color: 'w' | 'b'; flags: string };

function describeMove(m: PlyMove): string {
  if (m.flags.includes('k')) return `${sideName(m.color)} castles short`;
  if (m.flags.includes('q')) return `${sideName(m.color)} castles long`;
  let s = m.captured
    ? `${cap(NAME[m.piece])} takes **${NAME[m.captured]}** on ${m.to}`
    : `${cap(NAME[m.piece])} to ${m.to}`;
  if (m.promotion) s += ` and promotes to a ${NAME[m.promotion]}`;
  if (m.san.endsWith('#')) s += ' with **checkmate**';
  else if (m.san.endsWith('+')) s += ' with **check**';
  return s;
}

function mk(fen: string, m: { from: string; to: string; san: string; promotion?: string }, text: string, arrows: SceneArrow[], chip?: string): Scene {
  return {
    fen, from: m.from as Square, to: m.to as Square, san: m.san,
    uci: m.from + m.to + (m.promotion ?? ''), text: parseSegs(text), arrows, chip,
  };
}

const colorArrows = (arrows: { from: Square; to: Square }[], color: ArrowColor): SceneArrow[] =>
  arrows.map((a) => ({ ...a, color }));

/** Label shown on the chip, and the color of the tactic's lines on the board. */
const KIND_LABEL: Record<string, string> = {
  mate: 'Checkmate', 'double-check': 'Double check', 'greek-gift': 'Greek gift', 'remove-defender': 'Removing the defender',
  trapped: 'Trapped piece', fork: 'Fork', pin: 'Pin', skewer: 'Skewer', discovered: 'Discovered attack',
  'mate-threat': 'Mate threat', promotion: 'Promotion', capture: 'Wins material',
};
const KIND_COLOR: Record<string, ArrowColor> = {
  mate: 'green', 'double-check': 'yellow', 'greek-gift': 'yellow', 'remove-defender': 'blue', trapped: 'blue', fork: 'yellow', pin: 'blue', skewer: 'blue', discovered: 'blue',
  'mate-threat': 'yellow', promotion: 'yellow', capture: 'blue',
};

/** Lines for a tactic found by describeTactics (they start at the piece that just moved). */
const tacticArrows = (t: { kind: string; arrows: { from: Square; to: Square }[] }): SceneArrow[] =>
  t.arrows.map((a) => ({ ...a, color: KIND_COLOR[t.kind] ?? 'blue' }));

/** Lines for a ThreatItem: the first arrow is the move itself, the rest are the tactic. */
const itemArrows = (it: { kind: string; arrows: { from: Square; to: Square }[] }, moveColor: ArrowColor): SceneArrow[] =>
  it.arrows.map((a, i) => ({ ...a, color: i === 0 ? moveColor : KIND_COLOR[it.kind] ?? 'blue' }));

/** The most meaningful tactic a move created (forks of two pawns and promotion threats are skipped). */
function pickTactic(fenBefore: string, m: PlyMove, fenAfter: string) {
  try {
    return describeTactics(fenBefore, m as any, fenAfter).find(
      (t) =>
        t.kind !== 'promotion' &&
        !(t.kind === 'fork' && !/king|queen|rook|knight|bishop/.test(t.text)) &&
        // a pawn "pinned" to a rook is not worth announcing: only pins against the king or queen
        !(t.kind === 'pin' && !/to the (king|queen)/.test(t.text)),
    ) ?? null;
  } catch { return null; }
}

/**
 * Did this move save one of the mover's own pieces that the opponent could have won?
 * (moves it away, captures the attacker, or protects it so the capture no longer pays)
 */
function protects(fenBefore: string, m: PlyMove, fenAfter: string, mover: 'w' | 'b'): string | null {
  try {
    const opp = other(mover);
    const still = new Set(winnableCaptures(fenAfter, opp).map((c) => c.from + c.to));
    for (const c of winnableCaptures(fenBefore, opp)) {
      if (VAL[c.victim] < 3) continue;
      if (c.to === m.from) {
        // the moved piece was the one attacked: did it reach safety?
        if (!winnableCaptures(fenAfter, opp).some((x) => x.to === m.to)) return `moves the ${NAME[c.victim]} out of attack`;
        continue;
      }
      if (still.has(c.from + c.to)) continue;
      if (m.to === c.from) return `captures the ${NAME[c.attacker]} that was attacking the ${NAME[c.victim]} on ${c.to}`;
      return `protects the ${NAME[c.victim]} on ${c.to}`;
    }
  } catch { /* ignore */ }
  return null;
}

const moverPawns = (ev: any, c: 'w' | 'b'): number | null => {
  if (!ev) return null;
  try {
    const p = evalToPawns(ev);
    return typeof p === 'number' && Number.isFinite(p) ? (c === 'w' ? p : -p) : null;
  } catch { return null; }
};


// ---------- Stockfish checks, how a line ENDS, and the story of the position ----------

const uciMove = (u: string) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
const pvOf = (ev: any): string[] => ((ev?.continuation ?? '') as string).split(/\s+/).filter(Boolean);
/** The engine's line AFTER its own move `uci`: the rest of the principal variation, or undefined when the line does not start with that move. */
const restAfter = (ev: any, uci: string): string[] | undefined => {
  const pv = pvOf(ev);
  return pv.length && pv[0].slice(0, 4) === uci.slice(0, 4) ? pv.slice(1) : undefined;
};
const joinList = (parts: string[]) => (parts.length <= 1 ? parts[0] ?? '' : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]);

const evCache = new Map<string, any>();
/** analyzePosition with a small cache, so the same position is never searched twice. */
async function engineEval(fen: string, depth: number): Promise<any> {
  const key = `${fen}|${depth}`;
  if (evCache.has(key)) return evCache.get(key);
  const ev = await analyzePosition(fen, depth);
  evCache.set(key, ev);
  if (evCache.size > 300) evCache.delete(evCache.keys().next().value as string);
  return ev;
}

const END_WORD: Record<LineEnd['kind'], string> = {
  stalemate: '**stalemate**', insufficient: 'a draw by **insufficient material**', repetition: 'a draw by **repetition**',
  fifty: 'a draw by the **fifty-move rule**', mate: '**checkmate**',
};

/** Engine lines are short. If the line stops before the game does, ask the engine to carry on (a few rounds) to see where it ends. */
async function followToEnd(fen: string, ucis: string[], isCancelled: () => boolean): Promise<{ end: LineEnd | null; line: string[] }> {
  let line = [...ucis];
  let end = lineOutcome(fen, line);
  for (let round = 0; !end && round < 3 && line.length < 40; round++) {
    if (isCancelled()) break;
    try {
      const c = new Chess(fen);
      for (const u of line) c.move(uciMove(u));
      if (c.isGameOver()) break;
      const more = pvOf(await engineEval(c.fen(), 12));
      if (!more.length) break;
      line = [...line, ...more];
    } catch { break; }
    end = lineOutcome(fen, line);
  }
  return { end, line };
}

/** The player was losing (or clearly worse) and the engine now says the game is a draw. */
const savesDraw = (before: number | null, after: number | null) =>
  before != null && after != null && before <= -1.5 && Math.abs(after) <= 0.4;
/** The player was clearly winning and the game is now a draw. */
const throwsAwayWin = (before: number | null, after: number | null) =>
  before != null && after != null && before >= 1.5 && Math.abs(after) <= 0.4;

/** How many pawns `side` is ahead / behind, as a plain number ("9.0"), from that side's point of view. */
const pawnGap = (ev: any, side: 'w' | 'b') => { const p = moverPawns(ev, side); return p == null ? '?' : Math.abs(p).toFixed(1); };

const pointsOf = (fen: string, side: 'w' | 'b') => {
  const m = material(fen);
  return (['p', 'n', 'b', 'r', 'q'] as const).reduce((sum, t) => sum + m[side][t] * VAL[t], 0);
};

/** "White is up a queen", "Black is up a rook for a bishop": who has more material, in words. */
function materialLine(fen: string): { text: string; diff: number; lead: 'w' | 'b' | null } {
  const m = material(fen);
  const d = pointsOf(fen, 'w') - pointsOf(fen, 'b');
  if (Math.abs(d) < 1) return { text: 'material is level', diff: 0, lead: null };
  const lead: 'w' | 'b' = d > 0 ? 'w' : 'b';
  const low = other(lead);
  const ups: string[] = [], downs: string[] = [];
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    const n = m[lead][t] - m[low][t];
    const label = (k: number) => (k === 1 ? `${article(NAME[t])} ${NAME[t]}` : `${k} ${NAME[t]}s`);
    if (n > 0) ups.push(label(n));
    else if (n < 0) downs.push(label(-n));
  }
  return { text: `${sideName(lead)} is up ${joinList(ups)}${downs.length ? ` for ${joinList(downs)}` : ''}`, diff: d, lead };
}

const PHASE_WORD: Record<string, string> = { opening: 'the opening', middlegame: 'a middlegame', endgame: 'an endgame' };

/**
 * "Back to the game": what the game is REALLY about after this move. Built from Stockfish's evaluation and line,
 * set against the material on the board: who is ahead, whether the numbers and the engine disagree (and why),
 * whether the line ends in stalemate / mate / a draw, the plan, and what the engine expects next.
 */
function gameStory(inp: ExplainInput, lineEnd: LineEnd | null, drawSaved: boolean): string {
  const mover = inp.color, opp = other(mover);
  const side = sideName(mover), oppName = sideName(opp);
  const after = moverPawns(inp.evalAfter, mover);
  const whiteEval = after == null ? null : mover === 'w' ? after : -after;
  const mateN = typeof inp.evalAfter?.mate === 'number' ? inp.evalAfter.mate : 0;
  const mat = materialLine(inp.fenAfter);
  const parts: string[] = [];

  let phase = '';
  try { phase = PHASE_WORD[analyzePhase(inp.fenAfter)] ?? ''; } catch { /* ignore */ }
  parts.push(`${whereLead(inp.fenAfter)}${phase ? `it's ${phase} and ` : ''}${mat.text}.`);

  // 1. What the engine says about the position
  if (mateN !== 0) {
    parts.push(`The engine sees **checkmate in ${Math.abs(mateN)}** for ${sideName(mateN > 0 ? 'w' : 'b')}.`);
  } else if (whiteEval != null) {
    const a = Math.abs(whiteEval);
    const lead = whiteEval > 0 ? 'White' : 'Black';
    parts.push(a < 0.3
      ? `The engine calls it **equal** (${formatEval(inp.evalAfter)}).`
      : `The engine says ${lead} is ${a < 1 ? 'slightly better' : a < 2.5 ? 'clearly better' : a < 5 ? '**winning**' : '**completely winning**'} (**${formatEval(inp.evalAfter)}**).`);
  }

  // 2. What the game is about: compare the engine with the material
  const engineLead: 'w' | 'b' | null = whiteEval == null || Math.abs(whiteEval) < 0.3 ? null : whiteEval > 0 ? 'w' : 'b';
  const mismatch = !!mat.lead && Math.abs(mat.diff) >= 3 && mateN === 0 && whiteEval != null
    && (engineLead !== mat.lead || Math.abs(whiteEval) < Math.abs(mat.diff) / 3);
  if (lineEnd?.kind === 'stalemate') {
    parts.push(`The key idea is **stalemate**: ${sideName(lineEnd.stuck)} runs out of legal moves, so ${mat.lead && mat.lead !== lineEnd.stuck ? `${sideName(mat.lead)}'s extra material cannot win the game` : 'the game cannot be won by force'}.`);
  } else if (lineEnd && lineEnd.kind !== 'mate') {
    parts.push(`The engine's line ends in ${END_WORD[lineEnd.kind]}, so this is a fight for a draw, not for material.`);
  } else if (drawSaved) {
    parts.push(`${side} was losing before this move (about ${pawnGap(inp.evalBefore, mover)} pawns down) and is now holding the draw.`);
  } else if (mismatch && mat.lead) {
    parts.push(`${sideName(mat.lead)} has more material, but the engine disagrees with the numbers: ${sideName(other(mat.lead))} has real compensation (active pieces, an attack on the king, or a drawing setup).`);
  } else if (mateN === 0 && inp.level !== 'beginner') {
    try {
      const leader = engineLead ?? mover;
      const plan = coachPlan(inp.fenAfter, leader, undefined, 1)[0];
      if (plan) parts.push(`${sideName(leader)}'s plan: ${posMarkup(plan.text, 'neutral')}`);
    } catch { /* ignore */ }
  }

  // 3. What Stockfish expects next
  try {
    const u = pvOf(inp.evalAfter)[0];
    if (u) parts.push(`Stockfish expects ${oppName} to play **${new Chess(inp.fenAfter).move(uciMove(u)).san}**.`);
  } catch { /* ignore */ }
  return parts.join(' ');
}

/**
 * A good move that turns a lost game into a draw (typically a sacrifice that forces stalemate, a perpetual or a fortress).
 * If the engine's line doesn't reach the end of the game on its own, it is followed further until it does.
 */
async function drawIdea(inp: ExplainInput, isCancelled: () => boolean): Promise<{ scenes: Scene[]; end: LineEnd | null }> {
  const mover = inp.color;
  const before = moverPawns(inp.evalBefore, mover), after = moverPawns(inp.evalAfter, mover);
  if (!savesDraw(before, after)) return { scenes: [], end: null };
  const refu = pvOf(inp.evalAfter);
  const direct = lineOutcome(inp.fenAfter, refu);
  if (direct) return { scenes: [], end: direct }; // the core scenes already play it out
  const { end, line } = await followToEnd(inp.fenAfter, refu, isCancelled);
  if (!end || end.kind === 'mate' || isCancelled()) return { scenes: [], end: null };
  try {
    const c = new Chess(inp.fenAfter);
    let last: any = null;
    for (let i = 0; i <= end.ply; i++) last = c.move(uciMove(line[i]));
    const n = Math.ceil((end.ply + 1) / 2);
    const txt = end.kind === 'stalemate'
      ? `Drawing idea: if both sides follow the engine's line (${n} more move${n > 1 ? 's' : ''}), ${sideName(end.stuck)} has no legal move and is not in check. That is **stalemate**, so a lost position (about ${pawnGap(inp.evalBefore, mover)} pawns down) ends in a draw.`
      : `Drawing idea: the engine's line ends in ${END_WORD[end.kind]} after ${n} more move${n > 1 ? 's' : ''}, so a lost position (about ${pawnGap(inp.evalBefore, mover)} pawns down) ends in a draw.`;
    return { scenes: [mk(c.fen(), last, txt, [], 'Drawing idea')], end };
  } catch { return { scenes: [], end }; }
}

const withSide = (fen: string, side: 'w' | 'b') => {
  const f = fen.split(' ');
  f[1] = side;
  f[3] = '-';
  return f.join(' ');
};

interface Narrated {
  san: string; from: Square; to: Square; promotion?: string;
  /** Position after the move. */
  fen: string;
  /** Verb phrase: "forks the king on e8 and the queen on d8". */
  does: string;
  kind: string;
  arrows: { from: Square; to: Square }[];
  /** A fork / pin / mate / win of real material (not just "improves the position"). */
  tactical: boolean;
}
const MISSED_KINDS = new Set(['mate', 'double-check', 'greek-gift', 'fork', 'pin', 'skewer', 'discovered', 'remove-defender', 'trapped']);

/**
 * Puts words to a move that STOCKFISH chose. The tactic detectors only find the vocabulary ("fork", "pin", "wins the queen");
 * they never decide which move gets shown.
 */
function narrateMove(fen: string, uci: string, line?: string[]): Narrated | null {
  try {
    const c = new Chess(fen);
    const m: any = c.move(uciMove(uci));
    const after = c.fen();
    const san = (m.san as string).replace(/[+#]/g, '');
    const mv = { from: m.from as Square, to: m.to as Square };
    const base = { san, ...mv, promotion: m.promotion as string | undefined, fen: after };
    let tac = pickTactic(fen, m as PlyMove, after);
    // A fork only counts when the engine's line (after this move) really collects something.
    if (tac?.kind === 'fork' && line && !verifyClaim(after, line, { kind: 'fork', side: m.color }).ok) tac = null;
    if (tac) return { ...base, does: tac.text, kind: tac.kind, arrows: [mv, ...tac.arrows], tactical: true };
    if (m.captured && m.captured !== 'k') {
      return { ...base, does: `takes the ${NAME[m.captured]} on ${m.to}`, kind: 'capture', arrows: [mv], tactical: VAL[m.captured] >= 3 };
    }
    return { ...base, does: purpose(fen, m as PlyMove, after, m.color, line), kind: 'plan', arrows: [mv], tactical: false };
  } catch { return null; }
}

const sceneEvalOf = (ev: any): SceneEval | undefined => {
  if (!ev) return undefined;
  try {
    const p = evalToPawns(ev);
    return {
      pawns: Number.isFinite(p) ? p : 0,
      mate: typeof ev.mate === 'number' && ev.mate !== 0 ? ev.mate : null,
      label: formatEval(ev),
    };
  } catch { return undefined; }
};

const bestOf = (fen: string, ev: any): { san: string; uci: string } | undefined => {
  const uci = ev?.bestMove || pvOf(ev)[0];
  if (!uci || uci.length < 4) return undefined;
  try { return { san: new Chess(fen).move(uciMove(uci)).san, uci }; } catch { return undefined; }
};

/**
 * Gives every scene the engine's evaluation of its position (the eval bar follows it) and Stockfish's best move from there
 * (shown in the banner and as a blue arrow). Finished games get 1-0 / 0-1 / ½-½ instead of a search.
 */
async function withEngineInfo(scenes: Scene[], depth: number, isCancelled: () => boolean): Promise<Scene[]> {
  const out: Scene[] = [];
  for (const sc of scenes) {
    if (sc.evalInfo || isCancelled()) { out.push(sc); continue; }
    try {
      const c = new Chess(sc.fen);
      if (c.isCheckmate()) {
        const whiteWins = c.turn() === 'b';
        out.push({ ...sc, evalInfo: { pawns: whiteWins ? 15 : -15, mate: null, label: whiteWins ? '1-0' : '0-1' } });
      } else if (c.isDraw() || c.isStalemate()) {
        out.push({ ...sc, evalInfo: { pawns: 0, mate: null, label: '½-½' } });
      } else {
        const ev = await engineEval(sc.fen, Math.min(depth, 12));
        const best = bestOf(sc.fen, ev);
        const arrows = best && !sc.arrows.some((a) => a.from === best.uci.slice(0, 2) && a.to === best.uci.slice(2, 4))
          ? [...sc.arrows, { from: best.uci.slice(0, 2) as Square, to: best.uci.slice(2, 4) as Square, color: 'blue' as ArrowColor }]
          : sc.arrows;
        out.push({ ...sc, evalInfo: sceneEvalOf(ev), best, arrows });
      }
    } catch { out.push(sc); }
  }
  return out;
}

/**
 * The "Why" of a mistake. Every move it blames comes from Stockfish: the engine's best move before the move (what was missed),
 * the engine's reply after it (what was allowed), and the engine's best move for the opponent if the player had "passed" (what was ignored).
 */
async function buildCause(inp: ExplainInput, isCancelled: () => boolean): Promise<Scene | null> {
  if (!BAD.includes(inp.quality)) return null;
  const pre: { threatBefore?: { uci: string; gain: number } | null } = {};
  try {
    const opp = other(inp.color);
    const passFen = withSide(inp.fenBefore, opp);
    new Chess(passFen);
    const ev = await engineEval(passFen, Math.min(inp.depth, 12));
    if (isCancelled()) return null;
    const uci = ev?.bestMove || pvOf(ev)[0];
    const now = moverPawns(inp.evalBefore, opp), then = moverPawns(ev, opp);
    pre.threatBefore = uci && now != null && then != null ? { uci, gain: then - now } : null;
  } catch { pre.threatBefore = null; }
  return causeScene(inp, pre);
}

/** Plays a UCI line and returns one scene per ply, narrated for `mover`. */
function lineScenes(fenStart: string, ucis: string[], mover: 'w' | 'b', maxPlies: number, intro: 'reply' | 'then'): Scene[] {
  const scenes: Scene[] = [];
  let chess: Chess;
  try { chess = new Chess(fenStart); } catch { return scenes; }
  // Keep going up to 2 plies past `maxPlies` while an exchange is still in progress,
  // so a capture is never left hanging in the middle of a trade.
  // If the line ENDS the game (stalemate, mate, repetition...), play it all the way to that point.
  const end = lineOutcome(fenStart, ucis);
  const limit = Math.min(ucis.length, Math.max(maxPlies + 2, end ? Math.min(end.ply + 1, 14) : 0));
  for (let i = 0; i < limit; i++) {
    const uci = ucis[i];
    let m;
    try {
      m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
    } catch { break; }
    const first = scenes.length === 0;
    let text = first && intro === 'reply'
      ? `${watchLead(chess.fen())} ${sideName(m.color)} ${answerVerb(chess.fen())}: ${describeMove(m as PlyMove)}.`
      : `${first ? 'The game could go' : thenLead(chess.fen())}: ${describeMove(m as PlyMove)}.`;

    // Is the captured piece simply taken back on the very next move? Then it's a trade, not a win.
    const next = ucis[i + 1];
    const recaptured = !!m.captured && !!next && next.slice(2, 4) === m.to;
    if (m.captured && m.captured !== 'k') {
      text += recaptured
        ? ' It gets taken back next move.'
        : m.color === mover
          ? ` ++${cap(sideName(m.color))} wins the ${NAME[m.captured]}.++`
          : ` ~~${sideName(m.color)} wins the ${NAME[m.captured]}.~~`;
    }
    if (chess.isStalemate()) text += ` **Stalemate!** ${sideName(chess.turn() as 'w' | 'b')} has no legal move and is not in check, so the game is a **draw**.`;
    else if (chess.isInsufficientMaterial()) text += ' Neither side has enough pieces left to checkmate: **draw**.';
    else if (chess.isThreefoldRepetition()) text += ' The position repeats three times: **draw by repetition**.';
    const arrows: SceneArrow[] = [{ from: m.from as Square, to: m.to as Square, color: m.color === mover ? 'green' : 'red' }];
    scenes.push(mk(chess.fen(), m, text, arrows));

    if (chess.isGameOver()) break;
    // past the normal length, stop as soon as the last move wasn't a capture (unless the game is about to end)
    if (i + 1 >= maxPlies && !m.captured && !(end && i < end.ply)) break;
  }
  return scenes;
}

/** What a move is for (used for good moves and for the "better move"). Tactics are detected on the board first. */
/**
 * `line` = the engine's line from `fenAfter`. When given, "forks" / "wins" / "sacrifice" are only said if the material at the
 * end of that line agrees; otherwise the plain fact is said instead ("attacks", "takes").
 */
function purpose(fenBefore: string, m: PlyMove, fenAfter: string, mover: 'w' | 'b', line?: string[]): string {
  const bits: string[] = [];
  let tac = pickTactic(fenBefore, m, fenAfter);
  if (tac && tac.kind === 'fork' && line && !verifyClaim(fenAfter, line, { kind: 'fork', side: mover }).ok) {
    tac = { ...tac, text: tac.text.replace(/^forks the /, 'attacks the ') };
  }
  if (tac) bits.push(tac.text);
  if (!bits.length) {
    try {
      const fork = detectKnightFork(fenAfter, m.san, mover);
      if (fork && fork.length) bits.push(`forks the ${fork.map((t: any) => `${t.name} on ${t.square}`).join(' and the ')}`);
    } catch { /* ignore */ }
  }
  const saved = protects(fenBefore, m, fenAfter, mover);
  if (saved) bits.push(saved);
  const threatened = threatsFrom(fenAfter, m.to as Square, mover);
  const top = threatened[0];
  const mateIdea = !!tac && (tac.kind === 'mate' || tac.kind === 'mate-threat');
  // When the move threatens mate, a side attack on a piece is just noise.
  if (top && !mateIdea && !tac?.text.includes(top.square) && (!bits.length || VAL[top.piece] >= 3)) {
    bits.push(
      `attacks the ${NAME[top.piece]} on ${top.square}` +
      (VAL[top.piece] >= 3 ? (VAL[top.piece] > VAL[m.piece] ? ', forcing it to move' : ', so it needs protection') : ''),
    );
  }
  if (m.captured) {
    // Never say "wins a bishop" when the same move leaves something worth more (e.g. the queen) en prise.
    const back = winnableCaptures(fenAfter, other(mover))[0];
    const uci = m.from + m.to + (m.promotion ?? '');
    const winsOk = !line || verifyClaim(fenBefore, [uci, ...line], { kind: 'wins-material', side: mover }).ok;
    const sacOk = !line || verifyClaim(fenAfter, line, { kind: 'sacrifice', side: mover }).ok;
    const take = `${article(NAME[m.captured])} ${NAME[m.captured]}`;
    const oppN = sideName(other(mover));
    if (back && back.gain >= 3 && back.gain >= VAL[m.captured]) {
      if (VAL[back.victim] > VAL[m.captured]) {
        bits.push(sacOk
          ? `takes ${take}, but ${oppN} can answer by taking the ${NAME[back.victim]} on ${back.to}. That is a **sacrifice**, not an even trade: follow the line to see what it gets in return`
          : `takes ${take}, but ${oppN} can answer by taking the ${NAME[back.victim]} on ${back.to}`);
      } else {
        bits.push(`takes ${take} and allows ${oppN} to take the ${NAME[back.victim]} on ${back.to}, an even trade`);
      }
    } else bits.push(winsOk ? `wins ${take}` : `takes ${take}`);
  }
  if (m.san.endsWith('+') && !m.san.endsWith('#') && !mateIdea && !bits.some((b) => b.startsWith('forks'))) bits.push('forces the king to react');
  if (m.flags.includes('k') || m.flags.includes('q')) bits.push('tucks the king away and connects the rooks');
  const fullmove = Number(fenBefore.split(' ')[5] ?? 1);
  if (!bits.length && (m.piece === 'n' || m.piece === 'b') && /[18]/.test(m.from[1]) && fullmove <= 12) bits.push(`develops the ${NAME[m.piece]} toward the center`);
  if (!bits.length && m.piece === 'p' && ['e4', 'd4', 'e5', 'd5'].includes(m.to)) bits.push('fights for the center');
  if (!bits.length) {
    // Positional reason: open file, outpost, weak pawn for the opponent, king pressure...
    try { const pp = movePurpose(fenBefore, m as any, fenAfter); if (pp) bits.push(pp); } catch { /* ignore */ }
  }
  if (!bits.length) bits.push('improves the position without giving the opponent anything to attack');
  // "a, b and c" instead of "a and b and c"
  return bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0];
}

// ---------- synchronous core ----------

export function buildCoreScenes(inp: ExplainInput): Scene[] {
  const mover = inp.color, opp = other(mover);
  const side = sideName(mover), oppName = sideName(opp);
  const bad = BAD.includes(inp.quality);
  const scenes: Scene[] = [];

  let played: any;
  try { played = new Chess(inp.fenBefore).move(inp.san); } catch { return scenes; }
  const playedArrow: SceneArrow = { from: played.from, to: played.to, color: bad ? 'red' : 'green' };

  const before = moverPawns(inp.evalBefore, mover);
  const after = moverPawns(inp.evalAfter, mover);
  const refutation = (inp.evalAfter?.continuation ?? '').split(/\s+/).filter(Boolean) as string[];
  // Material is counted where the exchange SETTLES (a trade is never cut in half); an unsettled line counts as unknown (0).
  const lineMat = settleLine(inp.fenAfter, refutation, mover);
  // How does the engine's line END? (stalemate, mate, repetition...) and did the move save / waste a game?
  const lineEnd = lineOutcome(inp.fenAfter, refutation);
  const drawSaved = savesDraw(before, after);
  const stalemateWaste = !!lineEnd && lineEnd.kind === 'stalemate' && throwsAwayWin(before, after);
  let drawTold = false;

  // ---- Scene 1: the verdict and the reason
  let text = `${bad ? badOpen(inp.quality, inp.fenAfter + inp.san) + ' ' : ''}${describeMove(played)} is ${WORD[inp.quality] ?? 'a move'}`;
  const arrows: SceneArrow[] = [playedArrow];
  if (bad) {
    const hang = hangingInfo(inp.fenAfter, played.to, mover);
    if (stalemateWaste && lineEnd) {
      text += ` because the game ends in **stalemate**: ${sideName(lineEnd.stuck)} has no legal move and is not in check, so a won position (about ${pawnGap(inp.evalBefore, mover)} pawns up) becomes a draw.`;
    } else if (hang && (!refutation.length || verifyClaim(inp.fenAfter, refutation, { kind: 'wins-material', side: opp }).ok)) {
      text += ` because ${oppName} can ${hang.free ? 'win' : 'trade favorably for'} the **${NAME[played.piece]}** on ${played.to}`;
      text += hang.free ? ' for free.' : ` with the ${NAME[hang.attacker]}.`;
      arrows.push({ from: hang.from, to: played.to, color: 'red' });
    } else if (typeof inp.evalAfter?.mate === 'number' && (mover === 'w' ? inp.evalAfter.mate < 0 : inp.evalAfter.mate > 0)) {
      text += ` because it allows ${oppName} to force **checkmate**.`;
    } else if (lineMat.swing <= -1 && lineMat.worst) {
      text += ` because after ${oppName}'s best reply ${side} loses ${article(NAME[lineMat.worst])} **${NAME[lineMat.worst]}**.`;
    } else if (before != null && after != null) {
      text += ` — it throws away the advantage: the position drops from **${formatEval(inp.evalBefore)}** to **${formatEval(inp.evalAfter)}**.`;
    } else text += '.';
  } else {
    let tacG = pickTactic(inp.fenBefore, played, inp.fenAfter);
    // "That's a fork" only when the engine's line really collects something afterwards.
    if (tacG?.kind === 'fork' && !verifyClaim(inp.fenAfter, refutation, { kind: 'fork', side: mover }).ok) tacG = null;
    const opener = goodOpen(inp.quality, inp.fenAfter + inp.san);
    if (tacG && tacG.kind === 'mate') {
      const expl = tacG.text.split(': ')[1];
      text = `${describeMove(played)} — that's ${named(tacG.name)}${expl ? `: ${expl}` : ''}.`;
    } else if (tacG) {
      text = `${opener} ${describeMove(played)}. That's ${named(tacG.name)}: ${howClause(tacG)}.`;
    } else {
      text = `${opener} ${describeMove(played)} — it ${purpose(inp.fenBefore, played, inp.fenAfter, mover, refutation)}.`;
    }
    // A strong move whose piece can simply be taken is a sacrifice: say so, otherwise "brilliant" is unexplained.
    const sac = tacG?.kind === 'mate' ? null : hangingInfo(inp.fenAfter, played.to, mover);
    // "Sacrifice" needs material that is really given up in the line AND paid back (mate, material, or an engine eval that stays fine).
    const sacVerified = !!sac && verifyClaim(inp.fenAfter, refutation, { kind: 'sacrifice', side: mover, evalOk: after != null && after >= -0.3 }).ok;
    if (sac && sacVerified && sac.gain >= 2 && ['brilliant', 'great', 'best'].includes(inp.quality)) {
      // What does the sacrifice buy? Taken from the engine's line, never guessed.
      const moverMates = typeof inp.evalAfter?.mate === 'number' && (mover === 'w' ? inp.evalAfter.mate > 0 : inp.evalAfter.mate < 0);
      let buys: string;
      if (moverMates) buys = `${side} gets a forced **checkmate**`;
      else if (drawSaved) {
        drawTold = true;
        buys = lineEnd?.kind === 'stalemate'
          ? `${side} was losing (about ${pawnGap(inp.evalBefore, mover)} pawns down), and after the capture ${sideName(lineEnd.stuck)} has no legal move: **stalemate**, a draw`
          : `${side} was losing (about ${pawnGap(inp.evalBefore, mover)} pawns down) and this saves the game: the engine now says **${formatEval(inp.evalAfter)}**`;
      }
      else if (lineMat.swing >= 1 && lineMat.best) buys = `after best play ${side} comes out ++ahead++, winning ${article(NAME[lineMat.best])} ${NAME[lineMat.best]}`;
      else if (after != null && after >= 0.8) buys = `${side} gets a strong attack, and the engine rates it **${formatEval(inp.evalAfter)}**`;
      else buys = `${side} gets more in return than it gives up`;
      text += ` It's a **sacrifice**: ${oppName} can take the ${NAME[played.piece]}, but ${buys}.`;
    }
    // A move that turns a lost game into a draw: explain it even when it is not a visible sacrifice.
    if (drawSaved && !drawTold) {
      text += lineEnd?.kind === 'stalemate'
        ? ` This saves the game: the line ends in **stalemate**, so ${side} escapes with a draw from a lost position (about ${pawnGap(inp.evalBefore, mover)} pawns down).`
        : lineEnd && lineEnd.kind !== 'mate'
          ? ` This saves the game: the line ends in ${END_WORD[lineEnd.kind]}, a draw from a lost position (about ${pawnGap(inp.evalBefore, mover)} pawns down).`
          : ` This saves the game: the engine now says **${formatEval(inp.evalAfter)}**, it was about ${pawnGap(inp.evalBefore, mover)} pawns down before the move, so ${side} found a drawing resource.`;
    }
    if (inp.isPlayedBest && inp.quality !== 'book' && tacG?.kind !== 'mate') text += topChoice(inp.fenAfter + inp.san);
    try { text += principleTail(inp.quality, analyzePhase(inp.fenAfter), inp.fenAfter + inp.san); } catch { /* ignore */ }
  }
  // Lines on the board: the tactic (fork / pin / skewer / ...) or, failing that, what the moved piece now attacks.
  // A bad move whose piece just hangs is explained by "can win the piece for free", not by a tactic.
  const tac = bad && hangingInfo(inp.fenAfter, played.to, mover) ? null : pickTactic(inp.fenBefore, played, inp.fenAfter);
  if (tac) {
    arrows.push(...tacticArrows(tac));
  } else if (!bad) {
    for (const t of threatsFrom(inp.fenAfter, played.to, mover).slice(0, 2)) {
      arrows.push({ from: played.to, to: t.square, color: 'blue' });
    }
  }
  scenes.push(mk(inp.fenAfter, played, text, arrows, tac ? `${inp.san} · ${tac.name}` : `${inp.san}`));

  // ---- What happens next (punishment if bad, follow-up if good)
  // After the best move there is nothing to warn about: explain why it is good and stop (no "the game could go...").
  const lineSc = !bad && inp.isPlayedBest && !drawSaved ? [] : lineScenes(inp.fenAfter, refutation, mover, bad ? 5 : 3, bad ? 'reply' : 'then');
  scenes.push(...lineSc);
  if (bad && lineSc.length) {
    const phrase = materialPhrase(lineMat);
    const last = lineSc[lineSc.length - 1];
    const mateN = typeof inp.evalAfter?.mate === 'number' ? inp.evalAfter.mate : 0;
    const mateAgainst = mateN !== 0 && (mover === 'w' ? mateN < 0 : mateN > 0);
    const wasText = before != null ? ` (it was ${formatEval(inp.evalBefore)} before the move)` : '';
    let resultText: string;
    if (stalemateWaste) {
      resultText = `${resultLead('stalemate', inp.fenAfter + inp.san)} The game ends in **stalemate**: a draw. ${side} was winning (about ${pawnGap(inp.evalBefore, mover)} pawns up) before this move.`;
    } else if (mateAgainst) {
      // The engine sees a forced mate: this move loses the game, not just "a bit of advantage".
      const n = Math.abs(mateN);
      resultText = `${resultLead('mate', inp.fenAfter + inp.san)} This loses the game: ${oppName} has a forced **checkmate in ${n}**${n === 1 ? ' — it comes on the very next move' : ''}.${before != null ? ` The position was ${formatEval(inp.evalBefore)} before the move.` : ''}`;
    } else if (after != null && after <= -5) {
      resultText = `${resultLead('lost', inp.fenAfter + inp.san)} After this, ${side} is **completely lost**${phrase ? ` and ${phrase}` : ''}. The engine now shows **${formatEval(inp.evalAfter)}**${wasText}.${inp.quality === 'blunder' ? blunderAnalogy(inp.fenAfter + inp.san, inp.level) : ''}`;
    } else if (after != null && after <= -2.5) {
      resultText = `${resultLead('losing', inp.fenAfter + inp.san)} After this, ${side} is **clearly losing**${phrase ? ` and ${phrase}` : ''}. The engine now shows **${formatEval(inp.evalAfter)}**${wasText}.${inp.quality === 'blunder' ? blunderAnalogy(inp.fenAfter + inp.san, inp.level) : ''}`;
    } else {
      resultText = `${resultLead('worse', inp.fenAfter + inp.san)} After this, ${side} ${phrase ?? 'is clearly worse'}. The engine now shows **${formatEval(inp.evalAfter)}**${wasText || ''}.`;
    }
    scenes.push({
      ...last,
      arrows: [],
      chip: stalemateWaste ? 'Result · Stalemate' : mateAgainst ? 'Result · Checkmate' : 'Result',
      text: parseSegs(resultText),
    });
  }

  // ---- The better move
  if (!inp.isPlayedBest && inp.bestUci && inp.bestUci.length >= 4) {
    try {
      const c = new Chess(inp.fenBefore);
      const bm: any = c.move({ from: inp.bestUci.slice(0, 2), to: inp.bestUci.slice(2, 4), promotion: inp.bestUci.length > 4 ? inp.bestUci[4] : undefined });
      const why = purpose(inp.fenBefore, bm, c.fen(), mover, restAfter(inp.evalBefore, inp.bestUci));
      scenes.push(mk(
        c.fen(), bm,
        betterText(bad, inp.fenBefore + bm.san, describeMove(bm), why, formatEval(inp.evalBefore), why.startsWith('improves the position')),
        [{ from: bm.from, to: bm.to, color: 'green' }],
        `Better: ${bm.san}`,
      ));
    } catch { /* ignore */ }
  }
  return scenes;
}

// ---------- engine-assisted extras ----------

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Look-ahead scenes. Stockfish PICKS every move shown here; the tactic detectors only find the words for it (narrateMove).
 * They run after the core scenes are already playable:
 *  - "Threat":  what the mover threatens next (fork / skewer / mate / free piece) if the opponent ignores it
 *  - "Danger":  what the opponent can do to the mover right now
 *  - "Missed":  a fork / skewer / mate the mover had but did not play
 * The scene's board shows the position after that tactical move, with arrows on the targets.
 *
 * Every item is rejected when the piece making the tactic can simply be captured
 * (e.g. a queen "skewering" next to an undefended king that just takes it).
 */
async function ideaScenes(inp: ExplainInput, isCancelled: () => boolean): Promise<Scene[]> {
  if (inp.quality === 'book') return [];
  const mover = inp.color, opp = other(mover);
  const side = sideName(mover), oppName = sideName(opp);
  const bad = BAD.includes(inp.quality);
  let played: any;
  try { played = new Chess(inp.fenBefore).move(inp.san); } catch { return []; }
  const out: Scene[] = [];
  const depth = Math.min(inp.depth, 12);
  const afterNow = moverPawns(inp.evalAfter, mover);
  const refu = pvOf(inp.evalAfter);
  const sceneOf = (n: Narrated, text: string, color: ArrowColor, chip: string) =>
    mk(n.fen, n, text, itemArrows(n, color), chip);

  // Threat: what does STOCKFISH play for the mover if the opponent does nothing? Shown only when it gains a real amount.
  if (!bad && !inp.isPlayedBest && !inp.san.endsWith('#')) {
    await tick();
    if (isCancelled()) return [];
    // After a check the opponent MUST react, so look at the position after their forced (engine) reply instead.
    let reply = '';
    let fenFrom = inp.fenAfter;
    if (inp.san.includes('+')) {
      try {
        const c = new Chess(inp.fenAfter);
        reply = c.move(uciMove(refu[0])).san;
        fenFrom = c.fen();
      } catch { fenFrom = ''; }
    }
    if (fenFrom) {
      try {
        const passFen = withSide(fenFrom, mover);
        new Chess(passFen);
        const ev = await engineEval(passFen, depth);
        const best = ev?.bestMove || pvOf(ev)[0];
        const mp = moverPawns(ev, mover);
        const mateFor = typeof ev?.mate === 'number' && ev.mate !== 0 && (mover === 'w') === (ev.mate > 0);
        const gain = mp != null && afterNow != null ? mp - afterNow : 0;
        const n = best ? narrateMove(passFen, best, restAfter(ev, best)) : null;
        if (n && n.tactical && (gain >= 0.7 || mateFor)) {
          const arrows = itemArrows(n, 'green');
          const sc = sceneOf(
            n,
            reply
              ? `${oppName} has to deal with the check first. After that, ${side} threatens **${n.san}**, which ${n.does}.`
              : `${side} now threatens **${n.san}**, which ${n.does}. ${oppName} has to respond.`,
            'green',
            `Threat · ${KIND_LABEL[n.kind] ?? 'Idea'}`,
          );
          sc.threat = { san: n.san, does: n.does, afterCheck: !!reply, arrows };
          out.push(sc);
        }
      } catch { /* ignore */ }
    }
  }

  // What the opponent can do right now: STOCKFISH's reply (first move of the line after the move that was played).
  if (!inp.san.endsWith('#') && refu.length) {
    await tick();
    if (isCancelled()) return out;
    const d = narrateMove(inp.fenAfter, refu[0], refu.slice(1));
    if (d && d.tactical && !(bad && d.kind === 'capture' && d.to === played.to)) {
      if (bad) {
        out.push(sceneOf(d, wantsText(oppName, d.san, d.does, d.fen), 'red', `Danger · ${KIND_LABEL[d.kind] ?? 'Idea'}`));
      } else {
        // A sound move that leaves something en prise is a SACRIFICE, not a mistake. The engine's own line says what it is for.
        const lm = settleLine(inp.fenAfter, refu, mover);
        const ev = moverPawns(inp.evalAfter, mover);
        const moverMates = typeof inp.evalAfter?.mate === 'number' && (mover === 'w' ? inp.evalAfter.mate > 0 : inp.evalAfter.mate < 0);
        const end = lineOutcome(inp.fenAfter, refu);
        // When the line ends the game, the reply is just "takes the piece": its usual tactic label would mislead.
        if (end && d.to === played.to) d.does = `takes the ${NAME[played.piece]} on ${d.to}`;
        let text: string;
        let chip = `Danger · ${KIND_LABEL[d.kind] ?? 'Idea'}`;
        if (moverMates) {
          text = `Sacrifice: ${oppName} can play **${d.san}** (it ${d.does}), but ${side} still has a forced **checkmate**.`;
          chip = 'Sacrifice';
        } else if (end && end.kind !== 'mate') {
          text = `Sacrifice: ${oppName} can play **${d.san}** (it ${d.does}), but the engine's line ends in ${END_WORD[end.kind]}, so the extra material does not win.`;
          chip = 'Sacrifice';
        } else if (lm.settled && lm.swing >= 0) {
          text = `Sacrifice: ${oppName} can play **${d.san}** (it ${d.does}), but it is a trap. After best play ${side} ${materialPhrase(lm) ?? 'wins the material back'}.`;
          chip = 'Sacrifice';
        } else if (ev != null && ev >= 0.8) {
          text = `Sacrifice for position: ${oppName} can win material with **${d.san}** (it ${d.does}), but ${side} gets a strong attack. The engine still rates the position **${formatEval(inp.evalAfter)}**, so the initiative is worth more than the material.`;
          chip = 'Sacrifice';
        } else {
          text = wantsText(oppName, d.san, d.does, d.fen);
        }
        out.push(sceneOf(d, text, 'red', chip));
      }
    }
  }

  // A tactic the mover missed: STOCKFISH's best move before the move, when it was a real tactic.
  if (bad && inp.bestUci && inp.bestUci.length >= 4) {
    await tick();
    if (isCancelled()) return out;
    const n = narrateMove(inp.fenBefore, inp.bestUci, restAfter(inp.evalBefore, inp.bestUci));
    if (n && MISSED_KINDS.has(n.kind)) {
      out.push(sceneOf(n, `${side} ${missedVerb(n.fen)} ${named(KIND_LABEL[n.kind] ?? 'tactic')}: **${n.san}** ${n.does}.`, 'green', `Missed · ${KIND_LABEL[n.kind] ?? 'Idea'}`));
    }
  }
  return out;
}

/** The follow-up line after the engine's better move. */
async function bestLineScenes(inp: ExplainInput): Promise<Scene[]> {
  if (inp.isPlayedBest || !inp.bestUci || inp.bestUci.length < 4) return [];
  try {
    const c = new Chess(inp.fenBefore);
    c.move({ from: inp.bestUci.slice(0, 2), to: inp.bestUci.slice(2, 4), promotion: inp.bestUci.length > 4 ? inp.bestUci[4] : undefined });
    const ev: any = await analyzePosition(c.fen(), Math.min(inp.depth, 14));
    const line = (ev?.continuation ?? '').split(/\s+/).filter(Boolean) as string[];
    return lineScenes(c.fen(), line, inp.color, 5, 'then').map((s, i) => (i === 0 ? { ...s, chip: 'Main line' } : s));
  } catch { return []; }
}

/**
 * "Also good": other strong moves the player could have chosen (a fork, a check, a capture...).
 * Every candidate is checked with the engine and only shown if it is good or excellent
 * (within ~0.35 pawns of the position's value). Bad or tempting-but-losing moves are never shown.
 */
async function alternativeScenes(inp: ExplainInput): Promise<Scene[]> {
  if (BAD.includes(inp.quality) || inp.isPlayedBest) return [];
  const mover = inp.color;
  let played: any;
  try { played = new Chess(inp.fenBefore).move(inp.san); } catch { return []; }
  const ref = moverPawns(inp.evalBefore, mover) ?? moverPawns(inp.evalAfter, mover);
  if (ref == null) return [];

  // Moves we do not need to show again: the played move and the engine's best (shown in "Better").
  const skip = new Set<string>([played.from + played.to]);
  if (inp.bestUci && inp.bestUci.length >= 4) skip.add(inp.bestUci.slice(0, 4));

  const cands: { from: string; to: string; promotion?: string }[] = [];
  const add = (c: { from: string; to: string; promotion?: string }) => {
    const key = c.from + c.to;
    if (skip.has(key)) return;
    skip.add(key);
    cands.push(c);
  };
  // 1) verified tactics (forks, skewers, mates, pins against king/queen)
  for (const t of tacticalMoves(inp.fenBefore, mover, ['mate', 'fork', 'skewer', 'pin'], 3)) add(t);
  // 2) natural candidates: captures, checks, promotions
  const natural = new Chess(inp.fenBefore).moves({ verbose: true })
    .map((m) => ({ m, score: (m.captured ? VAL[m.captured] * 10 - VAL[m.piece] : 0) + (m.san.includes('+') ? 6 : 0) + (m.promotion ? 8 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  for (const { m } of natural) add({ from: m.from, to: m.to, promotion: m.promotion });

  const out: Scene[] = [];
  let shown = 0;
  for (const cand of cands.slice(0, 4)) {
    if (shown >= 2) break;
    try {
      const c = new Chess(inp.fenBefore);
      const m: any = c.move({ from: cand.from, to: cand.to, promotion: cand.promotion });
      const ev: any = await analyzePosition(c.fen(), Math.min(inp.depth, 12));
      const alt = moverPawns(ev, mover);
      const matedL = typeof ev?.mate === 'number' && ev.mate !== 0 && ((mover === 'w') !== (ev.mate > 0));
      if (alt == null || matedL || ref - alt > 0.35) continue; // only good / excellent moves, confirmed by Stockfish
      const why = purpose(inp.fenBefore, m as PlyMove, c.fen(), mover, pvOf(ev));
      const line = (ev?.continuation ?? '').split(/\s+/).filter(Boolean) as string[];
      out.push(mk(
        c.fen(), m,
        `Another good option: ${describeMove(m as PlyMove)}, which ${why}. The engine rates it **${formatEval(ev)}**, ${ref - alt <= 0.1 ? 'just as good' : 'almost as good'}.`,
        [{ from: m.from as Square, to: m.to as Square, color: 'green' }],
        `Also good: ${m.san}`,
      ));
      out.push(...lineScenes(c.fen(), line, mover, 2, 'reply'));
      shown++;
    } catch { /* ignore */ }
  }
  return out;
}

/**
 * "Continue": the next `plies` moves of the engine's line, starting from the position `fen`.
 * One search only gives a short line, so the engine is asked again from where the line stops until there are enough
 * moves (or the game ends). Call it again from the last scene to keep going. Returns [] when the game is over.
 */
export async function continuationScenes(
  fen: string, mover: 'w' | 'b', plies = 10, depth = 12, isCancelled: () => boolean = () => false,
): Promise<Scene[]> {
  const line: string[] = [];
  try {
    for (let round = 0; round < 6 && line.length < plies; round++) {
      if (isCancelled()) return [];
      const c = new Chess(fen);
      for (const u of line) c.move(uciMove(u));
      if (c.isGameOver()) break;
      const more = pvOf(await engineEval(c.fen(), Math.min(depth, 14)));
      if (!more.length) break;
      line.push(...more.slice(0, plies - line.length));
    }
  } catch { /* use the moves we have */ }
  if (!line.length || isCancelled()) return [];
  const scenes = lineScenes(fen, line, mover, plies, 'then');
  if (!scenes.length) return [];
  const first = scenes[0];
  if (first.text[0]?.t.startsWith('The game could go: ')) {
    first.text = [{ ...first.text[0], t: 'The line continues: ' + first.text[0].t.slice('The game could go: '.length) }, ...first.text.slice(1)];
  }
  first.chip = `Continuation · ${scenes.length} more moves`;
  return withEngineInfo(scenes, depth, isCancelled);
}

/**
 * Verdict on the move a scene shows (best / great / brilliant / good / mistake...), judged by the engine like the main review.
 * The position BEFORE the move is found among the positions we already know (the one before the played move, and every scene's),
 * so scenes made from hypothetical positions (a "threat" if the opponent passes) simply get no verdict.
 */
export async function sceneMoveQuality(scene: Scene, inp: ExplainInput, knownFens: string[]): Promise<string | null> {
  if (!scene.uci || scene.uci.length < 4) return null;
  const key4 = (f: string) => f.split(' ').slice(0, 4).join(' ');
  let before: string | null = null;
  for (const cand of [inp.fenBefore, ...knownFens]) {
    try {
      const c = new Chess(cand);
      c.move(uciMove(scene.uci));
      if (key4(c.fen()) === key4(scene.fen)) { before = cand; break; }
    } catch { /* not this position */ }
  }
  if (!before) return null;
  // The move the player really made keeps the main review's verdict.
  if (key4(before) === key4(inp.fenBefore) && key4(scene.fen) === key4(inp.fenAfter)) return inp.quality;
  try {
    const color: 'w' | 'b' = before.split(' ')[1] === 'b' ? 'b' : 'w';
    const san = new Chess(before).move(uciMove(scene.uci)).san;
    if (new Chess(scene.fen).isCheckmate()) return 'best';
    const d = Math.min(inp.depth, 12);
    const [evB, evA] = await Promise.all([engineEval(before, d), engineEval(scene.fen, d)]);
    return (classifyMove(evB, evA, scene.uci, color, false, san, before) as any).quality ?? null;
  } catch { return null; }
}

// ---------- why did the player go wrong? ----------

export const CAUSE_LABEL: Record<CauseId, string> = {
  'hung-piece': 'Left a piece loose',
  'ignored-threat': 'Missed a threat',
  'missed-tactic': 'Missed a tactic',
  'allowed-tactic': 'Allowed a tactic',
  greedy: 'Greedy capture',
  positional: 'Gave up the advantage',
  'stalemate-trap': 'Stalemated a won game',
};

/**
 * The reason behind a mistake, in plain words. Checked in order of how clearly it can be proven on the board:
 * a piece left loose, a threat that was ignored, a tactic that was allowed, a tactic that was missed,
 * a greedy capture, and finally "no single tactic, the advantage just slipped away".
 * Opponent ideas are only used when the engine's own reply is that move (so we never blame a threat that doesn't work).
 */
function causeScene(inp: ExplainInput, pre: { threatBefore?: { uci: string; gain: number } | null } = {}): Scene | null {
  if (!BAD.includes(inp.quality)) return null;
  const mover = inp.color, opp = other(mover);
  const side = sideName(mover), oppName = sideName(opp);
  let played: any;
  try { played = new Chess(inp.fenBefore).move(inp.san); } catch { return null; }
  const refu = pvOf(inp.evalAfter);
  const mat = settleLine(inp.fenAfter, refu, mover);
  const make = (id: CauseId, text: string, arrows: SceneArrow[]): Scene => {
    const sc = mk(inp.fenAfter, played, `${text} ${habitFor(id, inp.fenAfter + inp.san)}`, arrows, `Why · ${CAUSE_LABEL[id]}`);
    sc.cause = { id, label: CAUSE_LABEL[id] };
    return sc;
  };
  const b0 = moverPawns(inp.evalBefore, mover), a0 = moverPawns(inp.evalAfter, mover);

  try {
    // 0. The game was won and ends in stalemate.
    const endL = lineOutcome(inp.fenAfter, refu);
    if (endL?.kind === 'stalemate' && throwsAwayWin(b0, a0)) {
      return make('stalemate-trap',
        `${causeLead(inp.fenAfter + inp.san)}${sideName(endL.stuck)} ends up with no legal move and is not in check, so the game is a draw. ${side} was clearly winning (about ${pawnGap(inp.evalBefore, mover)} pawns up) before this move.`,
        [{ from: played.from, to: played.to, color: 'red' }]);
    }

    // 1. The piece that just moved can be won, and the engine's reply really does it.
    const hang = hangingInfo(inp.fenAfter, played.to, mover);
    if (hang && hang.gain >= 2 && (!refu.length || (refu[0].slice(2, 4) === played.to && verifyClaim(inp.fenAfter, refu, { kind: 'wins-material', side: opp }).ok))) {
      return make('hung-piece',
        `${causeLead(inp.fenAfter + inp.san)}the ${NAME[played.piece]} on ${played.to} ${hang.free ? 'has no protection there' : 'can be taken by a cheaper piece'}, so ${oppName} simply wins material.`,
        [{ from: hang.from, to: played.to, color: 'red' }]);
    }

    // 2. The opponent had a strong idea (Stockfish's best move for them), and the engine plays it again after this move.
    const tb = pre.threatBefore;
    if (tb && tb.gain >= 1.5 && refu[0] && refu[0].slice(0, 4) === tb.uci.slice(0, 4)) {
      const n = narrateMove(withSide(inp.fenBefore, opp), tb.uci);
      if (n && n.tactical) {
        return make('ignored-threat',
          `${oppName} was already threatening **${n.san}**, which ${n.does}. This move didn't deal with it.`,
          itemArrows(n, 'red'));
      }
    }

    // 3. The engine's reply is a tactic this move made possible.
    if (refu[0]) {
      const n = narrateMove(inp.fenAfter, refu[0], refu.slice(1));
      if (n && n.tactical && !(n.kind === 'capture' && n.to === played.to) && !(tb && refu[0].slice(0, 4) === tb.uci.slice(0, 4))) {
        return make('allowed-tactic',
          n.kind === 'capture'
            ? `This move lets ${oppName} play **${n.san}**, which ${n.does}.`
            : `This move allowed ${named(KIND_LABEL[n.kind] ?? 'tactic')}: ${oppName} can play **${n.san}**, which ${n.does}.`,
          itemArrows(n, 'red'));
      }
    }

    // 4. Stockfish's best move was a real tactic, and the player played something else.
    if (inp.bestUci && inp.bestUci.length >= 4) {
      const n = narrateMove(inp.fenBefore, inp.bestUci, restAfter(inp.evalBefore, inp.bestUci));
      if (n && MISSED_KINDS.has(n.kind)) {
        return make('missed-tactic',
          `${side} had ${named(KIND_LABEL[n.kind] ?? 'tactic')} available: **${n.san}** ${n.does}.`,
          itemArrows(n, 'green'));
      }
    }

    // 5. A small capture that costs more than it wins.
    if (played.captured && VAL[played.captured] <= 3 && mat.swing <= -2 && mat.worst) {
      return make('greedy',
        `${side} took the ${NAME[played.captured]}, but it cost more than it won: after ${oppName}'s reply ${side} loses ${article(NAME[mat.worst])} ${NAME[mat.worst]}.`,
        [{ from: played.from, to: played.to, color: 'red' }]);
    }

    // 6. No single tactic to blame.
    const b = moverPawns(inp.evalBefore, mover), a = moverPawns(inp.evalAfter, mover);
    if (b != null && a != null && b - a >= 0.8) {
      return make('positional',
        `There is no single tactic to blame: this move just gave away about **${(b - a).toFixed(1)}** pawns of advantage.`,
        [{ from: played.from, to: played.to, color: 'red' }]);
    }
  } catch { /* ignore */ }
  return null;
}

/** The cause of one mistake (or null for a good move): call it for every move of a game, then pass the ids to causeSummary. */
export const moveCause = (inp: ExplainInput): { id: CauseId; label: string } | null => causeScene(inp)?.cause ?? null;

/** Counts the "Why" scenes of a whole game: "Your most common mistake this game: ... (3 times). Habit to build: ..." */
export function causeSummary(ids: CauseId[]): string | null {
  if (!ids.length) return null;
  const n = new Map<CauseId, number>();
  ids.forEach((i) => n.set(i, (n.get(i) ?? 0) + 1));
  const [top, count] = [...n.entries()].sort((x, y) => y[1] - x[1])[0];
  return `Your most common mistake this game: ${CAUSE_LABEL[top].toLowerCase()} (${count} time${count > 1 ? 's' : ''}). ${habitFor(top, String(count))}`;
}

// ---------- "Find a better move": let the player retry a mistake ----------

export interface RetryChallenge {
  fen: string;
  side: 'w' | 'b';
  prompt: string;
  /** Progressive hints: which piece, which square it starts on, and finally the move. */
  hints: string[];
  bestUci: string;
}

/** Puzzle made from a mistake: the position before the move, same side to move. null if there is nothing to retry. */
export function retryChallenge(inp: ExplainInput): RetryChallenge | null {
  if (!BAD.includes(inp.quality) || !inp.bestUci || inp.bestUci.length < 4) return null;
  try {
    const c = new Chess(inp.fenBefore);
    const from = inp.bestUci.slice(0, 2) as Square;
    const piece = c.get(from);
    if (!piece) return null;
    const bm = c.move({ from, to: inp.bestUci.slice(2, 4), promotion: inp.bestUci.length > 4 ? inp.bestUci[4] : undefined });
    return {
      fen: inp.fenBefore,
      side: inp.color,
      prompt: retryPrompt(WORD[inp.quality] ?? 'a mistake', sideName(inp.color), inp.fenBefore + inp.san),
      hints: [
        `Think about your ${NAME[piece.type]}.`,
        `The move starts from ${from}.`,
        `The best move is ${bm.san}.`,
      ],
      bestUci: inp.bestUci,
    };
  } catch { return null; }
}

/**
 * Checks the player's retry. The engine's move is always right, but so is any move the engine rates
 * within ~0.35 pawns of it, so the player is not punished for finding another good idea.
 */
export async function checkRetryMove(inp: ExplainInput, uci: string): Promise<{ ok: boolean; text: string }> {
  const best = inp.bestUci ?? '';
  if (best.length >= 4 && uci.slice(0, 4) === best.slice(0, 4)) {
    return { ok: true, text: retryOk(inp.fenBefore + uci) };
  }
  try {
    const c = new Chess(inp.fenBefore);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
    const ev: any = await analyzePosition(c.fen(), Math.min(inp.depth, 12));
    const ref = moverPawns(inp.evalBefore, inp.color);
    const alt = moverPawns(ev, inp.color);
    if (ref != null && alt != null && ref - alt <= 0.35) {
      return { ok: true, text: `${m.san} works too: the engine rates it **${formatEval(ev)}**, about as good as its own choice.` };
    }
    return { ok: false, text: `${m.san} doesn't solve it${alt != null ? `: the engine rates it **${formatEval(ev)}**` : ''}. Want a hint?` };
  } catch {
    return { ok: false, text: "That move isn't legal here. Try another one." };
  }
}

/** The short version: verdict, why, what happens, better move. Everything else needs "Show more". */
export const visibleScenes = (scenes: Scene[], showAll = false): Scene[] => (showAll ? scenes : scenes.filter((s) => !s.extra));
export const hasMoreScenes = (scenes: Scene[]) => scenes.some((s) => s.extra);

// ---------- positional coaching: open lines, weak spots, structure, plan ----------

const POS_LABEL: Partial<Record<FactKind, string>> = {
  'open-file': 'Open file', 'half-open': 'Half-open file', 'file-info': 'Open file', 'file-king': 'Exposed king',
  'rook-7th': '7th rank', 'rook-battery': 'Doubled rooks', diagonal: 'Open diagonal', 'bishop-pair': 'Bishop pair',
  'bad-bishop': 'Bad bishop', 'rim-knight': 'Rim knight', outpost: 'Outpost', 'outpost-available': 'Outpost',
  isolated: 'Isolated pawn', doubled: 'Doubled pawns', backward: 'Backward pawn', passed: 'Passed pawn',
  islands: 'Pawn islands', center: 'Centre', castled: 'King safety', 'king-center': 'King in the centre',
  shield: 'Weak king shield', 'king-zone': 'King under fire', 'back-rank': 'Back rank', pin: 'Pin',
  trapped: 'Trapped piece', loose: 'Loose piece', development: 'Development', 'early-queen': 'Early queen',
  'endgame-king': 'Active king', unstoppable: 'Unstoppable pawn',
};
const LINE_KINDS = new Set<FactKind>(['open-file', 'half-open', 'file-info', 'file-king', 'rook-7th', 'rook-battery', 'diagonal']);
const SKIP_WEAK = new Set<FactKind>(['pin', 'loose', 'trapped', 'rim-knight', 'islands']); // tactics scenes already cover these

/** Highlights the squares, and colours the "Good:" / "Careful:" lead-in. */
function posMarkup(text: string, verdict: 'good' | 'bad' | 'neutral'): string {
  const m = /^([A-Z][^:.]{2,40}):\s/.exec(text);
  let head = '', body = text;
  if (m) {
    head = verdict === 'good' ? `++${m[1]}:++ ` : verdict === 'bad' ? `~~${m[1]}:~~ ` : `${m[0]}`;
    body = text.slice(m[0].length);
  }
  return head + body.replace(/\b([a-h][1-8])\b/g, '**$1**');
}

/**
 * What a real coach adds after the tactics: what the move did to the structure, which lines are open,
 * who is vulnerable, and what to do next. Everything comes from positional.ts (verified on the board).
 */
async function positionalScenes(inp: ExplainInput, isCancelled: () => boolean): Promise<Scene[]> {
  if (inp.quality === 'book') return [];
  const mover = inp.color, opp = other(mover);
  let played: any;
  try { played = new Chess(inp.fenBefore).move(inp.san); } catch { return []; }
  const bad = BAD.includes(inp.quality);
  const out: Scene[] = [];
  const used = new Set<string>();
  const playedArrow: SceneArrow = { from: played.from, to: played.to, color: bad ? 'red' : 'green' };
  const tone = (f: Fact): ArrowColor => {
    if (f.polarity === 'info' || !f.side) return 'blue';
    const mine = f.side === mover;
    return f.polarity === 'asset' ? (mine ? 'green' : 'red') : (mine ? 'red' : 'green');
  };

  // A. What this move changed in the structure
  await tick();
  if (isCancelled()) return out;
  try {
    const ins = moveInsights(inp.fenBefore, played, inp.fenAfter, undefined, 4, !bad)
      .filter((i) => i.kind !== 'pin' && i.kind !== 'loose' && !i.key.startsWith('x:earlyq'))
      .slice(0, 2);
    if (ins.length) {
      ins.forEach((i) => used.add(i.key));
      const arrows: SceneArrow[] = [playedArrow];
      for (const i of ins) for (const a of i.arrows.slice(0, 2)) arrows.push({ ...a, color: i.verdict === 'bad' ? 'red' : i.verdict === 'good' ? 'green' : 'blue' });
      // Coach tip only when the mover really broke the principle (a mistake, or a clearly harmful change), not on every move.
      const tipFrom = ins.find((i) => i.lesson && i.verdict === 'bad' && i.side === mover && (bad || i.score >= 14));
      const tip = tipFrom ? ` Coach tip: ${tipFrom.lesson}` : '';
      out.push(mk(inp.fenAfter, played,
        ins.map((i) => posMarkup(i.text, i.verdict)).join(' ') + tip,
        arrows, `Structure · ${POS_LABEL[ins[0].kind] ?? 'Position'}`));
    }
  } catch { /* ignore */ }

  // Static look at the position after the move. To avoid repeating the same background facts on every move,
  // only things that are NEW after this move are shown (or, after a mistake, the biggest vulnerabilities).
  await tick();
  if (isCancelled()) return out;
  let facts: Fact[] = [];
  let beforeKeys = new Set<string>();
  try {
    facts = positionFacts(inp.fenAfter, undefined, false);
    beforeKeys = new Set(positionFacts(inp.fenBefore, undefined, false).map((f) => f.key));
  } catch { return out; }
  const fresh = (f: Fact) => !used.has(f.key) && (bad || !beforeKeys.has(f.key));

  // B. Open lines the move really made use of (a rook / bishop actually on the line; never "this file is open" noise)
  const lines = facts.filter((f) => LINE_KINDS.has(f.kind) && f.polarity !== 'info' && f.score >= 13 && fresh(f))
    .sort((a, b) => b.score - a.score).slice(0, 2);
  // C. A vulnerability of the mover, or a target for the opponent
  const weak = facts.filter((f) => f.polarity === 'weakness' && f.side && !LINE_KINDS.has(f.kind) && !SKIP_WEAK.has(f.kind) && f.score >= 12 && fresh(f));
  const mine = weak.filter((f) => f.side === mover).sort((a, b) => b.score - a.score)[0];
  const theirs = weak.filter((f) => f.side === opp).sort((a, b) => b.score - a.score)[0];

  if (mine || theirs) {
    const parts: string[] = [];
    const arrows: SceneArrow[] = [];
    if (mine) { parts.push(`~~Vulnerable:~~ ${posMarkup(mine.text, 'neutral')}`); arrows.push(...mine.arrows.slice(0, 2).map((a) => ({ ...a, color: 'red' as ArrowColor }))); }
    if (theirs) { parts.push(`++Target:++ ${posMarkup(theirs.text, 'neutral')}`); arrows.push(...theirs.arrows.slice(0, 2).map((a) => ({ ...a, color: 'green' as ArrowColor }))); }
    const lead = (mine ?? theirs)!;
    // Only repeat the rule of thumb when the mover's own weakness is serious (or the move was a mistake).
    const weakTip = mine && mine.lesson && (bad || mine.score >= 14) ? ` ${mine.lesson}` : '';
    out.push(mk(inp.fenAfter, played, parts.join(' ') + weakTip,
      arrows.length ? arrows : [playedArrow], `Weak spots · ${POS_LABEL[lead.kind] ?? 'Weakness'}`));
  } else if (lines.length) {
    const arrows: SceneArrow[] = lines.flatMap((f) => f.arrows.slice(0, 1).map((a) => ({ ...a, color: tone(f) })));
    out.push(mk(inp.fenAfter, played, lines.map((f) => posMarkup(f.text, 'neutral')).join(' '),
      arrows.length ? arrows : [playedArrow], `Open lines · ${POS_LABEL[lines[0].kind] ?? 'Lines'}`));
  }

  // D. Plan: only after a mistake (what the opponent can now aim for) or when something urgent is on the board
  await tick();
  if (isCancelled()) return out;
  try {
    const side = bad ? opp : mover;
    const p = lineOutcome(inp.fenAfter, pvOf(inp.evalAfter)) ? undefined : coachPlan(inp.fenAfter, side, undefined, 1)[0];
    if (p && (bad || p.score >= 26)) {
      out.push(mk(inp.fenAfter, played,
        `${sideName(side)}'s plan: ${posMarkup(p.text, 'neutral')}`,
        p.arrows.length ? p.arrows.slice(0, 2).map((a) => ({ ...a, color: 'blue' as ArrowColor })) : [playedArrow],
        'Plan'));
    }
  } catch { /* ignore */ }
  return out;
}


// ---------- the coach's method: sweep + four criteria ----------

/** Step 3 of the method: checks, captures, attacks, read from the position BEFORE the move. */
function ccaScene(inp: ExplainInput): Scene | null {
  const mover = inp.color, opp = other(mover);
  const bad = BAD.includes(inp.quality);
  let played: any;
  let moves: any[] = [];
  try {
    played = new Chess(inp.fenBefore).move(inp.san);
    moves = new Chess(inp.fenBefore).moves({ verbose: true });
  } catch { return null; }
  const checks = moves.filter((m) => /[+#]/.test(m.san));
  const captures = moves.filter((m) => m.captured && !/[+#]/.test(m.san));
  let attackedCaps: ReturnType<typeof winnableCaptures> = [];
  try { attackedCaps = winnableCaptures(inp.fenBefore, opp); } catch { /* ignore */ }
  const attacked = attackedCaps.map((c) => `the ${NAME[c.victim]} on ${c.to}`);
  // Nothing forcing and the move was fine: not worth a scene.
  if (!bad && checks.length + captures.length + attacked.length === 0) return null;
  const kindOf = (san: string): 'check' | 'capture' | 'quiet' => (/[+#]/.test(san) ? 'check' : san.includes('x') ? 'capture' : 'quiet');
  let bestKind: 'check' | 'capture' | 'quiet' | null = null;
  let bestArrow: SceneArrow[] = [];
  if (inp.bestUci && inp.bestUci.length >= 4) {
    try {
      const bm: any = new Chess(inp.fenBefore).move(uciMove(inp.bestUci));
      bestKind = kindOf(bm.san);
      bestArrow = [{ from: bm.from, to: bm.to, color: 'green' }];
    } catch { /* ignore */ }
  }
  const text = ccaText({
    checks: checks.map((m) => m.san), captures: captures.map((m) => m.san), attacked,
    playedKind: kindOf(played.san), bestKind, bad, seed: inp.fenBefore + inp.san,
  });
  const arrows: SceneArrow[] = [
    ...bestArrow,
    ...checks.slice(0, 2).map((m) => ({ from: m.from as Square, to: m.to as Square, color: 'yellow' as ArrowColor })),
    ...attackedCaps.slice(0, 2).map((c) => ({ from: c.from, to: c.to, color: 'red' as ArrowColor })),
  ];
  return mk(inp.fenBefore, played, text, arrows.length ? arrows : [{ from: played.from, to: played.to, color: 'blue' }], 'Checks · captures · attacks');
}

const KING_KINDS = new Set<FactKind>(['castled', 'king-center', 'shield', 'king-zone', 'back-rank']);
const ACTIVITY_KINDS = new Set<FactKind>(['development', 'rook-7th', 'rook-battery', 'open-file', 'half-open', 'diagonal', 'bishop-pair', 'bad-bishop', 'rim-knight', 'outpost', 'outpost-available', 'early-queen', 'trapped', 'loose', 'pin', 'endgame-king']);
const STRUCTURE_KINDS = new Set<FactKind>(['isolated', 'doubled', 'backward', 'passed', 'islands', 'center', 'unstoppable']);

/** Step 6 of the method: material, king safety, piece activity, pawn structure; then the engine number as the referee. */
function criteriaScene(inp: ExplainInput): Scene | null {
  if (inp.quality === 'book') return null;
  let played: any;
  let facts: Fact[] = [];
  try {
    played = new Chess(inp.fenBefore).move(inp.san);
    facts = positionFacts(inp.fenAfter, undefined, false);
  } catch { return null; }
  const seed = inp.fenAfter + inp.san;
  const mat = materialLine(inp.fenAfter);
  const lead: Record<'w' | 'b', number> = { w: 0, b: 0 };
  if (mat.lead) lead[mat.lead]++;
  const lines: string[] = [`**Material:** ${mat.text}.`];
  const arrows: SceneArrow[] = [];
  let anything = !!mat.lead;
  const cats: [string, Set<FactKind>][] = [['King safety', KING_KINDS], ['Piece activity', ACTIVITY_KINDS], ['Pawn structure and space', STRUCTURE_KINDS]];
  for (const [label, kinds] of cats) {
    const fs = facts.filter((f) => kinds.has(f.kind) && f.side && f.polarity !== 'info');
    const net: Record<'w' | 'b', number> = { w: 0, b: 0 };
    for (const f of fs) net[f.polarity === 'asset' ? f.side! : other(f.side!)] += f.score;
    const diff = net.w - net.b;
    if (Math.abs(diff) < 6) { lines.push(`**${label}:** about equal.`); continue; }
    const lw: 'w' | 'b' = diff > 0 ? 'w' : 'b';
    lead[lw]++;
    anything = true;
    const top = fs.filter((f) => (f.polarity === 'asset' ? f.side : other(f.side!)) === lw).sort((a, b) => b.score - a.score)[0];
    const first = top ? posMarkup(top.text, 'neutral').split(/(?<=[.!?])\s/)[0] : '';
    lines.push(`**${label}:** ${sideName(lw)} is better. ${first}`.trim());
    if (top) arrows.push(...top.arrows.slice(0, 1).map((a) => ({ ...a, color: 'blue' as ArrowColor })));
  }
  const bad = BAD.includes(inp.quality);
  if (!anything && !bad) return null;
  const moverEval = moverPawns(inp.evalAfter, inp.color);
  const whiteEval = moverEval == null ? null : inp.color === 'w' ? moverEval : -moverEval;
  const engineLead: 'w' | 'b' | null = whiteEval == null || Math.abs(whiteEval) < 0.3 ? null : whiteEval > 0 ? 'w' : 'b';
  const crit: 'w' | 'b' | null = lead.w > lead.b ? 'w' : lead.b > lead.w ? 'b' : null;
  const close = whiteEval == null ? '' : ' ' + criteriaClose(crit ? sideName(crit) : null, engineLead ? sideName(engineLead) : null, formatEval(inp.evalAfter), seed);
  const text = `${criteriaIntro(seed)} ${lines.join(' ')}${close}`;
  return mk(inp.fenAfter, played, text, arrows.length ? arrows : [{ from: played.from, to: played.to, color: 'blue' }], 'Four criteria');
}

/**
 * Core scenes + look-ahead + engine-checked extras.
 * Order: verdict → why (mistakes) → structure / open lines / weak spots / plan → threat / danger / missed → what happens next → better move → main line → "also good".
 * Scenes with `extra: true` are the optional ones; use visibleScenes(scenes, showAll) to play the short version.
 */
export async function buildAdvancedExplanation(
  inp: ExplainInput,
  isCancelled: () => boolean = () => false,
): Promise<Scene[]> {
  const core = buildCoreScenes(inp);
  if (isCancelled() || core.length === 0) return core;
  const mover = inp.color;
  const refu = pvOf(inp.evalAfter);
  const drawSaved = savesDraw(moverPawns(inp.evalBefore, mover), moverPawns(inp.evalAfter, mover));
  // The short version a player sees first: verdict, WHY it went wrong (for mistakes), what happens, the better move.
  // Everything else (structure, threats, main line, other good moves) is marked `extra` for "Show more".
  // Every "why" / threat / missed tactic is confirmed by Stockfish before it is shown.
  const cause = await buildCause(inp, isCancelled);
  // The method's step 3: the checks / captures / attacks sweep. After a mistake it is part of the short version
  // (right after the verdict); after a good move it is an optional extra. Beginners only get it after a mistake.
  const sweep = ccaScene(inp);
  const wasBadMove = BAD.includes(inp.quality);
  const sweepScenes: Scene[] = sweep && (wasBadMove || inp.level !== 'beginner') ? [sweep] : [];
  const head: Scene[] = [core[0], ...(wasBadMove ? sweepScenes : []), ...(cause ? [cause] : [])];
  const sweepExtra: Scene[] = wasBadMove ? [] : sweepScenes;
  const ex = (s: Scene[]): Scene[] => s.map((x) => ({ ...x, extra: true }));
  let ideas: Scene[] = [];
  let positional: Scene[] = [];
  let draw: { scenes: Scene[]; end: LineEnd | null } = { scenes: [], end: null };
  const fallback = () => [...head, ...draw.scenes, ...ex(sweepExtra), ...ex(positional), ...ex(ideas), ...core.slice(1)];
  ideas = await ideaScenes(inp, isCancelled);
  if (isCancelled()) return fallback();
  // A move that turns a lost game into a draw (stalemate trick, perpetual...): follow the engine's line to the end of the game.
  draw = await drawIdea(inp, isCancelled);
  if (isCancelled()) return fallback();
  positional = await positionalScenes(inp, isCancelled);
  // The method's step 6: the four criteria, with the engine number as the referee.
  const scoreScene = criteriaScene(inp);
  if (scoreScene) positional = [...positional, scoreScene];
  if (isCancelled()) return fallback();
  const bestLine = await bestLineScenes(inp);
  if (isCancelled()) return fallback();
  const alsoGood = await alternativeScenes(inp);
  // The idea scenes move the board to hypothetical positions, so return to the move that was really played
  // before the line continues ("White answers: ...").
  let back: Scene[] = [];
  const oppName = sideName(other(inp.color));
  const wasBad = BAD.includes(inp.quality);
  const lineEnd = lineOutcome(inp.fenAfter, refu) ?? draw.end;
  // If the look-ahead found something the played move THREATENS, the scenes that follow must know about it:
  // the engine's next move is then the opponent's defence, not "nothing happens".
  const threatScene = wasBad ? undefined : ideas.find((s) => (s.chip ?? '').startsWith('Threat'));
  if ((ideas.length > 0 || draw.scenes.length > 0) && (!inp.isPlayedBest || drawSaved)) {
    try {
      const pm: any = new Chess(inp.fenBefore).move(inp.san);
      const th = threatScene?.threat;
      // Say WHAT the threat is and show it on the board: arrow from the piece's current square to the target,
      // plus the squares of the pieces it would hit.
      const note = th
        ? th.afterCheck
          ? ` Once ${oppName} has dealt with the check, ${sideName(inp.color)} threatens **${th.san}**, which ${th.does}.`
          : ` It threatens **${th.san}**, which ${th.does}. ${oppName} has to deal with that.`
        : '';
      const threatArrows: SceneArrow[] = th ? th.arrows : [];
      const lit = [...new Set(threatArrows.flatMap((a) => [a.from, a.to]))] as Square[];
      // "Back to the game" tells the player what the game is really about now (engine verdict vs material, stalemate / mate / draw ideas, plan).
      const story = gameStory(inp, lineEnd, drawSaved);
      // The eval bar goes back to the real position (the engine's eval after the played move) and Stockfish's best reply is drawn in blue.
      const bestReply = bestOf(inp.fenAfter, inp.evalAfter);
      const bestArrow: SceneArrow[] = bestReply ? [{ from: bestReply.uci.slice(0, 2) as Square, to: bestReply.uci.slice(2, 4) as Square, color: 'blue' }] : [];
      back = [{
        ...core[0],
        evalInfo: sceneEvalOf(inp.evalAfter),
        best: bestReply,
        chip: th ? `Back to the game · Threat ${th.san}` : 'Back to the game',
        arrows: [{ from: pm.from as Square, to: pm.to as Square, color: wasBad ? 'red' : 'green' }, ...threatArrows, ...bestArrow],
        squares: lit,
        text: parseSegs(`Back to the game: ${describeMove(pm as PlyMove)} was played.${note} ${story} Now let's see how ${oppName} answers.`),
      }];
    } catch { /* ignore */ }
  }
  // Reword the first line scene ("The game could go: ...") when it is really the answer to a threat.
  const restRaw = core.slice(1).map((s, i) => {
    if (i !== 0 || !threatScene || !s.text.length || !s.text[0].t.startsWith('The game could go: ')) return s;
    const segs = [...s.text];
    segs[0] = {
      ...segs[0],
      t: `${oppName} has to stop the threat of ${threatScene.threat?.san ?? 'that idea'}. The engine's best defence: ` + segs[0].t.slice('The game could go: '.length),
    };
    return { ...s, text: segs };
  });
  // Every scene that follows "Back to the game" carries the engine's eval of ITS position, so the eval bar moves with the moves,
  // and Stockfish's best move from there.
  const rest = await withEngineInfo(restRaw, inp.depth, isCancelled);
  const drawScenes = await withEngineInfo(draw.scenes, inp.depth, isCancelled);
  // verdict → why → drawing idea → structure / open lines / weak spots / plan → threats & dangers → back to the game → what happens next
  // Beginners get the simple story only: no pawn-structure talk, no side lines, no alternative moves.
  const beginner = inp.level === 'beginner';
  // When the game is about a draw / stalemate, "Back to the game" is part of the short version, not an optional extra.
  const backScenes = drawSaved || (lineEnd && lineEnd.kind !== 'mate') ? back : ex(back);
  return [
    ...head,
    ...drawScenes,
    ...ex(sweepExtra),
    ...(beginner ? [] : ex(positional)),
    ...ex(ideas),
    ...backScenes,
    ...rest,
    ...(beginner ? [] : bestLine),
    ...(beginner ? [] : ex(alsoGood)),
  ];
}

// ---------- "Why not this move?" ----------

/**
 * The player drags any move on the position a scene shows. Stockfish rates it against its own best move, then the SAME
 * machinery that explains a played move (verdict, why, the engine's reply, the result, the better move) explains this one,
 * so every sentence goes through the same line checks. `fen` is the position on the board, `uci` the move the player tried.
 * Returns [] when the move is not legal there; throws when the engine cannot be reached.
 */
export async function whyNotScenes(
  inp: ExplainInput, fen: string, uci: string, isCancelled: () => boolean = () => false,
): Promise<Scene[]> {
  let c: Chess;
  try { c = new Chess(fen); } catch { return []; }
  const color = c.turn() as 'w' | 'b';
  let m: any;
  try { m = c.move(uciMove(uci)); } catch { return []; }
  const after = c.fen();
  const depth = Math.min(inp.depth, 12);
  const [evB, evA] = await Promise.all([engineEval(fen, depth), engineEval(after, depth)]);
  if (isCancelled()) return [];
  const best: string | null = evB?.bestMove ?? null;
  const isBest = !!best && best.slice(0, 4) === uci.slice(0, 4);
  const quality = (classifyMove(evB, evA, uci, color, false, m.san, fen) as any).quality as string;
  const synth: ExplainInput = {
    fenBefore: fen, fenAfter: after, san: m.san, color, quality, isPlayedBest: isBest, bestUci: best,
    evalBefore: evB, evalAfter: evA, depth: inp.depth, level: inp.level,
  };
  const core = buildCoreScenes(synth);
  if (!core.length) return [];
  const cause = await buildCause(synth, isCancelled);
  if (isCancelled()) return [];
  const lead = whyNotLead(BAD.includes(quality), m.san, fen + uci);
  const head: Scene = {
    ...core[0], quality, chip: `Why not ${m.san}?`,
    text: [{ t: lead, hl: 'key' }, ...core[0].text],
  };
  return withEngineInfo([head, ...(cause ? [cause] : []), ...core.slice(1)], inp.depth, isCancelled);
}
