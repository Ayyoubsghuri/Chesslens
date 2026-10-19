import { useEffect, useMemo, useRef, useState } from 'react';
import type { Square } from 'chess.js';
import {
  Play, Pause, RotateCcw, SkipBack, SkipForward, Sparkles, Loader2, Volume2, VolumeX,
  Lightbulb, ChevronDown, ChevronUp, X,
} from 'lucide-react';
import {
  buildAdvancedExplanation, buildCoreScenes, sceneDuration, plainText, parseSegs,
  visibleScenes, hasMoreScenes, showAllByDefault, retryChallenge, checkRetryMove,
  type ExplainInput, type Scene, type Seg, type RetryChallenge,
} from '@/lib/coach-explain';
import { speak, unlockSpeech, squareCues, litSquares } from '@/lib/tts';

interface Props {
  /** Everything needed to explain the move. null = nothing to explain. (input.level = beginner / intermediate / advanced) */
  input: ExplainInput | null;
  /** Changes whenever a new move is shown. */
  moveKey: string | number;
  /** True while the board is showing a preview (so we notice when the user presses "Back"). */
  previewActive: boolean;
  /**
   * Puts a scene on the board (null = back to the game).
   * While the voice speaks, the scene carries `spoken`: sceneSquares(scene) then returns only the squares already said.
   */
  onScene: (scene: Scene | null) => void;
  compact?: boolean;
  /** Settings → "Speak explanations": the coach reads each step aloud. */
  voice?: boolean;
  voiceName?: string;
  /**
   * "Find a better move": called when the player taps the button. Put the board in puzzle mode
   * (challenge.fen, challenge.side to move) and pass the move the player plays back as `retryMove` (UCI, e.g. "e2e4").
   */
  onRetry?: (challenge: RetryChallenge) => void;
  /** The move the player tried on the board during a retry (UCI). Changes every attempt. */
  retryMove?: string | null;
  /** Called when the retry ends (solved or cancelled) so the board can leave puzzle mode. */
  onRetryEnd?: () => void;
}

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

const sameScene = (a: Scene, b: Scene) =>
  a.fen === b.fen && a.uci === b.uci && plainText(a.text) === plainText(b.text);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Which squares the voice has said so far, for ONE scene (idx = its position, so a stale value never leaks onto the next scene). */
interface SpokenState { idx: number; named: Square[]; current: Square[]; done: boolean }
interface RetryState { hints: number; checking: boolean; result: { ok: boolean; text: string } | null }

/** Step-by-step spoken-style explanation: why this move, what it threatens, what happens next, and why not the other moves. */
export function AdvancedCoach({
  input, moveKey, previewActive, onScene, compact, voice = false, voiceName, onRetry, retryMove, onRetryEnd,
}: Props) {
  const core = useMemo(() => (input ? buildCoreScenes(input) : []), [input]);
  /** Every scene, including the optional ones. `shown` is what actually plays. */
  const [scenes, setScenes] = useState<Scene[]>(core);
  const [showMore, setShowMore] = useState(false);
  const showAllNow = showMore || showAllByDefault(input?.level);
  const shown = useMemo(() => visibleScenes(scenes, showAllNow), [scenes, showAllNow]);
  const [idx, setIdx] = useState(0);
  const [prog, setProg] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [spoken, setSpoken] = useState<SpokenState | null>(null);
  const [retry, setRetry] = useState<RetryState | null>(null);
  const speaking = voice && !muted;
  const challenge = useMemo(() => (input ? retryChallenge(input) : null), [input]);
  const extrasFor = useRef<string | null>(null);
  const token = useRef(0);
  const sawActive = useRef(false);
  const startedRef = useRef(false);
  startedRef.current = started;
  const scenesRef = useRef<Scene[]>(shown);
  scenesRef.current = shown;
  const showAllRef = useRef(showAllNow);
  showAllRef.current = showAllNow;
  const idxRef = useRef(0);
  idxRef.current = idx;
  // New move → reset everything.
  useEffect(() => {
    token.current++;
    extrasFor.current = null;
    setScenes(core);
    setShowMore(false);
    setIdx(0);
    setProg(0);
    setPlaying(false);
    setLoadingExtras(false);
    setSpoken(null);
    setRetry((r) => { if (r) onRetryEnd?.(); return null; });
    sawActive.current = false;
    if (startedRef.current) onScene(null);
    setStarted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveKey, core]);

  // Leaving: clear the board preview.
  useEffect(() => () => { if (startedRef.current) onScene(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the current scene on the board. While the voice speaks, only the squares already said are lit.
  useEffect(() => {
    const s = shown[idx];
    if (!started || !s) return;
    const sp = spoken && spoken.idx === idx ? { named: spoken.named, current: spoken.current, done: spoken.done } : undefined;
    onScene(sp ? { ...s, spoken: sp } : s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, idx, shown, spoken]);

  // The user closed the preview with "Back" → stop.
  useEffect(() => {
    if (!started) return;
    if (previewActive) sawActive.current = true;
    else if (sawActive.current) {
      setStarted(false);
      setPlaying(false);
      sawActive.current = false;
    }
  }, [previewActive, started]);

  // Scene timer. With voice on, a scene lasts exactly as long as the spoken sentence,
  // and each square lights up at the moment the voice says it.
  useEffect(() => {
    if (!playing) return;
    const sc = scenesRef.current[idx];
    if (!sc) return;
    let cancelled = false;
    let handle: { cancel: () => void } | null = null;
    let interval: number | undefined;
    let gap: number | undefined;

    const advance = () => {
      if (cancelled) return;
      if (idx < scenesRef.current.length - 1) { setIdx((i) => i + 1); setProg(0); }
      else { setPlaying(false); setProg(1); }
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

    if (!speaking) {
      setSpoken(null); // nothing is spoken: show every square at once
      runTimer();
    } else {
      setVoiceBusy(true);
      setVoiceError(null);
      const text = plainText(sc.text);
      const cues = squareCues(text);
      const all = [...new Set(cues.map((c) => c.square))] as Square[];
      let furthest = 0;
      setSpoken({ idx, named: [], current: [], done: false }); // board starts with no square lit
      const h = speak(text, voiceName, {
        onStart: () => { if (!cancelled) setVoiceBusy(false); },
        onProgress: (p) => { if (!cancelled) setProg(p); },
        onWord: (i) => {
          if (cancelled || i < furthest) return; // never go backwards
          furthest = i;
          const l = litSquares(cues, i);
          setSpoken((prev) =>
            prev && prev.idx === idx && !prev.done && sameList(prev.named, l.named) && sameList(prev.current, l.current)
              ? prev
              : { idx, named: l.named as Square[], current: l.current as Square[], done: false },
          );
        },
      });
      handle = h;
      h.done
        .then(() => {
          if (cancelled) return;
          setVoiceBusy(false);
          setSpoken({ idx, named: all, current: [], done: true });
          gap = window.setTimeout(advance, 350);
        })
        .catch((e: any) => {
          if (cancelled) return;
          setVoiceBusy(false);
          setSpoken(null);
          setVoiceError(e?.message ? String(e.message).slice(0, 80) : 'Voice unavailable');
          runTimer(); // fall back to silent reading time
        });
    }
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(gap);
      handle?.cancel();
      setVoiceBusy(false);
      setSpoken(null); // paused or moved on: show the scene's squares normally
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, idx, speaking, voiceName]);

  // Muting while a sentence is being read: stop the voice right away.
  useEffect(() => {
    if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [muted]);

  // "Find a better move": the player tried a move on the board → check it with the engine.
  useEffect(() => {
    if (!retry || !retryMove || !input) return;
    let live = true;
    setRetry((r) => (r ? { ...r, checking: true, result: null } : r));
    checkRetryMove(input, retryMove)
      .then((res) => { if (live) setRetry((r) => (r ? { ...r, checking: false, result: res } : r)); })
      .catch(() => { if (live) setRetry((r) => (r ? { ...r, checking: false } : r)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryMove]);

  function loadExtras() {
    if (!input) return;
    const key = `${moveKey}`;
    if (extrasFor.current === key) return;
    extrasFor.current = key;
    const my = ++token.current;
    setLoadingExtras(true);
    buildAdvancedExplanation(input, () => token.current !== my)
      .then((all) => {
        if (token.current !== my || !all.length) return;
        // Keep the learner on the same scene when new steps are inserted before it.
        const cur = scenesRef.current[idxRef.current];
        const next = visibleScenes(all, showAllRef.current);
        const ni = cur ? next.findIndex((s) => sameScene(s, cur)) : -1;
        setScenes(all);
        if (ni >= 0) setIdx(ni);
      })
      .catch(() => {})
      .finally(() => { if (token.current === my) setLoadingExtras(false); });
  }

  function togglePlay() {
    unlockSpeech();
    if (shown.length === 0) return;
    if (!started) {
      setStarted(true);
      setIdx(0);
      setProg(0);
      setPlaying(true);
      loadExtras();
      return;
    }
    if (!playing && idx === shown.length - 1 && prog >= 1) { setIdx(0); setProg(0); }
    setPlaying((p) => !p);
  }
  function go(i: number) {
    unlockSpeech();
    if (!started) { setStarted(true); loadExtras(); }
    setIdx(Math.max(0, Math.min(shown.length - 1, i)));
    setProg(0);
    setPlaying(false);
  }
  function replay() {
    unlockSpeech();
    if (!started) { setStarted(true); loadExtras(); }
    setIdx(0);
    setProg(0);
    setPlaying(true);
  }
  /** "Show more" / "Show less": keeps the learner on the same step. */
  function toggleMore() {
    const cur = shown[idx];
    const next = visibleScenes(scenes, !showMore);
    const ni = cur ? next.findIndex((s) => sameScene(s, cur)) : 0;
    setShowMore((m) => !m);
    setIdx(Math.max(0, ni));
    setProg(0);
    setPlaying(false);
  }
  function startRetry() {
    if (!challenge || !onRetry) return;
    unlockSpeech();
    setPlaying(false);
    if (startedRef.current) { onScene(null); setStarted(false); }
    setRetry({ hints: 0, checking: false, result: null });
    onRetry(challenge);
  }
  function endRetry() {
    setRetry(null);
    onRetryEnd?.();
  }

  if (!input || core.length === 0) return null;
  const scene = shown[idx] ?? shown[0] ?? core[0];
  const total = Math.max(shown.length, 1);
  const overall = Math.min(1, (idx + (started ? prog : 0)) / total);
  const btn = 'flex items-center justify-center rounded-lg bg-ink-700/60 hover:bg-ink-600/70 text-ink-200 transition-colors disabled:opacity-40 w-9 h-9';
  const moreCount = scenes.filter((s) => s.extra).length;
  const canToggleMore = hasMoreScenes(scenes) && !showAllByDefault(input.level);

  return (
    <div className="mt-2 w-full min-w-0 max-w-full overflow-hidden rounded-xl bg-ink-800/70 border border-ink-700/60 p-3">
      <div className="flex min-w-0 items-center gap-2 mb-2 text-xs text-ink-400">
        <Sparkles size={13} className="shrink-0 text-brand-400" />
        <span className="shrink-0 font-semibold text-ink-300">Advanced coach</span>
        {!retry && scene.chip && <span className="min-w-0 truncate rounded-md bg-ink-700/70 px-1.5 py-0.5 font-mono text-[11px] text-ink-200">{scene.chip}</span>}
        {retry && <span className="min-w-0 truncate rounded-md bg-ink-700/70 px-1.5 py-0.5 font-mono text-[11px] text-ink-200">Find a better move</span>}
        {voice && (
          <button
            onClick={() => setMuted((m) => !m)}
            className="ml-1 rounded-md p-1 text-ink-300 hover:bg-ink-700/70"
            aria-label={muted ? 'Turn voice on' : 'Turn voice off'}
            title={muted ? 'Voice off' : 'Voice on'}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} className="text-brand-400" />}
          </button>
        )}
        {!retry && (
          <span className="ml-auto shrink-0 font-mono">{started ? `${idx + 1}/${shown.length}` : `${shown.length} steps`}</span>
        )}
      </div>

      {retry && challenge ? (
        /* ---- Find a better move ---- */
        <div className={`${compact ? 'text-sm' : 'text-[15px]'} leading-snug text-ink-100`}>
          <p>{challenge.prompt}</p>
          <p className="mt-1 text-ink-300">Play your move on the board.</p>
          {challenge.hints.slice(0, retry.hints).map((h, i) => (
            <p key={i} className="mt-1 text-amber-300/90">Hint: {h}</p>
          ))}
          {retry.checking && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-400">
              <Loader2 size={11} className="animate-spin" /> Checking your move…
            </div>
          )}
          {retry.result && !retry.checking && (
            <p className={`mt-2 ${retry.result.ok ? 'text-brand-300' : 'text-red-300'}`}>
              <Text segs={parseSegs(retry.result.text)} />
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            {!retry.result?.ok && retry.hints < challenge.hints.length && (
              <button
                onClick={() => setRetry((r) => (r ? { ...r, hints: r.hints + 1 } : r))}
                className="flex items-center gap-1.5 rounded-lg bg-ink-700/60 px-3 py-2 text-xs text-ink-100 hover:bg-ink-600/70"
              >
                <Lightbulb size={14} className="text-amber-300" /> Hint
              </button>
            )}
            <button
              onClick={endRetry}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-ink-700/60 px-3 py-2 text-xs text-ink-100 hover:bg-ink-600/70"
            >
              <X size={14} /> {retry.result?.ok ? 'Done' : 'Give up'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p
            className={`${compact ? 'text-sm' : 'text-[15px]'} leading-snug text-ink-100 min-h-[1.5em] sm:min-h-[3.6em]`}
            aria-live="polite"
          >
            <Text segs={scene.text} />
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button onClick={replay} className={btn} aria-label="Replay"><RotateCcw size={15} /></button>
            <button onClick={() => go(idx - 1)} disabled={!started || idx === 0} className={btn} aria-label="Previous step"><SkipBack size={15} /></button>
            <div className="flex-1 h-1.5 rounded-full bg-ink-700 overflow-hidden">
              <div className="h-full bg-brand-500 transition-[width] duration-75" style={{ width: `${overall * 100}%` }} />
            </div>
            <button onClick={() => go(idx + 1)} disabled={!started || idx >= shown.length - 1} className={btn} aria-label="Next step"><SkipForward size={15} /></button>
            <button
              onClick={togglePlay}
              className="flex items-center justify-center rounded-xl bg-brand-500 hover:bg-brand-400 text-ink-900 w-11 h-11 transition-colors"
              aria-label={playing ? 'Pause' : 'Play explanation'}
            >
              {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
          </div>

          {(canToggleMore || (challenge && onRetry)) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {challenge && onRetry && (
                <button
                  onClick={startRetry}
                  className="flex items-center gap-1.5 rounded-lg bg-ink-700/60 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-600/70"
                >
                  <Lightbulb size={13} className="text-amber-300" /> Find a better move
                </button>
              )}
              {canToggleMore && (
                <button
                  onClick={toggleMore}
                  className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-700/70"
                >
                  {showMore ? <><ChevronUp size={13} /> Show less</> : <><ChevronDown size={13} /> Show more ({moreCount})</>}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {voiceBusy && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-400">
          <Loader2 size={11} className="animate-spin" /> Getting the coach's voice…
        </div>
      )}
      {voiceError && !voiceBusy && (
        <div className="mt-2 text-[11px] text-amber-300/80">Voice unavailable ({voiceError}) — reading silently.</div>
      )}
      {loadingExtras && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-400">
          <Loader2 size={11} className="animate-spin" /> Looking for threats and checking other moves…
        </div>
      )}
    </div>
  );
}