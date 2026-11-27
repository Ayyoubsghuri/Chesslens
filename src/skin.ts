/**
 * Which design the app wears.
 *  - 'neon': the Android app's own design (dark, mint green, lime, bold sans-serif).
 *  - 'classic': the website.
 * The Android app always uses neon. On the web it can be previewed with ?skin=neon (remembered on that device;
 * ?skin=classic switches back). VITE_SKIN=neon at build time forces it too.
 */
import { Capacitor } from '@capacitor/core';

export type Skin = 'neon' | 'classic';
const KEY = 'chesslens:skin';

function detect(): Skin {
  try { if (Capacitor.isNativePlatform()) return 'neon'; } catch { /* not native */ }
  if ((import.meta.env.VITE_SKIN as string | undefined) === 'neon') return 'neon';
  try {
    const q = new URLSearchParams(window.location.search).get('skin');
    if (q === 'neon' || q === 'classic') { localStorage.setItem(KEY, q); return q; }
    if (localStorage.getItem(KEY) === 'neon') return 'neon';
  } catch { /* storage blocked */ }
  return 'classic';
}

export const SKIN: Skin = typeof window === 'undefined' ? 'classic' : detect();
export const isNeon = SKIN === 'neon';

/** Puts the skin's class on <html> (call before the first render). */
export function applySkin() {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('skin-neon', isNeon);
}
