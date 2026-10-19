/**
 * Advanced coach: turns a reviewed move into a short "movie" of scenes.
 * Every sentence is built from facts verified with chess.js + the engine (no guessing, no API key needed).
 *
 * Scene text markup:  **key**   ++good++   ~~bad~~
 */
import { Chess, type Square } from 'chess.js';
import { analyzePosition, evalToPawns, formatEval } from '@/lib/engine';
import { detectKnightFork } from '@/lib/knight-fork';
import { describeTactics, winnableCaptures } from '@/lib/tactics';
import { threats, missedTactic, tacticalMoves } from '@/lib/tactics-lookahead';
import { moveInsights, movePurpose, positionFacts, coachPlan, type Fact, type FactKind } from '@/lib/positional';

export type Seg = { t: string; hl?: 'key' | 'good' | 'bad' };
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
  /**
   * Set by the player while the coach is SPEAKING this scene: only squares the voice has already named should light up
   * (instead of every square in the text at once). `done` = the sentence is finished. Absent = light everything (paused / muted).
   */
  spoken?: { named: Square[]; current: Square[]; done: boolean };
}

export type CauseId = 'hung-piece' | 'ignored-threat' | 'missed-tactic' | 'allowed-tactic' | 'greedy' | 'positional';

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
/** Same position + same move always gives the same wording, but different moves sound different. */
const pickVar = (seed: string, opts: string[]) => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return opts[h % opts.length];
};
const GOOD_OPEN: Record<string, string[]> = {
  brilliant: ['Brilliant!', 'Wow, what a find.'],
  best: ['This is the best move here.', 'Spot on, this is the best move.'],
  great: ['Great move.', 'Really strong move.'],
  excellent: ['Excellent move.', 'Very nicely played.'],
  good: ['Good move.', 'A solid choice.'],
  book: ['A well-known book move.', 'Standard opening theory.'],
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

function material(fen: string): Record<'w' | 'b', Record<string, number>> {
  const out = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } } as any;
  for (const ch of fen.split(' ')[0]) {
    const l = ch.toLowerCase();
    if (!(l in VAL) || l === 'k') continue;
    out[ch === l ? 'b' : 'w'][l]++;
  }
  return out;
}

/** What `side` has won/lost on balance between two positions, e.g. "loses a knight". */
function netMaterial(fenStart: string, fenEnd: string, side: 'w' | 'b') {
  const a = material(fenStart), b = material(fenEnd);
  const o = other(side);
  let swing = 0;
  let worst: string | null = null, best: string | null = null;
  for (const t of ['p', 'n', 'b', 'r', 'q']) {
    const d = (b[side][t] - a[side][t]) - (b[o][t] - a[o][t]);
    swing += d * VAL[t];
    if (d < 0 && (!worst || VAL[t] > VAL[worst])) worst = t;
    if (d > 0 && (!best || VAL[t] > VAL[best])) best = t;
  }
  return { swing, worst, best };
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

/**
 * A "tactic" found by the look-ahead search is only real if the piece that makes it can't simply be taken.
 * Example: Qf8+ "skewering" the king and bishop is nonsense when the king just plays Kxf8.
 * `it.fen` is the position AFTER the tactical move, `it.to` the square the piece landed on,
 * `side` the colour that played it. Checkmates are always kept (the search already verified them).
 */
function hangsItsPiece(it: { fen: string; to: string; kind: string }, side: 'w' | 'b'): boolean {
  if (it.kind === 'mate') return false;
  try {
    return !!hangingInfo(it.fen, it.to as Square, side);
  } catch {
    return false;
  }
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

/** Plays a UCI line and returns one scene per ply, narrated for `mover`. */
function lineScenes(fenStart: string, ucis: string[], mover: 'w' | 'b', maxPlies: number, intro: 'reply' | 'then'): Scene[] {
  const scenes: Scene[] = [];
  let chess: Chess;
  try { chess = new Chess(fenStart); } catch { return scenes; }
  // Keep going up to 2 plies past `maxPlies` while an exchange is still in progress,
  // so a capture is never left hanging in the middle of a trade.
  for (let i = 0; i < Math.min(ucis.length, maxPlies + 2); i++) {
    const uci = ucis[i];
    let m;
    try {
      m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
    } catch { break; }
    const first = scenes.length === 0;
    let text = first && intro === 'reply'
      ? `${sideName(m.color)} answers: ${describeMove(m as PlyMove)}.`
      : `${first ? 'The game could go' : 'Then'}: ${describeMove(m as PlyMove)}.`;

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
    const arrows: SceneArrow[] = [{ from: m.from as Square, to: m.to as Square, color: m.color === mover ? 'green' : 'red' }];
    scenes.push(mk(chess.fen(), m, text, arrows));

    // past the normal length, stop as soon as the last move wasn't a capture
    if (i + 1 >= maxPlies && !m.captured) break;
  }
  return scenes;
}

/** What a move is for (used for good moves and for the "better move"). Tactics are detected on the board first. */
function purpose(fenBefore: string, m: PlyMove, fenAfter: string, mover: 'w' | 'b'): string {
  const bits: string[] = [];
  const tac = pickTactic(fenBefore, m, fenAfter);
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
  if (m.captured) bits.push(`wins ${article(NAME[m.captured])} ${NAME[m.captured]}`);
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
  const lineMat = (() => {
    try {
      const c = new Chess(inp.fenAfter);
      for (const u of refutation.slice(0, 6)) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
      return netMaterial(inp.fenAfter, c.fen(), mover);
    } catch { return { swing: 0, worst: null, best: null }; }
  })();

  // ---- Scene 1: the verdict and the reason
  let text = `${describeMove(played)} is ${WORD[inp.quality] ?? 'a move'}`;
  const arrows: SceneArrow[] = [playedArrow];
  if (bad) {
    const hang = hangingInfo(inp.fenAfter, played.to, mover);
    if (hang) {
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
    const tacG = pickTactic(inp.fenBefore, played, inp.fenAfter);
    const opener = pickVar(inp.fenAfter + inp.san, GOOD_OPEN[inp.quality] ?? ['Good move.']);
    if (tacG && tacG.kind === 'mate') {
      const expl = tacG.text.split(': ')[1];
      text = `${describeMove(played)} — that's ${named(tacG.name)}${expl ? `: ${expl}` : ''}.`;
    } else if (tacG) {
      text = `${opener} ${describeMove(played)}. That's ${named(tacG.name)}: ${howClause(tacG)}.`;
    } else {
      text = `${opener} ${describeMove(played)} — it ${purpose(inp.fenBefore, played, inp.fenAfter, mover)}.`;
    }
    // A strong move whose piece can simply be taken is a sacrifice: say so, otherwise "brilliant" is unexplained.
    const sac = tacG?.kind === 'mate' ? null : hangingInfo(inp.fenAfter, played.to, mover);
    if (sac && sac.gain >= 2 && ['brilliant', 'great', 'best'].includes(inp.quality)) {
      // What does the sacrifice buy? Taken from the engine's line, never guessed.
      const moverMates = typeof inp.evalAfter?.mate === 'number' && (mover === 'w' ? inp.evalAfter.mate > 0 : inp.evalAfter.mate < 0);
      let buys: string;
      if (moverMates) buys = `${side} gets a forced **checkmate**`;
      else if (lineMat.swing >= 1 && lineMat.best) buys = `after best play ${side} comes out ++ahead++, winning ${article(NAME[lineMat.best])} ${NAME[lineMat.best]}`;
      else if (after != null && after >= 0.8) buys = `${side} gets a strong attack, and the engine rates it **${formatEval(inp.evalAfter)}**`;
      else buys = `${side} gets more in return than it gives up`;
      text += ` It's a **sacrifice**: ${oppName} can take the ${NAME[played.piece]}, but ${buys}.`;
    }
    if (inp.isPlayedBest && inp.quality !== 'book' && tacG?.kind !== 'mate') text += " It's also the engine's top choice.";
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
  const lineSc = !bad && inp.isPlayedBest ? [] : lineScenes(inp.fenAfter, refutation, mover, bad ? 5 : 3, bad ? 'reply' : 'then');
  scenes.push(...lineSc);
  if (bad && lineSc.length) {
    const phrase = materialPhrase(lineMat);
    const last = lineSc[lineSc.length - 1];
    const mateN = typeof inp.evalAfter?.mate === 'number' ? inp.evalAfter.mate : 0;
    const mateAgainst = mateN !== 0 && (mover === 'w' ? mateN < 0 : mateN > 0);
    const wasText = before != null ? ` (it was ${formatEval(inp.evalBefore)} before the move)` : '';
    let resultText: string;
    if (mateAgainst) {
      // The engine sees a forced mate: this move loses the game, not just "a bit of advantage".
      const n = Math.abs(mateN);
      resultText = `This loses the game: ${oppName} has a forced **checkmate in ${n}**${n === 1 ? ' — it comes on the very next move' : ''}.${before != null ? ` The position was ${formatEval(inp.evalBefore)} before the move.` : ''}`;
    } else if (after != null && after <= -5) {
      resultText = `After this, ${side} is **completely lost**${phrase ? ` and ${phrase}` : ''}. The engine now shows **${formatEval(inp.evalAfter)}**${wasText}.`;
    } else if (after != null && after <= -2.5) {
      resultText = `After this, ${side} is **clearly losing**${phrase ? ` and ${phrase}` : ''}. The engine now shows **${formatEval(inp.evalAfter)}**${wasText}.`;
    } else {
      resultText = `After this, ${side} ${phrase ?? 'is clearly worse'}. The engine now shows **${formatEval(inp.evalAfter)}**${wasText || ''}.`;
    }
    scenes.push({
      ...last,
      arrows: [],
      chip: mateAgainst ? 'Result · Checkmate' : 'Result',
      text: parseSegs(resultText),
    });
  }

  // ---- The better move
  if (!inp.isPlayedBest && inp.bestUci && inp.bestUci.length >= 4) {
    try {
      const c = new Chess(inp.fenBefore);
      const bm: any = c.move({ from: inp.bestUci.slice(0, 2), to: inp.bestUci.slice(2, 4), promotion: inp.bestUci.length > 4 ? inp.bestUci[4] : undefined });
      const why = purpose(inp.fenBefore, bm, c.fen(), mover);
      scenes.push(mk(
        c.fen(), bm,
        bad
          ? `A much better choice was ${describeMove(bm)}. It ${why}, and the position would have stayed around **${formatEval(inp.evalBefore)}**.`
          : `The engine likes ${describeMove(bm)} a little more: it ${why}.`,
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
 * Look-ahead scenes (search over legal moves, so they run after the core scenes are already playable):
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

  // What the mover threatens next (only meaningful after a sound move)
  if (!bad && !inp.isPlayedBest && !inp.san.endsWith('#')) {
    await tick();
    if (isCancelled()) return [];
    // After a check the opponent MUST react, so "if they don't react" makes no sense:
    // look at what is threatened after their forced (engine) reply instead.
    let reply = '';
    let fenFrom = inp.fenAfter;
    if (inp.san.includes('+')) {
      const u = (inp.evalAfter?.continuation ?? '').split(/\s+/).filter(Boolean)[0];
      try {
        const c = new Chess(inp.fenAfter);
        const r = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
        reply = r.san;
        fenFrom = c.fen();
      } catch { fenFrom = ''; }
    }
    const p = fenFrom ? threats(fenFrom, mover, 2).find((x) => !hangsItsPiece(x, mover)) : undefined;
    if (p) {
      const arrows = itemArrows(p, 'green');
      const sc = mk(
        p.fen, p,
        reply
          ? `${oppName} has to deal with the check first. After that, ${side} threatens **${p.san}**, which ${p.does}.`
          : `${side} now threatens **${p.san}**, which ${p.does}. ${oppName} has to respond.`,
        arrows,
        `Threat · ${KIND_LABEL[p.kind]}`,
      );
      sc.threat = { san: p.san, does: p.does, afterCheck: !!reply, arrows };
      out.push(sc);
    }
  }

  // What the opponent can do right now
  if (!inp.san.endsWith('#')) {
    await tick();
    if (isCancelled()) return out;
    // After a mistake, only show a "danger" that really works: the attacking piece must not be capturable for free.
    // After a sound move, a hanging attacker is only kept when the engine itself plays it (a real sacrifice, checked below).
    const dangers = threats(inp.fenAfter, opp, 2);
    const d = (bad ? dangers.filter((x) => !hangsItsPiece(x, opp)) : dangers)
      .find((x) => !(x.kind === 'capture' && x.to === played.to && bad));
    if (d && bad) {
      out.push(mk(
        d.fen, d,
        `Watch out: ${oppName} now threatens **${d.san}**, which ${d.does}.`,
        itemArrows(d, 'red'),
        `Danger · ${KIND_LABEL[d.kind]}`,
      ));
    } else if (d) {
      // A sound move that leaves something en prise is a SACRIFICE, not a mistake: check with the engine what it is for.
      const refu = (inp.evalAfter?.continuation ?? '').split(/\s+/).filter(Boolean) as string[];
      const engineAgrees = !refu.length || refu[0].slice(0, 4) === d.from + d.to || d.kind === 'mate';
      if (engineAgrees) {
        const lm = (() => {
          try {
            const c = new Chess(inp.fenAfter);
            for (const u of refu.slice(0, 6)) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
            return netMaterial(inp.fenAfter, c.fen(), mover);
          } catch { return { swing: 0, worst: null, best: null }; }
        })();
        const ev = moverPawns(inp.evalAfter, mover);
        const moverMates = typeof inp.evalAfter?.mate === 'number' && (mover === 'w' ? inp.evalAfter.mate > 0 : inp.evalAfter.mate < 0);
        let text: string;
        let chip = `Danger · ${KIND_LABEL[d.kind]}`;
        if (moverMates) {
          text = `Sacrifice: ${oppName} can play **${d.san}** (it ${d.does}), but ${side} still has a forced **checkmate**.`;
          chip = 'Sacrifice';
        } else if (refu.length && lm.swing >= 0) {
          text = `Sacrifice: ${oppName} can play **${d.san}** (it ${d.does}), but it is a trap. After best play ${side} ${materialPhrase(lm) ?? 'wins the material back'}.`;
          chip = 'Sacrifice';
        } else if (ev != null && ev >= 0.8) {
          text = `Sacrifice for position: ${oppName} can win material with **${d.san}** (it ${d.does}), but ${side} gets a strong attack. The engine still rates the position **${formatEval(inp.evalAfter)}**, so the initiative is worth more than the material.`;
          chip = 'Sacrifice';
        } else {
          text = `Watch out: ${oppName} threatens **${d.san}**, which ${d.does}.`;
        }
        out.push(mk(d.fen, d, text, itemArrows(d, 'red'), chip));
      }
      // If the engine's best reply is something else, that "threat" doesn't actually work, so we don't mention it.
    }
  }

  // A tactic the mover missed
  if (bad) {
    await tick();
    if (isCancelled()) return out;
    const miss = missedTactic(inp.fenBefore, mover, inp.san);
    const isBestAlready = !!inp.bestUci && miss && miss.from + miss.to === inp.bestUci.slice(0, 4);
    if (miss && !isBestAlready && !hangsItsPiece(miss, mover)) {
      out.push(mk(
        miss.fen, miss,
        `${side} missed ${named(KIND_LABEL[miss.kind] ?? 'tactic')}: **${miss.san}** ${miss.does}.`,
        itemArrows(miss, 'green'),
        `Missed · ${KIND_LABEL[miss.kind]}`,
      ));
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
    return lineScenes(c.fen(), line, inp.color, 3, 'then').map((s, i) => (i === 0 ? { ...s, chip: 'Main line' } : s));
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
      if (alt == null || ref - alt > 0.35) continue; // only good / excellent moves
      const why = purpose(inp.fenBefore, m as PlyMove, c.fen(), mover);
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

// ---------- why did the player go wrong? ----------

export const CAUSE_LABEL: Record<CauseId, string> = {
  'hung-piece': 'Left a piece loose',
  'ignored-threat': 'Missed a threat',
  'missed-tactic': 'Missed a tactic',
  'allowed-tactic': 'Allowed a tactic',
  greedy: 'Greedy capture',
  positional: 'Gave up the advantage',
};
const CAUSE_HABIT: Record<CauseId, string> = {
  'hung-piece': 'Habit to build: before you move a piece, check it is still protected on its new square.',
  'ignored-threat': 'Habit to build: before every move, ask what your opponent is threatening right now.',
  'missed-tactic': 'Habit to build: look at checks, captures and threats first, because that is where tactics hide.',
  'allowed-tactic': 'Habit to build: once you pick a move, ask what your opponent can do to you in reply.',
  greedy: 'Habit to build: before grabbing material, check what the capture gives your opponent.',
  positional: 'Habit to build: when nothing is hanging, compare moves by piece activity and king safety.',
};

/**
 * The reason behind a mistake, in plain words. Checked in order of how clearly it can be proven on the board:
 * a piece left loose, a threat that was ignored, a tactic that was allowed, a tactic that was missed,
 * a greedy capture, and finally "no single tactic, the advantage just slipped away".
 * Opponent ideas are only used when the engine's own reply is that move (so we never blame a threat that doesn't work).
 */
function causeScene(inp: ExplainInput): Scene | null {
  if (!BAD.includes(inp.quality)) return null;
  const mover = inp.color, opp = other(mover);
  const side = sideName(mover), oppName = sideName(opp);
  let played: any;
  try { played = new Chess(inp.fenBefore).move(inp.san); } catch { return null; }
  const refu = (inp.evalAfter?.continuation ?? '').split(/\s+/).filter(Boolean) as string[];
  const mat = (() => {
    try {
      const c = new Chess(inp.fenAfter);
      for (const u of refu.slice(0, 6)) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
      return netMaterial(inp.fenAfter, c.fen(), mover);
    } catch { return { swing: 0, worst: null, best: null }; }
  })();
  const engineUses = (x: { from: string; to: string; kind: string }) =>
    !refu.length || refu[0].slice(0, 4) === x.from + x.to || x.kind === 'mate';
  const make = (id: CauseId, text: string, arrows: SceneArrow[]): Scene => {
    const sc = mk(inp.fenAfter, played, `${text} ${CAUSE_HABIT[id]}`, arrows, `Why · ${CAUSE_LABEL[id]}`);
    sc.cause = { id, label: CAUSE_LABEL[id] };
    return sc;
  };

  try {
    // 1. The piece that just moved can be won.
    const hang = hangingInfo(inp.fenAfter, played.to, mover);
    if (hang && hang.gain >= 2) {
      return make('hung-piece',
        `The cause: the ${NAME[played.piece]} on ${played.to} ${hang.free ? 'has no protection there' : 'can be taken by a cheaper piece'}, so ${oppName} simply wins material.`,
        [{ from: hang.from, to: played.to, color: 'red' }]);
    }

    const dangersAfter = threats(inp.fenAfter, opp, 4).filter((x) => !hangsItsPiece(x, opp));

    // 2. The opponent was already threatening something big, and the move did nothing about it.
    const ignored = threats(inp.fenBefore, opp, 4)
      .filter((t) => t.score >= 30 && !hangsItsPiece(t, opp))
      .find((t) => engineUses(t) && dangersAfter.some((x) => x.from === t.from && x.to === t.to));
    if (ignored) {
      return make('ignored-threat',
        `${oppName} was already threatening **${ignored.san}**, which ${ignored.does}. This move didn't deal with it.`,
        itemArrows(ignored, 'red'));
    }

    // 3. The move created a new opportunity for the opponent.
    const allowed = dangersAfter.find((x) => x.score >= 30 && engineUses(x));
    if (allowed) {
      return make('allowed-tactic',
        allowed.kind === 'capture'
          ? `This move lets ${oppName} play **${allowed.san}**, which ${allowed.does}.`
          : `This move allowed ${named(KIND_LABEL[allowed.kind] ?? 'tactic')}: ${oppName} can play **${allowed.san}**, which ${allowed.does}.`,
        itemArrows(allowed, 'red'));
    }

    // 4. The player had a real tactic and played something else.
    const miss = missedTactic(inp.fenBefore, mover, inp.san);
    if (miss && miss.score >= 30 && !hangsItsPiece(miss, mover)) {
      return make('missed-tactic',
        `${side} had ${named(KIND_LABEL[miss.kind] ?? 'tactic')} available: **${miss.san}** ${miss.does}.`,
        itemArrows(miss, 'green'));
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
  return `Your most common mistake this game: ${CAUSE_LABEL[top].toLowerCase()} (${count} time${count > 1 ? 's' : ''}). ${CAUSE_HABIT[top]}`;
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
      prompt: `That was ${WORD[inp.quality] ?? 'a mistake'}. Can you find a better move for ${sideName(inp.color)}?`,
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
    return { ok: true, text: "Yes, that's the engine's move. Well found!" };
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
    const p = coachPlan(inp.fenAfter, side, undefined, 1)[0];
    if (p && (bad || p.score >= 26)) {
      out.push(mk(inp.fenAfter, played,
        `${sideName(side)}'s plan: ${posMarkup(p.text, 'neutral')}`,
        p.arrows.length ? p.arrows.slice(0, 2).map((a) => ({ ...a, color: 'blue' as ArrowColor })) : [playedArrow],
        'Plan'));
    }
  } catch { /* ignore */ }
  return out;
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
  // The short version a player sees first: verdict, WHY it went wrong (for mistakes), what happens, the better move.
  // Everything else (structure, threats, main line, other good moves) is marked `extra` for "Show more".
  const cause = causeScene(inp);
  const head: Scene[] = cause ? [core[0], cause] : [core[0]];
  const ex = (s: Scene[]): Scene[] => s.map((x) => ({ ...x, extra: true }));
  const ideas = await ideaScenes(inp, isCancelled);
  if (isCancelled()) return [...head, ...core.slice(1)];
  const positional = await positionalScenes(inp, isCancelled);
  if (isCancelled()) return [...head, ...ex(positional), ...ex(ideas), ...core.slice(1)];
  const bestLine = await bestLineScenes(inp);
  if (isCancelled()) return [...head, ...ex(positional), ...ex(ideas), ...core.slice(1)];
  const alsoGood = await alternativeScenes(inp);
  // The idea scenes move the board to hypothetical positions, so return to the move that was really played
  // before the line continues ("White answers: ...").
  let back: Scene[] = [];
  const oppName = sideName(other(inp.color));
  const wasBad = BAD.includes(inp.quality);
  // If the look-ahead found something the played move THREATENS, the scenes that follow must know about it:
  // the engine's next move is then the opponent's defence, not "nothing happens".
  const threatScene = wasBad ? undefined : ideas.find((s) => (s.chip ?? '').startsWith('Threat'));
  if (ideas.length && !inp.isPlayedBest) {
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
      back = [{
        ...core[0],
        chip: th ? `Back to the game · Threat ${th.san}` : 'Back to the game',
        arrows: [{ from: pm.from as Square, to: pm.to as Square, color: wasBad ? 'red' : 'green' }, ...threatArrows],
        squares: lit,
        text: parseSegs(`Back to the game: ${describeMove(pm as PlyMove)} was played.${note} Now let's see how ${oppName} answers.`),
      }];
    } catch { /* ignore */ }
  }
  // Reword the first line scene ("The game could go: ...") when it is really the answer to a threat.
  const rest = core.slice(1).map((s, i) => {
    if (i !== 0 || !threatScene || !s.text.length || !s.text[0].t.startsWith('The game could go: ')) return s;
    const segs = [...s.text];
    segs[0] = {
      ...segs[0],
      t: `${oppName} has to stop the threat of ${threatScene.threat?.san ?? 'that idea'}. The engine's best defence: ` + segs[0].t.slice('The game could go: '.length),
    };
    return { ...s, text: segs };
  });
  // verdict → structure / open lines / weak spots / plan → threats & dangers → back to the game → what happens next
  // Beginners get the simple story only: no pawn-structure talk, no side lines, no alternative moves.
  const beginner = inp.level === 'beginner';
  return [
    ...head,
    ...(beginner ? [] : ex(positional)),
    ...ex(ideas),
    ...ex(back),
    ...rest,
    ...(beginner ? [] : ex(bestLine)),
    ...(beginner ? [] : ex(alsoGood)),
  ];
}
