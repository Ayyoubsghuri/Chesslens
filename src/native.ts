/**
 * native.ts — Android (Capacitor) polish. Does nothing in a normal browser.
 * Plugins are reached through registerPlugin(name), which talks to the native side by name.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

type Plugin = Record<string, (...a: any[]) => any>;

export const isNative = () => { try { return Capacitor.isNativePlatform(); } catch { return false; } };
const cache: Record<string, Plugin> = {};
const plugin = (name: string): Plugin | undefined => {
  if (!isNative()) return undefined;
  try { return (cache[name] ??= registerPlugin<Plugin>(name)); } catch { return undefined; }
};

/** Let the page draw under the status bar / gesture bar (safe-area insets then keep content clear). */
function allowEdgeToEdge() {
  const meta = document.querySelector('meta[name="viewport"]');
  const base = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
  if (meta) meta.setAttribute('content', base); else {
    const m = document.createElement('meta'); m.name = 'viewport'; m.content = base; document.head.appendChild(m);
  }
}

function rgbToHex(c: string): string | null {
  const m = c.match(/\d+/g);
  if (!m || m.length < 3) return null;
  return '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}

export function initNative() {
  allowEdgeToEdge();
  if (!isNative()) return;
  document.documentElement.classList.add('native');
  const bar = plugin('StatusBar');
  // Paint the status bar the same colour as the page, whatever the theme is.
  const bg = rgbToHex(getComputedStyle(document.body).backgroundColor);
  try { bar?.setStyle({ style: 'DARK' }); bar?.setOverlaysWebView?.({ overlay: false }); if (bg) bar?.setBackgroundColor({ color: bg }); } catch { /* optional */ }
  try { plugin('SplashScreen')?.hide({ fadeOutDuration: 250 }); } catch { /* optional */ }
}

/** Android back button: close things first, go up a level next, exit only from the top. */
export function onBackButton(handler: () => boolean): () => void {
  const app = plugin('App');
  if (!app) return () => {};
  let handle: { remove?: () => void } | undefined;
  Promise.resolve(app.addListener('backButton', () => {
    if (!handler()) { try { app.exitApp(); } catch { /* ignore */ } }
  })).then((h: any) => { handle = h; });
  return () => { try { handle?.remove?.(); } catch { /* ignore */ } };
}

export function haptic() {
  try { plugin('Haptics')?.impact({ style: 'LIGHT' }); } catch { /* optional */ }
}

/** Calls `cb` every time the app comes back to the foreground (and `cb` is also safe to call at launch). */
export function onAppForeground(cb: () => void): () => void {
  const app = plugin('App');
  if (!app) return () => {};
  let handle: { remove?: () => void } | undefined;
  Promise.resolve(app.addListener('appStateChange', (s: { isActive: boolean }) => { if (s?.isActive) cb(); }))
    .then((h: any) => { handle = h; });
  return () => { try { handle?.remove?.(); } catch { /* ignore */ } };
}

/** Text currently on the clipboard ('' when empty or not allowed). Uses the Capacitor Clipboard plugin, then the web API. */
export async function readClipboardText(): Promise<string> {
  try {
    const r = await plugin('Clipboard')?.read();
    if (r?.value) return String(r.value);
  } catch { /* plugin missing or empty */ }
  try { return (await navigator.clipboard.readText()) || ''; } catch { return ''; }
}

/**
 * Text (or a .pgn file's text) sent to the app from Android's Share sheet, e.g. Chess.com -> Share -> ChessLens.
 * `cb` also receives text that arrived before the page was ready (cold start).
 */
export function onSharedText(cb: (text: string) => void): () => void {
  const p = plugin('SharedText');
  if (!p) return () => {};
  let handle: { remove?: () => void } | undefined;
  Promise.resolve(p.addListener('sharedText', (e: { text?: string }) => { if (e?.text) cb(String(e.text)); }))
    .then((h: any) => { handle = h; }).catch(() => {});
  Promise.resolve(p.getPending?.()).then((r: { text?: string } | undefined) => { if (r?.text) cb(String(r.text)); }).catch(() => {});
  return () => { try { handle?.remove?.(); } catch { /* ignore */ } };
}
