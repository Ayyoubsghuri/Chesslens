# ChessLens → Android (Capacitor)

The app is wrapped with Capacitor: the same React build runs inside an Android WebView, and Stockfish, Maia and chess.js all keep working on-device.

## 1. Add these to your project (project root)
- `capacitor.config.ts`  (this kit)
- `.github/workflows/android-apk.yml`  (this kit)
- `assets/` folder  (app icon + splash screen, made into every Android size by the build)

## 2. vite.config.ts — make the base path switchable
```ts
export default defineConfig({
  base: process.env.CAP_BUILD ? './' : '/Chesslens/',
  // ...rest unchanged
});
```
(The web version on GitHub Pages keeps `/Chesslens/`; the Android build uses relative paths. The app already reads `import.meta.env.BASE_URL` for Stockfish and the Maia model, so nothing else changes.)

## 3. package.json
```
npm i @capacitor/core @capacitor/app @capacitor/status-bar @capacitor/splash-screen @capacitor/haptics
npm i -D @capacitor/cli @capacitor/android @capacitor/assets
```
Add to `"scripts"`:
```json
"build:android": "tsc -b && vite build",
"android:sync": "cross-env CAP_BUILD=1 npm run build:android && cap sync android"
```
(Use `npm i -D cross-env` if you build on Windows; or just run `set CAP_BUILD=1` first.)

## 4a. Easiest: get the APK from GitHub
Push the files, then GitHub → Actions → "Build Android APK" → Run workflow. Download `ChessLens-debug-apk` from the run, copy `app-debug.apk` to your phone and install it (allow "install unknown apps").
Make sure `public/models/maia3-5m.onnx` is committed, or the Maia rating won't work in the app.

## 4b. Or build locally (needs Android Studio)
```
npm run android:sync     # after: npx cap add android (first time only)
npx cap open android     # Build > Build APK(s)
```

## Notes
- Needs internet for: Puter voice, onnxruntime-web (CDN), Chess.com/Lichess imports.
- Debug APK is fine for your own phone. For Play Store you need a signed release build (AAB) — tell me and I'll add signing to the workflow.

## Design changes for the app (phone layout)
On phones the site now behaves like an app; tablets and desktop keep the normal website layout.
- **App bar** instead of the website header: back arrow + screen title (game name in a game) + settings. No tab row, no tagline.
- **Bottom tab bar** (Home · Learn · Openings · Puzzles · Play) with a gold active marker.
- **Import button** is a floating "+" on Home; the full-width **Analyze** button is big and thumb-sized.
- **Games list** is app-style rows with an icon, one-line details and a tappable area; delete-all tools are tucked behind a "…" button.
- **Home order**: your games first, Chess Story below as a compact card.
- **Analysis / Coach / Drills** is a segmented control; the pinned coach bubble sits under the app bar.
- **Import and Settings** open as bottom sheets that slide up (with a grab handle).
- Screens fade in on change; Android back button closes sheets, leaves a game, goes Home, then exits.
- Status bar in the page colour, splash screen + crown icon, no overscroll bounce, 44px touch targets, 16px inputs (no zoom).

### Game review screen (phone)
Laid out like a chess app: app bar → scrolling move strip (1. e4 e6 2. Nf3 …) → opponent bar → edge-to-edge board → your bar → bottom toolbar **Options · Coach · Best move (big gold button) · Back · Forward**. Options opens a sheet with Flip board, Best move, This move / Whole game, Coach tab, Drills and Re-analyze. The Coach button scrolls to the explanation under the board.
