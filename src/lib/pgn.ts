import { Chess } from 'chess.js';
import type { ImportedGame, ParsedGame } from './types';

/**
 * Why this file changed:
 * the old code read the same PGN in different ways. Importing trimmed the text,
 * but analysis (getMoveHistory / getFenAtMove) did not, so a PGN could import
 * fine and then come back with ZERO moves later. Every reader now goes through
 * loadChess(), which cleans the text and falls back to a stripped version.
 */

const HEADER_LINE = /^\s*\[\s*\w+\s+"/;

/** BOM, Windows/old-Mac line endings, non-breaking spaces, outer whitespace. */
function normalizePgn(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
}

/** Last resort: drop {comments}, (variations), $NAGs and ;comments from the move text. */
function stripMoveExtras(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (HEADER_LINE.test(line)) return line;
      let l = line.replace(/\{[^}]*\}/g, ' ').replace(/;.*$/, '').replace(/\$\d+/g, ' ');
      for (let i = 0; i < 5; i++) l = l.replace(/\([^()]*\)/g, ' ');
      return l;
    })
    .join('\n');
}

/** Loads a PGN, trying the cleaned text first, then the stripped text. */
function loadChess(pgn: string): { chess: Chess; text: string } | null {
  const base = normalizePgn(pgn);
  for (const text of [base, stripMoveExtras(base)]) {
    try {
      const chess = new Chess();
      chess.loadPgn(text);
      return { chess, text };
    } catch {
      /* try the next version */
    }
  }
  return null;
}

export function parsePgn(pgn: string, sourceUrl = ''): ParsedGame | null {
  const loaded = loadChess(pgn);
  if (!loaded) return null;
  const { chess, text } = loaded;
  const headers = chess.header();
  const moves = chess.history({ verbose: true }) as any[];

  return {
    pgn: text,
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
}

export function pgnToImported(pgn: string, sourceUrl = ''): ImportedGame | null {
  const parsed = parsePgn(pgn, sourceUrl);
  // A game with no moves can't be analysed, so don't import it.
  if (!parsed || parsed.moves.length === 0) return null;
  return {
    id: crypto.randomUUID(),
    pgn: parsed.pgn, // the cleaned text that actually parsed
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
  const lines = normalizePgn(text).split('\n');
  let current = '';
  let inMoves = false;

  for (const line of lines) {
    // A real header looks like [Name "value"]. A wrapped comment line such as
    // "[%clk 0:03:00] }" must NOT start a new game.
    if (HEADER_LINE.test(line)) {
      if (inMoves && current.trim()) {
        games.push(current.trim());
        current = '';
        inMoves = false;
      }
      current += line.trim() + '\n';
    } else if (line.trim()) {
      inMoves = true;
      current += line + '\n';
    } else if (inMoves) {
      current += '\n';
    } else if (current) {
      current += '\n'; // blank line between headers and moves
    }
  }
  if (current.trim()) games.push(current.trim());
  return games;
}

/** FEN the game starts from (handles [FEN]/[SetUp] games, not just the normal start). */
export function getStartFen(pgn: string): string {
  const loaded = loadChess(pgn);
  if (!loaded) return new Chess().fen();
  const history = loaded.chess.history({ verbose: true }) as any[];
  return history.length > 0 ? history[0].before : loaded.chess.fen();
}

export function getFenAtMove(pgn: string, moveIndex: number): string | null {
  const loaded = loadChess(pgn);
  if (!loaded) return null;
  const history = loaded.chess.history({ verbose: true }) as any[];
  if (moveIndex < 0 || moveIndex > history.length) return null;
  if (moveIndex === 0) return history.length > 0 ? history[0].before : loaded.chess.fen();
  return history[moveIndex - 1].after;
}

export function getMoveHistory(pgn: string): any[] {
  const loaded = loadChess(pgn);
  return loaded ? (loaded.chess.history({ verbose: true }) as any[]) : [];
}