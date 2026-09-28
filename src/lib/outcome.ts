import { Chess } from 'chess.js';
import type { ImportedGame } from './types';

export type OutcomeMethod =
  | 'checkmate'
  | 'resignation'
  | 'timeout'
  | 'abandonment'
  | 'agreement'
  | 'stalemate'
  | 'repetition'
  | 'insufficient'
  | 'fifty-move'
  | 'unknown';

export interface GameOutcome {
  winner: 'white' | 'black' | 'draw' | null; // null = unknown / unfinished
  winnerName: string | null;
  method: OutcomeMethod;
  /** Full sentence, e.g. "Magnus (White) won by resignation" */
  label: string;
  /** Compact form for lists, e.g. "1-0 · Resignation" */
  short: string;
}

function pgnHeader(pgn: string, tag: string): string | null {
  const m = pgn.match(new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`, 'i'));
  return m?.[1]?.trim() || null;
}

function methodFromTermination(text: string | null): OutcomeMethod {
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  if (t.includes('resign')) return 'resignation';
  if (t.includes('checkmate')) return 'checkmate';
  if (t.includes('time')) return 'timeout';
  if (t.includes('abandon')) return 'abandonment';
  if (t.includes('agreement')) return 'agreement';
  if (t.includes('stalemate')) return 'stalemate';
  if (t.includes('repetition')) return 'repetition';
  if (t.includes('insufficient')) return 'insufficient';
  if (t.includes('50') || t.includes('fifty')) return 'fifty-move';
  return 'unknown';
}

const METHOD_TEXT: Record<OutcomeMethod, string> = {
  checkmate: 'checkmate',
  resignation: 'resignation',
  timeout: 'timeout',
  abandonment: 'abandonment',
  agreement: 'agreement',
  stalemate: 'stalemate',
  repetition: 'repetition',
  insufficient: 'insufficient material',
  'fifty-move': 'the 50-move rule',
  unknown: '',
};

/**
 * Works out who won and how, from the PGN's Result / Termination headers
 * (Chess.com PGNs include e.g. [Termination "Name won by resignation"]).
 * If there is no Termination header, a finished game that isn't checkmate on
 * the board is reported as "resignation or timeout".
 */
export function getGameOutcome(game: ImportedGame): GameOutcome {
  const pgn = game.pgn ?? '';
  const resultRaw = pgnHeader(pgn, 'Result') ?? game.result ?? '*';
  const result = resultRaw.replace('½-½', '1/2-1/2');

  const whiteName = game.white || pgnHeader(pgn, 'White') || 'White';
  const blackName = game.black || pgnHeader(pgn, 'Black') || 'Black';

  let method = methodFromTermination(pgnHeader(pgn, 'Termination'));

  // No usable Termination header: at least detect checkmate from the board.
  let ambiguousEnd = false;
  if (method === 'unknown') {
    try {
      const chess = new Chess();
      chess.loadPgn(pgn);
      if (chess.isCheckmate()) method = 'checkmate';
      else if (chess.isStalemate()) method = 'stalemate';
      else if (chess.isThreefoldRepetition()) method = 'repetition';
      else if (chess.isInsufficientMaterial()) method = 'insufficient';
      else if (result === '1-0' || result === '0-1') ambiguousEnd = true;
    } catch {
      /* leave as unknown */
    }
  }

  if (result === '1-0' || result === '0-1') {
    const white = result === '1-0';
    const name = white ? whiteName : blackName;
    const side = white ? 'White' : 'Black';
    const how = ambiguousEnd
      ? 'resignation or timeout'
      : METHOD_TEXT[method];
    return {
      winner: white ? 'white' : 'black',
      winnerName: name,
      method,
      label: how ? `${name} (${side}) won by ${how}` : `${name} (${side}) won`,
      short: how ? `${result} · ${capitalize(how)}` : result,
    };
  }

  if (result === '1/2-1/2') {
    const how = METHOD_TEXT[method];
    return {
      winner: 'draw',
      winnerName: null,
      method,
      label: how ? `Draw by ${how}` : 'Draw',
      short: how ? `½-½ · ${capitalize(how)}` : '½-½',
    };
  }

  return { winner: null, winnerName: null, method, label: 'Result unknown', short: resultRaw };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
