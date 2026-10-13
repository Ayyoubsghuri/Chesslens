// Learn Path curriculum: 100 → 1600 Elo.
// Place in src/lib/learnCurriculum.ts
//
// Sequencing is based on common coaching roadmaps: tactics before openings, mates and
// piece safety first, then pattern packs (fork/pin/skewer → discovered/deflection/remove the
// defender → attraction/interference/x-ray), simple pawn endings before rook endings, and
// plans/pawn structure from ~1200. Sources: Chess.com improvement roadmaps, the Dutch "Steps
// Method", Chess Steps / Chessiverse / USCF-style roadmaps, Lichess puzzle themes.
// Rating bands are approximate (online rapid ratings) and meant as guidance, not a test.
//
// In src/lib/learnTypes.ts delete the old LEVELS constant and add:
//   export { LEVELS } from './learnCurriculum';
import type { Level, Skill, PracticeTarget } from './learnTypes';

export interface Lesson {
  /** One sentence: why this skill wins games at this level. */
  why: string;
  /** The actual things to learn. */
  ideas: string[];
  /** Typical errors players make with this skill. */
  mistakes?: string[];
  /** A concrete way to check you've got it. */
  selfCheck?: string;
  /** A mini game (shown lower on the Learn Path) that trains this skill. */
  miniGame?: 'coords' | 'knight' | 'value';
  /** Books / free resources, optional. */
  study?: string[];
}

export type RichSkill = Skill & { lesson?: Lesson };
export type RichLevel = Omit<Level, 'skills'> & {
  /** Approximate rating band, e.g. "400–600" */
  elo: string;
  /** What this stage is about, in one or two sentences. */
  summary: string;
  /** Suggested weekly routine for this stage. */
  routine: string[];
  /** Honest checklist: you're ready for the next stage when… */
  readyWhen: string[];
  skills: RichSkill[];
};

/* ---------- practice shortcuts ---------- */
const puz = (theme: string, label: string): PracticeTarget => ({ type: 'puzzles', theme, label }) as PracticeTarget;
const puzMulti = (themes: string[], label: string): PracticeTarget => ({ type: 'puzzles-multi', themes, label }) as PracticeTarget;
const play = (label: string): PracticeTarget => ({ type: 'play', label }) as PracticeTarget;
const openings = (label: string): PracticeTarget => ({ type: 'openings', label }) as PracticeTarget;
const review = (label: string): PracticeTarget => ({ type: 'home-review', label }) as PracticeTarget;
const manual = (label: string): PracticeTarget => ({ type: 'manual', label }) as PracticeTarget;

type SkillInput = Omit<RichSkill, 'id' | 'levelId'>;
const skills = (lv: number, items: SkillInput[]): RichSkill[] =>
  items.map((s, i) => ({ ...s, id: `${lv}.${i + 1}`, levelId: `level-${lv}` }) as RichSkill);

export const LEVELS: RichLevel[] = [
  /* ===================================================================== */
  /* LEVEL 1 · 100–400                                                      */
  /* ===================================================================== */
  {
    id: 'level-1',
    number: 1,
    title: 'Learn the Game',
    elo: '100–400',
    color: 'emerald',
    goal: 'Know every rule, see one-move mates, and stop giving pieces away for free.',
    summary:
      'Rules, piece values, check and checkmate, the three opening principles and the first mates. The big habit: before you move, look at what the piece you move lands on.',
    routine: [
      'Daily (10–15 min): mate-in-1 puzzles',
      '2–3 games a week vs the computer at a low rating, slow time control',
      'Play the Coordinate Sprint and Material Count mini games a few times',
    ],
    readyWhen: [
      'You never forget a rule (castling, en passant, stalemate)',
      'You find a mate in 1 almost every time',
      'You can checkmate with King+Queen and King+Rook vs a lone King',
      'You check whether the square you move to is attacked',
    ],
    levelDrill: 'Beat the computer at a low rating without losing a single piece for nothing.',
    levelPractice: [play('Play vs Computer'), puz('mateIn1', 'Mate in 1')],
    skills: skills(1, [
      {
        title: 'Board & Coordinates',
        description: 'Name any square instantly (e4, g7…) and know ranks, files and diagonals.',
        targetCount: 3,
        tip: 'Light square on your right in the corner: "white on right". Coordinates make every later lesson easier.',
        practice: [manual('Play Coordinate Sprint (Mini games below)')],
        lesson: {
          why: 'Every lesson, puzzle and notation uses coordinates. Slow square-finding costs you time and accuracy forever.',
          ideas: [
            'Files are columns a–h, ranks are rows 1–8; White starts on ranks 1–2.',
            'Each square has a colour: a1 is dark, h1 is light. Bishops stay on one colour for the whole game.',
            'Diagonals share a colour; ranks and files alternate colours.',
          ],
          mistakes: ['Mixing up files and ranks when reading a move like "Nf3".'],
          selfCheck: 'Score 30+ in the 60-second Coordinate Sprint.',
          miniGame: 'coords',
        },
      },
      {
        title: 'How the Pieces Move',
        description: 'Pawns, knights, bishops, rooks, queens and kings, including captures, castling, en passant and promotion.',
        targetCount: 3,
        tip: 'Pawns capture diagonally but move straight. Most beginner rule mistakes are pawn rules.',
        practice: [play('Play vs Computer')],
        lesson: {
          why: 'You cannot plan or defend with a piece whose moves you are unsure about.',
          ideas: [
            'Knight: L-shape, the only piece that jumps. Bishop: diagonal. Rook: straight. Queen: both. King: one square.',
            'Pawn: forward one (two from its start square), captures diagonally, promotes on the last rank (usually to a queen).',
            'Castling: king and rook have not moved, nothing between them, king not in check and not passing through an attacked square.',
            'En passant: only immediately after an enemy pawn jumps two squares next to yours.',
          ],
          mistakes: ['Castling out of, through or into check.', 'Forgetting that a promoted pawn can become any piece.'],
          selfCheck: 'Explain castling and en passant out loud without looking anything up.',
          miniGame: 'knight',
        },
      },
      {
        title: 'Piece Values & Fair Trades',
        description: 'Pawn 1, knight 3, bishop 3, rook 5, queen 9. Know when a trade wins, loses or is even.',
        targetCount: 3,
        tip: 'Before any capture ask: what do I give, what do I get, and what can they take back?',
        practice: [manual('Play Material Count (Mini games below)'), play('Play vs Computer')],
        lesson: {
          why: 'Winning material is the simplest way to win at this level, and trading badly is the simplest way to lose.',
          ideas: [
            'Values are a guide: P=1, N=3, B=3, R=5, Q=9. The king has no value because it cannot be traded.',
            'Trade up when you are ahead: even trades make a lead bigger.',
            'Rook for knight or bishop (5 for 3) loses material, unless it wins something else.',
          ],
          mistakes: ['Taking a protected pawn with a queen.', 'Giving a rook for a pawn and a "good position".'],
          selfCheck: 'Score 9/10 in Material Count.',
          miniGame: 'value',
        },
      },
      {
        title: 'Check, Checkmate & Stalemate',
        description: 'Escape check in three ways (move, block, capture), recognise checkmate, and avoid accidental stalemate.',
        targetCount: 15,
        tip: 'Stalemate (no legal move but not in check) is a draw. Do not stalemate when you are winning.',
        practice: [puz('mateIn1', 'Mate in 1 puzzles')],
        lesson: {
          why: 'Games end with mate. If you see mate in 1 for both sides, you win games and stop losing to cheap tricks.',
          ideas: [
            'Three ways out of check: move the king, block, or capture the checking piece.',
            'Double check can only be answered by moving the king.',
            'Stalemate = draw. When you are far ahead, always leave the enemy king a legal move before you aim for mate.',
          ],
          mistakes: ['Ignoring a check because "my other piece is attacked too".'],
          selfCheck: 'Solve 10 mate-in-1 puzzles in a row.',
        },
      },
      {
        title: 'Three Opening Principles',
        description: 'Control the centre, develop knights and bishops, castle early.',
        targetCount: 2,
        tip: 'Do not move the same piece twice in the opening without a reason. Do not bring the queen out early.',
        practice: [openings('Open the Openings trainer')],
        lesson: {
          why: 'Principles are enough for the first ten moves at this level. You do not need to memorise theory yet.',
          ideas: [
            'Centre: put pawns on e4/d4 (or e5/d5) and control the middle squares.',
            'Development: bring knights and bishops out before the queen and rooks.',
            'King safety: castle early, usually within the first 8–10 moves.',
          ],
          mistakes: ['Moving edge pawns for no reason.', 'Early queen adventures that lose tempo.'],
          selfCheck: 'Castle by move 10 in your next three games.',
        },
      },
      {
        title: 'Piece Safety: Is It Protected?',
        description: 'Before every move check which of your pieces are undefended and what the opponent just threatened.',
        targetCount: 15,
        tip: 'Two questions before every move: "What does their last move attack?" and "Is the piece I am moving safe?"',
        practice: [puz('hangingPiece', 'Hanging piece puzzles')],
        lesson: {
          why: 'At 100–600 Elo almost every game is decided by someone leaving a piece en prise.',
          ideas: [
            'A hanging piece is attacked and not defended (or attacked by something cheaper).',
            'Look at your opponent’s last move first. What new line or attack did it open?',
            'Count attackers vs defenders on any contested piece.',
          ],
          mistakes: ['Only looking at your own plan.', 'Moving a defender away and leaving something loose.'],
          selfCheck: 'Play a full game without leaving any piece hanging.',
        },
      },
      {
        title: 'First Checkmates: Queen and Rook',
        description: 'Mate with King+Queen and King+Rook against a lone king, without stalemating.',
        targetCount: 4,
        tip: 'K+R: build a "ladder" with rook checks. K+Q: keep a knight’s move away and shrink the box.',
        practice: [manual('Practise vs the computer (Play page) from a won position')],
        lesson: {
          why: 'Every endgame skill rests on being able to finish the game, and it saves half-points you would otherwise throw away.',
          ideas: [
            'Queen + king: restrict the enemy king one box at a time, then bring your king up.',
            'Rook + king: use the king to take opposition, then the rook delivers check on the edge.',
            'Check for stalemate before every queen move.',
          ],
          selfCheck: 'Deliver K+Q mate in under 10 moves and K+R mate in under 20, twice.',
        },
      },
    ]),
  },

  /* ===================================================================== */
  /* LEVEL 2 · 400–600                                                      */
  /* ===================================================================== */
  {
    id: 'level-2',
    number: 2,
    title: 'Stop Hanging Pieces',
    elo: '400–600',
    color: 'sky',
    goal: 'Build the blunder-check habit and learn the three first tactics: fork, pin, skewer.',
    summary:
      'Most games at this level end because of a free piece. Learn to check safety every move and win material with the first tactical patterns.',
    routine: [
      'Daily (15 min): 10–15 puzzles on one theme',
      '3–4 slower games a week (10+ minutes each)',
      'After each loss, find the first move where you lost material',
    ],
    readyWhen: [
      'You ask "what does their last move threaten?" every move',
      'You spot forks, pins and skewers for both sides',
      'You know what to do against Scholar’s mate and early queen attacks',
      'You castle and develop in nearly every game',
    ],
    levelDrill: 'Play 3 slow games and write down any piece you left hanging. Aim for zero.',
    levelPractice: [puzMulti(['fork', 'pin', 'skewer'], 'Fork, pin and skewer'), play('Play vs Computer')],
    skills: skills(2, [
      {
        title: 'The Blunder Check Habit',
        description: 'Two questions before each move: what is the opponent threatening, and is my move safe?',
        targetCount: 5,
        tip: 'Write it on a sticky note by your screen: "Threats? Safe?" It beats any opening study at this level.',
        practice: [play('Play vs Computer'), review('Review your game')],
        lesson: {
          why: 'A simple routine removes most blunders, and blunders are most of your losses right now.',
          ideas: [
            'Step 1: what did my opponent’s last move do? Any check, capture or attack?',
            'Step 2: if I play my move, can they capture something, check me or fork me?',
            'Do this every move, even when the move looks obvious.',
          ],
          mistakes: ['Skipping the check when you are winning or in a hurry.'],
          selfCheck: 'Five games in a row without a one-move blunder.',
        },
      },
      {
        title: 'Forks',
        description: 'One piece attacks two things at once. Knight forks are the most common.',
        targetCount: 20,
        tip: 'Look for a safe square that attacks the king, queen or rook together with something undefended.',
        practice: [puz('fork', 'Fork puzzles')],
        lesson: {
          why: 'Forks win material by force because the opponent can only save one piece.',
          ideas: [
            'Knights fork best because they cannot be blocked and attack from a distance.',
            'Pawn forks win a piece for a pawn. Queen forks need a safe landing square.',
            'Royal fork: knight attacking king and queen.',
          ],
          mistakes: ['Forking with a piece that can be captured first.'],
          selfCheck: '80% on 20 fork puzzles.',
        },
      },
      {
        title: 'Pins & Skewers',
        description: 'A pin holds a piece in place. A skewer forces a valuable piece to move and wins what is behind it.',
        targetCount: 20,
        tip: 'Pinned to the king means absolutely pinned: it cannot legally move. Attack pinned pieces again and again.',
        practice: [puzMulti(['pin', 'skewer'], 'Pin & skewer puzzles')],
        lesson: {
          why: 'Long-range pieces (bishop, rook, queen) win material through lines. This is the second family of basic tactics.',
          ideas: [
            'Pin: the piece in front is less valuable (or is the king). Skewer: the piece in front is more valuable.',
            'Pile up on a pinned piece with a pawn or a second attacker.',
            'Break your own pins by moving the king, blocking or attacking the pinning piece.',
          ],
          mistakes: ['Pinning a piece that is also defended twice and then achieving nothing.'],
          selfCheck: '80% on mixed pin/skewer puzzles.',
        },
      },
      {
        title: 'Count Attackers and Defenders',
        description: 'Decide if a capture on a contested square wins, loses, or draws material.',
        targetCount: 3,
        tip: 'Capture in order from the cheapest piece. If the number of attackers is not bigger than defenders, do not start.',
        practice: [play('Play vs Computer')],
        lesson: {
          why: 'This turns “I can capture” into “I should capture”, and stops two-for-one losses.',
          ideas: [
            'Count how many pieces attack the square and how many defend it.',
            'The cheapest attacker captures first.',
            'If the last capture is yours and you do not lose more value than you win, go ahead.',
          ],
          selfCheck: 'Explain why a capture works before you play it in 3 games.',
        },
      },
      {
        title: 'Defend Against Scholar’s Mate & Early Attacks',
        description: 'Meet 1.e4 e5 2.Qh5 / 2.Bc4 attacks calmly and punish early queen moves.',
        targetCount: 2,
        tip: 'Develop with tempo: attack their queen with a knight (…Nc6, …Nf6) and your development happens for free.',
        practice: [openings('Practise opening lines')],
        lesson: {
          why: 'Cheap mating tricks are common below 700. A short answer saves you a lot of games.',
          ideas: [
            'f7 (or f2) is the weakest square early: only the king defends it.',
            'Answer queen raids with a developing move that attacks the queen.',
            'Do not panic-move pawns in front of your king.',
          ],
          selfCheck: 'Meet 2.Qh5 and 2.Bc4 correctly in a game vs the computer.',
        },
      },
      {
        title: 'Back-Rank Mate',
        description: 'Spot back-rank mate threats against both kings and give your king an escape square.',
        targetCount: 15,
        tip: 'Make luft: one pawn move (h3/h6 or g3/g6) gives your king room before the rook arrives.',
        practice: [puz('backRankMate', 'Back-rank mate puzzles')],
        lesson: {
          why: 'It is the most common mating pattern in beginner games.',
          ideas: [
            'A king boxed in by its own pawns on the first rank can be mated by one rook or queen.',
            'Do not move the last piece defending the back rank.',
            'When your opponent’s back rank is weak, look for forcing exchanges or deflections.',
          ],
          selfCheck: '90% on 15 back-rank puzzles.',
        },
      },
      {
        title: 'Develop, Castle, Don’t Move Twice',
        description: 'Put the opening principles into real games with simple, solid setups.',
        targetCount: 3,
        tip: 'Pick one setup as White and one as Black and play it every game; you learn more that way than by switching.',
        practice: [openings('Practise opening lines'), play('Play vs Computer')],
        lesson: {
          why: 'You want to arrive in the middlegame safe and developed, not memorise lines.',
          ideas: [
            'Aim for: pawn to e4/d4, knights out, bishops out, castle, rooks to the centre.',
            'Every move should develop a piece, fight for the centre or improve king safety.',
            'Do not grab pawns with the queen while your pieces are still at home.',
          ],
          selfCheck: 'Three games where you finish development before move 10.',
        },
      },
      {
        title: 'King & Pawn vs King: Opposition',
        description: 'Win or draw the most basic pawn ending using the opposition and key squares.',
        targetCount: 10,
        tip: 'Move the king in front of the pawn, not behind. If the kings face each other and it is the opponent’s move, you have the opposition.',
        practice: [puz('pawnEndgame', 'Pawn endgame puzzles')],
        lesson: {
          why: 'Every simplified position ends up here eventually. A basic understanding turns draws into wins.',
          ideas: [
            'Opposition: the kings face each other with one square between them. The side NOT to move has it.',
            'King in front of the pawn plus opposition normally wins; a rook pawn is usually a draw.',
            'Rule of the square tells you whether a king can catch a running pawn.',
          ],
          mistakes: ['Pushing the pawn first and leaving the king behind.'],
          selfCheck: 'Win K+P vs K from 3 different starting positions.',
        },
      },
    ]),
  },

  /* ===================================================================== */
  /* LEVEL 3 · 600–800                                                      */
  /* ===================================================================== */
  {
    id: 'level-3',
    number: 3,
    title: 'See the Tactics',
    elo: '600–800',
    color: 'violet',
    goal: 'Look two moves ahead, find mate in 2, and add discovered attacks, deflection and removing the defender.',
    summary:
      'You stop hanging pieces most of the time. Now you start winning material with tactics and begin using a thinking routine (checks, captures, threats).',
    routine: [
      'Daily (20 min): 15–20 puzzles on one theme, then a mixed set',
      '3–4 games a week at 10+ minutes; review one without the engine first',
      'Learn one simple opening for each colour and stick with it',
    ],
    readyWhen: [
      'You find mates in 2 and common two-move tactics',
      'You use checks-captures-threats before moves',
      'You can spot a discovered attack or a trapped piece in your own games',
      'You have one White and one Black opening you know',
    ],
    levelDrill: 'Reach a 10-puzzle streak on mixed tactics, then play a game and find at least one tactic.',
    levelPractice: [puzMulti(['mateIn2', 'discoveredAttack', 'capturingDefender', 'deflection'], 'Mixed tactics')],
    skills: skills(3, [
      {
        title: 'Mate in 2',
        description: 'Find forcing mates in two moves: check first, then think about the escape squares.',
        targetCount: 20,
        tip: 'Count the squares around the enemy king and find which check takes them all away.',
        practice: [puz('mateIn2', 'Mate in 2 puzzles')],
        lesson: {
          why: 'Mate in 2 trains you to calculate forcing moves, the foundation of all later attack skills.',
          ideas: [
            'Start with checks. Which one leaves the fewest replies?',
            'Look at the king’s escape squares and which pieces cover them.',
            'A quiet move that threatens unstoppable mate is also a mate in 2.',
          ],
          selfCheck: '75% on 20 mate-in-2 puzzles.',
        },
      },
      {
        title: 'Discovered Attacks & Double Check',
        description: 'Move one piece to open a line for another, ideally with a check or a threat of its own.',
        targetCount: 20,
        tip: 'A discovered check lets the moving piece do anything, including capture the queen.',
        practice: [puzMulti(['discoveredAttack', 'doubleCheck'], 'Discovered attack & double check')],
        lesson: {
          why: 'Discoveries make two threats at once, and the opponent can usually answer only one.',
          ideas: [
            'Look for a long-range piece (bishop, rook, queen) with your own piece in front of it.',
            'Discovered check: the moving piece attacks something valuable while the king is in check.',
            'Double check can only be met by moving the king.',
          ],
          selfCheck: '80% on 20 mixed puzzles.',
        },
      },
      {
        title: 'Remove the Defender',
        description: 'Capture or chase away the piece that guards something important.',
        targetCount: 15,
        tip: 'Ask: which piece is holding their position together? Can I trade it, capture it or force it away?',
        practice: [puz('capturingDefender', 'Capture the defender puzzles')],
        lesson: {
          why: 'Defenders are often overloaded. Remove one and a hanging piece or mate appears.',
          ideas: [
            'List what each enemy piece defends.',
            'Trade or capture a key defender, even a lower-valued one.',
            'Often it is a check or capture that does the removal with tempo.',
          ],
          selfCheck: '75% on 15 puzzles.',
        },
      },
      {
        title: 'Deflection',
        description: 'Force a defending piece away from its post with a check, threat or sacrifice.',
        targetCount: 15,
        tip: 'Deflection is similar to removing the defender, but the piece is lured away rather than captured.',
        practice: [puz('deflection', 'Deflection puzzles')],
        lesson: {
          why: 'Another way to win a piece or mate that looks defended.',
          ideas: [
            'Identify the guard you want to remove and think of a forcing move that drags it away.',
            'A sacrifice that deflects is worth it if the follow-up wins more.',
            'Look for pieces that do two jobs (overloaded).',
          ],
          selfCheck: '75% on 15 puzzles.',
        },
      },
      {
        title: 'Trapped Pieces',
        description: 'Spot pieces with no safe squares and attack them, and keep your own from getting trapped.',
        targetCount: 15,
        tip: 'Rim pieces are in danger: a bishop grabbing a rook pawn or a knight on the edge often has no way out.',
        practice: [puz('trappedPiece', 'Trapped piece puzzles')],
        lesson: {
          why: 'Winning a trapped piece is a clean piece up with no risk.',
          ideas: [
            'List a piece’s escape squares. If every one is attacked or blocked, it is trapped.',
            'Attack it with a lower-valued piece.',
            'Before you snatch a pawn, check your piece’s way back.',
          ],
          selfCheck: '75% on 15 puzzles.',
        },
      },
      {
        title: 'Think: Checks, Captures, Threats',
        description: 'Before each move list all checks, captures and threats for both sides.',
        targetCount: 5,
        tip: 'CCT: first your forcing moves, then theirs. Most tactics start with a check, a capture or a threat.',
        practice: [play('Play vs Computer'), review('Review your game')],
        lesson: {
          why: 'CCT is a cheap way to organise your thinking, so you stop missing the obvious.',
          ideas: [
            'Checks: can I check? Can they check me next?',
            'Captures: what can I take? What can they take?',
            'Threats: what do I threaten after this move, and what do they threaten?',
          ],
          selfCheck: 'Use CCT every move in 3 games.',
        },
      },
      {
        title: 'Mating Patterns, Part 1',
        description: 'Recognise the core mates: back rank, smothered, Anastasia and Arabian.',
        targetCount: 20,
        tip: 'Learn the shape, not the exact squares. The same pattern shows up with different pieces on different corners.',
        practice: [puzMulti(['backRankMate', 'smotheredMate', 'anastasiaMate', 'arabianMate'], 'Mating patterns')],
        lesson: {
          why: 'Patterns let you see mates instead of calculating them from scratch.',
          ideas: [
            'Back rank: rook or queen on a boxed-in king.',
            'Smothered: a knight checks a king surrounded by its own pieces.',
            'Anastasia and Arabian: knight + rook (or queen) combinations on the edge.',
          ],
          selfCheck: 'Name each pattern in 8 of 10 puzzles.',
        },
      },
      {
        title: 'Your First Opening Repertoire',
        description: 'One simple setup as White (like the Italian) and one reply to 1.e4 and 1.d4.',
        targetCount: 4,
        tip: 'Pick lines with clear plans. Understand why each move is played instead of memorising a long list.',
        practice: [openings('Practise opening lines')],
        lesson: {
          why: 'A repertoire stops you from improvising the first ten moves. Keep it small though: tactics matter more.',
          ideas: [
            'Classical: Italian Game as White, double e4 (…e5) as Black.',
            'Learn the first 6–8 moves and the main plans.',
            'Play the same lines for months before changing anything.',
          ],
          selfCheck: 'Reach move 8 in your lines in 5 games without thinking.',
        },
      },
      {
        title: 'Review Your Games',
        description: 'After each game find where the game turned, before you look at the engine.',
        targetCount: 3,
        tip: 'Decide for yourself where you went wrong. Then check with the engine. You learn more from your mistakes than from the engine.',
        practice: [review('Open Game Review')],
        lesson: {
          why: 'Reviewing turns each loss into a lesson. Players who only play, without review, plateau.',
          ideas: [
            'Find the first moment the evaluation swung against you.',
            'Name the reason: hung piece, missed tactic, bad opening, time?',
            'Use the Drills tab (“Find the best move”) on your own game’s key positions.',
          ],
          selfCheck: 'Review 3 games and write down one lesson each.',
        },
      },
    ]),
  },

  /* ===================================================================== */
  /* LEVEL 4 · 800–1000                                                     */
  /* ===================================================================== */
  {
    id: 'level-4',
    number: 4,
    title: 'Attack the King',
    elo: '800–1000',
    color: 'amber',
    goal: 'Add the pack-3 tactics, attack a king in the centre, defend calmly and play slower games.',
    summary:
      'You know the basic tactics. Now you learn how to build an attack, how to defend one, and how to use your rooks. You also start learning from master games.',
    routine: [
      'Daily (20–30 min): 20 puzzles, one theme then mixed',
      'Slow games (15+10 or longer) and a review of every loss',
      'Once a week: play through one classic master game',
    ],
    readyWhen: [
      'You find 2–3 move combinations most of the time',
      'You can name the weak points around a king (f2/f7, open files)',
      'You calmly defend when attacked',
      'You put rooks on open files and the 7th rank',
    ],
    levelDrill: 'Win a game by attacking a king that stayed in the centre.',
    levelPractice: [puzMulti(['attraction', 'clearance', 'interference', 'xRayAttack'], 'Pack-3 tactics')],
    skills: skills(4, [
      {
        title: 'Attack a King in the Centre',
        description: 'Open lines, bring all pieces and punish a king that did not castle.',
        targetCount: 20,
        tip: 'Open the centre when their king is stuck there and yours is safe. Sacrifice a pawn if it keeps the king in the open.',
        practice: [puzMulti(['exposedKing', 'attackingF2F7'], 'Exposed king puzzles'), openings('Opening traps and plans')],
        lesson: {
          why: 'Most games between 800 and 1200 are decided by one side attacking the king with more pieces.',
          ideas: [
            'The king stays in the centre → open files and diagonals around it.',
            'Bring more attackers than they have defenders before you sacrifice.',
            'f2/f7 is the weak point until a king castles.',
          ],
          mistakes: ['Attacking with one or two pieces only.'],
          selfCheck: 'Win a game against a king in the centre.',
        },
      },
      {
        title: 'Attraction & Clearance',
        description: 'Lure a piece to a bad square, or clear a square or line for your own piece.',
        targetCount: 15,
        tip: 'Attraction: sacrifice to drag the king or queen onto a square where a fork or mate follows.',
        practice: [puzMulti(['attraction', 'clearance'], 'Attraction & clearance')],
        lesson: {
          why: 'These are the sacrifices behind many "brilliant" combinations.',
          ideas: [
            'Attraction: force the target piece to a square where it can be attacked.',
            'Clearance: move your own piece away with tempo so another gets a key square or line.',
            'Always count the follow-up before you sacrifice.',
          ],
          selfCheck: '70% on 15 puzzles.',
        },
      },
      {
        title: 'Interference & X-Ray',
        description: 'Block a defender’s line, or attack through a piece to a target behind it.',
        targetCount: 12,
        tip: 'X-ray: a piece defends or attacks "through" an enemy piece. A capture there often turns out to be protected.',
        practice: [puzMulti(['interference', 'xRayAttack'], 'Interference & x-ray')],
        lesson: {
          why: 'Completes the standard tactics set up to this level. They are rarer but decisive.',
          ideas: [
            'Interference: put your piece between two enemy pieces that defend each other.',
            'X-ray: remember that a rook behind a queen still “sees” the square.',
            'Check lines through pieces when you count defenders.',
          ],
          selfCheck: '70% on 12 puzzles.',
        },
      },
      {
        title: 'Mating Patterns, Part 2',
        description: 'Boden’s mate, double bishop mate and the hook mate.',
        targetCount: 15,
        tip: 'Two bishops on crossing diagonals are a classic mate. Look for them when the king castles with pieces nearby.',
        practice: [puzMulti(['bodenMate', 'doubleBishopMate', 'hookMate'], 'Mating patterns 2')],
        lesson: {
          why: 'More patterns mean more mates you see at a glance.',
          ideas: [
            'Boden: two bishops deliver mate on crossing diagonals after a queen sacrifice.',
            'Double bishop mate: bishops cover the escape squares from different diagonals.',
            'Hook mate: rook, knight and pawn work together on the edge.',
          ],
          selfCheck: 'Recognise each pattern in 7 of 10 puzzles.',
        },
      },
      {
        title: 'Defend Under Pressure',
        description: 'Find the defensive move, trade attackers and keep your king safe when attacked.',
        targetCount: 15,
        tip: 'When attacked: first list their threats, then trade attackers, block, or counter-attack. Do not panic.',
        practice: [puz('defensiveMove', 'Defensive move puzzles'), play('Play vs Computer')],
        lesson: {
          why: 'Defending well wins you the games where you are worse, and you do not lose to every attack.',
          ideas: [
            'Name the threat first.',
            'Trade the most dangerous attacker.',
            'Keep pawns in front of your king and avoid weakening moves.',
          ],
          selfCheck: '70% on 15 defensive puzzles.',
        },
      },
      {
        title: 'Rooks: Open Files & the 7th Rank',
        description: 'Place rooks on open and semi-open files and use the 7th rank.',
        targetCount: 4,
        tip: 'Rooks belong on files where pawns have gone. Double them to double the pressure.',
        practice: [play('Play vs Computer'), review('Review your game')],
        lesson: {
          why: 'Rooks are strong in open positions and passive ones lose games.',
          ideas: [
            'Open file: no pawns. Semi-open: only the opponent’s pawn.',
            'A rook on the 7th rank attacks pawns and traps the king.',
            'Connect your rooks by developing all minor pieces and queen.',
          ],
          selfCheck: 'Put a rook on an open file in 4 games.',
        },
      },
      {
        title: 'Learn from Master Games',
        description: 'Play through classic attacking games (Morphy, Steinitz, Alekhine) and guess the moves.',
        targetCount: 3,
        tip: 'Cover the next move and guess. Do not just click through.',
        practice: [openings('Open "GM games" in the trainer')],
        lesson: {
          why: 'Strong players show you how plans, development and attacks fit together.',
          ideas: [
            'Pick a game, predict each move, compare.',
            'Notice how every move develops, attacks or defends.',
            'Look at how the game opens lines near the king.',
          ],
          selfCheck: 'Play through 3 master games with predictions.',
          study: ['Lichess Studies on Morphy and Alekhine games', 'Chess.com Game Explorer'],
        },
      },
      {
        title: 'Slow Down: Play and Review Properly',
        description: 'Play 15+10 or longer games and review every loss.',
        targetCount: 5,
        tip: 'Fast games hide your weaknesses; slow games let you apply the checklist.',
        practice: [play('Play vs Computer'), review('Review your game')],
        lesson: {
          why: 'Good thinking habits form in slow games. Blitz mostly trains reflexes.',
          ideas: [
            'One or two serious games a day is plenty if you review them.',
            'Review without the engine first, then check.',
            'Tag the cause of each loss: tactic, opening, endgame, strategy or time.',
          ],
          selfCheck: 'Play 5 slow games and review each.',
        },
      },
    ]),
  },

  /* ===================================================================== */
  /* LEVEL 5 · 1000–1200                                                    */
  /* ===================================================================== */
  {
    id: 'level-5',
    number: 5,
    title: 'Calculate & Convert',
    elo: '1000–1200',
    color: 'rose',
    goal: 'Calculate 3 moves reliably, learn basic endgames and build a first real opening repertoire.',
    summary:
      'You are rarely hanging pieces now. Wins come from calculation and from not letting advantages slip. Simple pawn endings and a repertoire start to matter.',
    routine: [
      'Daily (30 min): 20 puzzles, calculate fully before you move',
      '1–2 slow games a day if you can, with review',
      'Twice a week: 15 minutes of endgame study',
    ],
    readyWhen: [
      'You solve mate in 3 and 3-move tactics regularly',
      'You use candidate moves instead of the first idea',
      'You can win K+P vs K+P with opposition',
      'You have a repertoire vs 1.e4 and 1.d4 as White and Black',
    ],
    levelDrill: 'Convert 3 winning positions against the computer without letting the advantage slip.',
    levelPractice: [puzMulti(['mateIn3', 'long', 'intermezzo'], 'Calculation puzzles')],
    skills: skills(5, [
      {
        title: 'Mate in 3',
        description: 'Calculate three-move mates, including quiet moves that stop all escapes.',
        targetCount: 15,
        tip: 'Visualise the board after each move. Do not move pieces on the screen: train your mind.',
        practice: [puz('mateIn3', 'Mate in 3 puzzles')],
        lesson: {
          why: 'Calculation depth is what separates 1000 from 1400. Mate in 3 trains it directly.',
          ideas: [
            'Check forcing moves first (checks, then captures, then threats).',
            'Look for the move that leaves the enemy king one safe square.',
            'Always consider the opponent’s best defence, not just one reply.',
          ],
          selfCheck: '60% on 15 puzzles without moving pieces.',
        },
      },
      {
        title: 'Candidate Moves & Forcing Lines',
        description: 'List 2–3 candidate moves, then calculate forcing lines (checks, captures, threats) first.',
        targetCount: 15,
        tip: 'Do not stop at the first good move. Find a second and compare.',
        practice: [puz('long', 'Longer puzzles')],
        lesson: {
          why: 'Candidate moves stop “first idea” blunders and make calculation efficient.',
          ideas: [
            'List candidates: checks, captures, threats, then quiet moves.',
            'Calculate forcing lines to the end, and check the opponent’s best reply.',
            'Compare final positions. Pick the clearest edge.',
          ],
          mistakes: ['Looking only for your own ideas.', 'Stopping when the line “looks good”.'],
          selfCheck: 'List three candidates in your next 3 games.',
        },
      },
      {
        title: 'Zwischenzug (In-Between Moves)',
        description: 'Before an expected recapture, ask if a check or threat comes first.',
        targetCount: 10,
        tip: 'When an exchange is happening, pause: is there a stronger in-between move?',
        practice: [puz('intermezzo', 'Intermezzo puzzles')],
        lesson: {
          why: 'Opponents expect obvious replies; an in-between move wins material.',
          ideas: [
            'Before recapturing, look for checks and bigger threats.',
            'Also check whether your opponent has one before you capture.',
          ],
          selfCheck: '70% on 10 puzzles.',
        },
      },
      {
        title: 'Quiet Moves & Defensive Resources',
        description: 'Find the non-forcing move that wins, and resources that save worse positions.',
        targetCount: 12,
        tip: 'A quiet move that threatens mate can be worth more than a check.',
        practice: [puzMulti(['quietMove', 'defensiveMove'], 'Quiet move puzzles')],
        lesson: {
          why: 'Not every tactic starts with a check. These puzzles train patience.',
          ideas: [
            'Look for moves that create double threats without giving a check.',
            'Defensive resources: counter-threats, stalemate tricks, perpetual check.',
          ],
          selfCheck: '65% on 12 puzzles.',
        },
      },
      {
        title: 'Pawn Endings: Opposition & Rule of the Square',
        description: 'Win K+P vs K+P using opposition, key squares and breakthrough ideas.',
        targetCount: 15,
        tip: 'In pawn endings, calculate everything. One tempo decides.',
        practice: [puz('pawnEndgame', 'Pawn endgame puzzles'), manual('Study basic K+P endings')],
        lesson: {
          why: 'Simplifying into a pawn ending only works if you understand the rules.',
          ideas: [
            'Opposition, key squares and triangulation.',
            'Rule of the square for passed pawns.',
            'Outside passed pawn: drags the king away.',
          ],
          selfCheck: 'Win or draw K+P vs K+P correctly from 5 positions.',
          study: ['Silman’s Complete Endgame Course (the 1000–1200 chapters)'],
        },
      },
      {
        title: 'Promotion & Queen vs Pawn',
        description: 'Create passed pawns, push them with tempo and handle queen vs pawn on the 7th.',
        targetCount: 12,
        tip: 'A passed pawn on the 6th or 7th rank is worth more than it looks, especially with the king nearby.',
        practice: [puzMulti(['advancedPawn', 'promotion'], 'Passed pawn puzzles')],
        lesson: {
          why: 'Winning a pawn race is a simple way to convert an endgame.',
          ideas: [
            'Support the pawn with king and rook behind it.',
            'Queen vs pawn on the 7th: most positions win, but bishop or rook pawns often draw.',
          ],
          selfCheck: '70% on 12 puzzles.',
        },
      },
      {
        title: 'Opening Repertoire: Both Colours',
        description: 'One setup as White, and one reply each to 1.e4 and 1.d4 as Black, with plans.',
        targetCount: 6,
        tip: 'Stop memorising lines you cannot explain. Learn the pawn breaks and typical piece squares.',
        practice: [openings('Build your repertoire')],
        lesson: {
          why: 'At 1000–1200 you meet the same openings repeatedly. A repertoire gives you comfortable positions.',
          ideas: [
            'Choose solid systems that fit your style.',
            'Learn plans: where pieces go, which pawn breaks you play.',
            'Check your games to see what the opponent actually plays.',
          ],
          selfCheck: 'Play 10 games with the same repertoire.',
          study: ['Lichess Opening Explorer', 'A beginner-friendly repertoire book'],
        },
      },
      {
        title: 'Game Review Loop',
        description: 'Review every game, find a recurring mistake, then train that exact thing.',
        targetCount: 5,
        tip: 'After analysing, open the Drills tab and use “Find the best move” on your own key positions.',
        practice: [review('Review your game')],
        lesson: {
          why: 'Improvement is targeted. Knowing why you lose makes training efficient.',
          ideas: [
            'Collect five losses and tag each cause.',
            'The most frequent tag becomes your next training focus.',
            'Use puzzles from the matching theme.',
          ],
          selfCheck: 'Name your top recurring mistake from 5 games.',
        },
      },
    ]),
  },

  /* ===================================================================== */
  /* LEVEL 6 · 1200–1400                                                    */
  /* ===================================================================== */
  {
    id: 'level-6',
    number: 6,
    title: 'Plans & Pawn Structure',
    elo: '1200–1400',
    color: 'indigo',
    goal: 'Use pawn structure, outposts and files to make plans, and convert advantages.',
    summary:
      'Tactics alone stop being enough. You need to know why a position is good or bad and what plan to follow. Endgames start to decide games.',
    routine: [
      'Daily (30–40 min): tactics warm-up, then strategy or endgame study',
      'Slow games plus a deep review of one game a week',
      'Study one pawn structure or endgame idea each week',
    ],
    readyWhen: [
      'You can name a good plan in a quiet position',
      'You recognise isolated, doubled, backward and passed pawns',
      'You trade pieces when ahead and keep your king safe',
      'You know basic rook endings',
    ],
    levelDrill: 'Win a game by a clear plan (outpost, open file or passed pawn), not just a tactic.',
    levelPractice: [play('Play vs Computer'), review('Review your game')],
    skills: skills(6, [
      {
        title: 'Attack the Castled King',
        description: 'Coordinate pieces, use pawn storms and sacrifices against a castled king.',
        targetCount: 20,
        tip: 'Count attackers and defenders in the attack zone before you commit.',
        practice: [puzMulti(['kingsideAttack', 'hookMate', 'smotheredMate'], 'King attack puzzles')],
        lesson: {
          why: 'Attacking a castled king is one of the main ways to win middlegames.',
          ideas: [
            'Bring pieces closer first: queen, rook lift, knight and bishop.',
            'Open files near the king with pawn breaks.',
            'Typical sacrifices: Bxh7+, Rxh7 with a follow-up, Greek gift. Always check the follow-up.',
          ],
          mistakes: ['Sacrificing without enough attackers.'],
          selfCheck: '70% on 20 puzzles.',
        },
      },
      {
        title: 'Pawn Structure Basics',
        description: 'Isolated, doubled, backward and passed pawns: what they mean for both sides.',
        targetCount: 4,
        tip: 'Pawn moves are permanent. Ask what a pawn move weakens before you play it.',
        practice: [play('Play vs Computer'), review('Review your game')],
        lesson: {
          why: 'Pawn structure tells you where to put pieces and which plan fits.',
          ideas: [
            'Isolated pawn: a strength (activity) and a weakness (target).',
            'Doubled pawns: often weak, sometimes give open files.',
            'Passed pawn: push it, and block an opponent’s.',
            'Healthy pawn structure: keep islands to a minimum.',
          ],
          selfCheck: 'Name pawn weaknesses in 4 of your games.',
          study: ['Simple Chess (John Emms)'],
        },
      },
      {
        title: 'Outposts & Weak Squares',
        description: 'Put a knight on a square the opponent cannot attack with a pawn.',
        targetCount: 4,
        tip: 'A knight on the 5th or 6th rank, supported by a pawn, is often stronger than a rook.',
        practice: [play('Play vs Computer'), review('Review your game')],
        lesson: {
          why: 'Outposts give long-term advantages that tactics do not.',
          ideas: [
            'An outpost is a square in enemy territory that no enemy pawn can attack.',
            'Support it with a pawn and bring a knight.',
            'Create weak squares by forcing pawn moves.',
          ],
          selfCheck: 'Establish a knight outpost in 4 games.',
        },
      },
      {
        title: 'Open Files & Rook Activity',
        description: 'Take control of open files, double rooks and invade the 7th rank.',
        targetCount: 4,
        tip: 'Contest the open file only if you can control its entry squares.',
        practice: [play('Play vs Computer'), review('Review your game')],
        lesson: {
          why: 'Rook activity often decides the middlegame and the endgame.',
          ideas: [
            'Place a rook on an open file and double.',
            'Entry squares: the first and second ranks need protection.',
            'Rook behind passed pawns, yours or theirs.',
          ],
          selfCheck: 'Win a file in 4 games.',
        },
      },
      {
        title: 'Bishop vs Knight, Good vs Bad Bishop',
        description: 'Judge which minor piece is better in open and closed positions.',
        targetCount: 10,
        tip: 'Do not put your pawns on the same colour as your bishop.',
        practice: [puzMulti(['bishopEndgame', 'knightEndgame'], 'Minor piece endgames')],
        lesson: {
          why: 'Minor-piece decisions come up in nearly every game.',
          ideas: [
            'Open positions with pawns on both wings favour bishops.',
            'Closed positions favour knights.',
            'A bad bishop is blocked by its own pawns. Free it or trade it.',
          ],
          selfCheck: '70% on 10 puzzles.',
        },
      },
      {
        title: 'Prophylaxis: What Does the Opponent Want?',
        description: 'Before you act, ask what your opponent’s best idea is and stop it.',
        targetCount: 15,
        tip: 'Ask it every move in quiet positions. It often wins you a pawn or a tempo.',
        practice: [puz('defensiveMove', 'Defensive move puzzles'), play('Play vs Computer')],
        lesson: {
          why: 'Stopping threats early is easier than solving them later.',
          ideas: [
            'Identify the opponent’s plan or threat.',
            'Choose a move that does your job and stops theirs.',
          ],
          selfCheck: 'Ask the question every move in 3 games.',
        },
      },
      {
        title: 'Converting an Advantage',
        description: 'Trade pieces (not pawns), activate your king in endings and create passed pawns.',
        targetCount: 20,
        tip: 'When ahead: simplify, improve your worst piece and avoid counterplay. Do not start fancy attacks.',
        practice: [puzMulti(['advantage', 'crushing'], 'Advantage puzzles'), play('Play vs Computer')],
        lesson: {
          why: 'Many players lose half-points by playing carelessly with a lead.',
          ideas: [
            'When ahead, trade pieces and keep pawns.',
            'Check for opponent counterplay first.',
            'Create a passed pawn or a second weakness.',
          ],
          selfCheck: 'Convert 3 winning positions vs the computer.',
        },
      },
      {
        title: 'Rook Endgame Basics',
        description: 'Active rook, rook behind passed pawns, cut off the king.',
        targetCount: 15,
        tip: 'Rook endings: activity over material. A passive rook loses.',
        practice: [puz('rookEndgame', 'Rook endgame puzzles'), manual('Study basic rook endings')],
        lesson: {
          why: 'Rook endings are the most common endgames in real games.',
          ideas: [
            'Put your rook behind a passed pawn, yours or theirs.',
            'Cut off the king along a file or rank.',
            'Keep the king active.',
          ],
          selfCheck: '65% on 15 puzzles.',
          study: ['Silman’s Complete Endgame Course'],
        },
      },
      {
        title: 'Opening Plans & Pawn Breaks',
        description: 'Know where the pieces go and which pawn breaks to play in your openings.',
        targetCount: 6,
        tip: 'If you cannot explain a move, it is not part of your repertoire yet.',
        practice: [openings('Practise opening lines')],
        lesson: {
          why: 'Plans replace memorised lines when the opponent deviates.',
          ideas: [
            'Know the typical pawn breaks (…c5, …e5, d4–d5, f4).',
            'Know the typical piece squares.',
            'Study model games in your openings.',
          ],
          selfCheck: 'Explain the plan in each of your openings.',
        },
      },
    ]),
  },

  /* ===================================================================== */
  /* LEVEL 7 · 1400–1600                                                    */
  /* ===================================================================== */
  {
    id: 'level-7',
    number: 7,
    title: 'Technique & Strategy',
    elo: '1400–1600',
    color: 'teal',
    goal: 'Master rook endings, advanced tactics, calculation and honest self-analysis.',
    summary:
      'Opponents now rarely give pieces away. You win by accurate calculation, better endgames and fewer errors. Self-analysis becomes the key to progress.',
    routine: [
      'Daily: 30–50 min mixed tactics, then endgames or strategy',
      'Slow games with a full review (engine second)',
      'Weekly: audit your losses and update your training plan',
    ],
    readyWhen: [
      'You find candidate moves in quiet positions',
      'You can win Lucena and hold Philidor positions',
      'You manage your clock without panic',
      'You know what your biggest weakness is and have a plan for it',
    ],
    levelDrill: 'Play 5 slow games, review each, and write down your top 3 recurring errors.',
    levelPractice: [play('Play vs Computer'), review('Review your game')],
    skills: skills(7, [
      {
        title: 'Rook Endings: Lucena & Philidor',
        description: 'Win the Lucena position and hold the Philidor position.',
        targetCount: 15,
        tip: 'Remember: Lucena = win (build a bridge), Philidor = draw (keep the rook on the 3rd rank).',
        practice: [puz('rookEndgame', 'Rook endgame puzzles'), manual('Study Lucena and Philidor')],
        lesson: {
          why: 'Rook endings are everywhere, and these two positions decide many of them.',
          ideas: [
            'Lucena: king in front of the pawn on the 7th. Build the bridge with the rook.',
            'Philidor: defender keeps the rook on the 3rd rank until the pawn advances, then checks from behind.',
            'Rook activity matters more than a single pawn.',
          ],
          selfCheck: 'Play both positions correctly against the engine.',
          study: ['Silman’s Complete Endgame Course', '100 Endgames You Must Know'],
        },
      },
      {
        title: 'Minor Piece & Queen Endgames',
        description: 'Bishop, knight and queen endings, including when to trade and how to use your king.',
        targetCount: 12,
        tip: 'In queen endings, perpetual check is a constant resource: think about it for both sides.',
        practice: [puzMulti(['bishopEndgame', 'knightEndgame', 'queenEndgame'], 'Endgame puzzles')],
        lesson: {
          why: 'You will meet these endings often, and knowing key ideas saves many half-points.',
          ideas: [
            'Bishops are better with pawns on both wings. Knights are better in closed positions.',
            'Opposite-coloured bishops are drawish, unless attack is on.',
            'Queen endings: passed pawns plus checks decide.',
          ],
          selfCheck: '65% on 12 puzzles.',
        },
      },
      {
        title: 'Advanced Combinations',
        description: 'Sacrifices, deflection, attraction and discovered attacks in more complex positions.',
        targetCount: 25,
        tip: 'Before you sacrifice, calculate the line to the end, including the best defence.',
        practice: [puzMulti(['sacrifice', 'deflection', 'attraction', 'discoveredAttack'], 'Advanced combinations')],
        lesson: {
          why: 'Combinations win games against solid opponents.',
          ideas: [
            'Use all the standard motifs together.',
            'Look at forcing moves first.',
            'Check the opponent’s best defence before committing.',
          ],
          selfCheck: '65% on 25 puzzles.',
        },
      },
      {
        title: 'Calculate Forcing Lines Accurately',
        description: 'Calculate long forcing variations without losing track of the position.',
        targetCount: 15,
        tip: 'Keep a tree of candidate moves in your head. Return to the start of the line when you hit a dead end.',
        practice: [puzMulti(['long', 'veryLong'], 'Long puzzles')],
        lesson: {
          why: 'Longer calculation is what stops losing tactical fights.',
          ideas: [
            'Candidate moves → forcing lines → evaluate end position.',
            'Visualise the board after each move.',
            'Do not re-calculate the same line twice.',
          ],
          selfCheck: '55% on 15 long puzzles.',
        },
      },
      {
        title: 'Plans in Quiet Positions',
        description: 'Find a plan when no tactic exists: improve the worst piece, fix a weakness, fight for a key square.',
        targetCount: 5,
        tip: 'A good plan improves your worst piece, creates a weakness or fights for a key square, ideally all three.',
        practice: [play('Play vs Computer'), review('Review your game')],
        lesson: {
          why: 'At 1400–1600 most games are quiet. A plan beats waiting for a blunder.',
          ideas: [
            'Evaluate: king safety, material, piece activity, pawn structure.',
            'Choose a plan and keep it.',
            'Re-evaluate after each opponent move.',
          ],
          selfCheck: 'State your plan in 5 slow games.',
        },
      },
      {
        title: 'Defend Worse Positions',
        description: 'Find resources, make it hard to win, and save half-points.',
        targetCount: 15,
        tip: 'Do not give up. Create practical problems and look for perpetual check or stalemate tricks.',
        practice: [puzMulti(['defensiveMove', 'equality'], 'Defence puzzles')],
        lesson: {
          why: 'Everyone gets worse positions. Defending well wins half-points.',
          ideas: [
            'Exchange pieces, block passed pawns, build fortresses.',
            'Look for counterplay and perpetual checks.',
          ],
          selfCheck: '60% on 15 puzzles.',
        },
      },
      {
        title: 'Time Management',
        description: 'Spend time where it matters and avoid blunders in time trouble.',
        targetCount: 5,
        tip: 'Play fast in familiar openings, and spend your time at the critical moment.',
        practice: [play('Play vs Computer'), review('Review your game')],
        lesson: {
          why: 'Clock mistakes cost many games at this level.',
          ideas: [
            'Plan your time budget before the game.',
            'Use more time at the first critical moment.',
            'Do not spend all your time in the opening.',
          ],
          selfCheck: 'Finish 5 games with at least 10% of time left.',
        },
      },
      {
        title: 'Opening Depth with Understanding',
        description: 'Deepen your repertoire with typical plans, model games and traps in your lines.',
        targetCount: 8,
        tip: 'Use the master games in the trainer to see how strong players handle your lines.',
        practice: [openings('Practise opening lines')],
        lesson: {
          why: 'A solid repertoire means a comfortable middlegame.',
          ideas: [
            'Know the main variations and their plans.',
            'Study model games.',
            'Review your own games in your openings.',
          ],
          selfCheck: 'Reach a comfortable middlegame in 8 of 10 games.',
        },
      },
      {
        title: 'Weakness Audit',
        description: 'Tag every loss: tactics, opening, endgame, strategy or time. Train your top category.',
        targetCount: 6,
        tip: 'Do this audit every 10 games. Your training plan should follow the data.',
        practice: [review('Review your game')],
        lesson: {
          why: 'At this level improvement is about fixing specific recurring weaknesses.',
          ideas: [
            'Count error types over your last 10 losses.',
            'Pick the top category and train it for two weeks.',
            'Re-audit and repeat.',
          ],
          selfCheck: 'Complete 2 audits.',
        },
      },
    ]),
  },
];
