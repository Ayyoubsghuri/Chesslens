import { useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import type { ImportedGame } from '@/lib/types';
import {
  Crown as ChessIcon, Download, Swords, Flame, Skull, BookOpen, Trophy, Loader2, Clock, Zap, Search, Sparkles,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Fetching games (public APIs, no key, CORS enabled)                  */
/* ------------------------------------------------------------------ */

type Platform = 'chesscom' | 'lichess';
type Outcome = 'w' | 'd' | 'l';

interface Game {
  ts: number; // ms
  color: 'w' | 'b';
  outcome: Outcome;
  myRating: number | null;
  oppName: string;
  oppRating: number | null;
  opening: string | null;
  speed: string; // bullet / blitz / rapid / classical / daily
  how: 'mate' | 'resign' | 'time' | 'other'; // how the game ended (for wins and losses)
}

const MAX_GAMES = 300;

/** Group variations into a family: "Sicilian Defense: Najdorf" -> "Sicilian Defense". */
const FAMILIES = [
  'Ruy Lopez', 'Queens Gambit', "Queen's Gambit", 'Kings Gambit', "King's Gambit", 'Kings Indian', "King's Indian",
  'Queens Indian', 'Nimzo Indian', 'Nimzo-Indian', 'Italian Game', 'Sicilian Defense', 'French Defense', 'Caro-Kann',
  'Caro Kann', 'Scandinavian', 'Pirc', 'Alekhine', 'English Opening', 'Vienna', 'Scotch', 'Petrov', 'London System',
  'Catalan', 'Slav', 'Dutch', 'Grunfeld', 'Grünfeld', 'Benoni', 'Bird', 'Reti', 'Zukertort', 'Philidor', 'Four Knights',
  'Danish Gambit', 'Evans Gambit', 'Two Knights', 'Bishops Opening', "Bishop's Opening", 'Center Game', 'Modern Defense',
];

function family(raw: string): string {
  const name = raw.replace(/-/g, ' ').replace(/%27/g, "'").replace(/\s+\d.*$/, '').replace(/[:,].*$/, '').trim();
  const lower = name.toLowerCase().replace(/-/g, ' ');
  for (const f of FAMILIES) {
    if (lower.startsWith(f.toLowerCase().replace(/-/g, ' '))) return f.replace("Queen's", 'Queens').replace("King's", 'Kings').replace("Bishop's", 'Bishops');
  }
  const m = name.match(/^(.*?\b(?:Defense|Defence|Opening|Game|Gambit|Attack|System))\b/i);
  return ((m ? m[1] : name.split(/\s+/).slice(0, 3).join(' ')).trim()) || 'Unknown';
}

async function fetchChessCom(user: string): Promise<{ games: Game[]; display: string }> {
  const u = user.toLowerCase();
  const arc = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`);
  if (arc.status === 404) throw new Error(`No Chess.com player called "${user}".`);
  if (!arc.ok) throw new Error(`Chess.com returned ${arc.status}. Try again in a moment.`);
  const archives: string[] = ((await arc.json()) as { archives?: string[] }).archives ?? [];

  const games: Game[] = [];
  let display = user;
  for (const url of [...archives].reverse().slice(0, 8)) {
    if (games.length >= MAX_GAMES) break;
    const res = await fetch(url);
    if (!res.ok) continue;
    const month = ((await res.json()) as { games?: any[] }).games ?? [];
    for (const g of [...month].reverse()) {
      if (games.length >= MAX_GAMES) break;
      if (g.rules && g.rules !== 'chess') continue;
      const isWhite = g.white?.username?.toLowerCase() === u;
      const isBlack = g.black?.username?.toLowerCase() === u;
      if (!isWhite && !isBlack) continue;
      const me = isWhite ? g.white : g.black;
      const opp = isWhite ? g.black : g.white;
      display = me.username || display;

      const draws = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];
      let outcome: Outcome;
      if (me.result === 'win') outcome = 'w';
      else if (draws.includes(me.result)) outcome = 'd';
      else outcome = 'l';

      const loserResult = outcome === 'w' ? opp.result : me.result;
      const how: Game['how'] =
        loserResult === 'checkmated' ? 'mate'
        : loserResult === 'resigned' ? 'resign'
        : loserResult === 'timeout' || loserResult === 'abandoned' ? 'time'
        : 'other';

      const ecoUrl = /\[ECOUrl "([^"]+)"\]/.exec(g.pgn ?? '')?.[1];
      const slug = ecoUrl ? decodeURIComponent(ecoUrl.split('/').pop() ?? '') : null;

      games.push({
        ts: (g.end_time ?? 0) * 1000,
        color: isWhite ? 'w' : 'b',
        outcome,
        myRating: typeof me.rating === 'number' ? me.rating : null,
        oppName: opp.username ?? 'Unknown',
        oppRating: typeof opp.rating === 'number' ? opp.rating : null,
        opening: slug ? family(slug) : null,
        speed: g.time_class ?? 'rapid',
        how,
      });
    }
  }
  return { games, display };
}

async function fetchLichess(user: string): Promise<{ games: Game[]; display: string }> {
  const u = user.toLowerCase();
  const res = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(u)}?max=${MAX_GAMES}&opening=true&moves=false&tags=false`,
    { headers: { Accept: 'application/x-ndjson' } },
  );
  if (res.status === 404) throw new Error(`No Lichess player called "${user}".`);
  if (!res.ok) throw new Error(`Lichess returned ${res.status}. Try again in a moment.`);
  const lines = (await res.text()).split('\n').filter(Boolean);

  const games: Game[] = [];
  let display = user;
  for (const line of lines) {
    let g: any;
    try { g = JSON.parse(line); } catch { continue; }
    if (g.variant && g.variant !== 'standard') continue;
    const wName = g.players?.white?.user?.name ?? (g.players?.white?.aiLevel ? `Stockfish ${g.players.white.aiLevel}` : 'Anonymous');
    const bName = g.players?.black?.user?.name ?? (g.players?.black?.aiLevel ? `Stockfish ${g.players.black.aiLevel}` : 'Anonymous');
    const isWhite = wName.toLowerCase() === u;
    const isBlack = bName.toLowerCase() === u;
    if (!isWhite && !isBlack) continue;
    display = isWhite ? wName : bName;
    const me = isWhite ? g.players.white : g.players.black;
    const opp = isWhite ? g.players.black : g.players.white;
    const winner: string | undefined = g.winner;
    const outcome: Outcome = !winner ? 'd' : (winner === 'white') === isWhite ? 'w' : 'l';
    const how: Game['how'] =
      g.status === 'mate' ? 'mate'
      : g.status === 'resign' ? 'resign'
      : g.status === 'outoftime' || g.status === 'timeout' ? 'time'
      : 'other';
    games.push({
      ts: g.lastMoveAt ?? g.createdAt ?? 0,
      color: isWhite ? 'w' : 'b',
      outcome,
      myRating: typeof me?.rating === 'number' ? me.rating : null,
      oppName: isWhite ? bName : wName,
      oppRating: typeof opp?.rating === 'number' ? opp.rating : null,
      opening: g.opening?.name ? family(g.opening.name) : null,
      speed: g.speed ?? 'rapid',
      how,
    });
  }
  return { games, display };
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

interface Row { icon: typeof Zap; title: string; value: string }
interface OpeningStat { name: string; n: number; win: number }
interface Bucket { label: string; n: number; score: number }
interface Story {
  name: string;
  platform: Platform;
  count: number;
  rating: number | null;
  winRate: number;
  record: { w: number; d: number; l: number };
  rows: Row[];
  white: OpeningStat[];
  black: OpeningStat[];
  weapon: { name: string; score: number; n: number } | null;
  /** Most-played opening + worst opening to retire (opening identity card). */
  identity: {
    main: string;
    share: number;
    n: number;
    retire: { name: string; score: number; side: string } | null;
  } | null;
  giant: { oppName: string; oppRating: number; myRating: number | null } | null;
  nemesis: { name: string; games: number; w: number; d: number; l: number } | null;
  streak: number;
  times: Bucket[];
  wins: { label: string; n: number }[];
  winTotal: number;
  formats: { speed: string; n: number; score: number }[];
  ratings: number[];
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const points = (o: Outcome) => (o === 'w' ? 1 : o === 'd' ? 0.5 : 0);

function openingMap(games: Game[], color?: 'w' | 'b') {
  const map = new Map<string, { n: number; w: number; points: number }>();
  for (const g of games) {
    if (!g.opening || (color && g.color !== color)) continue;
    const cur = map.get(g.opening) ?? { n: 0, w: 0, points: 0 };
    cur.n++;
    if (g.outcome === 'w') cur.w++;
    cur.points += points(g.outcome);
    map.set(g.opening, cur);
  }
  return map;
}

function topOpenings(games: Game[], color: 'w' | 'b'): OpeningStat[] {
  return [...openingMap(games, color).entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 3)
    .map(([name, s]) => ({ name, n: s.n, win: pct(s.w, s.n) }));
}

function buildStory(name: string, platform: Platform, all: Game[]): Story {
  const games = [...all].sort((a, b) => a.ts - b.ts); // oldest -> newest
  const record = { w: 0, d: 0, l: 0 };
  games.forEach((g) => record[g.outcome]++);

  const white = topOpenings(games, 'w');
  const black = topOpenings(games, 'b');

  const allOpenings = [...openingMap(games).entries()];
  const weaponEntry = allOpenings
    .filter(([, s]) => s.n >= 3)
    .sort((a, b) => b[1].points / b[1].n - a[1].points / a[1].n || b[1].n - a[1].n)[0];
  const weapon = weaponEntry ? { name: weaponEntry[0], score: pct(weaponEntry[1].points, weaponEntry[1].n), n: weaponEntry[1].n } : null;

  // Opening identity: most played overall + worst opening worth retiring
  const mostPlayedEntry = allOpenings.sort((a, b) => b[1].n - a[1].n)[0];
  const worstOverall = allOpenings
    .filter(([, s]) => s.n >= 3)
    .sort((a, b) => a[1].points / a[1].n - b[1].points / b[1].n || b[1].n - a[1].n)[0];
  // Prefer a weak Black repertoire line when available (matches the screenshot tone)
  const blackMap = openingMap(games, 'b');
  const worstBlack = [...blackMap.entries()]
    .filter(([, s]) => s.n >= 3)
    .sort((a, b) => a[1].points / a[1].n - b[1].points / b[1].n || b[1].n - a[1].n)[0];
  const retireSrc = worstBlack && (worstBlack[1].points / worstBlack[1].n) <= 0.4
    ? { name: worstBlack[0], score: pct(worstBlack[1].points, worstBlack[1].n), side: 'as Black' }
    : worstOverall
      ? { name: worstOverall[0], score: pct(worstOverall[1].points, worstOverall[1].n), side: '' }
      : null;
  const identity = mostPlayedEntry
    ? {
        main: mostPlayedEntry[0],
        share: pct(mostPlayedEntry[1].n, games.length),
        n: mostPlayedEntry[1].n,
        retire: retireSrc && retireSrc.name !== mostPlayedEntry[0] ? retireSrc : null,
      }
    : null;

  const giantGame = games
    .filter((g) => g.outcome === 'w' && g.oppRating != null)
    .sort((a, b) => b.oppRating! - a.oppRating!)[0];
  const giant = giantGame ? { oppName: giantGame.oppName, oppRating: giantGame.oppRating!, myRating: giantGame.myRating } : null;

  const vs = new Map<string, { games: number; w: number; d: number; l: number }>();
  games.forEach((g) => {
    const cur = vs.get(g.oppName) ?? { games: 0, w: 0, d: 0, l: 0 };
    cur.games++;
    cur[g.outcome]++;
    vs.set(g.oppName, cur);
  });
  const nem = [...vs.entries()].filter(([, s]) => s.l >= 2).sort((a, b) => b[1].l - a[1].l || b[1].games - a[1].games)[0];
  const nemesis = nem ? { name: nem[0], ...nem[1] } : null;

  let streak = 0, cur = 0;
  games.forEach((g) => { cur = g.outcome === 'w' ? cur + 1 : 0; streak = Math.max(streak, cur); });

  const bucketOf = (h: number) => (h >= 5 && h < 12 ? 'Mornings' : h >= 12 && h < 17 ? 'Afternoons' : h >= 17 && h < 22 ? 'Evenings' : 'Late nights');
  const tmp: Record<string, { n: number; points: number }> = {};
  games.forEach((g) => {
    if (!g.ts) return;
    const b = bucketOf(new Date(g.ts).getHours());
    const e = tmp[b] ?? { n: 0, points: 0 };
    e.n++;
    e.points += points(g.outcome);
    tmp[b] = e;
  });
  const times: Bucket[] = ['Mornings', 'Afternoons', 'Evenings', 'Late nights']
    .filter((l) => tmp[l])
    .map((label) => ({ label, n: tmp[label].n, score: pct(tmp[label].points, tmp[label].n) }));

  const winGames = games.filter((g) => g.outcome === 'w');
  const wins = [
    { label: 'Checkmate', n: winGames.filter((g) => g.how === 'mate').length },
    { label: 'Resignation', n: winGames.filter((g) => g.how === 'resign').length },
    { label: 'On time', n: winGames.filter((g) => g.how === 'time').length },
    { label: 'Other', n: winGames.filter((g) => g.how === 'other').length },
  ].filter((w) => w.n > 0);

  const fm = new Map<string, { n: number; points: number }>();
  games.forEach((g) => {
    const e = fm.get(g.speed) ?? { n: 0, points: 0 };
    e.n++;
    e.points += points(g.outcome);
    fm.set(g.speed, e);
  });
  const formats = [...fm.entries()].sort((a, b) => b[1].n - a[1].n).map(([speed, s]) => ({ speed, n: s.n, score: pct(s.points, s.n) }));

  const rated = games.filter((g) => g.myRating != null).map((g) => g.myRating as number);
  // Keep the sparkline light: at most ~60 points
  const step = Math.max(1, Math.ceil(rated.length / 60));
  const ratings = rated.filter((_, i) => i % step === 0 || i === rated.length - 1);

  // Poster rows (summary)
  const rows: Row[] = [{ icon: Swords, title: 'Record', value: `${record.w}W · ${record.d}D · ${record.l}L` }];
  if (white[0]) rows.push({ icon: BookOpen, title: 'As White', value: `${white[0].name} · ${white[0].win}% (${white[0].n})` });
  if (black[0]) rows.push({ icon: BookOpen, title: 'As Black', value: `${black[0].name} · ${black[0].win}% (${black[0].n})` });
  if (weapon) rows.push({ icon: Sparkles, title: 'Secret weapon', value: `${weapon.name} ${weapon.score}%` });
  if (giant) rows.push({ icon: Trophy, title: 'Giant killer', value: `Beat a ${giant.oppRating}` });
  if (nemesis) rows.push({ icon: Skull, title: 'Nemesis', value: `${nemesis.name} · ${nemesis.l} losses` });
  if (streak >= 3) rows.push({ icon: Flame, title: 'Best streak', value: `${streak} wins in a row` });
  const bestTime = [...times].filter((t) => t.n >= 5).sort((a, b) => b.score - a.score)[0];
  if (bestTime && times.length > 1) rows.push({ icon: Clock, title: 'Plays best', value: `${bestTime.label} · ${bestTime.score}%` });
  if (formats[0]) rows.push({ icon: Zap, title: 'Favorite format', value: `${cap(formats[0].speed)} · ${pct(formats[0].n, games.length)}%` });

  const latest = [...games].reverse().find((g) => g.myRating != null);
  return {
    name, platform, count: games.length, rating: latest?.myRating ?? null,
    winRate: pct(record.w + record.d / 2, games.length), record, rows,
    white, black, weapon, identity, giant, nemesis, streak, times, wins, winTotal: winGames.length, formats, ratings,
  };
}

/* ------------------------------------------------------------------ */
/* UI pieces                                                           */
/* ------------------------------------------------------------------ */

const GRADS = {
  green: 'linear-gradient(165deg, #1f6b4f 0%, #14412f 55%, #0e2b21 100%)',
  blue: 'linear-gradient(165deg, #1f5d7a 0%, #133a52 55%, #0c2234 100%)',
  amber: 'linear-gradient(165deg, #7a5a1f 0%, #4f3913 55%, #2f220b 100%)',
  plum: 'linear-gradient(165deg, #6a3a78 0%, #432451 55%, #2a1633 100%)',
  red: 'linear-gradient(165deg, #7a2f2f 0%, #4f1d1d 55%, #2f1111 100%)',
};
const GOLD = '#f2c862';

function Ring({ value }: { value: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden>
      <circle cx="38" cy="38" r={r} fill="none" stroke="#e5e7eb" strokeWidth="7" />
      <circle
        cx="38" cy="38" r={r} fill="none" stroke="#16a34a" strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${c * Math.max(0, Math.min(1, value / 100))} ${c}`} transform="rotate(-90 38 38)"
      />
      <text x="38" y="44" textAnchor="middle" fontSize="19" fontWeight="800" fill="#111827">{value}%</text>
    </svg>
  );
}

function Bar({ label, value, fill, sub }: { label: string; value: string; fill: number; sub?: string }) {
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold truncate">{label}</span>
        <span className="shrink-0 text-[13px] font-semibold" style={{ color: GOLD }}>{value}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-white/15 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, fill))}%`, background: GOLD }} />
      </div>
      {sub && <p className="text-[11px] text-white/55 mt-0.5">{sub}</p>}
    </div>
  );
}

/** Shared frame for the secondary cards. */
function Shell({
  grad, kicker, story, children, footer,
}: { grad: string; kicker: string; story: Story; children: React.ReactNode; footer?: string }) {
  return (
    <div className="w-full max-w-[340px] rounded-[28px] p-5 text-white shadow-2xl flex flex-col" style={{ background: grad, minHeight: 420 }}>
      <div className="flex items-center justify-between text-[11px] text-white/70">
        <span className="flex items-center gap-1.5 font-semibold text-white/90">
          <span className="w-6 h-6 rounded-md bg-white/15 flex items-center justify-center"><ChessIcon size={14} /></span>
          ChessLens
        </span>
        <span>{story.name} · {story.count} games</span>
      </div>
      <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: GOLD }}>{kicker}</p>
      <div className="mt-2 flex-1">{children}</div>
      {footer && <p className="mt-4 text-[11px] text-white/55">{footer}</p>}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 290, h = 110, pad = 6;
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (w - pad * 2), h - pad - ((v - min) / span) * (h - pad * 2)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" aria-hidden>
      <path d={`${d} L${last[0]} ${h} L${pts[0][0]} ${h} Z`} fill="rgba(242,200,98,0.15)" />
      <path d={d} fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="4" fill={GOLD} />
    </svg>
  );
}

const STORE_KEY = 'chesslens:story-user';

function loadLast(): { platform: Platform; user: string } | null {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Most frequent player name across imported games: a good default for the username box. */
function guessPlayer(games: ImportedGame[]): string {
  const counts = new Map<string, number>();
  games.forEach((g) => [g.white, g.black].forEach((n) => n && n !== 'You' && counts.set(n, (counts.get(n) ?? 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

export function ChessStory({ games: imported }: { games: ImportedGame[] }) {
  const last = useMemo(loadLast, []);
  const [platform, setPlatform] = useState<Platform>(last?.platform ?? 'chesscom');
  const [user, setUser] = useState(last?.user ?? guessPlayer(imported));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [story, setStory] = useState<Story | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  async function generate(e?: React.FormEvent) {
    e?.preventDefault();
    const name = user.trim();
    if (!name) return;
    setLoading(true);
    setError('');
    try {
      const { games, display } = platform === 'chesscom' ? await fetchChessCom(name) : await fetchLichess(name);
      if (games.length === 0) throw new Error(`No standard games found for "${name}" yet.`);
      setStory(buildStory(display, platform, games));
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ platform, user: name })); } catch { /* ignore */ }
    } catch (err) {
      setStory(null);
      setError(err instanceof TypeError ? 'Could not reach the site. Check your connection and try again.' : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function save(id: string) {
    const node = refs.current[id];
    if (!node || !story) return;
    setSaving(id);
    try {
      const url = await toPng(node, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement('a');
      a.href = url;
      a.download = `chesslens-${id}-${story.name}.png`;
      a.click();
    } catch (err) {
      console.error('Could not export the card', err);
    } finally {
      setSaving(null);
    }
  }

  const cards = useMemo(() => {
    if (!story) return [];
    const s = story;
    const list: { id: string; label: string; node: React.ReactNode; tilt?: boolean }[] = [];

    // 1. Poster
    list.push({
      id: 'poster', label: 'Summary', tilt: true,
      node: (
        <div className="w-full max-w-[340px] rounded-[28px] p-5 text-white shadow-2xl flex flex-col" style={{ background: GRADS.green, minHeight: 560 }}>
          <div className="flex items-center justify-between text-[11px] text-white/70">
            <span className="flex items-center gap-1.5 font-semibold text-white/90">
              <span className="w-6 h-6 rounded-md bg-white/15 flex items-center justify-center"><ChessIcon size={14} /></span>
              ChessLens
            </span>
            <span>Last {s.count} games</span>
          </div>
          <h3 className="mt-6 text-3xl font-extrabold tracking-tight leading-tight break-words">{s.name}</h3>
          <p className="text-xs text-white/60 mt-0.5">
            {s.platform === 'chesscom' ? 'Chess.com' : 'Lichess'}{s.rating != null && ` · rated ${s.rating}`}
          </p>
          <div className="mt-4 rounded-2xl bg-white p-3 flex items-center gap-3 shadow-lg" style={{ color: '#111827' }}>
            <Ring value={s.winRate} />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Score rate</p>
              <p className="text-lg font-extrabold leading-tight" style={{ color: '#15803d' }}>{s.record.w}–{s.record.d}–{s.record.l}</p>
              <p className="text-[11px] text-gray-500">wins · draws · losses</p>
            </div>
          </div>
          <ul className="mt-4 flex-1">
            {s.rows.map(({ icon: Icon, title, value }) => (
              <li key={title} className="flex items-center gap-3 py-2.5 border-t border-white/10 first:border-t-0">
                <Icon size={16} className="shrink-0 text-white/70" />
                <span className="text-sm font-semibold shrink-0">{title}</span>
                <span className="ml-auto text-right text-[13px] font-semibold" style={{ color: GOLD }}>{value}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-2xl px-4 py-3" style={{ background: GOLD, color: '#1f2937' }}>
            <p className="text-[11px] opacity-70">What's your chess story?</p>
            <p className="text-lg font-extrabold leading-tight">Analyze. Learn. Improve.</p>
          </div>
        </div>
      ),
    });

    // 2. Opening identity (light story card)
    if (s.identity) {
      const id = s.identity;
      list.push({
        id: 'identity', label: 'Identity',
        node: (
          <div
            className="w-full max-w-[340px] rounded-[28px] p-5 flex flex-col shadow-2xl"
            style={{ background: '#f4f0e8', color: '#111827', minHeight: 560 }}
          >
            <div className="flex items-center justify-between text-[11px] text-gray-500">
              <span className="flex items-center gap-1.5 font-semibold text-gray-800">
                <span className="w-6 h-6 rounded-md bg-gray-900/5 flex items-center justify-center">
                  <ChessIcon size={14} className="text-gray-800" />
                </span>
                ChessLens
              </span>
              <span>{s.name} · {s.count} games</span>
            </div>

            <p className="mt-8 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">
              Your opening identity
            </p>
            <h3 className="mt-2 text-[2rem] font-extrabold tracking-tight leading-[1.15]">
              You&apos;re a{/[aeiou]/i.test(id.main) ? 'n' : ''} {id.main} player.
            </h3>
            <p className="mt-3 text-sm text-gray-500 leading-relaxed">
              {id.n} of your last {s.count} games were in the <span className="font-semibold text-gray-700">{id.main}</span>.
            </p>

            <div className="mt-6 flex flex-col gap-2.5 flex-1">
              <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Most played</p>
                  <p className="text-sm font-bold text-gray-900 leading-tight">{id.main}</p>
                </div>
                <span className="text-lg font-extrabold text-gray-900">{id.share}%</span>
              </div>

              {s.weapon && (
                <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: '#1f6b4f' }}>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/70">Secret weapon</p>
                    <p className="text-sm font-bold text-white leading-tight">{s.weapon.name}</p>
                  </div>
                  <span className="text-lg font-extrabold text-white">{s.weapon.score}%</span>
                </div>
              )}

              {id.retire && (
                <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: '#fde8e8' }}>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-red-400">Time to retire</p>
                    <p className="text-sm font-bold text-red-700 leading-tight">
                      {id.retire.name}{id.retire.side ? `, ${id.retire.side}` : ''}
                    </p>
                  </div>
                  <span className="text-lg font-extrabold text-red-600">{id.retire.score}%</span>
                </div>
              )}
            </div>

            <p className="mt-5 text-[11px] text-gray-400 leading-relaxed">
              Most played is the share of your games. The others are the share of points you scored with that opening.
            </p>
          </div>
        ),
      });
    }

    // 3. Openings
    if (s.white.length > 0 || s.black.length > 0) {
      const maxN = Math.max(...[...s.white, ...s.black].map((o) => o.n));
      list.push({
        id: 'openings', label: 'Openings',
        node: (
          <Shell grad={GRADS.blue} kicker="Your repertoire" story={s} footer="Bars show how often you played it; the percentage is your win rate.">
            <h4 className="text-2xl font-extrabold leading-tight">
              {(s.weapon?.name ?? s.white[0]?.name ?? s.black[0]?.name)}
            </h4>
            {s.weapon && <p className="text-xs text-white/60">Your secret weapon · {s.weapon.score}% score over {s.weapon.n} games</p>}
            {s.white.length > 0 && <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-white/60">As White</p>}
            {s.white.map((o) => <Bar key={`w${o.name}`} label={o.name} value={`${o.win}% · ${o.n}`} fill={(o.n / maxN) * 100} />)}
            {s.black.length > 0 && <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-white/60">As Black</p>}
            {s.black.map((o) => <Bar key={`b${o.name}`} label={o.name} value={`${o.win}% · ${o.n}`} fill={(o.n / maxN) * 100} />)}
          </Shell>
        ),
      });
    }

    // 3. Giant killer
    if (s.giant) {
      const diff = s.giant.myRating != null ? s.giant.oppRating - s.giant.myRating : null;
      list.push({
        id: 'giant-killer', label: 'Giant killer',
        node: (
          <Shell grad={GRADS.amber} kicker="Giant killer" story={s}>
            <p className="text-sm text-white/70">Your biggest upset</p>
            <p className="mt-2 text-6xl font-extrabold tracking-tight" style={{ color: GOLD }}>{s.giant.oppRating}</p>
            <p className="mt-1 text-lg font-bold">beaten: {s.giant.oppName}</p>
            {diff != null && diff > 0 && <p className="mt-3 text-sm text-white/70">That's <b className="text-white">{diff} points</b> above your rating at the time.</p>}
          </Shell>
        ),
      });
    }

    // 4. Nemesis
    if (s.nemesis) {
      list.push({
        id: 'nemesis', label: 'Nemesis',
        node: (
          <Shell grad={GRADS.red} kicker="Your nemesis" story={s}>
            <p className="text-sm text-white/70">The player who beats you most</p>
            <p className="mt-2 text-4xl font-extrabold tracking-tight break-words">{s.nemesis.name}</p>
            <p className="mt-4 text-5xl font-extrabold" style={{ color: GOLD }}>{s.nemesis.w}–{s.nemesis.d}–{s.nemesis.l}</p>
            <p className="text-sm text-white/70">your wins · draws · losses against them ({s.nemesis.games} games)</p>
          </Shell>
        ),
      });
    }

    // 5. Rating journey
    if (s.ratings.length >= 5) {
      const first = s.ratings[0], lastR = s.ratings[s.ratings.length - 1];
      const delta = lastR - first;
      list.push({
        id: 'rating', label: 'Rating',
        node: (
          <Shell grad={GRADS.plum} kicker="Rating journey" story={s} footer={`Peak ${Math.max(...s.ratings)} · Lowest ${Math.min(...s.ratings)}`}>
            <p className="text-6xl font-extrabold tracking-tight">{lastR}</p>
            <p className="text-sm font-semibold" style={{ color: delta >= 0 ? '#86efac' : '#fca5a5' }}>
              {delta >= 0 ? '+' : ''}{delta} over these {s.count} games
            </p>
            <div className="mt-5"><Sparkline values={s.ratings} /></div>
          </Shell>
        ),
      });
    }

    // 6. Winning ways + streak
    if (s.winTotal >= 3) {
      list.push({
        id: 'winning-ways', label: 'Winning ways',
        node: (
          <Shell grad={GRADS.green} kicker="How you win" story={s}>
            <div className="flex items-end gap-3">
              <p className="text-6xl font-extrabold tracking-tight" style={{ color: GOLD }}>{s.winTotal}</p>
              <p className="pb-2 text-sm text-white/70">wins, {s.streak >= 2 ? `best run ${s.streak} in a row` : 'no long streaks yet'}</p>
            </div>
            <div className="mt-4">
              {s.wins.map((w) => <Bar key={w.label} label={w.label} value={`${pct(w.n, s.winTotal)}%`} fill={pct(w.n, s.winTotal)} />)}
            </div>
          </Shell>
        ),
      });
    }

    // 7. When you play
    if (s.times.length > 1) {
      const best = [...s.times].filter((t) => t.n >= 5).sort((a, b) => b.score - a.score)[0];
      list.push({
        id: 'when', label: 'When you play',
        node: (
          <Shell grad={GRADS.blue} kicker="When you play best" story={s} footer="Percentages are your score rate in that part of the day.">
            <h4 className="text-3xl font-extrabold leading-tight">{best ? best.label : 'Not enough data'}</h4>
            <div className="mt-4">
              {s.times.map((t) => <Bar key={t.label} label={t.label} value={`${t.score}%`} sub={`${t.n} games`} fill={t.score} />)}
            </div>
          </Shell>
        ),
      });
    }

    // 8. Formats
    if (s.formats.length > 0) {
      list.push({
        id: 'formats', label: 'Formats',
        node: (
          <Shell grad={GRADS.amber} kicker="Your format" story={s} footer="Bars show how many games you played; the percentage is your score rate.">
            <h4 className="text-4xl font-extrabold leading-tight">{cap(s.formats[0].speed)}</h4>
            <p className="text-sm text-white/70">{pct(s.formats[0].n, s.count)}% of your games</p>
            <div className="mt-4">
              {s.formats.map((f) => <Bar key={f.speed} label={cap(f.speed)} value={`${f.score}% · ${f.n}`} fill={pct(f.n, s.count)} />)}
            </div>
          </Shell>
        ),
      });
    }
    return list;
  }, [story]);

  async function saveAll() {
    for (const c of cards) {
      await save(c.id);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return (
    <section className="mt-12 w-full" aria-labelledby="story-heading">
      <div className="mb-5">
        <h2 id="story-heading" className="text-xl font-bold">Your chess, as a story</h2>
        <p className="text-sm text-ink-400 mt-0.5">
          Enter any Chess.com or Lichess username to get a set of cards from their recent games: openings, giant killer, nemesis and more.
        </p>
      </div>

      <form onSubmit={generate} className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex gap-1 p-1 rounded-lg bg-ink-800/70 text-sm">
          {(['chesscom', 'lichess'] as const).map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => setPlatform(p)}
              className={`px-3 py-1.5 rounded-md transition-colors ${platform === p ? 'bg-ink-600 text-white' : 'text-ink-400 hover:text-ink-200'}`}
            >
              {p === 'chesscom' ? 'Chess.com' : 'Lichess'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-lg bg-ink-800 border border-ink-700 text-ink-100 text-sm pl-8 pr-3 py-2 placeholder:text-ink-500"
          />
        </div>
        <button type="submit" disabled={loading || !user.trim()} className="btn-primary text-sm">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Tell my chess story
        </button>
        {cards.length > 1 && (
          <button type="button" onClick={saveAll} disabled={saving !== null} className="btn-secondary text-sm">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Save all ({cards.length})
          </button>
        )}
      </form>
      {error && <p className="text-sm text-red-300 mb-2" role="alert">{error}</p>}
      {loading && <p className="text-sm text-ink-400 mb-2">Fetching recent games…</p>}

      {cards.length > 0 && (
        <div className="relative -mx-4 sm:mx-0 mt-4">
          {/* Horizontal story strip: full-bleed swipe on mobile, fixed-width cards on larger screens */}
          <div
            className="flex overflow-x-auto snap-x snap-mandatory gap-3 sm:gap-6 px-4 sm:px-2 pb-6 pt-2
              scroll-smooth overscroll-x-contain
              [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {cards.map((c) => (
              <div
                key={c.id}
                className="snap-center shrink-0 flex flex-col items-center gap-3
                  w-[min(100vw-2rem,340px)] sm:w-[340px]"
              >
                <div
                  className={`w-full ${
                    c.tilt ? 'lg:-rotate-2 transition-transform hover:rotate-0 duration-300' : ''
                  }`}
                >
                  {/* Mobile story mode: stretch card to fill most of the viewport height */}
                  <div
                    ref={(el) => { refs.current[c.id] = el; }}
                    className="w-full [&>div]:w-full [&>div]:max-w-none
                      max-sm:[&>div]:min-h-[min(78dvh,640px)] max-sm:[&>div]:h-[min(78dvh,640px)]"
                  >
                    {c.node}
                  </div>
                </div>
                <button
                  onClick={() => save(c.id)}
                  disabled={saving !== null}
                  className="btn-ghost text-xs shrink-0"
                >
                  {saving === c.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Save {c.label.toLowerCase()}
                </button>
              </div>
            ))}
          </div>
          {/* Edge fades so users notice they can swipe on mobile */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-ink-950/80 to-transparent sm:hidden" aria-hidden />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-ink-950/80 to-transparent sm:hidden" aria-hidden />
        </div>
      )}
    </section>
  );
}