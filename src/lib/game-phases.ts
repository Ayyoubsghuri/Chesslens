/**
 * game-phases.ts — where the opening ends and the endgame starts, and accuracy per phase.
 *
 * The split follows Lichess's Divider (scalachess Divider.scala), the same one used by
 * github.com/NoRaincheck/chess-accuracy ("faithful" division):
 *  - MIDDLEGAME starts at the first position where there are 10 or fewer pieces (not counting kings and pawns),
 *    OR either side has fewer than 4 pieces left on its back rank, OR the pieces are "mixed" (mixedness > 150:
 *    white and black pieces in the same small areas of the board, i.e. the armies have met).
 *  - ENDGAME starts at the first position with 6 or fewer pieces (not counting kings and pawns).
 *  - If that would put the endgame before the middlegame, there is no middlegame.
 *
 * Accuracy per phase = the game-accuracy formula run on that phase's moves only.
 */
import { Chess } from 'chess.js';
import type { AnalyzedMove } from './types';
import { evalToWinChance } from './engine';
import { accuracyFromLosses, moveLosses } from './accuracy-model';

export type PhaseName = 'opening' | 'middlegame' | 'endgame';
export interface Division { middle: number | null; end: number | null }

type Grid = ({ type: string; color: 'w' | 'b' } | null)[][]; // grid[rank 0..7][file 0..7]

function gridOf(fen: string): Grid | null {
  try {
    const g: Grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    new Chess(fen).board().forEach((row, i) => row.forEach((p, f) => { if (p) g[7 - i][f] = { type: p.type, color: p.color as 'w' | 'b' }; }));
    return g;
  } catch { return null; }
}

const majorsAndMinors = (g: Grid) => g.flat().filter((p) => p && p.type !== 'k' && p.type !== 'p').length;

const backrankSparse = (g: Grid) =>
  g[0].filter((p) => p?.color === 'w').length < 4 || g[7].filter((p) => p?.color === 'b').length < 4;

/** Score of one 2x2 area at height y (1..7) holding `w` white and `b` black pieces (scalachess Divider table). */
function score(y: number, w: number, b: number): number {
  switch (`${w},${b}`) {
    case '0,0': return 0;
    case '1,0': return 1 + (8 - y);
    case '2,0': return y > 2 ? 2 + (y - 2) : 0;
    case '3,0': return y > 1 ? 3 + (y - 1) : 0;
    case '4,0': return y > 1 ? 3 + (y - 1) : 0;
    case '0,1': return 1 + y;
    case '1,1': return 5 + Math.abs(4 - y);
    case '2,1': return 4 + (y - 1);
    case '3,1': return 5 + (y - 1);
    case '0,2': return y < 6 ? 2 + (6 - y) : 0;
    case '1,2': return 4 + (7 - y);
    case '2,2': return 7;
    case '0,3': return y < 7 ? 3 + (7 - y) : 0;
    case '1,3': return 5 + (7 - y);
    case '0,4': return y < 7 ? 3 + (7 - y) : 0;
    default: return 0;
  }
}

function mixedness(g: Grid): number {
  let total = 0;
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    let w = 0, b = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const p = g[y + dy][x + dx];
      if (p) { if (p.color === 'w') w++; else b++; }
    }
    total += score(y + 1, w, b);
  }
  return total;
}

/** `fens[0]` = start position, `fens[i]` = position after ply i. Returns the ply indexes where each phase starts. */
export function divide(fens: string[]): Division {
  const grids = fens.map(gridOf);
  let middle: number | null = null;
  for (let i = 0; i < grids.length; i++) {
    const g = grids[i];
    if (g && (majorsAndMinors(g) <= 10 || backrankSparse(g) || mixedness(g) > 150)) { middle = i; break; }
  }
  let end: number | null = null;
  if (middle != null) {
    for (let i = 0; i < grids.length; i++) {
      const g = grids[i];
      if (g && majorsAndMinors(g) <= 6) { end = i; break; }
    }
  }
  if (middle != null && end != null && middle >= end) middle = null;
  return { middle, end };
}

export function phaseOfMove(i: number, d: Division): PhaseName {
  if (d.end != null && i >= d.end) return 'endgame';
  if (d.middle != null && i >= d.middle) return 'middlegame';
  return 'opening';
}

// ---------------------------------------------------------------------------
// The Lichess accuracy (as in NoRaincheck/chess-accuracy and lila's AccuracyPercent.scala)
// ---------------------------------------------------------------------------
function lichessMove(before: number, after: number): number {
  if (after >= before) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1));
}

const stdDevSample = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/**
 * Lichess game accuracy for a run of moves. `startWin` = White's win% before the first of them
 * (50 for a whole game, like the reference implementation; the real value before a later phase).
 */
export function lichessAccuracy(moves: AnalyzedMove[], startWin = 50): { white: number; black: number } {
  const wins = [startWin, ...moves.map((m, i) => (m.evalAfter ? evalToWinChance(m.evalAfter) : NaN))];
  for (let i = 1; i < wins.length; i++) if (!Number.isFinite(wins[i])) wins[i] = wins[i - 1];
  const n = moves.length;
  const size = Math.min(Math.max(2, Math.min(8, Math.floor(n / 10))), wins.length);
  const windows: number[][] = [];
  for (let k = 0; k < Math.max(0, size - 2); k++) windows.push(wins.slice(0, size));
  for (let k = 0; k + size <= wins.length; k++) windows.push(wins.slice(k, k + size));
  const weight = (i: number) => Math.max(0.5, Math.min(12, stdDevSample(windows[Math.min(i, windows.length - 1)] ?? [])));

  const acc: Record<'w' | 'b', { a: number; w: number }[]> = { w: [], b: [] };
  moves.forEach((m, i) => {
    const a = m.color === 'w' ? lichessMove(wins[i], wins[i + 1]) : lichessMove(100 - wins[i], 100 - wins[i + 1]);
    acc[m.color].push({ a, w: weight(i) });
  });
  const colorScore = (xs: { a: number; w: number }[]) => {
    if (!xs.length) return 100;
    const tw = xs.reduce((s, x) => s + x.w, 0);
    const wm = tw > 0 ? xs.reduce((s, x) => s + x.a * x.w, 0) / tw : xs.reduce((s, x) => s + x.a, 0) / xs.length;
    const hm = xs.every((x) => x.a > 0) ? xs.length / xs.reduce((s, x) => s + 1 / x.a, 0) : wm;
    return Math.round(((wm + hm) / 2) * 10) / 10;
  };
  return { white: colorScore(acc.w), black: colorScore(acc.b) };
}

// ---------------------------------------------------------------------------
// Accuracy by method, for the whole game and per phase
// ---------------------------------------------------------------------------
export type AccuracyMethod = 'chesscom' | 'lichess';
const METHOD_KEY = 'chesslens.accuracyMethod';
export function loadMethod(): AccuracyMethod {
  try { return localStorage.getItem(METHOD_KEY) === 'lichess' ? 'lichess' : 'chesscom'; } catch { return 'chesscom'; }
}
export function saveMethod(m: AccuracyMethod) { try { localStorage.setItem(METHOD_KEY, m); } catch { /* ignore */ } }

/** Accuracy of a run of moves with the chosen method. */
export function accuracyOf(moves: AnalyzedMove[], method: AccuracyMethod, startWin?: number): { white: number; black: number } {
  if (!moves.length) return { white: 0, black: 0 };
  if (method === 'lichess') return lichessAccuracy(moves, startWin ?? 50);
  return accuracyFromLosses(moveLosses(moves));
}

export interface PhaseAccuracy {
  phase: PhaseName;
  /** First and last ply of the phase (0-based, like AnalyzedMove.index). */
  from: number;
  to: number;
  white: number | null;
  black: number | null;
}

/** Accuracy for the opening, middlegame and endgame (only the phases the game actually reached). */
export function phaseAccuracies(moves: AnalyzedMove[], method: AccuracyMethod): { division: Division; phases: PhaseAccuracy[] } {
  if (!moves.length) return { division: { middle: null, end: null }, phases: [] };
  const fens = [moves[0].fenBefore, ...moves.map((m) => m.fenAfter)];
  const division = divide(fens);
  const groups = new Map<PhaseName, AnalyzedMove[]>();
  moves.forEach((m, i) => {
    const p = phaseOfMove(i, division);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p)!.push(m);
  });
  const phases: PhaseAccuracy[] = [];
  for (const p of ['opening', 'middlegame', 'endgame'] as PhaseName[]) {
    const seg = groups.get(p);
    if (!seg?.length) continue;
    const first = seg[0];
    const startWin = first.evalBefore ? evalToWinChance(first.evalBefore) : 50;
    const acc = accuracyOf(seg, method, moves.indexOf(first) === 0 ? 50 : startWin);
    const has = (c: 'w' | 'b') => seg.some((m) => m.color === c);
    phases.push({ phase: p, from: first.index, to: seg[seg.length - 1].index, white: has('w') ? acc.white : null, black: has('b') ? acc.black : null });
  }
  return { division, phases };
}
