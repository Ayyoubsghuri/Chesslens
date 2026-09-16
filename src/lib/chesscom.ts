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
    if (imported) result.push(imported);
  }
  return result;
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
