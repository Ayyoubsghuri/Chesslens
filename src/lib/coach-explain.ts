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
}

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
}

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

export function parseSegs(s: string): Seg[] {
  return s.split(/(\*\*.+?\*\*|\+\+.+?\+\+|~~.+?~~)/g).filter(Boolean).map((p) => {
    if (p.startsWith('**')) return { t: p.slice(2, -2), hl: 'key' as const };
    if (p.startsWith('++')) return { t: p.slice(2, -2), hl: 'good' as const };
    if (p.startsWith('~~')) return { t: p.slice(2, -2), hl: 'bad' as const };
    return { t: p };
  });
}
export const plainText = (segs: Seg[]) => segs.map((s) => s.t).join('');
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
  mate: 'Checkmate', fork: 'Fork', pin: 'Pin', skewer: 'Skewer', discovered: 'Discovered attack',
  'mate-threat': 'Mate threat', promotion: 'Promotion', capture: 'Wins material',
};
const KIND_COLOR: Record<string, ArrowColor> = {
  mate: 'green', fork: 'yellow', pin: 'blue', skewer: 'blue', discovered: 'blue',
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
    text += `: it ${purpose(inp.fenBefore, played, inp.fenAfter, mover)}.`;
    if (inp.isPlayedBest && inp.quality !== 'book') text += ' The engine agrees — this is its top choice.';
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
  scenes.push(mk(inp.fenAfter, played, text, arrows, tac ? `${inp.san} · ${KIND_LABEL[tac.kind]}` : `${inp.san}`));

  // ---- What happens next (punishment if bad, follow-up if good)
  const lineSc = lineScenes(inp.fenAfter, refutation, mover, bad ? 5 : 3, bad ? 'reply' : 'then');
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
      resultText = `After this, ${side} is **completely lost**${phrase ? ` and ${phrase}` : ''}. Engine: **${formatEval(inp.evalAfter)}**${wasText}.`;
    } else if (after != null && after <= -2.5) {
      resultText = `After this, ${side} is **clearly losing**${phrase ? ` and ${phrase}` : ''}. Engine: **${formatEval(inp.evalAfter)}**${wasText}.`;
    } else {
      resultText = `After this, ${side} ${phrase ?? 'is clearly worse'}. Engine: **${formatEval(inp.evalAfter)}**${wasText || ''}.`;
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
          ? `Instead, ${describeMove(bm)} was much stronger — it ${why}. The evaluation would have stayed around **${formatEval(inp.evalBefore)}**.`
          : `The engine slightly prefers ${describeMove(bm)}, which ${why}.`,
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
  if (!bad && !inp.san.endsWith('#')) {
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
      out.push(mk(
        p.fen, p,
        reply
          ? `${oppName} has to answer the check (for example ${reply}). After that it is ${side}'s move, and ${side} threatens **${p.san}**, which ${p.does}.`
          : `Next idea: if ${oppName} doesn't react, ${side} plays **${p.san}**, which ${p.does}.`,
        itemArrows(p, 'green'),
        `Threat · ${KIND_LABEL[p.kind]}`,
      ));
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
        `${oppName} now has **${d.san}**, which ${d.does}.`,
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
        `${side} had a strong tactic: **${miss.san}** ${miss.does}.`,
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
  if (BAD.includes(inp.quality)) return [];
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

/**
 * Core scenes + look-ahead + engine-checked extras.
 * Order: verdict → threat / danger / missed → what happens next → better move → main line → "also good".
 */
export async function buildAdvancedExplanation(
  inp: ExplainInput,
  isCancelled: () => boolean = () => false,
): Promise<Scene[]> {
  const core = buildCoreScenes(inp);
  if (isCancelled() || core.length === 0) return core;
  const ideas = await ideaScenes(inp, isCancelled);
  if (isCancelled()) return core;
  const bestLine = await bestLineScenes(inp);
  if (isCancelled()) return [core[0], ...ideas, ...core.slice(1)];
  const alsoGood = await alternativeScenes(inp);
  // The idea scenes move the board to hypothetical positions, so return to the move that was really played
  // before the line continues ("White answers: ...").
  let back: Scene[] = [];
  const oppName = sideName(other(inp.color));
  const wasBad = BAD.includes(inp.quality);
  // If the look-ahead found something the played move THREATENS, the scenes that follow must know about it:
  // the engine's next move is then the opponent's defence, not "nothing happens".
  const threatScene = wasBad ? undefined : ideas.find((s) => (s.chip ?? '').startsWith('Threat'));
  if (ideas.length) {
    try {
      const pm: any = new Chess(inp.fenBefore).move(inp.san);
      const note = threatScene
        ? ` It threatens **${threatScene.san}**, so ${oppName} has to deal with that.`
        : '';
      back = [{
        ...core[0],
        chip: 'Back to the game',
        arrows: [{ from: pm.from as Square, to: pm.to as Square, color: wasBad ? 'red' : 'green' }],
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
      t: `${oppName} has to stop that threat. The engine's best defence: ` + segs[0].t.slice('The game could go: '.length),
    };
    return { ...s, text: segs };
  });
  return [core[0], ...ideas, ...back, ...rest, ...bestLine, ...alsoGood];
}
