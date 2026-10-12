// Lichess-study style data: PGN → chapters with comments + variations (a move tree).
// Place in src/lib/study.ts

import { Chess, type Square } from 'chess.js';
import { getOpeningCatalog, type OpeningLine } from './openings-catalog';
import { BookWalker } from './openings';

const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface StudyNode {
  id: number;
  san: string;
  uci: string;
  fen: string; // position AFTER this move
  from?: Square;
  to?: Square;
  color: 'w' | 'b'; // who played this move
  num: number; // move number
  comment: string;
  nag: string; // "!", "?!", …
  children: StudyNode[]; // children[0] = main line, the rest are variations
}

export interface StudyChapter {
  id: string;
  name: string;
  orientation: 'white' | 'black';
  startFen: string;
  root: StudyNode;
  index: Map<number, { node: StudyNode; parent: StudyNode | null }>;
  moveCount: number;
  error?: string;
}

export interface StoredStudy {
  id: string;
  name: string;
  source?: string;
  pgn: string;
  addedAt: number;
}

const NAGS: Record<string, string> = { '1': '!', '2': '?', '3': '!!', '4': '??', '5': '!?', '6': '?!' };

function cleanComment(raw: string): string {
  return raw.replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

function tryMove(parent: StudyNode, san: string, nextId: () => number): StudyNode | null {
  let mv;
  const chess = new Chess(parent.fen);
  try {
    mv = chess.move(san);
  } catch {
    return null;
  }
  if (!mv) return null;
  const uci = mv.from + mv.to + (mv.promotion ?? '');
  const existing = parent.children.find((c) => c.uci === uci);
  if (existing) return existing;
  const parts = parent.fen.split(' ');
  const node: StudyNode = {
    id: nextId(),
    san: mv.san,
    uci,
    fen: chess.fen(),
    from: mv.from as Square,
    to: mv.to as Square,
    color: parts[1] === 'b' ? 'b' : 'w',
    num: parseInt(parts[5], 10) || 1,
    comment: '',
    nag: '',
    children: [],
  };
  parent.children.push(node);
  return node;
}

function parseChapter(pgn: string, idx: number): { chapter: StudyChapter; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const hre = /^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm;
  let m: RegExpExecArray | null;
  let end = 0;
  while ((m = hre.exec(pgn))) {
    headers[m[1]] = m[2].replace(/\\(["\\])/g, '$1');
    end = hre.lastIndex;
  }
  const movetext = pgn.slice(end);

  let startFen = DEFAULT_FEN;
  if (headers.FEN && headers.SetUp !== '0') {
    try {
      new Chess(headers.FEN);
      startFen = headers.FEN;
    } catch { /* keep default */ }
  }

  let counter = 0;
  const nextId = () => ++counter;
  const parts = startFen.split(' ');
  const root: StudyNode = {
    id: 0, san: '', uci: '', fen: startFen,
    color: parts[1] === 'b' ? 'w' : 'b', // "the move before" – unused
    num: parseInt(parts[5], 10) || 1,
    comment: '', nag: '', children: [],
  };

  let node: StudyNode = root;
  let lastParent: StudyNode | null = null;
  const stack: { node: StudyNode; parent: StudyNode | null }[] = [];
  let error: string | undefined;

  const re = /\{[^}]*\}|;[^\n]*|\(|\)|\$\d+|\d+\.(?:\.\.)?|\*|1-0|0-1|1\/2-1\/2|[^\s(){}]+/g;
  let t: RegExpExecArray | null;
  outer: while ((t = re.exec(movetext))) {
    const tok = t[0];
    const c = tok[0];
    if (c === '{' || c === ';') {
      const text = cleanComment(c === '{' ? tok.slice(1, -1) : tok.slice(1));
      if (text) node.comment = node.comment ? `${node.comment} ${text}` : text;
    } else if (c === '(') {
      if (lastParent) {
        stack.push({ node, parent: lastParent });
        node = lastParent;
        lastParent = null; // a nested variation needs a move first
        // find parent of `node` for deeper nesting is handled when a move is played
      }
    } else if (c === ')') {
      const s = stack.pop();
      if (s) { node = s.node; lastParent = s.parent; }
    } else if (c === '$') {
      const sym = NAGS[tok.slice(1)];
      if (sym) node.nag += sym;
    } else if (/^(\*|1-0|0-1|1\/2-1\/2)$/.test(tok) || /^\d+\.(\.\.)?$/.test(tok)) {
      // result / move number
    } else {
      let san = tok.replace(/…/g, '').replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
      const sfx = san.match(/[!?]+$/);
      san = san.replace(/[!?]+$/, '');
      if (!san || san === '--' || san === 'Z0') continue;
      const next = tryMove(node, san, nextId);
      if (!next) {
        error = `Couldn't read move "${tok}" — the rest of this chapter was skipped.`;
        break outer;
      }
      lastParent = node;
      node = next;
      if (sfx && !node.nag) node.nag = sfx[0];
    }
  }

  // index
  const index: StudyChapter['index'] = new Map();
  let moveCount = 0;
  const walk = (n: StudyNode, p: StudyNode | null) => {
    index.set(n.id, { node: n, parent: p });
    if (p) moveCount++;
    n.children.forEach((ch) => walk(ch, n));
  };
  walk(root, null);

  const ev = headers.Event ?? '';
  const name =
    headers.ChapterName ||
    (ev.includes(':') ? ev.slice(ev.indexOf(':') + 1).trim() : '') ||
    `Chapter ${idx + 1}`;

  return {
    headers,
    chapter: {
      id: `${idx}`,
      name,
      orientation: (headers.Orientation || '').toLowerCase() === 'black' ? 'black' : 'white',
      startFen,
      root,
      index,
      moveCount,
      error,
    },
  };
}

export function parseStudyPgn(text: string): { name: string; chapters: StudyChapter[] } {
  const games = text
    .replace(/\r/g, '')
    .trim()
    .split(/\n\s*\n(?=\[Event\s)/)
    .map((g) => g.trim())
    .filter(Boolean);
  const chapters: StudyChapter[] = [];
  let name = '';
  games.forEach((g, i) => {
    const { chapter, headers } = parseChapter(g, i);
    if (chapter.moveCount === 0 && !chapter.root.comment) return;
    if (!name) {
      const ev = headers.Event ?? '';
      name = headers.StudyName || (ev.includes(':') ? ev.slice(0, ev.indexOf(':')).trim() : ev) || 'Imported study';
    }
    chapters.push({ ...chapter, id: `${chapters.length}` });
  });
  return { name: name || 'Imported study', chapters };
}

export function extractStudyId(input: string): string | null {
  const m = input.match(/study\/([A-Za-z0-9]{8})/);
  if (m) return m[1];
  const raw = input.trim();
  return /^[A-Za-z0-9]{8}$/.test(raw) ? raw : null;
}

// ───────────── Built-in studies: every opening family in the lichess dataset ─────────────

export interface BuiltinStudyMeta {
  name: string;
  eco: string; // e.g. "C50–C59"
  volume: string; // "A".."E"
  count: number; // number of variations
}

let familyCache: Map<string, OpeningLine[]> | null = null;
function getFamilies(): Map<string, OpeningLine[]> {
  if (!familyCache) {
    familyCache = new Map();
    for (const l of getOpeningCatalog()) {
      const arr = familyCache.get(l.family) ?? [];
      arr.push(l);
      familyCache.set(l.family, arr);
    }
  }
  return familyCache;
}

export function listBuiltinStudies(): BuiltinStudyMeta[] {
  return [...getFamilies().entries()]
    .map(([name, lines]) => {
      const ecos = lines.map((l) => l.eco).sort();
      const first = ecos[0];
      const last = ecos[ecos.length - 1];
      return { name, eco: first === last ? first : `${first}–${last}`, volume: first[0], count: lines.length };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function emptyRoot(): StudyNode {
  return { id: 0, san: '', uci: '', fen: DEFAULT_FEN, color: 'b', num: 1, comment: '', nag: '', children: [] };
}

function addUci(parent: StudyNode, uci: string, nextId: () => number): StudyNode | null {
  const existing = parent.children.find((c) => c.uci === uci);
  if (existing) return existing;
  const chess = new Chess(parent.fen);
  let mv;
  try {
    mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
  } catch {
    return null;
  }
  if (!mv) return null;
  const parts = parent.fen.split(' ');
  const node: StudyNode = {
    id: nextId(), san: mv.san, uci, fen: chess.fen(),
    from: mv.from as Square, to: mv.to as Square,
    color: parts[1] === 'b' ? 'b' : 'w',
    num: parseInt(parts[5], 10) || 1,
    comment: '', nag: '', children: [],
  };
  parent.children.push(node);
  return node;
}

function finishChapter(id: string, name: string, orientation: 'white' | 'black', root: StudyNode): StudyChapter {
  const index: StudyChapter['index'] = new Map();
  let moveCount = 0;
  const walk = (n: StudyNode, p: StudyNode | null) => {
    index.set(n.id, { node: n, parent: p });
    if (p) moveCount++;
    n.children.forEach((c) => walk(c, n));
  };
  walk(root, null);
  return { id, name, orientation, startFen: DEFAULT_FEN, root, index, moveCount };
}

/** Chapters for one opening: an overview tree of every line, then one chapter per named variation. */
export function buildBuiltinChapters(family: string): StudyChapter[] {
  const lines = getFamilies().get(family) ?? [];
  const orientation: 'white' | 'black' = /defen[cs]e/i.test(family) ? 'black' : 'white';
  const chapters: StudyChapter[] = [];

  // 1) Overview: all lines merged into one tree, variations branch where they diverge
  {
    let c = 0;
    const nextId = () => ++c;
    const root = emptyRoot();
    for (const line of lines) {
      let cur: StudyNode | null = root;
      for (const u of line.uci) {
        cur = addUci(cur, u, nextId);
        if (!cur) break;
      }
      if (cur && cur !== root) {
        const label = `${line.name} (${line.eco})`;
        cur.comment = cur.comment ? `${cur.comment} · ${label}` : label;
      }
    }
    root.comment = `${family} — every named line in one tree. Variations branch at the move where they diverge.`;
    chapters.push(finishChapter('0', 'All lines (tree)', orientation, root));
  }

  // 2) One chapter per variation
  for (const line of lines) {
    let c = 0;
    const nextId = () => ++c;
    const root = emptyRoot();
    const walker = new BookWalker();
    let cur: StudyNode = root;
    let lastName = '';
    for (const u of line.uci) {
      const nx = addUci(cur, u, nextId);
      if (!nx) break;
      walker.step(u);
      const nm = walker.current();
      if (nm && nm.name !== lastName) {
        nx.comment = `${nm.name} (${nm.eco})`;
        lastName = nm.name;
      }
      cur = nx;
    }
    root.comment = `${line.name} (${line.eco}). Use Practice to play this line from memory.`;
    chapters.push(finishChapter(String(chapters.length), `${line.eco} ${line.variation || 'Main line'}`, orientation, root));
  }
  return chapters;
}

const KEY = 'chesslens-studies';

export function loadStudies(): StoredStudy[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveStudies(studies: StoredStudy[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(studies));
    return true;
  } catch {
    return false;
  }
}
