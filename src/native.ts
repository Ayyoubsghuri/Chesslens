/**
 * native.ts — Android (Capacitor) polish. Does nothing in a normal browser.
 * Uses the global Capacitor object so no extra imports are needed for the web build.
 */
type Plugin = Record<string, (...a: any[]) => any>;
const cap = (): any => (window as any).Capacitor;

export const isNative = () => !!cap()?.isNativePlatform?.();
const plugin = (name: string): Plugin | undefined => cap()?.Plugins?.[name];

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
