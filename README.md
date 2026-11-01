# ChessLens

**Analyze. Learn. Improve.**

ChessLens is a chess game review app that runs in your browser. Import a game and Stockfish checks every move. You get move ratings and accuracy scores, and a coach explains your game step by step on the board, out loud if you want. It explains what went wrong, why the better move is better, and which plan you missed. The engine and the coach both run on your device, so you don't need an API key.

## Features

- **Game import**: pull games from Chess.com or paste a PGN.
- **Engine analysis**: Stockfish 18 (lite, WASM) evaluates every position in the game, entirely in the browser.
- **Move classification**: brilliant, great, best, excellent, good, book, inaccuracy, mistake, miss, blunder.
- **Accuracy and ACPL**: per-player accuracy % (Chess.com's own number when the game was reviewed there) and average centipawn loss, plus an evaluation graph.
- **Opening detection**: book moves are recognized and the opening is named.
- **Advanced coach**: for each move, a short walkthrough on the board with arrows and lit squares:
  - the verdict, and **why** (a piece left loose, a threat ignored, a tactic allowed or missed, a greedy capture, an edge that slowly slipped away),
  - **what happens next**, played out move by move,
  - **why the better move is better**, comparing your move with it side by side,
  - **the idea you missed**: the long-term plan the position was asking for.
- **Whole-game coach**: a spoken review of the full game. Choose **Every move** or **Highlights only**, jump with **Next mistake**, and review **Both sides**, **White only** or **Black only**.
- **Coach voice**: a deep, calm coach voice reads each step out loud, and the board lights up each square as it is spoken.
- **Best move**: shows the engine's best move on the board, then how the game would continue.
- **Why not this move?**: try any move on the board and the coach explains it the same way.
- **Find a better move**: after a mistake, retry the position, with hints.
- **Chess Story**: enter any Chess.com or Lichess username to get a shareable story from up to **10,000** recent games: record, openings, nemesis, how you win and lose, checkmates that beat you, opponents' weaknesses by rating. It also shows your **brilliant moves (!!)**, counted from the games you have analyzed in the app, because Chess.com and Lichess don't publish move labels in their APIs.
- **Learn Path, Openings trainer, Practice puzzles, Studies, Masters games, Play vs Computer.**
- **Drills**: practice positions built from your own mistakes.
- **Explore mode**: play your own moves on the board and get instant engine feedback.
- **Local storage**: games, analyses and settings are saved in your browser (`localStorage`).

## Tech stack

- React + TypeScript + Vite
- Tailwind CSS
- [chess.js](https://github.com/jhlywa/chess.js) for move generation and PGN handling
- [Stockfish](https://www.npmjs.com/package/stockfish) (`stockfish-18-lite-single`) running in Web Workers
- [Puter.js](https://docs.puter.com/AI/txt2speech/) for the coach voice (optional; falls back to the browser's built-in speech)
- [lucide-react](https://lucide.dev) icons

## Getting started

### Prerequisites

- Node.js 18 or later
- npm

### Install

```bash
npm install
```

### Add the Stockfish engine files

The engine is served as static files from `public/`, because Vite would otherwise try to bundle the worker and break the `.wasm` lookup. Copy the lite single-threaded build, and keep the `.js` and `.wasm` file names matching:

```bash
mkdir -p public/stockfish
cp node_modules/stockfish/stockfish-18-lite-single.js   public/stockfish/
cp node_modules/stockfish/stockfish-18-lite-single.wasm public/stockfish/
```

If your installed version lays out files differently, check `node_modules/stockfish/`.

The single-threaded build doesn't need `SharedArrayBuffer`, so **no special COOP/COEP headers are required**.

### Run

```bash
npm run dev
```

Then open the URL Vite prints. The app uses a base path, so the URL looks like `http://localhost:5173/Chesslens/`.

### Build

```bash
npm run build
npm run preview
```

## Using the app

1. Click **Import** and add a game from Chess.com or paste a PGN.
2. Select the game and click **Analyze Game**.
3. Step through moves in the **Analysis** tab. Each move shows its quality, its evaluation and the engine's best move. Press **Best move** to see it on the board.
4. In the coach bubble, choose **This move** for one move or **Whole game** for a full review. In **Whole game** you can pick **Both sides**, **White only** or **Black only**.
5. Use the **Drills** tab to practice positions where you went wrong.

### Settings

- **Engine depth**: 8 to 18. Stockfish lite can crash above depth 18, so the slider stops there. Use 12 to 15 for speed and 16 to 18 for stronger analysis.
- **Advanced coach mode**: the coach bubble explains each move step by step on the board.
- **Speak explanations**: turns the coach voice on. Pick a voice:

| Voice | What it is |
| --- | --- |
| **Coach (deep)** (default) | A deep, calm baritone (OpenAI "onyx" through Puter.js). It's told to speak like a coach at the board: slower on move names, a pause before the key idea, and stress on "because" and the lesson. |
| **Coach (gravelly)** | A rougher, lower voice (Gemini "Algenib" through Puter.js). |
| **Brian (classic)** | The original British voice (Amazon Polly "Brian"), played slightly deeper. |

If a voice can't play, the coach tries the next one automatically: the chosen voice first, then Brian, then your browser's own voice. For the browser voice, the coach picks the most natural male voice on your device and makes it lower and slower. Puter voices need you to be signed in to Puter (free). Older saved settings that say "Brian" switch to **Coach (deep)**; choose **Brian (classic)** to keep the old voice.

Changing the depth, or re-analyzing, recomputes the game. Saved analyses from older scoring logic are discarded automatically (see `ANALYSIS_SCHEMA_VERSION` in `storage.ts`).

## How analysis works

### Engine (`src/lib/engine.ts`)

- A **pool of up to 8 Stockfish workers** searches different positions in parallel. The pool size is your CPU core count minus one.
- All positions in a game are collected up front and queued as one batch. Each position is searched **once**, and a move's "before" evaluation is the previous move's "after" evaluation.
- Workers that crash or time out are discarded and replaced automatically.
- Evaluations are always from White's point of view (positive means White is better). Search uses `go depth N`, so results are deterministic for a given depth.

### Classification (`src/lib/analysis.ts`)

Each move is scored by how much win probability the mover lost, using the Lichess win% curve. The thresholds and the accuracy formula are tuned to land close to Chess.com's Game Review:

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

### Accuracy

- **Games reviewed on Chess.com** show **Chess.com's own accuracy**, so the number is exactly the same as on Chess.com. The app reads it from Chess.com's public API: either when you import from Chess.com, or later by looking the game up from its Chess.com link. The card then says *Chess.com accuracy*.
- **Other games** get an estimate calculated from Stockfish's evaluations, using the published Lichess method (`computeAccuracy` in `analysis.ts`). Each move is scored from the winning chances it lost. Sharp moments are weighted more, and the final number is the average of the weighted mean and the harmonic mean, which is why blunders hurt a lot. The card then says *Accuracy (estimated)*.
- **Why the estimate can't match Chess.com exactly:** Chess.com's formula (CAPS2) is not public, and its servers search much deeper than Stockfish lite in the browser. `DEPTH_COMPENSATION` in `analysis.ts` partly makes up for that. A higher engine depth brings the estimate closer.

### Brilliant moves (`src/lib/sacrifice.ts`)

A move is brilliant when all of these hold:

1. It is the engine's best move, or within 1.5 win% of it.
2. It is a sacrifice: after the engine's continuation, the mover's material dips at least 2 points below where it started, and the exchange does not settle back to about even, so ordinary trades do not count. A rook given up to win a queen qualifies.
3. The mover was not already winning big (under 85% win chance) and had no forced mate.
4. The mover is still fine afterward (at least 50% win chance).

Material values used: pawn 1, knight 3, bishop 3, rook 5, queen 9. The check reads the engine's continuation, so a very short line can hide a sacrifice. Higher depth helps.

## How the coach explains a move

Every sentence is built from facts checked on the board, either with chess.js or with Stockfish's own lines. Before the coach says "wins a rook", "fork" or "sacrifice", `claim-check.ts` plays the engine line forward to confirm it. The coach never makes up a threat or a tactic.

For a mistake, the coach goes through these steps:

1. **Verdict**: what kind of move it was and the main reason.
2. **Why**: the cause, such as a loose piece, an ignored threat, an allowed or missed tactic, a greedy capture, or an edge that slowly slipped away.
3. **What happens next**: the engine's reply, played out, then the result.
4. **Why the better move is better** (`src/lib/coach-compare.ts`). The coach puts your move and the better move side by side:
   - **The threat**: what your opponent wanted, and whether each move deals with it.
   - **What your move stopped guarding**: "every move stops guarding something".
   - **Your worst piece**: the coach counts each piece's safe squares and checks which move brings that piece into play.
   - **King safety, piece activity, pawn structure**: compared right after each move and again a few quiet moves later.
   - **Material**: who is ahead once the trades are finished.
   - **The verdict in plain words**, for example "Bg5 wins on piece activity, about half a pawn", followed by one rule of thumb to remember.
5. **The idea you missed**: the long-term plan the position was asking for, such as "put a rook on the open d-file". The coach only shows it when the better move is the first step of that plan.

When you play the best move, the coach gives the human reason it was right, for example "it improves your worst piece", instead of just saying "the engine agrees".

**Level**: beginners get the short, simple version. Advanced players see everything by default, and also get the strategy step on good moves.

## Project structure

```
public/
  stockfish/                Engine .js and .wasm (you copy these in)
src/
  App.tsx                   App shell, game library, pages and tabs
  main.tsx                  Entry point (loads App.tsx)
  components/
    AnalysisView.tsx        Board, eval bar, move review, Best move, explore mode
    AdvancedCoach.tsx       Plays one move's coach scenes, syncs voice and board
    GameCoach.tsx           Whole-game review (every move / highlights, White / Black / both)
    CoachBubble.tsx         Coach bubble on the board
    CoachPanel.tsx          Coach tab
    DrillsPanel.tsx         Practice positions
    ImportModal.tsx         Chess.com / PGN import
    MoveList.tsx            Move list with quality icons
    SettingsModal.tsx       Engine depth, coach mode, voice
    LearnPath.tsx, OpeningsTrainer.tsx, PuzzleTrainer.tsx, StudiesTrainer.tsx,
    MastersGames.tsx, PlayVsComputer.tsx   Training pages
  lib/
    engine.ts               Stockfish worker pool and eval helpers
    analysis.ts             Game analysis, classification, accuracy
    sacrifice.ts            Material-sacrifice detector for brilliant moves
    coach-explain.ts        Builds the coach scenes for a move
    coach-compare.ts        Why the better move is better + the plan you missed
    coach-game.ts           Whole-game review
    coach-voice.ts, coach-persona.ts, coach-method.ts   The coach's wording, personality and teaching method
    positional.ts           Positional facts: open files, outposts, weak pawns, king safety, plans
    tactics.ts, tactics-lookahead.ts   Forks, pins, skewers, threats
    claim-check.ts          Checks every claim against the engine's line
    tts.ts                  Coach voice (Puter.js voices, then browser speech)
    board-analysis.ts       Board facts (attacked pieces, checks, material)
    storage.ts              localStorage persistence and cache invalidation
    pgn.ts, openings.ts     PGN parsing and opening book
    types.ts                Shared types
```

## Troubleshooting

- **`Failed to resolve import "./App.tsx" from "src/main.tsx"`**: `src/App.tsx` is missing. Put it back in `src/`.
- **"Stockfish did not respond" / failed to load worker**: make sure `public/stockfish/stockfish-18-lite-single.js` and the matching `.wasm` exist and are served from your base path.
- **Engine crashes with `RuntimeError: unreachable`**: lower the depth to 18 or below.
- **Old numbers after changing scoring logic**: bump `ANALYSIS_SCHEMA_VERSION` in `storage.ts`, then re-analyze.
- **Voice says "Voice unavailable" or sounds robotic**: sign in to Puter to use the coach voices. Without Puter, the browser's own voice is used, and how good it sounds depends on the voices installed on your device. Edge and Chrome have natural-sounding ones.
- **Memory on low-end devices**: each worker holds its own WASM instance and a 16 MB hash table. Lower `MAX_WORKERS` in `engine.ts`.

## Privacy

Games, analyses and settings stay in your browser's `localStorage`. Engine analysis and the coach's explanations run on your device. If you turn on the coach voice and are signed in to Puter, the text being spoken is sent to Puter to turn into audio. Otherwise your browser's built-in speech is used, and nothing is sent anywhere.

## License

Stockfish is licensed under GPL-3.0, so check its terms before you distribute a build that includes the engine files.
