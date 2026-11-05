/**
 * ads.ts — AdMob banners for the Android app (does nothing on the web).
 *  - 'loading': a medium banner in the middle of the screen while a game is being analyzed;
 *  - 'bottom' : a small banner at the bottom of the review page, above the toolbar;
 *  - 'none'   : no ad.
 * Test mode (Google's test ads) is on until VITE_ADMOB_TESTING is set to 'false' at build time, so you never click
 * live ads on your own phone by accident. The real banner id comes from VITE_ADMOB_BANNER_ID.
 */
import { isNative } from '../native';

export type AdMode = 'none' | 'loading' | 'bottom';

const TEST_BANNER = 'ca-app-pub-3940256099942544/6300978111';
const REAL_BANNER = (import.meta.env.VITE_ADMOB_BANNER_ID as string | undefined) || '';
const TESTING = !REAL_BANNER || (import.meta.env.VITE_ADMOB_TESTING as string | undefined) !== 'false';
const BANNER_ID = TESTING ? TEST_BANNER : REAL_BANNER;

/** dp from the bottom of the screen to the top of the game toolbar (toolbar + gesture bar). */
const BOTTOM_MARGIN_DP = 84;

let desired: AdMode = 'none';
const holds = new Set<string>();
let shown: AdMode = 'none';
let ready = false;
let chain: Promise<void> = Promise.resolve();

async function load() {
  return import('@capacitor-community/admob');
}

async function init() {
  if (ready) return;
  const { AdMob, AdmobConsentStatus } = await load();
  try {
    const info = await AdMob.requestConsentInfo();
    if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) await AdMob.showConsentForm();
  } catch { /* consent is only needed in some regions */ }
  await AdMob.initialize({ initializeForTesting: TESTING });
  ready = true;
}

async function apply() {
  const want: AdMode = holds.size > 0 ? 'none' : desired;
  if (want === shown) return;
  const { AdMob, BannerAdSize, BannerAdPosition } = await load();
  if (shown !== 'none') { try { await AdMob.removeBanner(); } catch { /* nothing to remove */ } shown = 'none'; }
  if (want === 'none') return;
  await init();
  if (want === 'loading') {
    await AdMob.showBanner({ adId: BANNER_ID, isTesting: TESTING, adSize: BannerAdSize.MEDIUM_RECTANGLE, position: BannerAdPosition.CENTER, margin: 0 });
  } else {
    await AdMob.showBanner({ adId: BANNER_ID, isTesting: TESTING, adSize: BannerAdSize.ADAPTIVE_BANNER, position: BannerAdPosition.BOTTOM_CENTER, margin: BOTTOM_MARGIN_DP });
  }
  shown = want;
}

function refresh() {
  if (!isNative()) return;
  chain = chain.then(apply).catch((e) => { console.warn('ads', e); });
}

/** Which ad the current screen wants. */
export function setAdMode(mode: AdMode) { desired = mode; refresh(); }

/** Temporarily hide the ad (sheets, dialogs) so it never covers buttons. `key` names who asked. */
export function setAdHold(key: string, on: boolean) {
  const had = holds.has(key);
  if (on) holds.add(key); else holds.delete(key);
  if (had !== on) refresh();
}
