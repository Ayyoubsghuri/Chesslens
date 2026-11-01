import type { CapacitorConfig } from '@capacitor/cli';

// The app is dark; change PAGE if your `ink-950` colour is different.
const PAGE = '#0a1311';
// The splash screen shows the logo on off-white.
const SPLASH = '#f7f7f5';

const config: CapacitorConfig = {
  appId: 'com.ayyoub.chesslens',
  appName: 'ChessLens',
  webDir: 'dist',
  backgroundColor: PAGE,
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 1200, launchAutoHide: false, backgroundColor: SPLASH, showSpinner: false },
    StatusBar: { style: 'DARK', backgroundColor: PAGE, overlaysWebView: false },
  },
};

export default config;