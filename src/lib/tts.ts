/**
 * Coach voice.
 *
 * 1. Puter.js neural voices (free) - used only if the listener is already signed in to Puter,
 *    because Puter's sign-in popup is blocked by browsers when it isn't opened from a click.
 *    The default "Coach (deep)" voice is OpenAI's deep "onyx" voice, given delivery instructions so it sounds like a
 *    coach at the board (measured pace, pauses before the key idea). It falls back to Polly "Brian" if unavailable.
 * 2. Otherwise the browser's built-in speech (Web Speech API): free, no account, no popup. The most natural male voice
 *    on the device is picked, and pitch / rate are lowered so it sounds deeper and calmer.
 *
 * AdvancedCoach just calls speak(); the fallback is automatic.
 */
declare global { interface Window { puter?: any } }

/**
 * The coach's voices. "Coach (deep)" is the default: a deep baritone (OpenAI "onyx" through Puter) told to speak like a
 * coach sitting next to you at the board, slowly on the moves and with a pause before the key idea.
 * If that provider fails, the voice falls back to Polly "Brian", then to the browser's own voice (lowered and slowed down).
 */
export const COACH_VOICES = ['Coach (deep)', 'Coach (gravelly)', 'Brian (classic)'] as const;
export const DEFAULT_COACH_VOICE = 'Coach (deep)';
/** Old saved settings ("Brian", "Amy", "Joanna"...) are mapped to the deep coach voice. */
const normalizeVoice = (v?: string) => ((COACH_VOICES as readonly string[]).includes(v ?? '') ? (v as string) : DEFAULT_COACH_VOICE);

/** How a real coach talks: the instructions sent to voices that accept them. */
const COACH_DELIVERY = [
  'Voice: a deep, warm, resonant baritone. An experienced chess coach sitting next to the student at the board.',
  'Tone: calm, confident and encouraging; honest about mistakes without sounding harsh. Never sound like you are reading.',
  'Pacing: measured, a little slower than normal conversation. Slow down slightly on move names and squares (like "bishop to d three") so the student can find them on the board.',
  'Pauses: a short pause before the key move or the key idea, and after a question you ask the student, as if letting them think.',
  'Emphasis: stress the important move, the word "because", and the lesson at the end.',
].join('\n');

interface VoiceProfile {
  /** Puter request options, tried in order. */
  puter: Record<string, unknown>[];
  /** Browser fallback: language, and how far to lower pitch / slow down. */
  lang: 'en-GB' | 'en-US';
  pitch: number;
  rate: number;
  /** Puter audio playback speed with the pitch NOT preserved (below 1 = slower and deeper). 1 = untouched. */
  depth: number;
}
const BRIAN = { provider: 'aws-polly', voice: 'Brian', engine: 'neural', language: 'en-GB' };
const PROFILES: Record<string, VoiceProfile> = {
  'Coach (deep)': {
    puter: [{ provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'onyx', instructions: COACH_DELIVERY }, BRIAN],
    lang: 'en-US', pitch: 0.78, rate: 0.9, depth: 1,
  },
  'Coach (gravelly)': {
    puter: [{ provider: 'gemini', voice: 'Algenib', instructions: COACH_DELIVERY }, { provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'onyx', instructions: COACH_DELIVERY }, BRIAN],
    lang: 'en-US', pitch: 0.72, rate: 0.88, depth: 1,
  },
  'Brian (classic)': {
    puter: [BRIAN],
    lang: 'en-GB', pitch: 0.82, rate: 0.92, depth: 0.93,
  },
};
const profileOf = (voice: string) => PROFILES[normalizeVoice(voice)];

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
    // dashes and dots used as separators in the text read badly: turn them into short pauses
    .replace(/\s[—–]\s/g, ', ')
    .replace(/\s·\s/g, '. ')
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
  const key = `${normalizeVoice(voice)}|${spoken}`;
  let p = cache.get(key);
  if (!p) {
    const options = profileOf(voice).puter;
    p = loadPuter().then(async (puter) => {
      // Try each provider of the profile in turn: the deep coach voice first, Brian if that one is unavailable.
      let last: unknown = null;
      for (const opts of options) {
        try {
          const a = await puter.ai.txt2speech(spoken, opts);
          if (a) return a as HTMLAudioElement;
        } catch (e) { last = e; }
      }
      throw last ?? new Error('No voice available');
    }) as Promise<HTMLAudioElement>;
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
  /** Speaking speed for the browser voice (0.5 slow .. 1.5 fast). Default: the voice profile's (about 0.9, calmer than normal). */
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

// Phones and tablets have no voice called "Brian", so we look for a MALE English voice by name or Android voice id.
// (The old check /male/ also matched "Fe-male", which is why a female voice was picked on mobile.)
const FEMALE_RE = /female|woman|zira|samantha|susan|aria|jenny|fiona|karen|moira|tessa|amy|emma|serena|kate|hazel|libby|sonia|victoria|allison|ava|joanna|kimberly|salli|ivy|kendra|-x-(gba|gbc|gbf|iob|iof|iog|ioc)/i;
const MALE_RE = /(^|[^a-z])male\b|brian|david|daniel|alex\b|mark|guy|george|ryan|thomas|arthur|oliver|james|fred|rishi|aaron|matthew|joey|justin|-x-(gbb|gbd|rjs|iol)/i;
const isMaleVoice = (v: SpeechSynthesisVoice) => MALE_RE.test(v.name) && !FEMALE_RE.test(v.name);
const langOf = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace('_', '-'); // Android reports "en_GB"

/** Natural-sounding system voices (Edge "Online (Natural)", Chrome "Google", Apple "Daniel"...) beat the robotic defaults. */
const QUALITY_RE = /natural|neural|online|premium|enhanced|google/i;
const DEEP_RE = /guy|christopher|eric|davis|roger|steffan|ryan|thomas|daniel|arthur|google uk english male/i;

function pickBrowserVoice(lang: 'en-GB' | 'en-US'): SpeechSynthesisVoice | undefined {
  const all = window.speechSynthesis.getVoices();
  const en = all.filter((v) => langOf(v).startsWith('en'));
  const want = lang.toLowerCase();
  const score = (v: SpeechSynthesisVoice) =>
    (isMaleVoice(v) ? 100 : FEMALE_RE.test(v.name) ? 0 : 40) +
    (QUALITY_RE.test(v.name) ? 30 : 0) +
    (DEEP_RE.test(v.name) ? 15 : 0) +
    (langOf(v) === want ? 10 : 0) +
    (v.localService ? 0 : 5);
  return [...en].sort((a, b) => score(b) - score(a))[0];
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
      const prof = profileOf(voice);
      const v = pickBrowserVoice(prof.lang);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = prof.lang;
      // Deeper and calmer than the default system voice. A device with only female voices gets pitched down further.
      u.pitch = v && isMaleVoice(v) ? prof.pitch : Math.max(0.5, prof.pitch - 0.12);
      u.rate = opts.rate ?? prof.rate;
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
        // "Deeper" on voices that need it: play slightly slower without keeping the pitch.
        const depth = profileOf(voice).depth;
        if (depth !== 1) {
          (a as any).preservesPitch = false; (a as any).mozPreservesPitch = false; (a as any).webkitPreservesPitch = false;
          a.playbackRate = depth;
        }
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
