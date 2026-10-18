/**
 * Look-ahead layer on top of tactics.ts.
 * tactics.ts answers "what tactic did this move just create?".
 * This file answers the smarter questions:
 *   - What could I fork / skewer / mate / win with NEXT move if the opponent does nothing?   (plan)
 *   - What can the opponent do to me right now?                                              (danger)
 *   - Was there a tactic I could have played instead?                                        (missed)
 * Everything is verified with chess.js, nothing is guessed. Candidates are ranked by what they actually win:
 * winning the queen beats a fork of two minor pieces, which beats a pin of a pawn.
 */
import { Chess, type Square } from 'chess.js';
import {
  NAME, other, winnableCaptures, describeTactics,
  type Side, type PlyMove, type Tactic, type TacticKind,
} from './tactics';

const withSide = (fen: string, side: Side) => {
  const f = fen.split(' ');
  f[1] = side;
  f[3] = '-';
  return f.join(' ');
};

export interface ThreatItem {
  san: string;
  from: Square;
  to: Square;
  promotion?: string;
  /** Position after this move is played (so the board can show it). */
  fen: string;
  /** Verb phrase: "forks the king on e8 and the queen on d8", "delivers checkmate", "wins the queen on f7 for a bishop". */
  does: string;
  kind: TacticKind | 'capture';
  /** First arrow is the move itself, the rest show the tactic. */
  arrows: { from: Square; to: Square }[];
  /** How much this is worth (mate 1000, material win = 10 per pawn, forks / skewers / pins less). Used for ranking. */
  score: number;
}

/**
 * Worth of a tactic, 0 = not worth announcing.
 * Fork: a check forces the reply, so the best target is won; otherwise the opponent saves one piece and we win the
 * second best. It must be worth a minor piece (forking two pawns is not a tactic).
 * Pin: only against the king (small) or the queen (bigger). Skewer / discovered attack: medium.
 */
function tacticScore(t: Tactic, m: { from: string; to: string; san: string }, after: string, side: Side): number {
  switch (t.kind) {
    case 'mate': return 1000;
    case 'fork': {
      const gains = winnableCaptures(after, side)
        .filter((x) => x.from === m.to)
        .map((x) => x.gain)
        .sort((a, b) => b - a);
      const win = m.san.includes('+') ? (gains[0] ?? 0) : (gains[1] ?? 0);
      return win >= 3 ? 30 + win * 10 : 0;
    }
    case 'pin': return /to the king/.test(t.text) ? 12 : /to the queen/.test(t.text) ? 25 : 0;
    case 'skewer': return 35;
    case 'discovered': return 30;
    case 'mate-threat': return 50;
    default: return 20;
  }
}

/** Every legal move `side` could play in this position that creates one of `kinds`, best first. */
export function tacticalMoves(
  fen: string,
  side: Side,
  kinds: TacticKind[] = ['mate', 'fork', 'skewer'],
  limit = 3,
): ThreatItem[] {
  const base = withSide(fen, side);
  let c: Chess;
  try { c = new Chess(base); } catch { return []; }
  const out: ThreatItem[] = [];
  for (const m of c.moves({ verbose: true })) {
    let after: string;
    try {
      const t = new Chess(base);
      t.move(m.san);
      after = t.fen();
    } catch { continue; }
    const tactic = describeTactics(base, m as unknown as PlyMove, after).find(
      (x) => kinds.includes(x.kind) && tacticScore(x, m, after, side) > 0,
    );
    if (!tactic) continue;
    out.push({
      san: m.san.replace(/[+#]/g, ''),
      from: m.from as Square,
      to: m.to as Square,
      promotion: m.promotion,
      fen: after,
      does: tactic.text,
      kind: tactic.kind,
      arrows: [{ from: m.from as Square, to: m.to as Square }, ...tactic.arrows],
      score: tacticScore(tactic, m, after, side),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * What `side` threatens to do in this position if it were its turn:
 * mates, forks, skewers, pins AND plain material wins, ranked by how much they win.
 */
export function threats(fen: string, side: Side, limit = 3): ThreatItem[] {
  const items = tacticalMoves(fen, side, ['mate', 'fork', 'skewer', 'pin'], 6);
  const base = withSide(fen, side);
  for (const cp of winnableCaptures(fen, side).slice(0, 3)) {
    const score = cp.gain * 10;
    const dup = items.find((i) => i.from === cp.from && i.to === cp.to);
    if (dup) { dup.score = Math.max(dup.score, score); continue; }
    try {
      const c = new Chess(base);
      const m = c.move({ from: cp.from, to: cp.to, promotion: 'q' });
      items.push({
        san: m.san.replace(/[+#]/g, ''),
        from: cp.from,
        to: cp.to,
        promotion: m.promotion,
        fen: c.fen(),
        does: `wins the ${cp.free ? 'undefended ' : ''}${NAME[cp.victim]} on ${cp.to}${cp.free ? '' : ` for a ${NAME[cp.attacker]}`}`,
        kind: 'capture',
        arrows: [{ from: cp.from, to: cp.to }],
        score,
      });
    } catch { /* ignore */ }
  }
  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface Ideas {
  /** What the side that just moved threatens to do next. */
  plan: ThreatItem[];
  /** What the opponent can do right now. */
  danger: ThreatItem[];
}

/** Position AFTER `mover` played. */
export function lookAhead(fenAfter: string, mover: Side): Ideas {
  return { plan: threats(fenAfter, mover), danger: threats(fenAfter, other(mover)) };
}

/** Position BEFORE the move: a fork / skewer / mate that was available (to explain misses and mistakes). */
export function missedTactic(fenBefore: string, mover: Side, playedSan: string): ThreatItem | null {
  const clean = playedSan.replace(/[+#]/g, '');
  return tacticalMoves(fenBefore, mover, ['mate', 'fork', 'skewer'], 3).find((m) => m.san !== clean) ?? null;
}
