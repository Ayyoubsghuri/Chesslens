/**
 * player.ts
 * Remembers WHO THE USER IS (their chess username) so every game can be narrated as "you" vs "your opponent",
 * with the user at the bottom of the board.
 *
 * Put this file in src/lib/ (imported as '@/lib/player').
 */

const KEY = 'chesslens:username';
const STORY_KEY = 'chesslens:story-user'; // written by ChessStory: { platform, user }

/** Names that say nothing about who the player is. */
const GENERIC = new Set(['', 'white', 'black', 'anonymous', 'unknown', '?', 'computer', 'stockfish']);

const clean = (s?: string | null) => (s ?? '').trim().toLowerCase();

/** The saved username ('' when unknown). Falls back to the one typed in the "Chess story" box. */
export function getUsername(): string {
  try {
    const own = localStorage.getItem(KEY);
    if (own) return own;
    const story = localStorage.getItem(STORY_KEY);
    if (story) {
      const u = JSON.parse(story)?.user;
      if (typeof u === 'string') return u;
    }
  } catch { /* storage unavailable */ }
  return '';
}

export function setUsername(name: string) {
  try { localStorage.setItem(KEY, name.trim()); } catch { /* ignore */ }
}

/** Which side the user played in this game: 'w', 'b', or null when we cannot tell. */
export function youSide(game: { white?: string | null; black?: string | null }, username: string): 'w' | 'b' | null {
  const w = clean(game.white), b = clean(game.black);
  // Games played against the computer are saved as "You" vs "Computer".
  if (w === 'you') return 'w';
  if (b === 'you') return 'b';
  const u = clean(username);
  if (GENERIC.has(u)) return null;
  if (u === w && u !== b) return 'w';
  if (u === b && u !== w) return 'b';
  return null;
}

/** Best guess of the user's name from a batch of imported games: the one name that appears in (almost) every game. */
export function guessUsername(games: { white?: string | null; black?: string | null }[]): string {
  if (games.length < 2) return '';
  const counts = new Map<string, { name: string; n: number }>();
  for (const g of games) {
    for (const raw of new Set([g.white, g.black])) {
      const k = clean(raw);
      if (GENERIC.has(k) || k === 'you') continue;
      const cur = counts.get(k) ?? { name: (raw ?? '').trim(), n: 0 };
      cur.n++;
      counts.set(k, cur);
    }
  }
  const sorted = [...counts.values()].sort((a, b) => b.n - a.n);
  const top = sorted[0];
  if (!top || top.n < 2 || top.n < games.length * 0.6) return '';
  if (sorted[1] && sorted[1].n === top.n) return '';
  return top.name;
}
