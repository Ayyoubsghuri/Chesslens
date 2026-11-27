import type { ImportedGame } from './types';
import { pgnToImported, splitMultiGamePgn } from './pgn';

const BASE = 'https://api.chess.com';

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Chess.com request failed (${res.status})`);
  return res.json();
}

export async function getMonthlyArchives(username: string): Promise<string[]> {
  const data = await fetchJson(`${BASE}/pub/player/${username.toLowerCase()}/games/archives`);
  return data.archives || [];
}

export interface MonthInfo {
  year: number;
  month: number;
  label: string;
  url: string;
}

export function parseArchiveUrls(urls: string[]): MonthInfo[] {
  return urls.map((url) => {
    const m = url.match(/\/(\d{4})\/(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    return {
      year,
      month,
      label: new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      url,
    };
  }).filter(Boolean) as MonthInfo[];
}

export async function getGamesForMonth(archiveUrl: string): Promise<ImportedGame[]> {
  const data = await fetchJson(archiveUrl);
  const games = data.games || [];
  const result: ImportedGame[] = [];

  for (const g of games) {
    if (!g.pgn) continue;
    const imported = pgnToImported(g.pgn, g.url || '');
    if (!imported) continue;
    // Chess.com sends its own accuracy for games that were reviewed there: keep it, it is THE number players compare with.
    const acc = accuraciesOf(g);
    if (acc) imported.chesscomAccuracy = acc;
    result.push(imported);
  }
  return result;
}

function accuraciesOf(g: any): { white: number; black: number } | null {
  const a = g?.accuracies;
  return a && typeof a.white === 'number' && typeof a.black === 'number' ? { white: a.white, black: a.black } : null;
}

const accCache = new Map<string, Promise<{ white: number; black: number } | null>>();

/** A PGN header's value, or ''. */
const header = (pgn: string, tag: string) => pgn.match(new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`, 'i'))?.[1]?.trim() ?? '';

/** Just the moves of a PGN ("e4 e5 Nf3 ..."): no headers, clocks, comments, move numbers or result. Two copies of the same game give the same string. */
export function movesKey(pgn: string): string {
  return pgn
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/, ' ')
    .replace(/[?!]+/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/** Does this game come from Chess.com? (its link, its Site header, or Chess.com-only headers such as ECOUrl). */
export function isChesscomGame(game: ImportedGame): boolean {
  const pgn = game.pgn || '';
  const site = header(pgn, 'Site') || game.site || '';
  // No site at all (a bare "copy PGN"): worth one look on Chess.com, unless it clearly comes from somewhere else.
  if ((!site || site === '?') && !/lichess|chess24|chessbase/i.test(game.url || '')) return true;
  return /chess\.com/i.test(game.url || '') || /chess\.com/i.test(game.site || '')
    || /chess\.com/i.test(header(pgn, 'Site')) || /chess\.com/i.test(header(pgn, 'ECOUrl')) || /chess\.com/i.test(header(pgn, 'Link'));
}

/** The archive months to look in: the month the game ended (Chess.com files games by end date), then the month it started. */
function monthsOf(game: ImportedGame): string[] {
  const pgn = game.pgn || '';
  const out: string[] = [];
  for (const d of [header(pgn, 'EndDate'), header(pgn, 'UTCDate'), game.date || '', header(pgn, 'Date')]) {
    const m = d.match(/^(\d{4})[.\-/](\d{2})/);
    if (!m) continue;
    const ym = `${m[1]}/${m[2]}`;
    if (!out.includes(ym)) out.push(ym);
    // a game started on the last evening of a month can end in the next one
    const next = Number(m[2]) === 12 ? `${Number(m[1]) + 1}/01` : `${m[1]}/${String(Number(m[2]) + 1).padStart(2, '0')}`;
    if (!out.includes(next)) out.push(next);
  }
  return out.slice(0, 3);
}

/**
 * Chess.com's own accuracy for a Chess.com game, wherever it came from: imported with your username, or pasted as PGN.
 * The game is looked up in either player's monthly archive, by its link when the PGN has one, otherwise by its moves
 * (so a pasted PGN without a [Link] header is found too). null when the game was never reviewed on Chess.com,
 * is not a Chess.com game, or the request fails.
 */
export function fetchChesscomAccuracy(game: ImportedGame): Promise<{ white: number; black: number } | null> {
  if (game.chesscomAccuracy) return Promise.resolve(game.chesscomAccuracy);
  if (!isChesscomGame(game)) return Promise.resolve(null);
  const url = game.url || header(game.pgn || '', 'Link');
  const id = /chess\.com/i.test(url) ? url.match(/(\d{5,})/)?.[1] : undefined;
  const moves = movesKey(game.pgn || '');
  const months = monthsOf(game);
  if (!months.length || (!id && !moves)) return Promise.resolve(null);
  const key = `${id ?? moves}|${months[0]}`;
  if (!accCache.has(key)) {
    accCache.set(key, (async () => {
      for (const ym of months) {
        for (const name of [game.white, game.black]) {
          if (!name || /^(white|black|\?)$/i.test(name)) continue;
          try {
            const data = await fetchJson(`${BASE}/pub/player/${encodeURIComponent(name.toLowerCase())}/games/${ym}`);
            const list: any[] = data.games || [];
            const hit = (id && list.find((g) => String(g.url || '').endsWith('/' + id)))
              || list.find((g) => g.pgn && movesKey(g.pgn) === moves);
            if (hit) return accuraciesOf(hit);
          } catch { /* try the other player / month */ }
        }
      }
      return null;
    })());
  }
  const pending = accCache.get(key)!;
  // Chess.com updates its archives with a delay: do not remember a "not found" answer, ask again next time.
  pending.then((v) => { if (!v) accCache.delete(key); }).catch(() => accCache.delete(key));
  return pending;
}

export async function getGamesForMonthRaw(archiveUrl: string): Promise<{ pgn: string; url: string }[]> {
  const data = await fetchJson(archiveUrl);
  return (data.games || []).filter((g: any) => g.pgn).map((g: any) => ({ pgn: g.pgn, url: g.url || '' }));
}

export function parsePastedGames(text: string): ImportedGame[] {
  const pgns = splitMultiGamePgn(text);
  const games: ImportedGame[] = [];
  for (const pgn of pgns) {
    const imported = pgnToImported(pgn);
    if (imported) games.push(imported);
  }
  return games;
}
