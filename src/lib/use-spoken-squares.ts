/**
 * Lights the board square by square, at the moment the coach's voice says it (not when the text appears).
 *
 *   const { lit, speakScene, stop, reset, showAll } = useSpokenSquares();
 *
 *   - new scene appears     -> reset()                  (board starts with no square lit)
 *   - voice on              -> speakScene(text, voice)  (squares light up as they are spoken)
 *   - voice off / muted     -> showAll(text)            (nothing is spoken, so light them all)
 *   - pause / leave scene   -> stop()
 *
 * Board props:  bright squares = lit.current   (the square being said right now)
 *               soft squares   = lit.named     (squares already said)
 * Do NOT also pass sceneSquares(scene) to the board while the voice is on: that lights everything at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { speak, squareCues, litSquares, type SpeakHandle, type SpeakOptions } from '@/lib/tts';

export interface SpokenLit { current: string[]; named: string[] }
const EMPTY: SpokenLit = { current: [], named: [] };
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function useSpokenSquares() {
  const [lit, setLit] = useState<SpokenLit>(EMPTY);
  const handle = useRef<SpeakHandle | null>(null);
  const furthest = useRef(0);

  const stop = useCallback(() => {
    handle.current?.cancel();
    handle.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    furthest.current = 0;
    setLit(EMPTY);
  }, [stop]);

  /** Speaks the text and lights each square when its turn comes. Returns the speech handle (await .done). */
  const speakScene = useCallback((text: string, voice?: string, opts: SpeakOptions = {}): SpeakHandle => {
    reset();
    const cues = squareCues(text);
    const h = speak(text, voice, {
      ...opts,
      onWord: (i, total) => {
        opts.onWord?.(i, total);
        if (i < furthest.current) return; // never go backwards (timer fallback vs real word events)
        furthest.current = i;
        const next = litSquares(cues, i);
        setLit((prev) => (same(prev.current, next.current) && same(prev.named, next.named) ? prev : next));
      },
    });
    handle.current = h;
    return h;
  }, [reset]);

  /** For when nothing is spoken (muted): light every named square at once. */
  const showAll = useCallback((text: string) => {
    stop();
    setLit({ current: [], named: [...new Set(squareCues(text).map((c) => c.square))] });
  }, [stop]);

  useEffect(() => stop, [stop]); // stop speaking when the component unmounts

  return { lit, speakScene, stop, reset, showAll };
}
