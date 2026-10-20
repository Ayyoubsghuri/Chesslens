/**
 * Claim checker for the advanced coach.
 *
 * The coach's wording comes from templates ("wins a rook", "it's a sacrifice", "that's a fork"). A template only
 * proves that a pattern exists on the board, not that it works. This module plays the engine's line forward and
 * checks the material count at the END of the exchange, so a sentence is only said when the line agrees.
 *
 * Pure chess.js, no engine, no DOM: everything here is unit-testable with a stored principal variation.
 */
import { Chess } from 'chess.js';

export type Side = 'w' | 'b';

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const other = (c: Side): Side => (c === 'w' ? 'b' : 'w');

export const uciMove = (u: string) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });

// ---------- material ----------

export function material(fen: string): Record<Side, Record<string, number>> {
  const out = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } } as any;
  for (const ch of fen.split(' ')[0]) {
    const l = ch.toLowerCase();
    if (!(l in VAL) || l === 'k') continue;
    out[ch === l ? 'b' : 'w'][l]++;
  }
  return out;
}

/** What `side` has won/lost on balance between two positions (in pawns), and the biggest piece lost / won. */
export function netMaterial(fenStart: string, fenEnd: string, side: Side) {
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

// ---------- how a line ends ----------

export interface LineEnd {
  kind: 'stalemate' | 'insufficient' | 'repetition' | 'fifty' | 'mate';
  ply: number;
  fen: string;
  /** Side to move when the game ends (the one with no legal move / the one that was mated). */
  stuck: Side;
}

function endOf(c: Chess, ply: number): LineEnd | null {
  const stuck = c.turn() as Side;
  if (c.isCheckmate()) return { kind: 'mate', ply, fen: c.fen(), stuck };
  if (c.isStalemate()) return { kind: 'stalemate', ply, fen: c.fen(), stuck };
  if (c.isInsufficientMaterial()) return { kind: 'insufficient', ply, fen: c.fen(), stuck };
  if (c.isThreefoldRepetition()) return { kind: 'repetition', ply, fen: c.fen(), stuck };
  if ((c as any).isDrawByFiftyMoves?.()) return { kind: 'fifty', ply, fen: c.fen(), stuck };
  return null;
}

/**
 * Plays a UCI line and says whether the GAME ENDS inside it: checkmate, stalemate, repetition, dead position.
 * A position that is already over (the move just played stalemated or mated) ends at ply -1.
 */
export function lineOutcome(fenStart: string, ucis: string[], maxPlies = 40): LineEnd | null {
  let c: Chess;
  try { c = new Chess(fenStart); } catch { return null; }
  const now = endOf(c, -1);
  if (now) return now;
  for (let i = 0; i < Math.min(ucis.length, maxPlies); i++) {
    try { c.move(uciMove(ucis[i])); } catch { return null; }
    const end = endOf(c, i);
    if (end) return end;
  }
  return null;
}

// ---------- settling a line ----------

/** `capture` = the last ply was a capture / promotion that the side to move can answer on the same square (exchange still open). */
interface Step { fen: string; swing: number; capture: boolean; over: boolean }

function walk(fen: string, ucis: string[], side: Side, maxPlies: number): { steps: Step[]; legal: boolean } {
  const steps: Step[] = [];
  let c: Chess;
  try { c = new Chess(fen); } catch { return { steps, legal: false }; }
  for (let i = 0; i < Math.min(ucis.length, maxPlies); i++) {
    let m;
    try { m = c.move(uciMove(ucis[i])); } catch { return { steps, legal: false }; }
    // A capture only leaves the count open when the other side can capture on that square next:
    // "Rxb2" with a queen behind it is not settled; "Qxb2" with nothing left to retake is.
    const open = (!!m.captured || !!m.promotion) && c.moves({ verbose: true }).some((r) => r.to === m.to && !!r.captured);
    steps.push({
      fen: c.fen(),
      swing: netMaterial(fen, c.fen(), side).swing,
      capture: open,
      over: c.isGameOver(),
    });
    if (c.isGameOver()) break;
  }
  return { steps, legal: true };
}

export interface Settled {
  /** Material won by `side` at the end of the exchange (pawns). 0 when the line never settles: we do not know. */
  swing: number;
  worst: string | null;
  best: string | null;
  /** The same count even if the line stopped in the middle of a capture sequence (never use it to make a claim). */
  rawSwing: number;
  /** False when the line stops mid-exchange (last ply is a capture), so the count could still flip. */
  settled: boolean;
  /** False when a move of the line is illegal or the line is empty. */
  legal: boolean;
  plies: number;
  fen: string;
  end: LineEnd | null;
}

function settleSteps(fen: string, ucis: string[], side: Side, steps: Step[], legal: boolean, minPlies: number): Settled {
  if (!steps.length) return { swing: 0, worst: null, best: null, rawSwing: 0, settled: false, legal: false, plies: 0, fen, end: null };
  let idx = steps.findIndex((s, i) => s.over || (i + 1 >= minPlies && !s.capture));
  if (idx < 0) idx = steps.length - 1;
  const last = steps[idx];
  const settled = legal && (last.over || !last.capture);
  const n = netMaterial(fen, last.fen, side);
  return {
    swing: settled ? n.swing : 0,
    worst: settled ? n.worst : null,
    best: settled ? n.best : null,
    rawSwing: n.swing,
    settled, legal, plies: idx + 1, fen: last.fen,
    end: lineOutcome(fen, ucis.slice(0, idx + 1)),
  };
}

/**
 * Plays `ucis` from `fen` for at least `minPlies`, then keeps going while the last move was a capture (or promotion),
 * so a trade is never cut in half: "Rxb2" without the "Qxb2" that follows looks like a won pawn.
 */
export function settleLine(fen: string, ucis: string[], side: Side, minPlies = 4, maxPlies = 12): Settled {
  const { steps, legal } = walk(fen, ucis, side, maxPlies);
  return settleSteps(fen, ucis, side, steps, legal, minPlies);
}

// ---------- claims ----------

export type Claim =
  /** `side` ends the exchange at least `min` pawns up (default 1). A line that ends in a draw never wins material. */
  | { kind: 'wins-material'; side: Side; min?: number }
  /** A fork only counts when it really wins something worth a minor piece. */
  | { kind: 'fork'; side: Side }
  /**
   * `side` gives up at least `dip` pawns (default 2) at some quiet point of the line AND gets it back, wins by mate,
   * or the engine still rates the position fine (`evalOk`). Without a real dip it is not a sacrifice at all.
   */
  | { kind: 'sacrifice'; side: Side; dip?: number; evalOk?: boolean }
  | { kind: 'mate'; side: Side };

export interface Verdict { ok: boolean; why: string; swing: number; dip?: number }

/**
 * `fen` is the position the line starts from; `ucis` is the engine's line from there (first move = opponent's reply
 * when the claim is about the move that was just played).
 */
export function verifyClaim(fen: string, ucis: string[], claim: Claim): Verdict {
  const { steps, legal } = walk(fen, ucis, claim.side, 12);
  const s = settleSteps(fen, ucis, claim.side, steps, legal, 4);
  if (!ucis.length || !s.legal) return { ok: false, why: 'no usable line', swing: 0 };
  const e = s.end;
  const mated: 'for' | 'against' | null = e?.kind === 'mate' ? (e.stuck === claim.side ? 'against' : 'for') : null;
  const draw = !!e && e.kind !== 'mate';

  switch (claim.kind) {
    case 'mate':
      return { ok: mated === 'for', why: mated === 'for' ? 'line ends in mate' : 'line does not end in mate', swing: s.swing };

    case 'wins-material':
    case 'fork': {
      const min = claim.kind === 'fork' ? 3 : claim.min ?? 1;
      if (mated === 'for') return { ok: true, why: 'line ends in mate', swing: s.swing };
      if (mated === 'against') return { ok: false, why: 'the line ends with this side mated', swing: s.swing };
      if (draw) return { ok: false, why: `line ends in a draw (${e!.kind})`, swing: s.swing };
      if (!s.settled) return { ok: false, why: 'line stops in the middle of an exchange', swing: s.swing };
      return { ok: s.swing >= min, why: `material at the end of the line: ${s.swing >= 0 ? '+' : ''}${s.swing}`, swing: s.swing };
    }

    case 'sacrifice': {
      if (mated === 'against') return { ok: false, why: 'the line ends with this side mated', swing: s.swing };
      // Only look at quiet points (not halfway through a trade) up to where the exchange settles.
      const quiet = steps.slice(0, s.plies).filter((x) => !x.capture || x.over);
      const dip = Math.min(0, ...quiet.map((x) => x.swing));
      if (dip > -(claim.dip ?? 2)) return { ok: false, why: 'no material is given up', swing: s.swing, dip };
      const recovered = s.settled && s.swing - dip >= 1;
      const ok = mated === 'for' || recovered || !!claim.evalOk;
      return { ok, why: ok ? 'material is given up and the line pays it back' : 'material is given up and never returns', swing: s.swing, dip };
    }
  }
}
