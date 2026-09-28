# ChessLens

**Analyze. Learn. Improve.**

ChessLens is a browser-based chess game review app. Import a game, run Stockfish on every move, get move classifications and accuracy scores, and ask an AI coach to explain what happened. Everything runs locally in your browser except the optional coach, which calls OpenAI.

## Features

- **Game import**: pull games from Chess.com or paste a PGN.
- **Engine analysis**: Stockfish 18 (lite, WASM) evaluates every position in the game, entirely in the browser.
- **Move classification**: brilliant, great, best, excellent, good, book, inaccuracy, mistake, miss, blunder.
- **Accuracy and ACPL**: per-player accuracy % and average centipawn loss.
- **Opening detection**: book moves are recognized and the opening is named.
- **AI coach**: explains why a move was good or bad, and walks through the engine's best line. Moves in the explanation can be previewed on the board.
- **Best-line playback**: step through or auto-play the engine's recommended continuation.
- **Drills**: practice positions built from your own mistakes.
- **Explore mode**: play your own moves on the board and get instant engine feedback.
- **Local storage**: games, analyses and settings are saved in your browser (`localStorage`).

## Tech stack

- React + TypeScript + Vite
- Tailwind CSS
- [chess.js](https://github.com/jhlywa/chess.js) for move generation and PGN handling
- [Stockfish](https://www.npmjs.com/package/stockfish) (`stockfish-18-lite-single`) running in Web Workers
- [lucide-react](https://lucide.dev) icons
- OpenAI API for the optional coach

## Getting started

### Prerequisites

- Node.js 18 or later
- npm

### Install

```bash
npm install
```

### Add the Stockfish engine files

The engine is served as static files from `public/` (Vite would otherwise try to bundle the worker and break the `.wasm` lookup). Copy the lite single-threaded build and keep the `.js` and `.wasm` names matching:

```bash
mkdir -p public/stockfish
cp node_modules/stockfish/stockfish-18-lite-single.js   public/stockfish/
cp node_modules/stockfish/stockfish-18-lite-single.wasm public/stockfish/
```

If your installed version lays out files differently, check `node_modules/stockfish/`.

The single-threaded build needs no `SharedArrayBuffer`, so **no special COOP/COEP headers are required**.

### Run

```bash
npm run dev
```

Then open the URL Vite prints (the app uses a base path, e.g. `http://localhost:5173/Chesslens/`).

### Build

```bash
npm run build
npm run preview
```

## Using the app

1. Click **Import** and add a game from Chess.com or paste a PGN.
2. Select the game and click **Analyze Game**.
3. Step through moves in the **Analysis** tab. Each move shows its quality, evaluation and the engine's best move.
4. Open the **Coach** tab (or click explain on a move) for an AI explanation.
5. Use the **Drills** tab to practice positions where you went wrong.

### Settings

- **OpenAI API key**: needed only for coach explanations. It is stored in your browser and never sent anywhere except to OpenAI.
- **Coach model**: GPT-4o Mini, GPT-4o, GPT-4 Turbo or GPT-3.5 Turbo.
- **Engine depth**: 8 to 18. Stockfish lite can crash above depth 18, so the slider is capped there. Use 12 to 15 for speed and 16 to 18 for stronger analysis.

Changing the depth, or re-analyzing, recomputes the game. Saved analyses from older scoring logic are discarded automatically (see `ANALYSIS_SCHEMA_VERSION` in `storage.ts`).

## How analysis works

### Engine (`src/lib/engine.ts`)

- A **pool of up to 4 Stockfish workers** (capped at your CPU cores minus one) searches different positions in parallel.
- All positions in a game are collected up front and queued as one batch. Each position is searched **once**, and a move's "before" evaluation is the previous move's "after" evaluation.
- Workers that crash or time out are discarded and replaced automatically.
- Evaluations use a White-positive convention. Search uses `go depth N`, so results are deterministic for a given depth.

### Classification (`src/lib/analysis.ts`)

Each move is scored by how much win probability the mover lost, using the Lichess win% curve. Thresholds and accuracy are tuned to land near Chess.com Game Review:

| Win% loss (adjusted) | Quality |
| --- | --- |
| < 0.4 | Best |
| < 1.2 | Excellent |
| < 2.5 | Good |
| < 6 | Inaccuracy |
| < 12 | Mistake |
| 12+ | Blunder |

Special cases:

- **Book**: moves that follow known opening theory.
- **Miss**: the mover had a winning position (win% above 88 or a forced mate) and gave it up.
- **Great**: a best move that takes the position from roughly equal to clearly winning.
- **Brilliant**: a real **material sacrifice** that keeps the advantage. See below.

Accuracy uses a weighted power mean so that mistakes pull the score down harder than a plain average.

### Brilliant moves (`src/lib/sacrifice.ts`)

A move is brilliant when all of these hold:

1. It is the engine's best move, or within 1.5 win% of it.
2. It is a sacrifice: after the engine's continuation, the mover's material dips at least 2 points below where it started, and the exchange does not settle back to about even (so ordinary trades do not count). A rook given up to win a queen qualifies.
3. The mover was not already winning big (under 85% win chance) and had no forced mate.
4. The mover is still fine afterward (at least 50% win chance).

Material values used: pawn 1, knight 3, bishop 3, rook 5, queen 9. The check reads the engine's continuation, so a very short line can hide a sacrifice. Higher depth helps.

## Project structure

```
public/
  stockfish/                Engine .js and .wasm (you copy these in)
src/
  App.tsx                   App shell, game library, tabs
  components/
    AnalysisView.tsx        Board, eval bar, move review, explore mode
    CoachPanel.tsx          AI coach and best-line playback
    DrillsPanel.tsx         Practice positions
    ImportModal.tsx         Chess.com / PGN import
    MoveList.tsx            Move list with quality icons
    SettingsModal.tsx       API key, coach model, engine depth
  lib/
    engine.ts               Stockfish worker pool and eval helpers
    analysis.ts             Game analysis, classification, accuracy
    sacrifice.ts            Material-sacrifice detector for brilliant moves
    board-analysis.ts       Board facts fed to the coach (attacked pieces, checks, material)
    storage.ts              localStorage persistence and cache invalidation
    coach.ts                OpenAI prompts
    pgn.ts, openings.ts     PGN parsing and opening book
    types.ts                Shared types
```

## Troubleshooting

- **"Stockfish did not respond" / failed to load worker**: make sure `public/stockfish/stockfish-18-lite-single.js` and the matching `.wasm` exist and are served from your base path.
- **Engine crashes with `RuntimeError: unreachable`**: lower the depth to 18 or below.
- **Old numbers after changing scoring logic**: bump `ANALYSIS_SCHEMA_VERSION` in `storage.ts`, then re-analyze.
- **Coach buttons disabled**: add your OpenAI API key in Settings.
- **Memory on low-end devices**: each worker holds its own WASM instance and 16 MB hash. Lower `MAX_WORKERS` in `engine.ts`.

## Privacy

Games, analyses and settings stay in your browser's `localStorage`. Engine analysis runs on your device. If you use the AI coach, the position and move details are sent to OpenAI using your own API key.

## License

Add your license here.

Stockfish is licensed under GPL-3.0, so check its terms before distributing a build that bundles the engine files.
