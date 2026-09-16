// Book-move detection backed by the lichess-org/chess-openings dataset
// (https://github.com/lichess-org/chess-openings, CC0). The raw TSVs are
// compiled offline into a UCI-move trie — see scripts/generate-openings-book.mjs.
// We match on UCI (from+to+promotion) rather than SAN so lookups never depend
// on check/mate suffixes or disambiguation formatting.

import bookData from './openings-book.json';

interface BookNode {
  move?: string;
  eco?: string;
  name?: string;
  children?: Record<string, BookNode>;
}

const ROOT = bookData as BookNode;

export interface OpeningMatch {
  eco: string;
  name: string;
}

/**
 * Walks one game's moves ply-by-ply against the opening trie.
 * Once a move falls off the tree the walker permanently leaves "book" —
 * it never re-syncs later even if the position transposes back into a
 * known line, matching how chess.com / lichess classify openings.
 */
export class BookWalker {
  private node: BookNode | undefined = ROOT;
  private best: OpeningMatch | null = null;

  /** Advance by one ply. Returns true if this move is still in book. */
  step(uci: string): boolean {
    const next = this.node?.children?.[uci];
    if (!next) {
      this.node = undefined;
      return false;
    }
    this.node = next;
    if (next.eco && next.name) {
      this.best = { eco: next.eco, name: next.name };
    }
    return true;
  }

  /** Deepest named opening reached so far on this path (or null). */
  current(): OpeningMatch | null {
    return this.best;
  }
}

/** Convenience for one-off lookups outside the incremental analysis loop. */
export function classifyLine(uciMoves: string[]): {
  bookPlyCount: number;
  opening: OpeningMatch | null;
} {
  const walker = new BookWalker();
  let bookPlyCount = 0;
  for (const uci of uciMoves) {
    if (!walker.step(uci)) break;
    bookPlyCount++;
  }
  return { bookPlyCount, opening: walker.current() };
}
