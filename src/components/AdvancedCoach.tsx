import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, SkipBack, SkipForward, Sparkles, Loader2, Volume2, VolumeX } from 'lucide-react';
import {
  buildAdvancedExplanation, buildCoreScenes, sceneDuration,
  plainText, type ExplainInput, type Scene, type Seg,
} from '@/lib/coach-explain';
import { speak, unlockSpeech } from '@/lib/tts';

interface Props {
  /** Everything needed to explain the move. null = nothing to explain. */
  input: ExplainInput | null;
  /** Changes whenever a new move is shown. */
  moveKey: string | number;
  /** True while the board is showing a preview (so we notice when the user presses "Back"). */
  previewActive: boolean;
  /** Puts a scene on the board (null = back to the game). */
  onScene: (scene: Scene | null) => void;
  compact?: boolean;
  /** Settings → "Speak explanations": the coach reads each step aloud. */
  voice?: boolean;
  voiceName?: string;
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

/** Step-by-step spoken-style explanation: why this move, what it threatens, what happens next, and why not the other moves. */
export function AdvancedCoach({ input, moveKey, previewActive, onScene, compact, voice = false, voiceName }: Props) {
  const core = useMemo(() => (input ? buildCoreScenes(input) : []), [input]);
  const [scenes, setScenes] = useState<Scene[]>(core);
  const [idx, setIdx] = useState(0);
  const [prog, setProg] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const speaking = voice && !muted;
  const extrasFor = useRef<string | null>(null);
  const token = useRef(0);
  const sawActive = useRef(false);
  const startedRef = useRef(false);
  startedRef.current = started;
  const scenesRef = useRef<Scene[]>(scenes);
  scenesRef.current = scenes;
  const idxRef = useRef(0);
  idxRef.current = idx;

  // New move → reset everything.
  useEffect(() => {
    token.current++;
    extrasFor.current = null;
    setScenes(core);
    setIdx(0);
    setProg(0);
    setPlaying(false);
    setLoadingExtras(false);
    sawActive.current = false;
    if (startedRef.current) onScene(null);
    setStarted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveKey, core]);

  // Leaving: clear the board preview.
  useEffect(() => () => { if (startedRef.current) onScene(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the current scene on the board.
  useEffect(() => {
    if (started && scenes[idx]) onScene(scenes[idx]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, idx, scenes]);

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

  // Scene timer. With voice on, a scene lasts exactly as long as the spoken sentence.
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
      runTimer();
    } else {
      setVoiceBusy(true);
      setVoiceError(null);
      const h = speak(plainText(sc.text), voiceName, {
        onStart: () => { if (!cancelled) setVoiceBusy(false); },
        onProgress: (p) => { if (!cancelled) setProg(p); },
      });
      handle = h;
      h.done
        .then(() => {
          if (cancelled) return;
          setVoiceBusy(false);
          gap = window.setTimeout(advance, 350);
        })
        .catch((e: any) => {
          if (cancelled) return;
          setVoiceBusy(false);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, idx, speaking, voiceName]);

  // Muting while a sentence is being read: stop the voice right away.
  useEffect(() => {
    if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [muted]);

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
        const ni = cur ? all.findIndex((s) => sameScene(s, cur)) : -1;
        setScenes(all);
        if (ni >= 0) setIdx(ni);
      })
      .catch(() => {})
      .finally(() => { if (token.current === my) setLoadingExtras(false); });
  }

  function togglePlay() {
    unlockSpeech();
    if (scenes.length === 0) return;
    if (!started) {
      setStarted(true);
      setIdx(0);
      setProg(0);
      setPlaying(true);
      loadExtras();
      return;
    }
    if (!playing && idx === scenes.length - 1 && prog >= 1) { setIdx(0); setProg(0); }
    setPlaying((p) => !p);
  }
  function go(i: number) {
    unlockSpeech();
    if (!started) { setStarted(true); loadExtras(); }
    setIdx(Math.max(0, Math.min(scenes.length - 1, i)));
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

  if (!input || core.length === 0) return null;
  const scene = scenes[idx] ?? scenes[0];
  const total = Math.max(scenes.length, 1);
  const overall = Math.min(1, (idx + (started ? prog : 0)) / total);
  const btn = 'flex items-center justify-center rounded-lg bg-ink-700/60 hover:bg-ink-600/70 text-ink-200 transition-colors disabled:opacity-40 w-9 h-9';

  return (
    <div className="mt-2 rounded-xl bg-ink-800/70 border border-ink-700/60 p-3">
      <div className="flex items-center gap-2 mb-2 text-xs text-ink-400">
        <Sparkles size={13} className="text-brand-400" />
        <span className="font-semibold text-ink-300">Advanced coach</span>
        {scene.chip && <span className="rounded-md bg-ink-700/70 px-1.5 py-0.5 font-mono text-[11px] text-ink-200">{scene.chip}</span>}
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
        <span className="ml-auto font-mono">{started ? `${idx + 1}/${scenes.length}` : `${scenes.length} steps`}</span>
      </div>

      <p className={`${compact ? 'text-sm' : 'text-[15px]'} leading-snug text-ink-100 min-h-[3.6em]`} aria-live="polite">
        <Text segs={scene.text} />
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button onClick={replay} className={btn} aria-label="Replay"><RotateCcw size={15} /></button>
        <button onClick={() => go(idx - 1)} disabled={!started || idx === 0} className={btn} aria-label="Previous step"><SkipBack size={15} /></button>
        <div className="flex-1 h-1.5 rounded-full bg-ink-700 overflow-hidden">
          <div className="h-full bg-brand-500 transition-[width] duration-75" style={{ width: `${overall * 100}%` }} />
        </div>
        <button onClick={() => go(idx + 1)} disabled={!started || idx >= scenes.length - 1} className={btn} aria-label="Next step"><SkipForward size={15} /></button>
        <button
          onClick={togglePlay}
          className="flex items-center justify-center rounded-xl bg-brand-500 hover:bg-brand-400 text-ink-900 w-11 h-11 transition-colors"
          aria-label={playing ? 'Pause' : 'Play explanation'}
        >
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
      </div>

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
