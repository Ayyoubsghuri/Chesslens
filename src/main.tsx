import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './index.css';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { initNative, isNative } from './native';
import { applySkin } from './skin';

applySkin();
initNative();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Vercel visitor / page-view counting. Web only: the Android app has no Vercel endpoint to report to. */}
    {!isNative() && <Analytics />}
    {/* Vercel Speed Insights. Web only: the Android app has no Vercel endpoint to report to. */}
    {!isNative() && <SpeedInsights />}
  </StrictMode>
);