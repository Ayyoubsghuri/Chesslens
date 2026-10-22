import { useEffect, useMemo, useRef, useState } from 'react';
import type { Square } from 'chess.js';
import {
  Play, Pause, RotateCcw, SkipBack, SkipForward, ChevronsLeft, ChevronsRight, Sparkles, Loader2,
  Volume2, VolumeX, Filter, AlertTriangle,
} from 'lucide-react';
import type { AnalyzedMove } from '@/lib/types';
import { sceneDuration, plainText, type CoachLevel, type Seg } from '@/lib/coach-explain';
import {
  prepareGameBeats, flattenBeats, deepenBeat, sameGameScene,
  type GameBeat, type GameScene, type GameDetail, type TimelineItem,
} from '@/lib/coach-game';
import { speak, unlockSpeech, squareCues, litSquares } from '@/lib/tts';

/* ------------------------------------------------------------------ */
/* Mode switch: one move (the existing AdvancedCoach) or the whole game */
/* ------------------------------------------------------------------ */

export type CoachMode = 'move' | 'game';

export function CoachModeTabs({ mode, onChange }: { mode: CoachMode; onChange: (m: CoachMode) => void }) {
  const tab = (m: CoachMode, text: string) => (
    <button
      onClick={() => onChange(m)}
      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
        mode === m ? 'bg-brand-500 text-ink-900' : 'text-ink-300 hover:bg-ink-700/70'
      }`}
      aria-pressed={mode === m}
    >
      {text}
    </button>
  );
  return (
    <div className="mt-2 flex gap-1 rounded-xl border border-ink-700/60 bg-ink-800/70 p-1">
      {tab('move', 'This move')}
      {tab('game', 'Whole game')}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const QUALITY_COLOR: Record<string, { label: string; color: string }> = {
  brilliant: { label: 'Brilliant', color: '#26c2a3' }, best: { label: 'Best', color: '#81b64c' },
  great: { label: 'Great', color: '#749bbf' }, excellent: { label: 'Excellent', color: '#96bc4b' },
  good: { label: 'Good', color: '#95b3b8' }, book: { label: 'Book', color: '#a88865' },
  inaccuracy: { label: 'Inaccuracy', color: '#f7c631' }, mistake: { label: 'Mistake', color: '#ffa459' },
  miss: { label: 'Miss', color: '#e040fb' }, blunder: { label: 'Blunder', color: '#fa412d' },
};

function Text({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) =>
        s.hl === 'key' ? <b key={i} className="text-brand-300">{s.t}</b>
        : s.hl === 'good' ? <b key={i} className="text-brand-400">{s.t}</b>
        : s.hl === 'bad' ? <b key={i} className="text-red-400">{s.t}</b>
        : <span key={i}>{s.t}</span>,
      )}
    </>
  );
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

interface SpokenState { idx: number; named: Square[]; current: Square[]; done: boolean }

interface Props {
  moves: AnalyzedMove[];
  /** The game move the board is on right now. */
  currentIndex: number;
  onIndexChange: (i: number) => void;
  /** True while a preview (scene) is on the board, so we notice when the user presses "Back". */
  previewActive: boolean;
  /** Puts a scene on the board (null = the real game position). Same callback AdvancedCoach uses. */
  onScene: (scene: GameScene | null) => void;
  /** Which side the student played. null = narrate "White" and "Black". */
  you?: 'w' | 'b' | null;
  level?: CoachLevel;
  depth: number;
  compact?: boolean;
  voice?: boolean;
  voiceName?: string;
  /** Player names, so the coach can ask "which one are you?" while `you` is still unknown. */
  names?: { white: string; black: string };
  /** The student picked their side: the app saves that name as the user. */
  onPickYou?: (side: 'w' | 'b') => void;
}

/**
 * Whole-game coach: plays the entire game as a spoken-style review.
 *  - every move gets a reaction + why (good moves short, mistakes long)
 *  - mistakes are deepened in the background with the engine (threats, danger, missed shots, why-not-the-others)
 *  - "Highlights" skips the good moves, "Next mistake" jumps straight to the next one
 */
export function GameCoach({
  moves, currentIndex, onIndexChange, previewActive, onScene, you = null, level, depth, compact, voice = false, voiceName, names, onPickYou,
}: Props) {
  const [detail, setDetail] = useState<GameDetail>('every');
  // The review is built in small slices (not in one blocking pass), so the page stays alive and shows a loading bar.
  const [beats, setBeats] = useState<GameBeat[]>([]);
  const [building, setBuilding] = useState(moves.length > 0);
  const [buildFrac, setBuildFrac] = useState(0);
  useEffect(() => {
    let dead = false;
    setBeats([]); setBuilding(moves.length > 0); setBuildFrac(0);
    if (!moves.length) return;
    prepareGameBeats(moves, { you, level, depth, detail }, (f) => { if (!dead) setBuildFrac(f); }, () => dead)
      .then((b) => { if (!dead && b) { setBeats(b); setBuilding(false); } })
      .catch(() => { if (!dead) setBuilding(false); });
    return () => { dead = true; };
  }, [moves, you, level, depth, detail]);
  const [deep, setDeep] = useState<Record<string, GameScene[]>>({});
  const [deepBusy, setDeepBusy] = useState<string | null>(null);
  const timeline = useMemo<TimelineItem[]>(() => flattenBeats(beats, deep), [beats, deep]);

  const [idx, setIdx] = useState(0);
  const [prog, setProg] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [spoken, setSpoken] = useState<SpokenState | null>(null);
  const speaking = voice && !muted;

  const tlRef = useRef(timeline); tlRef.current = timeline;
  const idxRef = useRef(idx); idxRef.current = idx;
  const startedRef = useRef(started); startedRef.current = started;
  const curIndexRef = useRef(currentIndex); curIndexRef.current = currentIndex;
  const sawActive = useRef(false);
  const commanded = useRef<number | null>(null);
  const deepGen = useRef(0);
  const inflight = useRef<Set<string>>(new Set());
  const prevTl = useRef<TimelineItem[]>(timeline);

  const item = timeline[Math.min(idx, timeline.length - 1)];
  const beatsById = useMemo(() => new Map(beats.map((b) => [b.id, b])), [beats]);

  // New game / new settings -> start over.
  useEffect(() => {
    deepGen.current++;
    inflight.current.clear();
    setDeep({});
    setDeepBusy(null);
    setIdx(0); setProg(0); setPlaying(false);
    if (startedRef.current) onScene(null);
    setStarted(false);
    setSpoken(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves, detail, you]);

  // Leaving: clear the preview.
  useEffect(() => () => { if (startedRef.current) onScene(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When the timeline changes under us (a deep dive arrived), stay on the same step.
  useEffect(() => {
    const old = prevTl.current[Math.min(idxRef.current, prevTl.current.length - 1)];
    prevTl.current = timeline;
    if (!old || !startedRef.current) return;
    let ni = timeline.findIndex((t) => t.beatId === old.beatId && sameGameScene(t.scene, old.scene));
    if (ni < 0) { const first = timeline.findIndex((t) => t.beatId === old.beatId && t.firstOfBeat); ni = first >= 0 ? first + 1 : idxRef.current; }
    if (ni !== idxRef.current) setIdx(Math.max(0, Math.min(timeline.length - 1, ni)));
  }, [timeline]);

  // 1) Move the game to the move this step is about.
  useEffect(() => {
    if (!started || !item) return;
    if (curIndexRef.current !== item.moveIndex) {
      sawActive.current = false; // the parent clears its preview when the move changes: that is not a "Back" press
      commanded.current = item.moveIndex;
      onIndexChange(item.moveIndex);
    } else commanded.current = item.moveIndex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, idx, item?.key]);

  // 2) Show the scene once the board is on that move. Deferred one tick: the parent clears its preview in an effect when the move changes.
  useEffect(() => {
    if (!started || !item || currentIndex !== item.moveIndex) return;
    const sp = spoken && spoken.idx === idx ? { named: spoken.named, current: spoken.current, done: spoken.done } : undefined;
    const t = window.setTimeout(() => {
      if (item.scene.plain) { sawActive.current = false; onScene(null); }
      else onScene({ ...item.scene, ...(sp ? { spoken: sp } : {}) });
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, idx, item?.key, currentIndex, spoken, timeline]);

  // The player moved the game themselves (arrow keys, move list): stop, they are driving now.
  useEffect(() => {
    if (!startedRef.current) return;
    if (commanded.current !== null && currentIndex !== commanded.current) {
      setPlaying(false); setStarted(false); onScene(null); commanded.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // "Back" closes the preview -> pause.
  useEffect(() => {
    if (!started) return;
    if (previewActive) sawActive.current = true;
    else if (sawActive.current) { setPlaying(false); sawActive.current = false; }
  }, [previewActive, started]);

  // Scene timer. With voice on, a scene lasts exactly as long as the sentence.
  useEffect(() => {
    if (!playing) return;
    const sc = tlRef.current[idx]?.scene;
    if (!sc) return;
    let cancelled = false;
    let handle: { cancel: () => void } | null = null;
    let interval: number | undefined;
    let gap: number | undefined;
    const advance = () => {
      if (cancelled) return;
      if (idx < tlRef.current.length - 1) { setIdx((i) => i + 1); setProg(0); } else { setPlaying(false); setProg(1); }
    };
    const runTimer = () => {
      const dur = sceneDuration(sc);
      const t0 = performance.now() - prog * dur;
      interval = window.setInterval(() => {
        const p = (performance.now() - t0) / dur;
        if (p < 1) { setProg(p); return; }
        window.clearInterval(interval);
        advance();
      }, 60);
    };
    if (!speaking) { setSpoken(null); runTimer(); }
    else {
      setVoiceBusy(true); setVoiceError(null);
      const text = plainText(sc.text);
      const cues = squareCues(text);
      const all = [...new Set(cues.map((c: any) => c.square))] as Square[];
      let furthest = 0;
      setSpoken({ idx, named: [], current: [], done: false });
      const h = speak(text, voiceName, {
        onStart: () => { if (!cancelled) setVoiceBusy(false); },
        onProgress: (p: number) => { if (!cancelled) setProg(p); },
        onWord: (i: number) => {
          if (cancelled || i < furthest) return;
          furthest = i;
          const l = litSquares(cues, i);
          setSpoken((prev) => prev && prev.idx === idx && !prev.done && sameList(prev.named, l.named) && sameList(prev.current, l.current)
            ? prev : { idx, named: l.named as Square[], current: l.current as Square[], done: false });
        },
      });
      handle = h;
      h.done
        .then(() => { if (cancelled) return; setVoiceBusy(false); setSpoken({ idx, named: all, current: [], done: true }); gap = window.setTimeout(advance, 350); })
        .catch((e: any) => { if (cancelled) return; setVoiceBusy(false); setSpoken(null); setVoiceError(e?.message ? String(e.message).slice(0, 80) : 'Voice unavailable'); runTimer(); });
    }
    return () => { cancelled = true; window.clearInterval(interval); window.clearTimeout(gap); handle?.cancel(); setVoiceBusy(false); setSpoken(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, idx, speaking, voiceName]);

  useEffect(() => { if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); }, [muted]);

  // Look-ahead on mistakes: deepen the beat we are on and the next bad beat, in the background, one at a time.
  useEffect(() => {
    if (!started || !item) return;
    const here = beats.findIndex((b) => b.id === item.beatId);
    const wanted = beats.filter((b, i) => i >= here && b.kind === 'bad' && b.deepInput && !deep[b.id]).slice(0, 2);
    if (!wanted.length || deepBusy) return;
    const b = wanted[0];
    if (inflight.current.has(b.id)) return;
    inflight.current.add(b.id);
    const gen = deepGen.current;
    setDeepBusy(b.id);
    deepenBeat(b, () => deepGen.current !== gen)
      .then((body) => { if (deepGen.current === gen && body) setDeep((p) => ({ ...p, [b.id]: body })); })
      .catch(() => {})
      .finally(() => { if (deepGen.current === gen) { inflight.current.delete(b.id); setDeepBusy(null); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, item?.beatId, deep, deepBusy, beats]);

  /* ----------------------------- controls ----------------------------- */

  function start(at = 0) {
    unlockSpeech();
    setStarted(true); setIdx(at); setProg(0); setPlaying(true);
  }
  function togglePlay() {
    unlockSpeech();
    if (!timeline.length) return;
    if (!started) { start(0); return; }
    if (!playing && idx === timeline.length - 1 && prog >= 1) { setIdx(0); setProg(0); }
    setPlaying((p) => !p);
  }
  function go(i: number, play = false) {
    unlockSpeech();
    if (!started) setStarted(true);
    setIdx(Math.max(0, Math.min(timeline.length - 1, i)));
    setProg(0); setPlaying(play);
  }
  const beatStart = (beatIndex: number) => Math.max(0, timeline.findIndex((t) => t.beatIndex === beatIndex && t.firstOfBeat));
  const curBeat = item ? item.beatIndex : 0;
  const jumpBeat = (delta: number) => go(beatStart(Math.max(0, Math.min(beats.length - 1, curBeat + delta))), true);
  function jumpBad(dir: 1 | -1) {
    let b = curBeat + dir;
    while (b >= 0 && b < beats.length && beats[b].kind !== 'bad') b += dir;
    if (b >= 0 && b < beats.length) go(beatStart(b), true);
  }
  const hasBadAhead = beats.some((b, i) => i > curBeat && b.kind === 'bad');
  const hasBadBehind = beats.some((b, i) => i < curBeat && b.kind === 'bad');

  if (building) {
    return (
      <div className="mt-2 w-full min-w-0 max-w-full overflow-hidden rounded-xl bg-ink-800/70 border border-ink-700/60 p-3" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-xs text-ink-300">
          <Loader2 size={14} className="animate-spin text-brand-400" />
          <span className="font-semibold">Game coach</span>
          <span className="text-ink-400">Preparing the review of your game…</span>
          <span className="ml-auto font-mono text-ink-400">{Math.round(buildFrac * 100)}%</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-ink-700 overflow-hidden">
          <div className="h-full bg-brand-500 transition-[width] duration-100" style={{ width: `${Math.max(4, buildFrac * 100)}%` }} />
        </div>
      </div>
    );
  }
  if (!moves.length || !timeline.length || !item) return null;
  const scene = item.scene;
  const beat = beatsById.get(item.beatId);
  const q = beat?.quality ?? scene.quality;
  const total = timeline.length;
  const overall = Math.min(1, (idx + (started ? prog : 0)) / total);
  const btn = 'flex items-center justify-center rounded-lg bg-ink-700/60 hover:bg-ink-600/70 text-ink-200 transition-colors disabled:opacity-40 w-9 h-9';
  const badCount = beats.filter((b) => b.kind === 'bad').length;

  return (
    <div className="mt-2 w-full min-w-0 max-w-full overflow-hidden rounded-xl bg-ink-800/70 border border-ink-700/60 p-3">
      {you === null && names && onPickYou && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-ink-700/40 px-2 py-1.5 text-xs text-ink-300">
          <span>Which player are you?</span>
          <button onClick={() => onPickYou('w')} className="max-w-[9rem] truncate rounded-md bg-ink-700/70 px-2 py-1 text-ink-100 hover:bg-ink-600/70">
            {names.white}
          </button>
          <button onClick={() => onPickYou('b')} className="max-w-[9rem] truncate rounded-md bg-ink-700/70 px-2 py-1 text-ink-100 hover:bg-ink-600/70">
            {names.black}
          </button>
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2 mb-2 text-xs text-ink-400">
        <Sparkles size={13} className="shrink-0 text-brand-400" />
        <span className="shrink-0 font-semibold text-ink-300">Game coach</span>
        {scene.chip && <span className="min-w-0 truncate rounded-md bg-ink-700/70 px-1.5 py-0.5 font-mono text-[11px] text-ink-200">{scene.chip}</span>}
        {started && q && QUALITY_COLOR[q] && (
          <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: QUALITY_COLOR[q].color + '30', color: QUALITY_COLOR[q].color }}>
            {QUALITY_COLOR[q].label}
          </span>
        )}
        {voice && (
          <button onClick={() => setMuted((m) => !m)} className="ml-1 rounded-md p-1 text-ink-300 hover:bg-ink-700/70" aria-label={muted ? 'Turn voice on' : 'Turn voice off'}>
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} className="text-brand-400" />}
          </button>
        )}
        <span className="ml-auto shrink-0 font-mono">{started ? `${idx + 1}/${total}` : `${total} steps`}</span>
      </div>

      <p className={`${compact ? 'text-sm' : 'text-[15px]'} leading-snug text-ink-100 min-h-[1.5em] sm:min-h-[4.2em]`} aria-live="polite">
        <Text segs={scene.text} />
      </p>

      {/* Game strip: one dot per explained move, coloured by verdict. Click to jump. */}
      <div className="mt-3 flex flex-wrap items-center gap-[3px]" role="list" aria-label="Moves in this review">
        {beats.map((b, i) => {
          const col = b.kind === 'bad' || b.kind === 'good' || b.kind === 'book' ? QUALITY_COLOR[b.quality ?? 'good']?.color : '#8b8b9a';
          const on = i === curBeat;
          return (
            <button
              key={b.id}
              role="listitem"
              onClick={() => go(beatStart(i), true)}
              title={b.kind === 'bad' ? `${(b.quality ?? '')} on move ${Math.floor(b.moveIndex / 2) + 1}` : b.kind}
              className={`rounded-full transition-all ${b.kind === 'bad' ? 'h-2.5 w-2.5' : 'h-2 w-2'} ${on ? 'ring-2 ring-brand-300 ring-offset-1 ring-offset-ink-800' : 'opacity-80 hover:opacity-100'}`}
              style={{ backgroundColor: col }}
            />
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => go(0, true)} className={btn} aria-label="Restart"><RotateCcw size={15} /></button>
        <button onClick={() => jumpBeat(-1)} disabled={curBeat === 0} className={btn} aria-label="Previous move"><ChevronsLeft size={16} /></button>
        <button onClick={() => go(idx - 1)} disabled={!started || idx === 0} className={btn} aria-label="Previous step"><SkipBack size={15} /></button>
        <div className="flex-1 h-1.5 rounded-full bg-ink-700 overflow-hidden">
          <div className="h-full bg-brand-500 transition-[width] duration-75" style={{ width: `${overall * 100}%` }} />
        </div>
        <button onClick={() => go(idx + 1)} disabled={!started || idx >= total - 1} className={btn} aria-label="Next step"><SkipForward size={15} /></button>
        <button onClick={() => jumpBeat(1)} disabled={curBeat >= beats.length - 1} className={btn} aria-label="Next move"><ChevronsRight size={16} /></button>
        <button onClick={togglePlay} className="flex items-center justify-center rounded-xl bg-brand-500 hover:bg-brand-400 text-ink-900 w-11 h-11 transition-colors" aria-label={playing ? 'Pause' : 'Play whole game'}>
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => jumpBad(-1)} disabled={!hasBadBehind}
          className="flex items-center gap-1.5 rounded-lg bg-ink-700/60 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-600/70 disabled:opacity-40"
        >
          <AlertTriangle size={13} className="text-amber-300" /> Prev mistake
        </button>
        <button
          onClick={() => jumpBad(1)} disabled={!hasBadAhead}
          className="flex items-center gap-1.5 rounded-lg bg-brand-500/15 px-3 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/25 disabled:opacity-40"
        >
          <AlertTriangle size={13} /> Next mistake{badCount ? ` (${badCount})` : ''}
        </button>
        <button
          onClick={() => setDetail((d) => (d === 'every' ? 'highlights' : 'every'))}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-700/70"
          title={detail === 'every' ? 'Skip the good moves and only talk about the big moments' : 'Explain every move'}
        >
          <Filter size={13} /> {detail === 'every' ? 'Every move' : 'Highlights only'}
        </button>
      </div>

      {deepBusy && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-400">
          <Loader2 size={11} className="animate-spin" /> Looking ahead on mistakes ({Math.min(badCount, Object.keys(deep).length + 1)}/{badCount})…
        </div>
      )}
      {voiceBusy && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-400">
          <Loader2 size={11} className="animate-spin" /> Getting the coach's voice…
        </div>
      )}
      {voiceError && !voiceBusy && <div className="mt-2 text-[11px] text-amber-300/80">Voice unavailable ({voiceError}), reading silently.</div>}
    </div>
  );
}
