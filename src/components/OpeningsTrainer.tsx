// Place in src/components/OpeningsTrainer.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { ChessBoard } from './ChessBoard';
import { FeedbackBanner } from './PracticeBits';
import { BookWalker } from '@/lib/openings';
import { getOpeningCatalog, loadCustomLines, saveCustomLines, parseLine, type OpeningLine } from '@/lib/openings-catalog';
import { gameOverText, pickComputerMove, sleep } from '@/lib/practice';
import { ImportedStudies } from './StudiesTrainer';
import { BuiltinStudies } from './BuiltinStudies';
import { MastersGames } from './MastersGames';
import { logEvent } from '@/lib/activity';
import {
  BookOpen, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, X, Plus, Trash2,
  Lightbulb, RotateCcw, GraduationCap, Swords, ChevronDown, Trophy,
} from 'lucide-react';

const START = new Chess().fen();
const MAX_RESULTS = 80;

interface Frames {
  fens: string[]; // fens[k] = position after k plies
  sans: string[];
  moves: { from: Square; to: Square }[];
  names: ({ eco: string; name: string } | null)[]; // names[k-1] = opening name after ply k
}

function buildFrames(uci: string[]): Frames {
  const chess = new Chess();
  const fens = [START];
  const sans: string[] = [];
  const moves: { from: Square; to: Square }[] = [];
  const names: Frames['names'] = [];
  const walker = new BookWalker();
  let inBook = true;
  for (const u of uci) {
    const r = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
    fens.push(chess.fen());
    sans.push(r.san);
    moves.push({ from: r.from as Square, to: r.to as Square });
    if (inBook) inBook = walker.step(u);
    names.push(walker.current());
  }
  return { fens, sans, moves, names };
}

// ───────────────────────────── Browser ─────────────────────────────

/** Openings page: Lichess-style Studies + the opening library. */
export function OpeningsTrainer() {
  const [tab, setTab] = useState<'studies' | 'library' | 'import'>('studies');
  const [line, setLine] = useState<OpeningLine | null>(null);
  const tabCls = (t: string) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-brand-400 text-brand-300' : 'border-transparent text-ink-400 hover:text-ink-200'}`;
  return (
    <>
    {line && <LineTrainer key={line.id} line={line} onBack={() => setLine(null)} />}
    <div className={`space-y-5 ${line ? 'hidden' : ''}`}>
      <div className="flex gap-1 border-b border-ink-800">
        <button onClick={() => setTab('studies')} className={tabCls('studies')}>Studies</button>
        <button onClick={() => setTab('library')} className={tabCls('library')}>Quick lines</button>
        <button onClick={() => setTab('import')} className={tabCls('import')}>Import</button>
      </div>
      {tab === 'studies' ? <BuiltinStudies onOpenLine={setLine} /> : tab === 'library' ? <OpeningLibrary /> : <ImportedStudies />}
    </div>
    </>
  );
}

function OpeningLibrary() {
  const catalog = useMemo(() => getOpeningCatalog(), []);
  const [custom, setCustom] = useState<OpeningLine[]>(() => loadCustomLines());
  const [selected, setSelected] = useState<OpeningLine | null>(null);
  const [query, setQuery] = useState('');
  const [openFamily, setOpenFamily] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const families = useMemo(() => {
    const m = new Map<string, OpeningLine[]>();
    for (const l of catalog) {
      const arr = m.get(l.family) ?? [];
      arr.push(l);
      m.set(l.family, arr);
    }
    return [...m.entries()];
  }, [catalog]);

  if (selected) return <LineTrainer key={selected.id} line={selected} onBack={() => setSelected(null)} />;

  const q = query.trim().toLowerCase();
  const results = q
    ? [...custom, ...catalog].filter((l) => l.name.toLowerCase().includes(q) || l.eco.toLowerCase() === q)
    : [];

  const row = (l: OpeningLine) => (
    <button key={l.id} onClick={() => setSelected(l)}
      className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-700/50 transition-colors">
      <span className="font-mono text-xs text-ink-500 w-9 shrink-0">{l.custom ? '★' : l.eco}</span>
      <span className="flex-1 min-w-0 truncate text-ink-100">{l.name}</span>
      <span className="text-xs text-ink-500 shrink-0">{Math.ceil(l.uci.length / 2)} moves</span>
    </button>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen size={20} className="text-brand-400" />
        <h2 className="text-xl font-bold">Openings</h2>
        <span className="text-sm text-ink-500">({catalog.length} lines)</span>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search: Sicilian, Traxler, King's Gambit, B90…"
          className="w-full rounded-lg bg-ink-800 border border-ink-700 text-ink-100 text-sm pl-8 pr-8 py-2.5 placeholder:text-ink-500" />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-200" aria-label="Clear">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Custom lines */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-ink-300">My lines ({custom.length})</h3>
          <button onClick={() => setShowAdd((s) => !s)} className="btn-secondary text-xs px-2.5 py-1.5">
            <Plus size={13} /> Add line
          </button>
        </div>
        {showAdd && (
          <AddLine onSave={(l) => {
            const next = [l, ...custom];
            setCustom(next); saveCustomLines(next); setShowAdd(false);
          }} />
        )}
        {custom.length === 0 && !showAdd && (
          <p className="text-xs text-ink-500">Paste a line from a Lichess study or a book (e.g. the Traxler mainline) and train it here.</p>
        )}
        {custom.map((l) => (
          <div key={l.id} className="flex items-center">
            <div className="flex-1 min-w-0">{row(l)}</div>
            <button onClick={() => { const next = custom.filter((c) => c.id !== l.id); setCustom(next); saveCustomLines(next); }}
              className="p-1.5 text-ink-500 hover:text-red-300" title="Delete line" aria-label={`Delete ${l.name}`}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Library */}
      <div className="card p-2">
        {q ? (
          results.length === 0 ? (
            <p className="text-sm text-ink-500 p-3">No openings match "{query}".</p>
          ) : (
            <>
              {results.slice(0, MAX_RESULTS).map(row)}
              {results.length > MAX_RESULTS && <p className="text-xs text-ink-500 p-3">Showing {MAX_RESULTS} of {results.length} — narrow your search.</p>}
            </>
          )
        ) : (
          families.map(([family, lines]) => {
            const open = openFamily === family;
            return (
              <div key={family}>
                <button onClick={() => setOpenFamily(open ? null : family)}
                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-700/50 transition-colors">
                  <span className="font-mono text-xs text-ink-500 w-9 shrink-0">{lines[0].eco}</span>
                  <span className="flex-1 font-medium text-ink-100">{family}</span>
                  <span className="text-xs text-ink-500">{lines.length}</span>
                  <ChevronDown size={14} className={`text-ink-500 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && <div className="pl-4 border-l border-ink-700/60 ml-5 mb-1">{lines.map(row)}</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function AddLine({ onSave }: { onSave: (l: OpeningLine) => void }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="space-y-2 mb-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Traxler: Kg1 line)"
        className="w-full rounded-lg bg-ink-800 border border-ink-700 text-ink-100 text-sm px-3 py-2 placeholder:text-ink-500" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
        placeholder="1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 Bc5 5. Nxf7 Bxf2+ 6. Kf1 …"
        className="w-full rounded-lg bg-ink-800 border border-ink-700 text-ink-100 text-sm font-mono px-3 py-2 placeholder:text-ink-500" />
      {error && <p className="text-xs text-red-300">{error}</p>}
      <button className="btn-primary text-sm" onClick={() => {
        const uci = parseLine(text);
        if (!name.trim()) return setError('Give the line a name.');
        if (!uci) return setError('Could not read the moves — check for typos or an illegal move.');
        setError('');
        onSave({ id: `custom-${Date.now()}`, eco: '', name: name.trim(), family: name.trim(), variation: '', uci, custom: true });
      }}>Save line</button>
    </div>
  );
}

// ───────────────────────────── Trainer ─────────────────────────────

function LineTrainer({ line, onBack }: { line: OpeningLine; onBack: () => void }) {
  const frames = useMemo(() => buildFrames(line.uci), [line]);
  const total = line.uci.length;

  const [mode, setMode] = useState<'learn' | 'practice' | 'games'>('learn');
  const [side, setSide] = useState<'w' | 'b'>('w');
  const [k, setK] = useState(0); // plies played
  const [fen, setFen] = useState(START);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [arrow, setArrow] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [free, setFree] = useState(false); // after the line: keep playing vs the engine
  const [thinking, setThinking] = useState(false);
  const [elo, setElo] = useState(1400);
  const run = useRef(0);
  const learnLogged = useRef(false);

  const orientation = side === 'w' ? 'white' : 'black';
  const userTurn = (k % 2 === 0 ? 'w' : 'b') === side;
  const done = k >= total;

  function goTo(n: number) {
    const c = Math.max(0, Math.min(total, n));
    if (c === total && total > 0 && !learnLogged.current) {
      learnLogged.current = true;
      logEvent('lesson');
    }
    setK(c);
    setFen(frames.fens[c]);
    setLastMove(c > 0 ? frames.moves[c - 1] : null);
    setArrow(null);
  }

  function startPractice(s: 'w' | 'b' = side) {
    run.current++;
    setMode('practice');
    setSide(s);
    setMistakes(0);
    setFree(false);
    setBusy(false);
    setThinking(false);
    setFeedback(null);
    setK(0);
    setFen(START);
    setLastMove(null);
    setArrow(null);
  }

  function startLearn() {
    run.current++;
    setMode('learn');
    setFree(false);
    setThinking(false);
    setFeedback(null);
    goTo(0);
  }

  // Practice: the computer plays its side of the book line
  useEffect(() => {
    if (mode !== 'practice' || free || done || userTurn || busy) return;
    const my = run.current;
    const t = window.setTimeout(() => {
      if (my !== run.current) return;
      setK(k + 1);
      setFen(frames.fens[k + 1]);
      setLastMove(frames.moves[k]);
      setArrow(null);
    }, 550);
    return () => window.clearTimeout(t);
  }, [mode, free, done, userTurn, busy, k, frames]);

  // Practice: line finished
  useEffect(() => {
    if (mode === 'practice' && done && !free) {
      logEvent('lesson');
      setFeedback({
        tone: 'good',
        text: mistakes === 0 ? 'Line complete — perfect, no mistakes! 🎉' : `Line complete with ${mistakes} mistake${mistakes === 1 ? '' : 's'}. Run it again to clean it up.`,
      });
    }
  }, [mode, done, free]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUserMove(m: { from: Square; to: Square; promotion?: string; san: string; fen: string }) {
    if (mode !== 'practice' || busy) return;

    // After the book line ends: normal game against the engine
    if (free) {
      const my = run.current;
      setFen(m.fen);
      setLastMove({ from: m.from, to: m.to });
      const over = gameOverText(m.fen);
      if (over) { setFeedback({ tone: 'info', text: over }); return; }
      setThinking(true);
      const [mv] = await Promise.all([pickComputerMove(m.fen, elo).catch(() => null), sleep(300)]);
      if (my !== run.current) return;
      setThinking(false);
      if (!mv) return;
      setFen(mv.fen);
      setLastMove({ from: mv.from, to: mv.to });
      const over2 = gameOverText(mv.fen);
      if (over2) setFeedback({ tone: 'info', text: over2 });
      return;
    }

    if (done || !userTurn) return;
    const uci = m.from + m.to + (m.promotion ?? '');
    if (uci === line.uci[k]) {
      setFeedback(null);
      setArrow(null);
      setK(k + 1);
      setFen(frames.fens[k + 1]);
      setLastMove(frames.moves[k]);
      return;
    }
    // Not the book move: show it briefly, then put it back
    const my = run.current;
    setBusy(true);
    setMistakes((x) => x + 1);
    setFeedback({ tone: 'bad', text: `${m.san} isn't the book move here — try again.` });
    setFen(m.fen);
    setLastMove({ from: m.from, to: m.to });
    await sleep(700);
    if (my !== run.current) return;
    setFen(frames.fens[k]);
    setLastMove(k > 0 ? frames.moves[k - 1] : null);
    setBusy(false);
  }

  function showHint() {
    if (done || !userTurn) return;
    setArrow(line.uci[k]);
  }

  const shown = mode === 'learn' ? k : k;
  const nameNow = shown > 0 ? frames.names[shown - 1] : null;
  const nextSan = k < total ? frames.sans[k] : null;

  // move list
  const pairs: { n: number; w?: number; b?: number }[] = [];
  frames.sans.forEach((_, i) => {
    const n = Math.floor(i / 2);
    pairs[n] ??= { n: n + 1 };
    if (i % 2 === 0) pairs[n].w = i; else pairs[n].b = i;
  });
  const cell = (i?: number) => {
    if (i === undefined) return <span />;
    const visible = mode === 'learn' || i < k;
    if (!visible) return <span className="text-ink-700">·</span>;
    const active = i === k - 1;
    return (
      <button onClick={() => mode === 'learn' && goTo(i + 1)} disabled={mode !== 'learn'}
        className={`text-left rounded px-1 ${active ? 'bg-brand-500/25 text-brand-200' : 'text-ink-100'} ${mode === 'learn' ? 'hover:bg-ink-700/60' : 'cursor-default'}`}>
        {frames.sans[i]}
      </button>
    );
  };

  const tabBtn = (active: boolean) =>
    `flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 ${active ? 'border-brand-400 text-brand-300' : 'border-transparent text-ink-400 hover:text-ink-200'}`;
  const tabBar = (
    <div className="flex gap-1 mt-4 border-b border-ink-800">
      <button onClick={startLearn} className={tabBtn(mode === 'learn')}><GraduationCap size={15} /> Learn</button>
      <button onClick={() => startPractice()} className={tabBtn(mode === 'practice')}><Swords size={15} /> Practice</button>
      <button onClick={() => { run.current++; setThinking(false); setFeedback(null); setMode('games'); }} className={tabBtn(mode === 'games')}>
        <Trophy size={15} /> GM games
      </button>
    </div>
  );

  if (mode === 'games') {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="card p-4">
          <button onClick={onBack} className="text-xs text-ink-400 hover:text-ink-200 mb-1 flex items-center gap-1">← All openings</button>
          <h2 className="text-lg font-bold leading-tight">{line.name}</h2>
          <p className="text-xs text-ink-500 font-mono mt-0.5">{line.eco || 'Custom'} · {Math.ceil(total / 2)} moves</p>
          {tabBar}
        </div>
        <MastersGames uci={line.uci} orientation={orientation} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,560px)_1fr] gap-4 sm:gap-6">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="-mx-4 w-[calc(100%+2rem)] sm:mx-auto sm:w-full sm:max-w-[560px]">
          <ChessBoard
            fen={fen}
            orientation={orientation}
            lastMove={lastMove}
            bestMoveUci={arrow ?? (mode === 'learn' && k < total ? line.uci[k] : null)}
            interactive={mode === 'practice' && !busy && (free ? !thinking : !done && userTurn)}
            onUserMove={handleUserMove}
            size={560}
          />
        </div>

        {mode === 'learn' ? (
          <div className="flex items-center justify-center gap-2">
            <button className="btn-secondary px-2.5" onClick={() => goTo(0)} disabled={k === 0}><ChevronsLeft size={16} /></button>
            <button className="btn-secondary px-2.5" onClick={() => goTo(k - 1)} disabled={k === 0}><ChevronLeft size={16} /></button>
            <span className="px-3 font-mono text-sm text-ink-400">{k} / {total}</span>
            <button className="btn-secondary px-2.5" onClick={() => goTo(k + 1)} disabled={k >= total}><ChevronRight size={16} /></button>
            <button className="btn-secondary px-2.5" onClick={() => goTo(total)} disabled={k >= total}><ChevronsRight size={16} /></button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {!free && <button onClick={showHint} disabled={done || !userTurn || busy} className="btn-secondary text-sm disabled:opacity-40"><Lightbulb size={14} /> Hint</button>}
            <button onClick={() => startPractice()} className="btn-secondary text-sm"><RotateCcw size={14} /> Restart</button>
            {thinking && <span className="text-xs text-ink-400">computer thinking…</span>}
          </div>
        )}
        {feedback && <FeedbackBanner tone={feedback.tone}>{feedback.text}</FeedbackBanner>}
      </div>

      <div className="flex flex-col gap-4">
        <div className="card p-4">
          <button onClick={onBack} className="text-xs text-ink-400 hover:text-ink-200 mb-1 flex items-center gap-1">← All openings</button>
          <h2 className="text-lg font-bold leading-tight">{line.name}</h2>
          <p className="text-xs text-ink-500 font-mono mt-0.5">{line.eco || 'Custom'} · {Math.ceil(total / 2)} moves</p>
          {nameNow && nameNow.name !== line.name && (
            <p className="text-xs text-ink-400 mt-2 flex items-center gap-1.5">
              <BookOpen size={12} className="text-[#a88865]" /> Now: {nameNow.name}
            </p>
          )}

          {tabBar}

          {mode === 'learn' ? (
            <p className="text-sm text-ink-400 mt-3">
              Step through the line. The green arrow shows the next book move{nextSan ? <> (<span className="font-mono text-ink-200">{nextSan}</span>)</> : ''}.
              Switch to <b>Practice</b> when you're ready to play it from memory.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs text-ink-400 block mb-1">You play</label>
                <div className="flex gap-2">
                  <button onClick={() => startPractice('w')} className={`${side === 'w' ? 'btn-primary' : 'btn-secondary'} text-sm`}>White</button>
                  <button onClick={() => startPractice('b')} className={`${side === 'b' ? 'btn-primary' : 'btn-secondary'} text-sm`}>Black</button>
                </div>
              </div>
              <p className="text-sm text-ink-400">
                The computer plays the other side of the line. Play the book moves from memory — wrong moves are taken back.
              </p>
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
                    setFree(true);
                    setFeedback({ tone: 'info', text: 'Out of book — play on! Take it as far as you can.' });
                    // if it's the computer's move, let it play
                    if (!userTurn) {
                      const my = run.current;
                      setThinking(true);
                      pickComputerMove(fen, elo).catch(() => null).then((mv) => {
                        if (my !== run.current) return;
                        setThinking(false);
                        if (!mv) return;
                        setFen(mv.fen);
                        setLastMove({ from: mv.from, to: mv.to });
                      });
                    }
                  }}>
                    <Swords size={14} /> Play on vs computer
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-semibold text-ink-300 mb-2">Moves</h3>
          <div className="grid grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-1 text-sm font-mono">
            {pairs.map((p) => (
              <div key={p.n} className="contents">
                <span className="text-ink-500">{p.n}.</span>
                {cell(p.w)}
                {cell(p.b)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
