export type SkillStatus = 'locked' | 'available' | 'in_progress' | 'completed';

/** Where this skill's practice lives inside ChessLens */
export type PracticeTarget =
  | { type: 'puzzles'; theme: string; label: string }
  | { type: 'puzzles-multi'; themes: string[]; label: string }
  | { type: 'play'; elo?: number; coach?: boolean; label: string }
  | { type: 'openings'; label: string }
  | { type: 'home-review'; label: string }
  | { type: 'manual'; label: string };

export interface Skill {
  id: string;
  title: string;
  description: string;
  levelId: string;
  targetCount: number;
  tip?: string;
  practice: PracticeTarget[];
}

export interface Level {
  id: string;
  number: number;
  title: string;
  goal: string;
  color: string;
  skills: Skill[];
  levelDrill: string;
  levelPractice?: PracticeTarget[];
}

export interface SkillProgress {
  status: SkillStatus;
  completedCount: number;
  completedAt?: string;
}

export interface LearnProgress {
  skills: Record<string, SkillProgress>;
  xp: number;
  streak: number;
  lastActiveDate?: string;
  dailyRoutine?: {
    puzzles: boolean;
    lesson: boolean;
    games: boolean;
    review: boolean;
    date: string;
  };
  activeSkillId?: string | null;
}

export const LEVELS: Level[] = [
  {
    id: 'level-1',
    number: 1,
    title: 'The Foundations',
    goal: 'Learn how the pieces move without accidentally dropping your phone.',
    color: 'emerald',
    levelDrill: 'Play 5 games against a bot where your only goal is to legally checkmate with a King and Queen.',
    levelPractice: [
      { type: 'play', elo: 600, coach: true, label: 'Play 5 beginner games (coach on)' },
      { type: 'puzzles', theme: 'mateIn1', label: 'Mate-in-1 puzzles' },
    ],
    skills: [
      {
        id: '1.1',
        title: 'The Board & Coordinates',
        description: 'Master files (a–h), ranks (1–8), light/dark squares, and "White on the right."',
        levelId: 'level-1',
        targetCount: 10,
        tip: 'Always say the square name out loud when you move a piece.',
        practice: [
          { type: 'play', elo: 600, coach: true, label: 'Play a beginner game — name every square you move to' },
          { type: 'manual', label: 'Quiz yourself: point at random squares and name them' },
        ],
      },
      {
        id: '1.2',
        title: 'Piece Movement & Point Values',
        description: 'Rook (5), Bishop (3), Knight (3), Queen (9), Pawn (1), and King (priceless).',
        levelId: 'level-1',
        targetCount: 12,
        tip: 'Knights jump; bishops stay on the same color forever.',
        practice: [
          { type: 'play', elo: 600, coach: true, label: 'Play vs Computer (Beginner) with coach mode' },
          { type: 'puzzles', theme: 'hangingPiece', label: 'Hanging-piece puzzles (spot free material)' },
        ],
      },
      {
        id: '1.3',
        title: 'Game Ends & Rules',
        description: 'Check, Checkmate, Stalemate (draw), Castling, En Passant, and Pawn Promotion.',
        levelId: 'level-1',
        targetCount: 15,
        tip: 'Castling needs a clear path, an unmoved king & rook, and the king must not pass through check.',
        practice: [
          { type: 'puzzles', theme: 'mateIn1', label: 'Mate-in-1 puzzles' },
          { type: 'puzzles', theme: 'mateIn2', label: 'Mate-in-2 puzzles' },
          { type: 'play', elo: 600, coach: true, label: 'Play until you deliver checkmate' },
        ],
      },
    ],
  },
  {
    id: 'level-2',
    number: 2,
    title: 'Opening Principles & Survival',
    goal: 'Reach move 10 without getting checkmated or losing your Queen.',
    color: 'sky',
    levelDrill: 'Play 10 games focusing only on developing all pieces before moving any piece twice.',
    levelPractice: [
      { type: 'play', elo: 800, coach: true, label: 'Play 10 games — develop every piece once before repeating' },
      { type: 'openings', label: 'Browse opening studies & quick lines' },
    ],
    skills: [
      {
        id: '2.1',
        title: 'The 3 Golden Rules',
        description: '1. Control the Center (e4, d4, e5, d5). 2. Develop Minor Pieces (Knights before Bishops). 3. King Safety (Castle early).',
        levelId: 'level-2',
        targetCount: 12,
        tip: 'Knights before bishops. Castle before you attack.',
        practice: [
          { type: 'openings', label: 'Learn a basic opening line (Italian / London / e4 e5)' },
          { type: 'play', elo: 800, coach: true, label: 'Play focusing on center + development + castle' },
        ],
      },
      {
        id: '2.2',
        title: 'Trap Avoidance',
        description: "Recognizing and stopping the Scholar’s Mate (4-move checkmate) and Fool's Mate.",
        levelId: 'level-2',
        targetCount: 10,
        tip: 'Against 1.e4 e5 2.Bc4 Qh5? just play 2…Nc6 or 2…Nf6 and stay calm.',
        practice: [
          { type: 'play', elo: 600, coach: true, label: 'Play vs weak bot — defend Scholar’s Mate attempts' },
          { type: 'puzzles', theme: 'mate', label: 'Mate puzzles (spot early threats)' },
        ],
      },
    ],
  },
  {
    id: 'level-3',
    number: 3,
    title: 'Tactical "Software"',
    goal: 'Process over Patterns — train the forcing-moves workflow.',
    color: 'violet',
    levelDrill: 'Solve 15 puzzles a day where you check every check and capture on the board before choosing a move.',
    levelPractice: [
      { type: 'puzzles', theme: 'all', label: '15 mixed puzzles — scan Checks, Captures, Threats first' },
    ],
    skills: [
      {
        id: '3.1',
        title: 'The Forcing-Moves Workflow',
        description: 'Before every single move, force your brain to scan: Checks? Captures? Threats?',
        levelId: 'level-3',
        targetCount: 15,
        tip: 'CCT: Checks → Captures → Threats. Never skip the scan.',
        practice: [
          { type: 'puzzles', theme: 'all', label: 'Mixed puzzles — force CCT before every move' },
          { type: 'play', elo: 1000, coach: true, label: 'Play with coach mode (retry bad moves)' },
        ],
      },
      {
        id: '3.2',
        title: 'Spotting Tactical Triggers',
        description: 'Recognizing Loose Pieces (unprotected assets), King Exposure, and Back-Rank Vulnerabilities.',
        levelId: 'level-3',
        targetCount: 15,
        tip: 'A piece is "loose" if it has zero defenders. Always count attackers vs defenders.',
        practice: [
          { type: 'puzzles', theme: 'hangingPiece', label: 'Hanging piece puzzles' },
          { type: 'puzzles', theme: 'exposedKing', label: 'Exposed king puzzles' },
          { type: 'puzzles', theme: 'backRankMate', label: 'Back-rank mate puzzles' },
        ],
      },
      {
        id: '3.3',
        title: 'Step-by-Step Calculation',
        description: 'Looking 1, 2, and 3 moves ahead without "hallucinating" or missing opponent counter-attacks.',
        levelId: 'level-3',
        targetCount: 12,
        tip: 'After your candidate move, always ask: "What is their best reply?"',
        practice: [
          { type: 'puzzles', theme: 'mateIn2', label: 'Mate-in-2 (force 2-move calculation)' },
          { type: 'puzzles', theme: 'mateIn3', label: 'Mate-in-3 (stretch to 3 moves)' },
        ],
      },
    ],
  },
  {
    id: 'level-4',
    number: 4,
    title: 'Tactical "Content"',
    goal: 'The building blocks of winning — core motifs & patterns.',
    color: 'amber',
    levelDrill: 'Do themed puzzle blocks (e.g. a whole day of only Pins, then only Forks).',
    levelPractice: [
      { type: 'puzzles', theme: 'fork', label: 'Fork day' },
      { type: 'puzzles', theme: 'pin', label: 'Pin day' },
    ],
    skills: [
      {
        id: '4.1',
        title: 'The Fork & Double Attack',
        description: 'Hitting two pieces at once (especially with Knights and Pawns).',
        levelId: 'level-4',
        targetCount: 15,
        tip: 'Knight forks on f7 / c7 / f2 / c2 are classic. Look for unprotected royals.',
        practice: [{ type: 'puzzles', theme: 'fork', label: 'Fork puzzles' }],
      },
      {
        id: '4.2',
        title: 'The Pin & Skewer',
        description: 'Freezing a piece that cannot move because a valuable piece is behind it (Pin), or forcing a valuable piece to move to capture what’s behind it (Skewer).',
        levelId: 'level-4',
        targetCount: 15,
        tip: 'Absolute pin = pinned to the King. Relative pin = pinned to a higher-value piece.',
        practice: [
          { type: 'puzzles', theme: 'pin', label: 'Pin puzzles' },
          { type: 'puzzles', theme: 'skewer', label: 'Skewer puzzles' },
        ],
      },
      {
        id: '4.3',
        title: 'Discovered & Double Checks',
        description: 'Moving a piece to reveal a hidden attack or check from a Rook, Bishop, or Queen.',
        levelId: 'level-4',
        targetCount: 12,
        tip: 'Double check is almost always answered only by moving the King.',
        practice: [
          { type: 'puzzles', theme: 'discoveredAttack', label: 'Discovered attack puzzles' },
          { type: 'puzzles', theme: 'doubleCheck', label: 'Double check puzzles' },
        ],
      },
      {
        id: '4.4',
        title: 'Removing the Defender & Deflection',
        description: 'Eliminating or luring away the piece guarding an enemy target.',
        levelId: 'level-4',
        targetCount: 12,
        tip: 'If the defender is overloaded, deflect it with a check or sacrifice.',
        practice: [
          { type: 'puzzles', theme: 'deflection', label: 'Deflection puzzles' },
          { type: 'puzzles', theme: 'capturingDefender', label: 'Remove the defender puzzles' },
        ],
      },
      {
        id: '4.5',
        title: 'Zwischenzug (The In-Between Move)',
        description: 'Inserting an unexpected check or threat before a standard recapture.',
        levelId: 'level-4',
        targetCount: 10,
        tip: 'Before you automatically recapture, ask: "Is there a check or stronger threat first?"',
        practice: [{ type: 'puzzles', theme: 'intermezzo', label: 'Zwischenzug / intermezzo puzzles' }],
      },
    ],
  },
  {
    id: 'level-5',
    number: 5,
    title: 'Checkmating Nets & Finishes',
    goal: 'Deliver lethal blows when the enemy king is weak.',
    color: 'rose',
    levelDrill: 'Complete checkmate-in-1 and checkmate-in-2 puzzle rushes until reaction time is under 3 seconds.',
    levelPractice: [
      { type: 'puzzles', theme: 'mateIn1', label: 'Mate-in-1 rush' },
      { type: 'puzzles', theme: 'mateIn2', label: 'Mate-in-2 rush' },
    ],
    skills: [
      {
        id: '5.1',
        title: 'Back-Rank Mate',
        description: 'Trapping a castled king behind its own pawns.',
        levelId: 'level-5',
        targetCount: 12,
        tip: 'Always leave a "luft" square (h3/h6 or a3/a6) for your own king.',
        practice: [{ type: 'puzzles', theme: 'backRankMate', label: 'Back-rank mate puzzles' }],
      },
      {
        id: '5.2',
        title: 'Smothered Mate',
        description: 'Delivering checkmate with a Knight where the enemy King is completely trapped by its own pieces.',
        levelId: 'level-5',
        targetCount: 10,
        tip: 'Classic pattern: Queen sacrifice on g8, then Knight to f7 (or f2).',
        practice: [{ type: 'puzzles', theme: 'smotheredMate', label: 'Smothered mate puzzles' }],
      },
      {
        id: '5.3',
        title: "Anastasia’s & Boden’s Mates",
        description: 'Classic coordinate traps using rooks, knights, and bishops.',
        levelId: 'level-5',
        targetCount: 10,
        tip: 'Boden’s mate = two bishops on crossing diagonals. Anastasia = Rook + Knight on the edge.',
        practice: [
          { type: 'puzzles', theme: 'mate', label: 'General mate-pattern puzzles' },
          { type: 'puzzles', theme: 'mateIn2', label: 'Mate-in-2 pattern drills' },
        ],
      },
    ],
  },
  {
    id: 'level-6',
    number: 6,
    title: 'Strategic Planning & Piece Coordination',
    goal: 'Transition from winning random pieces to executing a long-term plan.',
    color: 'indigo',
    levelDrill: 'Review your own lost games without an engine first. Find the exact turn where your pieces became uncoordinated.',
    levelPractice: [
      { type: 'home-review', label: 'Open a lost game → review without engine first' },
      { type: 'play', elo: 1200, coach: false, label: 'Play a thoughtful rapid game' },
    ],
    skills: [
      {
        id: '6.1',
        title: 'Prophylaxis',
        description: 'Asking "What is my opponent trying to do?" before executing your own plan.',
        levelId: 'level-6',
        targetCount: 10,
        tip: 'Spend 5 seconds every move asking what their last move threatened.',
        practice: [
          { type: 'play', elo: 1200, coach: true, label: 'Play with coach — pause and ask "what are they threatening?"' },
          { type: 'home-review', label: 'Review a lost game: find where you ignored their plan' },
        ],
      },
      {
        id: '6.2',
        title: 'Piece Activity & Open Files',
        description: 'Placing Rooks on open files and locking down strong outpost squares for Knights.',
        levelId: 'level-6',
        targetCount: 12,
        tip: 'An outpost is a square that cannot be attacked by enemy pawns.',
        practice: [
          { type: 'openings', label: 'Study lines that fight for open files / outposts' },
          { type: 'play', elo: 1200, coach: false, label: 'Play focusing on rook activity' },
        ],
      },
      {
        id: '6.3',
        title: 'Basic Pawn Structures',
        description: 'Recognizing isolated, doubled, and passed pawns.',
        levelId: 'level-6',
        targetCount: 10,
        tip: 'Passed pawns must be pushed. Isolated pawns need piece support.',
        practice: [
          { type: 'puzzles', theme: 'advancedPawn', label: 'Advanced / passed pawn puzzles' },
          { type: 'puzzles', theme: 'pawnEndgame', label: 'Pawn endgame puzzles' },
          { type: 'home-review', label: 'In your games, label isolated / doubled / passed pawns' },
        ],
      },
    ],
  },
  {
    id: 'level-7',
    number: 7,
    title: 'Endgame Mastery',
    goal: 'Convert material advantages into absolute victory when the board is empty.',
    color: 'teal',
    levelDrill: 'Practice King + Pawn vs. King endgames against a computer bot until you win 10 times in a row.',
    levelPractice: [
      { type: 'play', elo: 1000, coach: true, label: 'Play endgame-heavy games (simplify when ahead)' },
      { type: 'puzzles', theme: 'pawnEndgame', label: 'Pawn endgame puzzles' },
    ],
    skills: [
      {
        id: '7.1',
        title: 'King + Queen / King + Rook Checkmates',
        description: 'Clean, clinical execution of the basic checkmates.',
        levelId: 'level-7',
        targetCount: 12,
        tip: 'Box the king to the edge, then deliver mate. Avoid stalemate!',
        practice: [
          { type: 'puzzles', theme: 'mateIn1', label: 'Mate-in-1 (basic patterns)' },
          { type: 'puzzles', theme: 'mateIn2', label: 'Mate-in-2 with heavy pieces' },
          { type: 'play', elo: 800, coach: true, label: 'Play and force K+Q or K+R endgames' },
        ],
      },
      {
        id: '7.2',
        title: 'Pawn Endgames & The Opposition',
        description: 'Using your King as an active attacking piece and understanding the Square Rule for racing pawns.',
        levelId: 'level-7',
        targetCount: 15,
        tip: 'Opposition = kings face each other with one square between. The side not to move often has the opposition.',
        practice: [
          { type: 'puzzles', theme: 'pawnEndgame', label: 'Pawn endgame puzzles' },
          { type: 'puzzles', theme: 'endgame', label: 'General endgame puzzles' },
        ],
      },
      {
        id: '7.3',
        title: 'Simplification',
        description: 'Knowing when to trade pieces to safely cruise into a winning endgame.',
        levelId: 'level-7',
        targetCount: 10,
        tip: 'When ahead in material, trade pieces (not pawns). When behind, keep pieces on the board.',
        practice: [
          { type: 'play', elo: 1200, coach: true, label: 'Play — when up material, trade down deliberately' },
          { type: 'home-review', label: 'Review wins: where did simplification decide the game?' },
        ],
      },
    ],
  },
];

export const XP_PER_SKILL_COMPLETE = 50;
export const XP_PER_DRILL = 5;
export const XP_DAILY_ROUTINE = 25;