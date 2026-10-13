// Built-in studies: every opening from the lichess dataset, ready to study and practice.
// Search matches variations too (Traxler, Evans Gambit…), and there is a Gambits filter.
// Place in src/components/BuiltinStudies.tsx
import { useMemo, useState } from 'react';
import { BookOpen, Crown, Loader2, Search, Sparkles, X } from 'lucide-react';
import { buildBuiltinChapters, listBuiltinStudies } from '@/lib/study';
import { normalizeName, searchCatalog, type OpeningLine } from '@/lib/openings-catalog';
import { StudyViewer, loadUserFeatured, type UserFeaturedStudy } from './StudiesTrainer';
import { parseStudyPgn } from '@/lib/study';
import { FEATURED_STUDIES, loadFeaturedPgn, type FeaturedStudy } from '@/lib/featured-studies';
import { ENDGAME_STUDIES, ENDGAME_LICHESS_STUDIES, type EndgameStudy } from '@/lib/endgames';

const VOLUMES: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'A', label: 'A · Flank & odd' },
  { id: 'B', label: 'B · Semi-open' },
  { id: 'C', label: 'C · Open (1.e4 e5)' },
  { id: 'D', label: 'D · Closed (1.d4 d5)' },
  { id: 'E', label: 'E · Indian' },
];

// Extra Lichess studies shown under Featured studies (loaded from Lichess when opened).
const EXTRA_FEATURED = [
  {
    id: 'lichess-opening-traps',
    studyId: 'aCyAboTF',
    title: 'Opening Traps!',
    blurb: 'Classic opening traps to spring on your opponents, and to avoid falling into yourself.',
    tags: 'opening traps trap lichess gambit tricks',
  },
  {
    id: "lichess-Of3mcPk8",
    studyId: "Of3mcPk8",
    title: "Opening Traps (most popular)",
    blurb: "One of the most-liked opening-trap studies on Lichess.",
    tags: "opening traps trap",
  },
  {
    id: "lichess-jtlLwUvh",
    studyId: "jtlLwUvh",
    title: "Caro-Kann Defense",
    blurb: "The most popular Caro-Kann study on Lichess.",
    tags: "caro-kann caro kann defense opening",
  },
  {
    id: "lichess-8c8bmUfy",
    studyId: "8c8bmUfy",
    title: "All about the Sicilian Defense",
    blurb: "Ideas and lines for the Sicilian.",
    tags: "sicilian defense najdorf dragon opening",
  },
  {
    id: "lichess-vIEKP8t3",
    studyId: "vIEKP8t3",
    title: "The London System",
    blurb: "A popular, easy-to-learn White system.",
    tags: "london system opening d4",
  },
  {
    id: "lichess-UzKIIAtz",
    studyId: "UzKIIAtz",
    title: "French Defense",
    blurb: "Main lines and plans in the French.",
    tags: "french defense opening",
  },
  {
    id: "lichess-vJsZScnC",
    studyId: "vJsZScnC",
    title: "Italian Opening",
    blurb: "Giuoco Piano and friends.",
    tags: "italian opening giuoco piano e4 e5",
  },
  {
    id: "lichess-4JQtS6iu",
    studyId: "4JQtS6iu",
    title: "Repertoire for 1.e4 players",
    blurb: "A full repertoire for White with 1.e4.",
    tags: "repertoire 1.e4 white",
  },
  {
    id: "lichess-ZkCxh0nB",
    studyId: "ZkCxh0nB",
    title: "Ruy Lopez",
    blurb: "The Spanish game, step by step.",
    tags: "ruy lopez spanish opening e4 e5",
  },
  {
    id: "lichess-9XAhbaE7",
    studyId: "9XAhbaE7",
    title: "King's Indian: Fantastic Opening",
    blurb: "Attacking ideas in the King's Indian.",
    tags: "kings indian opening",
  },
  {
    id: "lichess-whCVdUeM",
    studyId: "whCVdUeM",
    title: "Stafford Gambit Traps",
    blurb: "Tricky traps in the Stafford Gambit.",
    tags: "stafford gambit traps petrov",
  },
  {
    id: "lichess-rMrAjlAG",
    studyId: "rMrAjlAG",
    title: "The Queen's Gambit",
    blurb: "Main ideas in the Queen's Gambit.",
    tags: "queens gambit opening d4 d5",
  },
  {
    id: "lichess-bZOUIzL2",
    studyId: "bZOUIzL2",
    title: "1.e4 e5 Repertoire for Black 2.0",
    blurb: "A solid repertoire for Black against 1.e4.",
    tags: "repertoire black e5 1.e4 e5",
  },
  {
    id: "lichess-A3gjlZCl",
    studyId: "A3gjlZCl",
    title: "Complete Repertoire for 1.d4 Players",
    blurb: "A full 1.d4 repertoire for White.",
    tags: "repertoire 1.d4 white queen pawn",
  },
  {
    id: "lichess-sScZfLgM",
    studyId: "sScZfLgM",
    title: "Checkmate Patterns",
    blurb: "The classic mating patterns, with examples.",
    tags: "checkmate patterns mate tactics",
  },
  {
    id: "lichess-viiWlKjv",
    studyId: "viiWlKjv",
    title: "Puzzle Themes",
    blurb: "Every tactical theme with examples.",
    tags: "tactics puzzle themes fork pin skewer",
  },
  {
    id: "lichess-YtBYXc3m",
    studyId: "YtBYXc3m",
    title: "Beautiful Checkmates",
    blurb: "Famous and elegant checkmates.",
    tags: "checkmate beautiful mates tactics",
  },
] as unknown as FeaturedStudy[];

const ENDGAME_REMOTE = ENDGAME_LICHESS_STUDIES as unknown as FeaturedStudy[];

const QUICK = ['Endgame', 'Traxler', 'Evans Gambit', "King's Gambit", 'Danish Gambit', 'Smith-Morra', 'Budapest', 'Englund', 'Blackmar-Diemer'];
const MAX_LINES = 60;

export function BuiltinStudies({ onOpenLine }: { onOpenLine: (l: OpeningLine) => void }) {
  const all = useMemo(() => listBuiltinStudies(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [volume, setVolume] = useState('all');
  const [gambits, setGambits] = useState(false);
  const [featured, setFeatured] = useState<{ title: string; pgn: string; startAt?: string } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [featErr, setFeatErr] = useState('');

  // Always read latest from localStorage when rendering the list (Import tab can add/remove)
  const userFeatured = loadUserFeatured();

  const onBackFromFeatured = () => setFeatured(null);

  async function openFeatured(f: FeaturedStudy) {
    setFeatErr('');
    setLoadingId(f.id);
    try {
      const pgn = await loadFeaturedPgn(f.studyId);
      if (parseStudyPgn(pgn).chapters.length === 0) throw new Error('No chapters found in that study.');
      setFeatured({ title: f.title, pgn, startAt: f.startAt });
    } catch (e) {
      setFeatErr(`${f.title}: ${e instanceof Error ? e.message : 'could not load.'}`);
    } finally {
      setLoadingId(null);
    }
  }

  function openUserFeatured(f: UserFeaturedStudy) {
    setFeatErr('');
    if (parseStudyPgn(f.pgn).chapters.length === 0) {
      setFeatErr(`${f.title}: No chapters found in that study.`);
      return;
    }
    setFeatured({ title: f.title, pgn: f.pgn });
  }

  if (featured) {
    return (
      <StudyViewer key={featured.title} name={featured.title} startAt={featured.startAt}
        getChapters={() => parseStudyPgn(featured.pgn).chapters} onBack={onBackFromFeatured} />
    );
  }

  if (open) {
    return <StudyViewer key={open} name={open} getChapters={() => buildBuiltinChapters(open)} onBack={() => setOpen(null)} />;
  }

  const q = normalizeName(query.trim());
  const filtering = !!q || gambits;

  // Individual lines/variations (Traxler Counterattack, Evans Gambit, …)
  const lines = filtering ? searchCatalog(q, { volume, gambitsOnly: gambits }) : [];

  const builtInFeatured = [...FEATURED_STUDIES, ...EXTRA_FEATURED.filter((e) => !FEATURED_STUDIES.some((f) => f.studyId === e.studyId))].filter(
    (f) => !gambits && (!q || normalizeName(`${f.title} ${f.tags}`).includes(q)),
  );
  const endgameList = ENDGAME_STUDIES.filter(
    (f) => !gambits && (!q || normalizeName(`${f.title} ${f.tags}`).includes(q)),
  );
  const endgameRemote = ENDGAME_REMOTE.filter(
    (f) => !gambits && (!q || normalizeName(`${f.title} ${f.tags}`).includes(q)),
  );
  const userFeaturedList = userFeatured.filter(
    (f) => !gambits && (!q || normalizeName(`${f.title} ${f.tags}`).includes(q)),
  );
  const featuredList = [...userFeaturedList, ...builtInFeatured];
  const hasFeatured = featuredList.length > 0;

  const list = all.filter(
    (s) =>
      (volume === 'all' || s.volume === volume) &&
      (!gambits || normalizeName(s.name).includes('gambit')) &&
      (!q || normalizeName(s.name).includes(q) || s.eco.toLowerCase().includes(q)),
  );

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen size={20} className="text-brand-400" />
        <h2 className="text-xl font-bold">Opening studies</h2>
        <span className="text-sm text-ink-500">({all.length} openings)</span>
      </div>
      <p className="text-sm text-ink-400">
        Every opening with all its variations. Search finds variations and gambits too (try <b>Traxler</b>). Open a line to
        learn it, practice it from memory, and replay <b>games by masters</b> that used it.
      </p>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search: Sicilian, Traxler, Evans Gambit, C57…"
          className="w-full rounded-lg bg-ink-800 border border-ink-700 text-ink-100 text-sm pl-8 pr-8 py-2.5 placeholder:text-ink-500" />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-200" aria-label="Clear">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setGambits((g) => !g)}
          className={`chip ${gambits ? 'bg-accent-400/25 text-accent-400' : 'bg-ink-700 text-ink-300'}`}>
          ♟ Gambits
        </button>
        {VOLUMES.map((v) => (
          <button key={v.id} onClick={() => setVolume(v.id)}
            className={`chip ${volume === v.id ? 'bg-brand-500/20 text-brand-300' : 'bg-ink-700 text-ink-300'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {hasFeatured && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-ink-300 flex items-center gap-1.5">
            <Sparkles size={14} className="text-brand-400" /> Featured studies
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {userFeaturedList.map((f) => (
              <button key={`user-${f.id}`} onClick={() => openUserFeatured(f)}
                className="card p-3 text-left hover:border-brand-400/40 transition-colors border-brand-400/20">
                <span className="flex items-center gap-2 text-sm font-medium text-ink-100">
                  <span className="flex-1 min-w-0 truncate">{f.title}</span>
                  <span className="text-[10px] uppercase tracking-wide text-brand-400 shrink-0">Yours</span>
                </span>
                <span className="block text-xs text-ink-400 mt-1 leading-snug">{f.blurb}</span>
              </button>
            ))}
            {builtInFeatured.map((f) => (
              <button key={f.id} onClick={() => openFeatured(f)} disabled={loadingId !== null}
                className="card p-3 text-left hover:border-brand-400/40 transition-colors disabled:opacity-60">
                <span className="flex items-center gap-2 text-sm font-medium text-ink-100">
                  <span className="flex-1 min-w-0 truncate">{f.title}</span>
                  {loadingId === f.id && <Loader2 size={14} className="animate-spin text-brand-300 shrink-0" />}
                </span>
                <span className="block text-xs text-ink-400 mt-1 leading-snug">{f.blurb}</span>
              </button>
            ))}
          </div>
          {featErr && <p className="text-sm text-red-300">{featErr}</p>}
        </div>
      )}

      {(endgameList.length > 0 || endgameRemote.length > 0) && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-ink-300 flex items-center gap-1.5">
            <Crown size={14} className="text-brand-400" /> Endgames
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {endgameList.map((f: EndgameStudy) => (
              <button key={f.id} onClick={() => setFeatured({ title: f.title, pgn: f.pgn })}
                className="card p-3 text-left hover:border-brand-400/40 transition-colors">
                <span className="block text-sm font-medium text-ink-100 truncate">{f.title}</span>
                <span className="block text-xs text-ink-400 mt-1 leading-snug">{f.blurb}</span>
              </button>
            ))}
            {endgameRemote.map((f) => (
              <button key={f.id} onClick={() => openFeatured(f)} disabled={loadingId !== null}
                className="card p-3 text-left hover:border-brand-400/40 transition-colors disabled:opacity-60">
                <span className="flex items-center gap-2 text-sm font-medium text-ink-100">
                  <span className="flex-1 min-w-0 truncate">{f.title}</span>
                  {loadingId === f.id && <Loader2 size={14} className="animate-spin text-brand-300 shrink-0" />}
                </span>
                <span className="block text-xs text-ink-400 mt-1 leading-snug">{f.blurb}</span>
              </button>
            ))}
          </div>
          {featErr && <p className="text-sm text-red-300">{featErr}</p>}
        </div>
      )}

      {!filtering && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-500">Popular:</span>
          {QUICK.map((s) => (
            <button key={s} onClick={() => setQuery(s)} className="chip bg-ink-800 text-ink-300 hover:text-ink-100 border border-ink-700">{s}</button>
          ))}
        </div>
      )}

      {filtering && lines.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-ink-300">
            Variations & gambits <span className="font-normal text-ink-500">({lines.length})</span>
          </h3>
          <div className="card p-2">
            {lines.slice(0, MAX_LINES).map((l) => (
              <button key={l.id} onClick={() => onOpenLine(l)}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-700/50 transition-colors">
                <span className="font-mono text-xs text-ink-500 w-9 shrink-0">{l.eco}</span>
                <span className="flex-1 min-w-0 truncate text-ink-100">{l.name}</span>
                <span className="text-xs text-ink-500 shrink-0">{Math.ceil(l.uci.length / 2)} moves</span>
              </button>
            ))}
            {lines.length > MAX_LINES && (
              <p className="text-xs text-ink-500 p-3">Showing {MAX_LINES} of {lines.length} — narrow your search.</p>
            )}
          </div>
        </div>
      )}

      {filtering && list.length > 0 && <h3 className="text-sm font-semibold text-ink-300">Full opening studies</h3>}

      {filtering && lines.length === 0 && list.length === 0 && featuredList.length === 0 && endgameList.length === 0 && endgameRemote.length === 0 ? (
        <p className="text-sm text-ink-500">No openings match.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {list.map((s) => (
            <button key={s.name} onClick={() => setOpen(s.name)}
              className="card p-3 text-left hover:border-brand-400/40 transition-colors flex items-center gap-3">
              <span className="font-mono text-xs text-ink-500 w-16 shrink-0">{s.eco}</span>
              <span className="flex-1 min-w-0 truncate text-sm font-medium text-ink-100">{s.name}</span>
              <span className="text-xs text-ink-500 shrink-0">{s.count} {s.count === 1 ? 'line' : 'lines'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}