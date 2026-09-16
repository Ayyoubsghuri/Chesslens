import type { Move } from 'chess.js';

export type PieceColor = 'w' | 'b';

export interface EngineEval {
  fen: string;
  bestMove: string | null;
  continuation: string;
  evaluation: number | null;
  mate: number | null;
  depth: number;
  success: boolean;
}

export type MoveQuality =
  | 'brilliant'   // ← NEW
  | 'best'
  | 'great'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'miss';

export interface OpeningInfo {
  eco: string;
  name: string;
}

export interface AnalyzedMove {
  index: number;
  color: PieceColor;
  san: string;
  fenBefore: string;
  fenAfter: string;
  evalBefore: EngineEval | null;
  evalAfter: EngineEval | null;
  quality: MoveQuality;
  evalDelta: number | null;
  evalLoss: number | null;
  /** Win-probability points (0-100 scale) lost by the mover, from the mover's perspective. */
  winPercentLoss: number | null; // ← NEW
  isBestMove: boolean;
  isCheck: boolean;
  /** Deepest named opening reached on the book path up to and including this move (book moves only). */
  opening: OpeningInfo | null;
}

export interface ParsedGame {
  pgn: string;
  headers: Record<string, string>;
  moves: Move[];
  white: string;
  black: string;
  result: string;
  date: string;
  site: string;
  url: string;
  timeControl: string;
  eco: string;
}

export interface ImportedGame {
  id: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  date: string;
  eco: string;
  timeControl: string;
  site: string;
  url: string;
}

export interface AnalysisResult {
  game: ImportedGame;
  moves: AnalyzedMove[];
  accuracy: { white: number; black: number };
  acpl: { white: number; black: number };
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  bestMoves: number;
  greatMoves: number;
  brilliantMoves: number;  // ← NEW
  opening: OpeningInfo | null; // ← NEW: from the lichess-org/chess-openings book
}

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
  fen?: string;
}

export interface Drill {
  id: string;
  fen: string;
  theme: string;
  description: string;
  solutionMoves: string[];
  sourceMoveIndex: number;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface Settings {
  openaiApiKey: string;
  analysisDepth: number;
  coachModel: string;
}

export type View = 'analysis' | 'coach' | 'drills';