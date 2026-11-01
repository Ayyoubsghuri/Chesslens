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

/**
 * Chess.com's own accuracy for a game imported from Chess.com (or pasted with its Link header).
 * Looks the game up in the player's monthly archive by its URL. null when the game was never reviewed on
 * Chess.com, is not a Chess.com game, or the request fails.
 */
export function fetchChesscomAccuracy(game: ImportedGame): Promise<{ white: number; black: number } | null> {
  if (game.chesscomAccuracy) return Promise.resolve(game.chesscomAccuracy);
  const url = game.url || '';
  if (!/chess\.com\/(game|live|daily|analysis)/i.test(url)) return Promise.resolve(null);
  const m = (game.date || '').match(/^(\d{4})[.\-/](\d{2})/);
  if (!m) return Promise.resolve(null);
  const id = url.match(/(\d{5,})/)?.[1];
  const key = `${url}|${game.date}`;
  if (!accCache.has(key)) {
    accCache.set(key, (async () => {
      for (const name of [game.white, game.black]) {
        if (!name) continue;
        try {
          const data = await fetchJson(`${BASE}/pub/player/${name.toLowerCase()}/games/${m[1]}/${m[2]}`);
          const hit = (data.games || []).find((g: any) => g.url === url || (id && String(g.url || '').endsWith('/' + id)));
          if (hit) return accuraciesOf(hit);
        } catch { /* try the other player */ }
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
