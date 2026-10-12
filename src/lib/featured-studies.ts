// Built-in "featured" Lichess studies. They load on demand from the public Lichess API
// (same endpoint the Import box uses) and are cached in this browser after the first open.
// To add another: append an entry below. Place in src/lib/featured-studies.ts

export interface FeaturedStudy {
  id: string;        // our own key
  studyId: string;   // Lichess study id (https://lichess.org/study/<studyId>)
  title: string;
  blurb: string;
  startAt?: string;  // open on the first chapter whose name contains this text
  tags: string;      // extra search words
}

export const FEATURED_STUDIES: FeaturedStudy[] = [
  {
    id: 'olympiad-2026-puzzles',
    studyId: 'Zwqt6BdF',
    title: '46th FIDE Chess Olympiad 2026 · Puzzle Pack',
    blurb: 'Puzzle pack from the 2026 Olympiad. Open a chapter and switch to Practice to solve it.',
    tags: 'olympiad puzzles tactics 2026 fide',
  },
  {
    id: 'fried-liver-traxler',
    studyId: 'QYhJnYOH',
    title: 'Fried Liver Counter-Attack',
    blurb: 'Black’s Traxler Counterattack (…Bc5!?) against the Fried Liver setup, with practice mode.',
    startAt: 'Traxler',
    tags: 'traxler counterattack fried liver italian two knights',
  },
];

const PREFIX = 'chesslens-featured-pgn:';
const mem = new Map<string, string>();

export async function loadFeaturedPgn(studyId: string): Promise<string> {
  const hit = mem.get(studyId);
  if (hit) return hit;
  try {
    const cached = localStorage.getItem(PREFIX + studyId);
    if (cached) { mem.set(studyId, cached); return cached; }
  } catch { /* storage blocked */ }

  let res: Response;
  try {
    res = await fetch(`https://lichess.org/api/study/${encodeURIComponent(studyId)}.pgn`);
  } catch {
    throw new Error("Couldn't reach Lichess. Check your connection, or import the study's PGN from the Import tab.");
  }
  if (res.status === 404) throw new Error("Lichess says this study wasn't found — it may be private or deleted.");
  if (res.status === 429) throw new Error('Lichess rate limit hit — wait a minute and try again.');
  if (!res.ok) throw new Error(`Lichess returned an error (${res.status}).`);
  const text = await res.text();
  if (!text.trim()) throw new Error('That study came back empty.');

  mem.set(studyId, text);
  try { localStorage.setItem(PREFIX + studyId, text); } catch { /* too big for storage — still works this session */ }
  return text;
}
