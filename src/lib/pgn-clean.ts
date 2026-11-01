import { parsePastedGames } from './chesscom';
import type { ImportedGame } from './types';

/** Tidies pasted PGN so common copy/paste problems don't make the parser fail. */
export function cleanPgn(text: string): string {
  let t = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  // Drop any text before the first header (e.g. copied page text).
  const first = t.search(/^\s*\[\s*\w+\s+"/m);
  if (first > 0) t = t.slice(first);
  // Moves only, no headers: give the parser a header to work with.
  if (!/^\s*\[\s*\w+\s+"/m.test(t)) t = `[Event "Pasted game"]\n\n${t}`;
  // Make sure there is a blank line between the headers and the moves.
  t = t.replace(/(\]\s*)\n(?=[^\[\n])/g, '$1\n\n');
  return t;
}

/** Last resort: remove {comments}, (variations), $NAGs and ;comments from the move text. */
export function stripMoveExtras(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('[')) return line; // header line
      let l = line.replace(/\{[^}]*\}/g, ' ').replace(/;.*$/, '').replace(/\$\d+/g, ' ');
      for (let i = 0; i < 5; i++) l = l.replace(/\([^()]*\)/g, ' ');
      return l;
    })
    .join('\n');
}


/** Parses PGN text the forgiving way: as pasted, then tidied, then with comments/variations stripped. */
export function parsePgnText(text: string): ImportedGame[] {
  const cleaned = cleanPgn(text);
  for (const candidate of [text, cleaned, stripMoveExtras(cleaned)]) {
    try {
      const games = parsePastedGames(candidate);
      if (games.length > 0) return games;
    } catch { /* try the next form */ }
  }
  return [];
}

/** Quick check before parsing: does this clipboard text look like a chess game? */
export function looksLikePgn(text: string): boolean {
  const t = text.trim();
  if (t.length < 20 || t.length > 200000) return false;
  if (/^\s*\[\s*(Event|Site|White|Black|Date|Result|FEN)\s+"/m.test(t)) return true;
  // Moves only: "1. e4 e5 2. Nf3 ..."
  return /(^|\s)1\.\s*(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O(?:-O)?)[+#]?\s+\S+/.test(t);
}
