/**
 * Coach voice.
 *
 * 1. Puter.js neural voice (free) - used only if the listener is already signed in to Puter,
 *    because Puter's sign-in popup is blocked by browsers when it isn't opened from a click
 *    (that is why the voice used to do nothing).
 * 2. Otherwise the browser's built-in speech (Web Speech API): free, no account, no popup, works right away.
 *
 * AdvancedCoach just calls speak(); the fallback is automatic.
 */
declare global { interface Window { puter?: any } }

export const COACH_VOICES = ['Brian', 'Amy'] as const;
export const DEFAULT_COACH_VOICE = 'Brian';
/** Old saved settings may still say Joanna / Matthew: map them to a voice that exists. */
const normalizeVoice = (v?: string) => ((COACH_VOICES as readonly string[]).includes(v ?? '') ? (v as string) : DEFAULT_COACH_VOICE);
const UK = new Set(['Amy', 'Brian', 'Emma']);
const MALE = new Set(['Matthew', 'Brian']);

// ---------------------------------------------------------------------------
// Puter.js
// ---------------------------------------------------------------------------
let loading: Promise<any> | null = null;

export function loadPuter(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.puter?.ai?.txt2speech) return Promise.resolve(window.puter);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js.puter.com/v2/';
    s.async = true;
    s.onload = () => (window.puter ? resolve(window.puter) : (loading = null, reject(new Error('Puter.js did not start'))));
    s.onerror = () => { loading = null; reject(new Error('Could not load Puter.js')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Call from a button click: opens Puter's sign-in (allowed because it comes from a click). */
export async function signInPuter(): Promise<boolean> {
  try {
    const puter = await loadPuter();
    await puter.auth.signIn();
    return !!puter.auth.isSignedIn();
  } catch {
    return false;
  }
}

async function puterReady(): Promise<any | null> {
  try {
    const puter = await Promise.race([
      loadPuter(),
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]);
    return puter && puter.auth?.isSignedIn?.() ? puter : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Text clean-up
// ---------------------------------------------------------------------------
/** Makes chess/eval text sound right when read aloud. */
const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const PIECE_SAY: Record<string, string> = { N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };
const CHECK_SAY: Record<string, string> = { '+': ', check', '#': ', checkmate' };

export function toSpeech(text: string): string {
  return text
    // chess moves: "Nf7+" -> "knight to f seven, check", "Rxh6" -> "rook takes h six", "gxh6" -> "g takes h six", "O-O" -> "castles short"
    .replace(/O-O-O/g, 'castles long')
    .replace(/O-O/g, 'castles short')
    .replace(
      /\b([NBRQK])([a-h]?[1-8]?)(x?)([a-h])([1-8])([+#]?)(?![A-Za-z0-9])/g,
      (_m, p: string, dis: string, x: string, f: string, r: string, ch: string) =>
        `${PIECE_SAY[p]} ${dis ? `${dis} ` : ''}${x ? 'takes' : 'to'} ${f} ${DIGIT[Number(r)]}${CHECK_SAY[ch] ?? ''}`,
    )
    .replace(/\b([a-h])x([a-h])([1-8])\b/g, (_m, a: string, f: string, r: string) => `${a} takes ${f} ${DIGIT[Number(r)]}`)
    .replace(/\b([a-h])([1-8])\b/g, (_m, f: string, r: string) => `${f} ${DIGIT[Number(r)]}`)
    // evaluations and misc
    .replace(/#(\d+)/g, 'mate in $1')
    .replace(/(^|\s)\+(\d)/g, '$1plus $2')
    .replace(/(^|\s)[-−](\d)/g, '$1minus $2')
    .replace(/\bvs\.?\b/gi, 'versus')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2900);
}

// ---------------------------------------------------------------------------
// Board lights in sync with the voice
// ---------------------------------------------------------------------------
export interface SquareCue {
  square: string;
  /** Where this square starts / ends inside the SPOKEN text (toSpeech(text)). */
  start: number;
  end: number;
}

/**
 * Every square a sentence names ("the knight on e5", "Rxb7"), with the position at which the voice says it.
 * Positions are measured in the spoken text, because "Nf7+" is read as "knight to f seven, check" (a different length).
 */
export function squareCues(text: string): SquareCue[] {
  const cues: SquareCue[] = [];
  for (const m of text.matchAll(/(?<![a-wyz0-9])[a-h][1-8](?![a-z0-9])/g)) {
    const i = m.index ?? 0;
    const start = toSpeech(text.slice(0, i)).length;
    const end = toSpeech(text.slice(0, i + 2)).length;
    cues.push({ square: m[0], start, end });
  }
  return cues;
}

/**
 * Which squares to light right now. `current` = the square being said at this moment (light it brightly),
 * `named` = every square said so far (keep them softly lit). Call it from SpeakOptions.onWord.
 */
export function litSquares(cues: SquareCue[], charIndex: number): { current: string[]; named: string[] } {
  const named = cues.filter((c) => charIndex >= c.start - 1).map((c) => c.square);
  const current = cues.filter((c) => charIndex >= c.start - 1 && charIndex <= c.end + 1).map((c) => c.square);
  return { current: [...new Set(current)], named: [...new Set(named)] };
}

// ---------------------------------------------------------------------------
// Puter audio (cached so the next sentence can be prepared)
// ---------------------------------------------------------------------------
const cache = new Map<string, Promise<HTMLAudioElement>>();

export function prepareSpeech(text: string, voice: string = DEFAULT_COACH_VOICE): Promise<HTMLAudioElement> {
  const spoken = toSpeech(text);
  const key = `${voice}|${spoken}`;
  let p = cache.get(key);
  if (!p) {
    p = loadPuter().then((puter) =>
      puter.ai.txt2speech(spoken, { voice, engine: 'neural', language: UK.has(voice) ? 'en-GB' : 'en-US' }),
    ) as Promise<HTMLAudioElement>;
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 24) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------
export interface SpeakOptions {
  /** 0..1 while speaking. */
  onProgress?: (p: number) => void;
  /** Called when sound actually starts. */
  onStart?: () => void;
  /**
   * Called while speaking with the position (in characters) inside the SPOKEN text, i.e. toSpeech(text),
   * and that text's length. Pair it with squareCues(text) + litSquares(...) to light the board in sync.
   */
  onWord?: (charIndex: number, total: number) => void;
  /** Speaking speed for the browser voice (0.5 slow .. 1.5 fast). Default 0.95, a little calmer than normal. */
  rate?: number;
}
export interface SpeakHandle { done: Promise<void>; cancel: () => void }

function voicesReady(): Promise<void> {
  const synth = window.speechSynthesis;
  if (synth.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { synth.removeEventListener('voiceschanged', finish); resolve(); };
    synth.addEventListener('voiceschanged', finish);
    setTimeout(finish, 1200); // some browsers never fire it; speak with the default voice
  });
}

function pickBrowserVoice(name: string): SpeechSynthesisVoice | undefined {
  const all = window.speechSynthesis.getVoices();
  const en = all.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const wantLang = UK.has(name) ? 'en-gb' : 'en-us';
  return (
    all.find((v) => v.name.toLowerCase().includes(name.toLowerCase())) ??
    en.find((v) => v.lang.toLowerCase() === wantLang && (MALE.has(name) ? /male|david|daniel|alex|mark|guy/i.test(v.name) : /female|zira|samantha|susan|aria|jenny|google/i.test(v.name))) ??
    en.find((v) => v.lang.toLowerCase() === wantLang) ??
    en[0]
  );
}

function speakBrowser(spoken: string, voice: string, opts: SpeakOptions): SpeakHandle {
  let cancelled = false;
  let tick: number | undefined;
  const done = new Promise<void>((resolve, reject) => {
    (async () => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) throw new Error('This browser has no speech support');
      await voicesReady();
      if (cancelled) return resolve();
      const u = new SpeechSynthesisUtterance(spoken);
      const v = pickBrowserVoice(voice);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = UK.has(voice) ? 'en-GB' : 'en-US';
      u.rate = opts.rate ?? 0.95;
      let best = 0;
      const t0 = performance.now();
      const estMs = Math.max(1200, spoken.length * 65); // ~15 chars/second, only used if no boundary events arrive
      let gotBoundary = false; // real word positions from the voice; the timer is only a fallback for voices without them
      u.onstart = () => {
        opts.onStart?.();
        opts.onWord?.(0, spoken.length);
        tick = window.setInterval(() => {
          const p = Math.min(0.95, (performance.now() - t0) / estMs);
          if (p > best) { best = p; opts.onProgress?.(p); }
          if (!gotBoundary) opts.onWord?.(Math.floor(p * spoken.length), spoken.length);
        }, 100);
      };
      u.onboundary = (e) => {
        gotBoundary = true;
        const p = Math.min(0.97, e.charIndex / Math.max(1, spoken.length));
        if (p > best) { best = p; opts.onProgress?.(p); }
        opts.onWord?.(e.charIndex, spoken.length);
      };
      u.onend = () => { window.clearInterval(tick); opts.onProgress?.(1); opts.onWord?.(spoken.length, spoken.length); resolve(); };
      u.onerror = (e) => {
        window.clearInterval(tick);
        if (cancelled || e.error === 'canceled' || e.error === 'interrupted') resolve();
        else reject(new Error(e.error || 'Speech failed'));
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(u);
    })().catch(reject);
  });
  return {
    done,
    cancel() {
      cancelled = true;
      window.clearInterval(tick);
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    },
  };
}

function speakPuter(puter: any, spoken: string, voice: string, opts: SpeakOptions): SpeakHandle {
  let cancelled = false;
  let audio: HTMLAudioElement | null = null;
  const done = prepareSpeech(spoken, voice).then(
    (a) =>
      new Promise<void>((resolve, reject) => {
        if (cancelled) return resolve();
        audio = a;
        a.currentTime = 0;
        a.ontimeupdate = () => {
          if (a.duration > 0) {
            const p = Math.min(1, a.currentTime / a.duration);
            opts.onProgress?.(p);
            opts.onWord?.(Math.floor(p * spoken.length), spoken.length);
          }
        };
        a.onended = () => { opts.onWord?.(spoken.length, spoken.length); resolve(); };
        a.onerror = () => reject(new Error('Audio failed'));
        a.play().then(() => opts.onStart?.()).catch(reject);
      }),
  );
  void puter;
  return {
    done,
    cancel() {
      cancelled = true;
      if (audio) { audio.onended = null; audio.ontimeupdate = null; audio.onerror = null; audio.pause(); }
    },
  };
}

/** Speaks one sentence. Puter voice if signed in, otherwise the browser voice. Never throws silently: `done` rejects only if both fail. */
export function speak(text: string, voice: string = DEFAULT_COACH_VOICE, opts: SpeakOptions = {}): SpeakHandle {
  voice = normalizeVoice(voice);
  const spoken = toSpeech(text);
  let cancelled = false;
  let current: SpeakHandle | null = null;
  const done = (async () => {
    const puter = await puterReady();
    if (cancelled) return;
    if (puter) {
      try {
        current = speakPuter(puter, spoken, voice, opts);
        await current.done;
        return;
      } catch {
        if (cancelled) return;
        // fall through to the browser voice
      }
    }
    current = speakBrowser(spoken, voice, opts);
    await current.done;
  })();
  return { done, cancel() { cancelled = true; current?.cancel(); } };
}

/** Call from the Play button (a real click) so browsers allow sound afterwards. */
export function unlockSpeech(): void {
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch { /* ignore */ }
}
