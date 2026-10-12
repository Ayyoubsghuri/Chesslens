// Flattens the lichess opening trie (openings-book.json) into a browsable list of
// openings + variations, and stores the user's own custom lines.
// Place in src/lib/openings-catalog.ts

import { Chess } from 'chess.js';
import bookData from './openings-book.json';

interface BookNode {
  move?: string;
  eco?: string;
  name?: string;
  children?: Record<string, BookNode>;
}

export interface OpeningLine {
  id: string;
  eco: string;
  name: string;      // full name, e.g. "Italian Game: Two Knights Defense, Traxler Counterattack"
  family: string;    // "Italian Game"
  variation: string; // "Two Knights Defense, Traxler Counterattack" ('' for the main line)
  uci: string[];     // the line, as UCI moves
  custom?: boolean;
}

let cache: OpeningLine[] | null = null;

export function getOpeningCatalog(): OpeningLine[] {
  if (cache) return cache;
  const out: OpeningLine[] = [];
  const path: string[] = [];
  const walk = (node: BookNode) => {
    if (path.length > 0 && node.eco && node.name) {
      const [family, ...rest] = node.name.split(':');
      out.push({
        id: `${node.eco}|${path.join(' ')}`,
        eco: node.eco,
        name: node.name,
        family: family.trim(),
        variation: rest.join(':').trim(),
        uci: [...path],
      });
    }
    for (const [uci, child] of Object.entries(node.children ?? {})) {
      path.push(uci);
      walk(child);
      path.pop();
    }
  };
  walk(bookData as BookNode);
  out.sort((a, b) => a.family.localeCompare(b.family) || a.uci.length - b.uci.length || a.name.localeCompare(b.name));
  cache = out;
  return out;
}

/** "1. e4 e5 2. Nf3 Nc6 {comment}" → UCI moves, or null if any move is illegal. */
export function parseLine(text: string): string[] | null {
  const cleaned = text
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/[!?]+/g, '');
  const tokens = cleaned.split(/\s+/).filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  if (tokens.length === 0) return null;
  const chess = new Chess();
  const uci: string[] = [];
  for (const t of tokens) {
    try {
      const m = chess.move(t);
      if (!m) return null;
      uci.push(m.from + m.to + (m.promotion ?? ''));
    } catch {
      return null;
    }
  }
  return uci;
}

const KEY = 'chesslens-custom-openings';

export function loadCustomLines(): OpeningLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]') as OpeningLine[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveCustomLines(lines: OpeningLine[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch { /* storage full / blocked */ }
}

/** Lowercase + unify apostrophes so "King’s Gambit" matches "kings gambit"-style typing. */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[’‘`]/g, "'");
}

/**
 * Searches every opening AND variation by full name (e.g. "traxler" finds
 * "Italian Game: Two Knights Defense, Traxler Counterattack"). All words must match.
 */
export function searchCatalog(
  query: string,
  opts: { volume?: string; gambitsOnly?: boolean } = {},
): OpeningLine[] {
  const terms = normalizeName(query).split(/\s+/).filter(Boolean);
  return getOpeningCatalog().filter((l) => {
    if (opts.volume && opts.volume !== 'all' && l.eco[0] !== opts.volume) return false;
    const name = normalizeName(l.name);
    if (opts.gambitsOnly && !name.includes('gambit')) return false;
    return terms.every((t) => name.includes(t) || l.eco.toLowerCase() === t);
  });
}
