// Lichess-study style viewer/trainer. Place in src/components/StudiesTrainer.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Square } from 'chess.js';
import { ChessBoard } from './ChessBoard';
import { FeedbackBanner } from './PracticeBits';
import { gameOverText, pickComputerMove, sleep } from '@/lib/practice';
import {
  extractStudyId, loadStudies, parseStudyPgn, saveStudies,
  type StoredStudy, type StudyChapter, type StudyNode,
} from '@/lib/study';
import { logEvent } from '@/lib/activity';
import {
  BookOpen, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, FileUp, Trash2,
  Loader2, RotateCcw, Lightbulb, Swords, GraduationCap, FlipVertical2, Sparkles,
} from 'lucide-react';

// ───────────────────────────── User Featured studies (localStorage) ─────────────────────────────

export type UserFeaturedStudy = {
  id: string;
  title: string;
  blurb: string;
  tags: string;
  pgn: string;
  source?: string;
  addedAt: number;
};

const USER_FEAT_KEY = 'user-featured-studies';

export function loadUserFeatured(): UserFeaturedStudy[] {
  try {
    const raw = localStorage.getItem(USER_FEAT_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveUserFeatured(list: UserFeaturedStudy[]): boolean {
  try {
    localStorage.setItem(USER_FEAT_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function isUserFeatured(id: string): boolean {
  return loadUserFeatured().some((f) => f.id === id);
}

export function addToUserFeatured(study: StoredStudy, blurb?: string): { ok: boolean; error?: string } {
  const list = loadUserFeatured();
  if (list.some((f) => f.id === study.id)) return { ok: true };
  const entry: UserFeaturedStudy = {
    id: study.id,
    title: study.name,
    blurb: blurb ?? (study.source ? `Imported from ${study.source}` : 'Imported study'),
    tags: study.name,
    pgn: study.pgn,
    source: study.source,
    addedAt: Date.now(),
  };
  const next = [entry, ...list];
  if (!saveUserFeatured(next)) return { ok: false, error: 'Browser storage is full — could not save to Featured.' };
  return { ok: true };
}

export function removeFromUserFeatured(id: string): boolean {
  const next = loadUserFeatured().filter((f) => f.id !== id);
  return saveUserFeatured(next);
}

// ───────────────────────────── Study list / import ─────────────────────────────

export function ImportedStudies() {
  const [studies, setStudies] = useState<StoredStudy[]>(() => loadStudies());
  const [openId, setOpenId] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [pgn, setPgn] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [featuredIds, setFeaturedIds] = useState<Set<string>>(() => new Set(loadUserFeatured().map((f) => f.id)));
  const [featMsg, setFeatMsg] = useState('');

  function addStudy(text: string, source?: string, idHint?: string) {
    setError('');
    setFeatMsg('');
    const parsed = parseStudyPgn(text);
    if (parsed.chapters.length === 0) {
      setError('No chapters found in that PGN.');
      return;
    }
    const id = idHint ?? `study-${Date.now()}`;
    const s: StoredStudy = { id, name: parsed.name, source, pgn: text, addedAt: Date.now() };
    const next = [s, ...studies.filter((x) => x.id !== id)];
    setStudies(next);
    if (!saveStudies(next)) setError("Imported, but browser storage is full, so it won't be remembered after a reload.");
    setOpenId(id);
    setPgn('');
    setUrl('');
  }

  function toggleFeatured(s: StoredStudy) {
    setFeatMsg('');
    if (featuredIds.has(s.id)) {
      removeFromUserFeatured(s.id);
      setFeaturedIds((prev) => {
        const n = new Set(prev);
        n.delete(s.id);
        return n;
      });
      setFeatMsg(`Removed "${s.name}" from Featured studies.`);
    } else {
      const res = addToUserFeatured(s);
      if (!res.ok) {
        setError(res.error ?? 'Could not save to Featured.');
        return;
      }
      setFeaturedIds((prev) => new Set(prev).add(s.id));
      setFeatMsg(`"${s.name}" is now in Featured studies (Studies tab).`);
    }
  }

  async function importFromUrl() {
    const id = extractStudyId(url);
    if (!id) return setError('Paste a Lichess study link, e.g. https://lichess.org/study/abcd1234');
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`https://lichess.org/api/study/${id}.pgn`);
      if (res.status === 404) throw new Error('Study not found — it may be private. Private studies can\'t be imported by link; paste the PGN instead.');
      if (res.status === 429) throw new Error('Lichess rate limit hit — wait a minute and try again.');
      if (!res.ok) throw new Error(`Lichess returned ${res.status}.`);
      addStudy(await res.text(), `https://lichess.org/study/${id}`, id);
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith('Study') ? e.message : e instanceof Error && /Lichess/.test(e.message) ? e.message : 'Could not reach Lichess from the browser. Download the study PGN on Lichess (Share → Study PGN) and paste or upload it below.');
    } finally {
      setLoading(false);
    }
  }

  const open = studies.find((s) => s.id === openId) ?? null;
  if (open) {
    return (
      <StudyViewer key={open.id} name={open.name} getChapters={() => parseStudyPgn(open.pgn).chapters} onBack={() => setOpenId(null)} />
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen size={20} className="text-brand-400" />
        <h2 className="text-xl font-bold">Import your own study</h2>
      </div>

      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-ink-300">Import a Lichess study</h3>
        <div className="flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && importFromUrl()}
            placeholder="https://lichess.org/study/…"
            className="flex-1 rounded-lg bg-ink-800 border border-ink-700 text-ink-100 text-sm px-3 py-2 placeholder:text-ink-500" />
          <button onClick={importFromUrl} disabled={loading || !url.trim()} className="btn-primary text-sm disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Import
          </button>
        </div>
        <p className="text-xs text-ink-500">Works with public studies. For private ones, or if the import is blocked, paste or upload the PGN below.</p>

        <textarea value={pgn} onChange={(e) => setPgn(e.target.value)} rows={4}
          placeholder="…or paste study PGN here (all chapters)"
          className="w-full rounded-lg bg-ink-800 border border-ink-700 text-ink-100 text-xs font-mono px-3 py-2 placeholder:text-ink-500" />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => addStudy(pgn)} disabled={!pgn.trim()} className="btn-secondary text-sm disabled:opacity-50">Import PGN</button>
          <label className="btn-secondary text-sm cursor-pointer">
            <FileUp size={14} /> Upload .pgn
            <input type="file" accept=".pgn,.txt" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) addStudy(await f.text());
              e.target.value = '';
            }} />
          </label>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        {featMsg && !error && <p className="text-sm text-brand-300">{featMsg}</p>}
      </div>

      <div className="card p-2">
        {studies.length === 0 ? (
          <p className="text-sm text-ink-500 p-3">No studies yet. Import one above — chapters, comments and variations are kept.</p>
        ) : studies.map((s) => {
          const isFeat = featuredIds.has(s.id);
          return (
            <div key={s.id} className="flex items-center">
              <button onClick={() => setOpenId(s.id)} className="flex-1 min-w-0 flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-ink-700/50 transition-colors">
                <BookOpen size={15} className="text-brand-400 shrink-0" />
                <span className="flex-1 truncate text-sm text-ink-100">{s.name}</span>
                <span className="text-xs text-ink-500 shrink-0">{new Date(s.addedAt).toLocaleDateString()}</span>
              </button>
              <button
                onClick={() => toggleFeatured(s)}
                className={`p-2 ${isFeat ? 'text-brand-300 hover:text-brand-200' : 'text-ink-500 hover:text-brand-300'}`}
                title={isFeat ? 'Remove from Featured studies' : 'Save to Featured studies'}
                aria-label={isFeat ? `Remove ${s.name} from Featured` : `Save ${s.name} to Featured`}
              >
                <Sparkles size={14} className={isFeat ? 'fill-current' : ''} />
              </button>
              <button onClick={() => {
                if (!window.confirm(`Delete "${s.name}"?`)) return;
                if (featuredIds.has(s.id)) {
                  removeFromUserFeatured(s.id);
                  setFeaturedIds((prev) => {
                    const n = new Set(prev);
                    n.delete(s.id);
                    return n;
                  });
                }
                const next = studies.filter((x) => x.id !== s.id);
                setStudies(next); saveStudies(next);
              }} className="p-2 text-ink-500 hover:text-red-300" title="Delete study" aria-label={`Delete ${s.name}`}>
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────── Study viewer (chapters list + chapter) ─────────────────────────────

export function StudyViewer({ name, getChapters, onBack, startAt }: { name: string; getChapters: () => StudyChapter[]; onBack: () => void; startAt?: string }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parsed = useMemo(() => ({ name, chapters: getChapters() }), []);
  const [ci, setCi] = useState(() => {
    if (!startAt) return 0;
    const i = parsed.chapters.findIndex((c) => c.name.toLowerCase().includes(startAt.toLowerCase()));
    return i < 0 ? 0 : i;
  });
  const chapter = parsed.chapters[ci];

  return (
    <div className="space-y-4">
      <div>
        <button onClick={onBack} className="text-xs text-ink-400 hover:text-ink-200 mb-1">← All studies</button>
        <h2 className="text-xl font-bold">{parsed.name}</h2>
        <p className="text-xs text-ink-500">{parsed.chapters.length} chapters</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4 sm:gap-6">
        {/* chapters */}
        <div>
          <select value={ci} onChange={(e) => setCi(Number(e.target.value))}
            className="lg:hidden w-full rounded-lg bg-ink-800 border border-ink-700 text-ink-100 text-sm px-3 py-2">
            {parsed.chapters.map((c, i) => <option key={c.id} value={i}>{i + 1}. {c.name}</option>)}
          </select>
          <div className="hidden lg:block card p-1 max-h-[640px] overflow-y-auto">
            {parsed.chapters.map((c, i) => (
              <button key={c.id} onClick={() => setCi(i)}
                className={`w-full flex gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${i === ci ? 'bg-brand-500/20 text-brand-200' : 'text-ink-300 hover:bg-ink-700/50'}`}>
                <span className="text-brand-400 font-mono text-xs pt-0.5 w-5 shrink-0">{i + 1}</span>
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        {chapter && (
          <ChapterView
            key={chapter.id}
            chapter={chapter}
            hasNext={ci < parsed.chapters.length - 1}
            onNext={() => setCi(ci + 1)}
          />
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── One chapter: board, tree, practice ─────────────────────────────

function ChapterView({ chapter, hasNext, onNext }: { chapter: StudyChapter; hasNext: boolean; onNext: () => void }) {
  const [curId, setCurId] = useState(0);
  const [flip, setFlip] = useState(false);
  const [mode, setMode] = useState<'view' | 'practice'>('view');
  const [side, setSide] = useState<'w' | 'b'>(chapter.orientation === 'white' ? 'w' : 'b');
  const [tempFen, setTempFen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const [arrow, setArrow] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [free, setFree] = useState<{ fen: string; last: { from: Square; to: Square } | null } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [elo, setElo] = useState(1400);
  const run = useRef(0);
  const treeRef = useRef<HTMLDivElement>(null);

  const entry = chapter.index.get(curId)!;
  const node = entry.node;
  const parent = entry.parent;
  const turn: 'w' | 'b' = node.fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const done = node.children.length === 0;

  const baseOrientation = chapter.orientation;
  const orientation: 'white' | 'black' =
    mode === 'practice'
      ? side === 'w' ? 'white' : 'black'
      : flip ? (baseOrientation === 'white' ? 'black' : 'white') : baseOrientation;

  const nodeLast = node.from && node.to ? { from: node.from, to: node.to } : null;
  const fen = free?.fen ?? tempFen ?? node.fen;
  const lastMove = free ? free.last : nodeLast;

  // keyboard navigation (view mode)
  useEffect(() => {
    if (mode !== 'view') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      const cur = chapter.index.get(curId)!;
      if (e.key === 'ArrowRight' && cur.node.children[0]) { e.preventDefault(); setCurId(cur.node.children[0].id); }
      else if (e.key === 'ArrowLeft' && cur.parent) { e.preventDefault(); setCurId(cur.parent.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, curId, chapter]);

  // keep the active move visible in the tree
  useEffect(() => {
    treeRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [curId, mode]);

  // practice: computer plays its side of the study
  useEffect(() => {
    if (mode !== 'practice' || free || done || turn === side || busy) return;
    const my = run.current;
    const t = window.setTimeout(() => {
      if (my !== run.current) return;
      setCurId(node.children[0].id);
      setArrow(null);
    }, 550);
    return () => window.clearTimeout(t);
  }, [mode, free, done, turn, side, busy, node]);

  const viewLogged = useRef(false);
  useEffect(() => {
    if (mode === 'view' && done && curId !== 0 && !viewLogged.current) {
      viewLogged.current = true;
      logEvent('lesson');
    }
  }, [mode, done, curId]);

  useEffect(() => {
    if (mode === 'practice' && done && !free) {
      logEvent('lesson');
      setFeedback({
        tone: 'good',
        text: mistakes === 0 ? 'Chapter complete — no mistakes! 🎉' : `Chapter complete with ${mistakes} mistake${mistakes === 1 ? '' : 's'}. Run it again to clean it up.`,
      });
    }
  }, [mode, done, free, curId]); // eslint-disable-line react-hooks/exhaustive-deps

  function startPractice(s: 'w' | 'b' = side) {
    run.current++;
    setMode('practice');
    setSide(s);
    setCurId(0);
    setMistakes(0);
    setFree(null);
    setTempFen(null);
    setBusy(false);
    setThinking(false);
    setFeedback(null);
    setArrow(null);
  }

  function startView() {
    run.current++;
    setMode('view');
    setFree(null);
    setTempFen(null);
    setBusy(false);
    setThinking(false);
    setFeedback(null);
    setArrow(null);
  }

  async function engineReply(f: string) {
    const my = run.current;
    const over = gameOverText(f);
    if (over) { setFeedback({ tone: 'info', text: over }); return; }
    setThinking(true);
    const [mv] = await Promise.all([pickComputerMove(f, elo).catch(() => null), sleep(300)]);
    if (my !== run.current) return;
    setThinking(false);
    if (!mv) return;
    setFree({ fen: mv.fen, last: { from: mv.from, to: mv.to } });
    const over2 = gameOverText(mv.fen);
    if (over2) setFeedback({ tone: 'info', text: over2 });
  }

  async function handleUserMove(m: { from: Square; to: Square; promotion?: string; san: string; fen: string }) {
    if (mode !== 'practice' || busy || thinking) return;
    if (free) {
      setFree({ fen: m.fen, last: { from: m.from, to: m.to } });
      engineReply(m.fen);
      return;
    }
    if (done || turn !== side) return;
    const uci = m.from + m.to + (m.promotion ?? '');
    const idx = node.children.findIndex((c) => c.uci === uci);
    if (idx >= 0) {
      setFeedback(idx > 0 ? { tone: 'info', text: 'Valid — that\'s one of the study\'s alternative lines.' } : null);
      setArrow(null);
      setCurId(node.children[idx].id);
      return;
    }
    const my = run.current;
    setBusy(true);
    setMistakes((x) => x + 1);
    setFeedback({ tone: 'bad', text: `${m.san} isn't in the study here — try again.` });
    setTempFen(m.fen);
    await sleep(700);
    if (my !== run.current) return;
    setTempFen(null);
    setBusy(false);
  }

  function goLast() {
    let n = node;
    while (n.children[0]) n = n.children[0];
    setCurId(n.id);
  }

  // path from the start to the current move (practice shows only this, no spoilers)
  const path: StudyNode[] = [];
  {
    let cur: { node: StudyNode; parent: StudyNode | null } | undefined = entry;
    while (cur && cur.node.id !== 0) {
      path.unshift(cur.node);
      cur = cur.parent ? chapter.index.get(cur.parent.id) : undefined;
    }
  }

  const chip = (n: StudyNode, active: boolean, clickable: boolean) => (
    <button
      key={n.id}
      data-active={active ? '1' : undefined}
      disabled={!clickable}
      onClick={() => setCurId(n.id)}
      className={`rounded px-1 py-0.5 ${active ? 'bg-brand-500/30 text-brand-100 font-semibold' : 'text-ink-100'} ${clickable ? 'hover:bg-ink-700/60' : 'cursor-default'}`}
    >
      {n.san}{n.nag}
    </button>
  );

  const renderLine = (p0: StudyNode, first: StudyNode): ReactNode[] => {
    const els: ReactNode[] = [];
    let p = p0;
    let n: StudyNode | undefined = first;
    let needNum = true;
    while (n) {
      const cur: StudyNode = n;
      const label = cur.color === 'w' ? `${cur.num}.` : needNum ? `${cur.num}…` : '';
      els.push(
        <span key={`m${cur.id}`} className="inline-flex items-baseline">
          {label && <span className="text-ink-500 text-xs mr-0.5">{label}</span>}
          {chip(cur, cur.id === curId, true)}
        </span>,
        ' ',
      );
      needNum = false;
      if (cur.comment) {
        els.push(
          <div key={`c${cur.id}`} className="my-1.5 rounded-md bg-ink-800/80 px-3 py-2 text-sm font-sans text-ink-200 leading-snug">{cur.comment}</div>,
        );
        needNum = true;
      }
      if (cur === p.children[0]) {
        for (const alt of p.children.slice(1)) {
          els.push(
            <div key={`v${alt.id}`} className="my-1 ml-2 pl-2 border-l-2 border-ink-700 text-ink-300">
              {renderLine(p, alt)}
            </div>,
          );
          needNum = true;
        }
      }
      p = cur;
      n = cur.children[0];
    }
    return els;
  };

  const interactive = mode === 'practice' && !busy && !thinking && (free ? true : !done && turn === side);
  const hint = () => { if (!done && turn === side && !free) setArrow(node.children[0].uci); };
  const currentComment = node.comment;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,560px)_1fr] gap-4 sm:gap-6 min-w-0">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="-mx-4 w-[calc(100%+2rem)] sm:mx-auto sm:w-full sm:max-w-[560px]">
          <ChessBoard
            fen={fen}
            orientation={orientation}
            lastMove={lastMove}
            bestMoveUci={arrow}
            interactive={interactive}
            onUserMove={handleUserMove}
            size={560}
          />
        </div>

        {mode === 'view' ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button className="btn-secondary px-2.5" onClick={() => setCurId(0)} disabled={curId === 0}><ChevronsLeft size={16} /></button>
            <button className="btn-secondary px-2.5" onClick={() => parent && setCurId(parent.id)} disabled={!parent}><ChevronLeft size={16} /></button>
            <button className="btn-secondary px-2.5" onClick={() => node.children[0] && setCurId(node.children[0].id)} disabled={done}><ChevronRight size={16} /></button>
            <button className="btn-secondary px-2.5" onClick={goLast} disabled={done}><ChevronsRight size={16} /></button>
            <button className="btn-ghost px-2.5" onClick={() => setFlip((f) => !f)} title="Flip board"><FlipVertical2 size={16} /></button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {!free && <button onClick={hint} disabled={done || turn !== side || busy} className="btn-secondary text-sm disabled:opacity-40"><Lightbulb size={14} /> Hint</button>}
            <button onClick={() => startPractice()} className="btn-secondary text-sm"><RotateCcw size={14} /> Restart</button>
            {thinking && <span className="text-xs text-ink-400">computer thinking…</span>}
          </div>
        )}
        {feedback && <FeedbackBanner tone={feedback.tone}>{feedback.text}</FeedbackBanner>}
      </div>

      <div className="flex flex-col gap-4 min-w-0">
        <div className="card p-4">
          <div className="flex gap-1 border-b border-ink-800 mb-3">
            <button onClick={startView}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 ${mode === 'view' ? 'border-brand-400 text-brand-300' : 'border-transparent text-ink-400 hover:text-ink-200'}`}>
              <GraduationCap size={15} /> Study
            </button>
            <button onClick={() => startPractice()}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 ${mode === 'practice' ? 'border-brand-400 text-brand-300' : 'border-transparent text-ink-400 hover:text-ink-200'}`}>
              <Swords size={15} /> Practice
            </button>
          </div>

          {chapter.error && <p className="text-xs text-amber-300 mb-2">{chapter.error}</p>}

          {mode === 'view' ? (
            <div ref={treeRef} className="max-h-[480px] overflow-y-auto pr-1 text-sm font-mono leading-7">
              {chapter.root.comment && (
                <div className="mb-2 rounded-md bg-ink-800/80 px-3 py-2 text-sm font-sans text-ink-200 leading-snug">{chapter.root.comment}</div>
              )}
              {chapter.root.children[0]
                ? renderLine(chapter.root, chapter.root.children[0])
                : <p className="text-ink-500 font-sans">This chapter has no moves.</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-ink-400 block mb-1">You play</label>
                <div className="flex gap-2">
                  <button onClick={() => startPractice('w')} className={`${side === 'w' ? 'btn-primary' : 'btn-secondary'} text-sm`}>White</button>
                  <button onClick={() => startPractice('b')} className={`${side === 'b' ? 'btn-primary' : 'btn-secondary'} text-sm`}>Black</button>
                </div>
              </div>
              <p className="text-sm text-ink-400">
                Play your side from memory. The computer answers with the study's main line; any of the study's variations is also accepted.
              </p>
              {!free && (
                <div ref={treeRef} className="text-sm font-mono leading-7">
                  {path.map((n, i) => (
                    <span key={n.id} className="inline-flex items-baseline mr-1">
                      {(n.color === 'w' || i === 0) && <span className="text-ink-500 text-xs mr-0.5">{n.num}{n.color === 'w' ? '.' : '…'}</span>}
                      {chip(n, i === path.length - 1, false)}
                    </span>
                  ))}
                  {currentComment && (
                    <div className="mt-2 rounded-md bg-ink-800/80 px-3 py-2 text-sm font-sans text-ink-200 leading-snug">{currentComment}</div>
                  )}
                </div>
              )}
              {done && !free && (
                <div className="rounded-lg border border-ink-700 p-3 space-y-2">
                  <p className="text-sm text-ink-200">Keep playing from this position against the engine?</p>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-ink-400">Computer strength</span>
                    <span className="font-mono text-brand-300">{elo}</span>
                  </div>
                  <input type="range" min={400} max={2800} step={100} value={elo} onChange={(e) => setElo(Number(e.target.value))} className="w-full accent-brand-500" />
                  <button className="btn-primary w-full justify-center text-sm" onClick={() => {
                    run.current++;
                    setFree({ fen: node.fen, last: nodeLast });
                    setFeedback({ tone: 'info', text: 'Out of the study — play on!' });
                    if (turn !== side) engineReply(node.fen);
                  }}>
                    <Swords size={14} /> Play on vs computer
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {hasNext && (
          <button onClick={onNext} className={`${mode === 'view' && done ? 'btn-primary' : 'btn-secondary'} w-full justify-center`}>
            <ChevronRight size={16} /> Next chapter
          </button>
        )}
      </div>
    </div>
  );
}