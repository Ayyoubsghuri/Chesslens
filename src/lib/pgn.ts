import { Chess } from 'chess.js';
import type { ImportedGame, ParsedGame } from './types';

export function parsePgn(pgn: string, sourceUrl = ''): ParsedGame | null {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn.trim());
    const headers = chess.header();
    const moves = chess.history({ verbose: true }) as any[];
    const lastFen = moves.length > 0 ? moves[moves.length - 1].after : chess.fen();

    return {
      pgn,
      headers,
      moves,
      white: headers.White || 'White',
      black: headers.Black || 'Black',
      result: headers.Result || '*',
      date: headers.Date || headers.UTCDate || '',
      site: headers.Site || '',
      url: headers.Link || sourceUrl,
      timeControl: headers.TimeControl || '',
      eco: headers.ECO || '',
    };
  } catch {
    return null;
  }
}

export function pgnToImported(pgn: string, sourceUrl = ''): ImportedGame | null {
  const parsed = parsePgn(pgn, sourceUrl);
  if (!parsed) return null;
  return {
    id: crypto.randomUUID(),
    pgn,
    white: parsed.white,
    black: parsed.black,
    result: parsed.result,
    date: parsed.date,
    eco: parsed.eco,
    timeControl: parsed.timeControl,
    site: parsed.site,
    url: parsed.url,
  };
}

export function splitMultiGamePgn(text: string): string[] {
  const games: string[] = [];
  const lines = text.split(/\r?\n/);
  let current = '';
  let inMoves = false;

  for (const line of lines) {
    if (line.startsWith('[')) {
      if (inMoves && current.trim()) {
        games.push(current.trim());
        current = '';
        inMoves = false;
      }
      current += line + '\n';
    } else if (line.trim()) {
      inMoves = true;
      current += line + '\n';
    } else if (inMoves) {
      current += '\n';
    }
  }
  if (current.trim()) games.push(current.trim());
  return games;
}

export function getFenAtMove(pgn: string, moveIndex: number): string | null {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history({ verbose: true }) as any[];
    if (moveIndex < 0 || moveIndex > history.length) return null;
    if (moveIndex === 0) return new Chess().fen();
    return history[moveIndex - 1].after;
  } catch {
    return null;
  }
}

export function getMoveHistory(pgn: string): any[] {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    return chess.history({ verbose: true }) as any[];
  } catch {
    return [];
  }
}
