/**
 * coach-streamer.ts
 * The "live-stream coach" voice for WHOLE-GAME review. Fast, funny, thinks out loud, always asks
 * "what does my opponent want?", scans Checks / Captures / Attacks, uses danger levels, the plus-two rule,
 * evaluates with four criteria and ends with ONE rule you can reuse.
 *
 * It is a STYLE built from teaching habits, not a person: lines are original wording, nothing here claims
 * to be a real streamer. Facts never live here: every fact comes from the board / engine in coach-game.ts.
 * This file only supplies the *words around* the facts.
 *
 * Deterministic: vary(seed, options) always returns the same line for the same seed, so replaying a
 * game gives the same commentary (no flicker, no random contradictions between replays).
 */
import type { MoveQuality } from './types';
import { PRINCIPLES, ANALOGIES, DRAMA, TACTIC_LESSONS } from './coach-persona';

// ===========================================================================
// 0. HELPERS
// ===========================================================================

/** Small stable hash (FNV-1a). */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Same seed -> same pick. Different `salt` -> a different pick from the same seed (so two lines in one move differ). */
export function vary<T>(seed: string, options: readonly T[], salt = ''): T {
  if (options.length === 0) return '' as unknown as T;
  return options[hash(seed + '|' + salt) % options.length];
}

/** Replace {tokens}: fill('Nice {san}', { san: 'Nf3' }). Unknown tokens are left empty. */
export function fill(line: string, vars: Record<string, string | number | undefined>): string {
  return line.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
}

/** Pick + fill in one go. */
export const say = (seed: string, options: readonly string[], vars: Record<string, string | number | undefined> = {}, salt = '') =>
  fill(vary(seed, options, salt), vars).replace(/\s{2,}/g, ' ').trim();

export type Phase = 'opening' | 'middlegame' | 'endgame';

// ===========================================================================
// 1. SYSTEM PROMPT for the optional LLM path (same facts-only contract as PERSONA_SYSTEM)
// ===========================================================================
export const STREAMER_SYSTEM = `You are narrating a student's WHOLE game from move one to the last move, like a live-stream coach who is seeing the game for the first time, in real time, and talking out loud.

THE LOOP (every move, quickly, out loud)
1. React in half a sentence ("okay", "nice", "wait", "oh no").
2. Say what the move DOES: a threat, a development, a defender it removed, a square it took.
3. Say what the OPPONENT wants now. Run Checks, Captures, Attacks for them. If they have nothing, say so and relax.
4. If the move was good: one sentence on why, plus the plan. Do not overtalk good moves.
5. If the move was bad: stop and slow down. Show exactly what it allows (the engine line), why it works, what the better move was, and the habit that would have caught it.
6. End a segment with at most ONE reusable rule.

THINKING STYLE
- Danger levels: a piece may ignore an attack if it can hit something worth more.
- The plus-two rule: to attack a king you want two more attackers than it has defenders.
- Evaluate with material, king safety, piece activity, pawn structure. Tactics override all four.
- Trade when ahead, keep pieces on when behind. Simple wins beat fancy wins.
- Opposite-side castling means pawn storms; do not get blockaded, and do not open the position for the enemy.
- Improve the worst piece when there is no tactic. Pawn breaks crack closed positions.
- Absorb the first punch: after a blunder do not make a second one. Do not be stubborn, admit the mistake and change plans.
- If the opponent plays a weird opening move, do not respect it, punish it.
- Rating is a range. Raise the FLOOR (the worst moves) before the ceiling.

VOICE
- Spoken English. Contractions. Short punchy sentences, then the occasional run-on thought.
- Funny through comparisons and mock drama, never cruel. Roast the move, never the person.
- Admit when something is hard to see. Never use emojis, swearing or bullet lists.

HARD CONSTRAINTS (override the style)
- Only mention pieces, squares, threats and tactics that appear in the data you are given. Jokes may exaggerate the DRAMA, never the FACTS.
- A recommended move MUST be the engine's best move or the first move of its line.
- Never call a sacrifice a blunder if the engine line ends in mate, stalemate, perpetual or a fortress.
- Good moves get 1-2 sentences. Bad moves get the long treatment.`;

// ===========================================================================
// 2. PHASE FLAVOUR
// ===========================================================================
export const PHASE_THINK: Record<Phase, string[]> = {
  opening: [
    'Opening. Develop, fight for the center, castle. Nothing fancy.',
    'We are still in the opening, so I am just checking one thing: did a piece come out, and is the king getting safe?',
    'Early moves are about principles, not calculation.',
    'No need to reinvent the wheel here. Pieces out, center taken.',
  ],
  middlegame: [
    'Middlegame now, so the question is: where is the weakness, and who can get there first?',
    'Middlegame. Compare the kings first, then the pieces, then the pawns.',
    'This is where you stop following moves and start following ideas.',
    'We have a real position now. Which side has the better worst piece?',
  ],
  endgame: [
    'Endgame. The king is a fighting piece now.',
    'Fewer pieces, so every tempo counts. Count the moves.',
    'Endgame technique time. Rooks behind passed pawns, king in the game.',
    'Simple position, but simple does not mean easy. Count, count, count.',
  ],
};

// ===========================================================================
// 3. REACTIONS
// ===========================================================================

/** Spoken reaction at the start of a move, by verdict. Tokens: {san} {who} {n}. */
export const REACT: Record<MoveQuality, string[]> = {
  brilliant: [
    'Hold on. {san}? You have to see this.',
    'Okay, {san}. That is a very, very nice move.',
    'Oh, I love this. {san} is the kind of move you screenshot.',
    'Wow. {san}. Nobody finds that by accident.',
    'Ladies and gentlemen, {san}.',
  ],
  great: [
    '{san}. Very nice.',
    'Good find. {san} was not easy.',
    'I really like {san} here.',
    'Yep, {san}. That is the move.',
  ],
  best: [
    '{san}. Exactly what the position wanted.',
    'Clean. {san}.',
    '{san}, and the engine nods.',
    'Right move, right moment. {san}.',
    '{san}. Love it.',
  ],
  excellent: [
    '{san}. Good stuff.',
    '{san} is excellent, no complaints.',
    'Solid. {san}.',
    '{san}. Almost perfect, and nobody loses sleep over the difference.',
  ],
  good: [
    '{san}. Totally fine.',
    'Okay, {san}. Reasonable.',
    '{san}. Nothing wrong with it.',
    'Not flashy, but {san} works.',
  ],
  book: [
    '{san}. Standard stuff.',
    '{san}, everybody knows this one.',
    '{san}. Still theory.',
  ],
  inaccuracy: [
    'Hmm, {san}. Not the best.',
    '{san}. Small slip. Not a crime, but the engine raised an eyebrow.',
    'Okay, {san}. That is a move. It is just not THE move.',
    '{san}. Little gift for the other side.',
  ],
  mistake: [
    'Careful. {san} is where this starts to go wrong.',
    'Oh boy. {san}.',
    'Okay, pause. {san} is a mistake and I want to show you why.',
    '{san}. This looks natural, and that is exactly why it is dangerous.',
  ],
  miss: [
    'Wait. There was something here, and {san} is not it.',
    '{san}. You walked right past a shot.',
    'Okay, {san}. Reasonable move, but look at what was available.',
    'Hang on, let me show you what was sitting on the board.',
  ],
  blunder: [
    'Oh no. {san}.',
    'Folks, I need everyone to stay calm. {san}.',
    'Ouch. {san}. Let me show you why.',
    'Wait, what? {san}?',
    'Okay. {san}. Deep breath, because this one matters.',
  ],
};

/** The same reaction when it is the OPPONENT who played the move (student is the other side). */
export const REACT_OPP: Record<MoveQuality, string[]> = {
  brilliant: ['Credit to them. {san} is a very good move.', 'Hats off. {san}. That one hurts.'],
  great: ['{san}. Sharp move from them.', 'They found {san}. Not easy.'],
  best: ['{san}. Good move by them.', 'Annoying. {san} is exactly right.'],
  excellent: ['{san}. Fine move from them.'],
  good: ['{san}. Reasonable from them.', 'They play {san}. Nothing scary.'],
  book: ['{san}. They know the book.', '{san}. Standard.'],
  inaccuracy: ['{san}. A little loose from them.', 'They play {san}. Not the best, and we can use that.'],
  mistake: ['{san}. That is a mistake from them. Look for the punishment.', 'Oh, {san}? Now we are talking.'],
  miss: ['{san}. They had something better and did not see it.', 'They miss a shot with {san}. Phew.'],
  blunder: ['{san}?! Oh, that is a gift.', 'They play {san}, and we are about to be very happy.', 'Wow. {san}. Check what that left hanging.'],
};

// ===========================================================================
// 4. THE SCAN: "what does my opponent want?"  (Checks, Captures, Attacks)
// ===========================================================================
export const SCAN_DANGER: string[] = [
  'Checks, captures, attacks for them: {what}.',
  'What does {opp} want now? {what}.',
  'Danger check. {opp} can play {what}.',
  'If I am {opp}, here is what I am looking at: {what}.',
  'Their options: {what}. Keep that in mind.',
];
export const SCAN_CLEAR: string[] = [
  'Checks, captures, attacks for {opp}? Nothing real. Everything is protected.',
  'I looked for their checks, captures and attacks. Nothing. Relax.',
  'Does {opp} have a threat? No. Good.',
  '{opp} has nothing forcing here, so we are free to improve.',
  'No danger levels to worry about. The position is quiet.',
];
export const NO_THREAT_OWN: string[] = [
  'Does the move have a threat? Not really. That is fine, it improves the position.',
  'No immediate threat, so this is a plan move, not a tactic.',
  'It does not attack anything yet. When there is no tactic, improve your worst piece, and that is what this does.',
];
export const OWN_THREAT: string[] = [
  'And it creates a threat: next move {what}.',
  'It also sets up something: {what}.',
  'Now {who} threatens to play {what}.',
];

// ===========================================================================
// 5. CONTINUITY: reacting to what just happened one ply earlier
// ===========================================================================
/** Previous move was the opponent's mistake/blunder and the student answered with the best move. */
export const PUNISHED: string[] = [
  'And that is how you punish it: they slipped, you took it. Loose pieces drop off.',
  'Good. They gave you something and you did not get fancy. Simple wins.',
  'See the pattern? One slip from them, and you stepped on it. Checks, captures, attacks.',
  'That is the whole game at this level: someone blunders, someone notices.',
];
/** Previous move was the opponent's mistake and the student did NOT use it. */
export const WASTED_GIFT: string[] = [
  'They just gave you a gift on the last move, and this does not cash it in. Keep scanning for what they left behind.',
  'Remember what they did on the last move? There was something to punish there.',
];
/** The student got hit and now has to absorb the first punch. */
export const ABSORB: string[] = [
  'This is the important moment: you took a punch. Do not make a second mistake right now.',
  'You are worse, but you are not dead. Absorb the first punch, then fight.',
  'After a blunder the most dangerous move is the next one. Slow down.',
];
/** The student answered a mistake of their own with another mistake. */
export const SNOWBALL: string[] = [
  'And here it snowballs. One mistake, then a second one right behind it.',
  'The first punch hurts. The second one finishes the game. Do not stack mistakes.',
];
export const STREAK_GOOD: string[] = [
  'That is the third solid move in a row. You are playing like a much stronger player right now. Keep it.',
  'Look at that, a little streak of good moves. This is what raising your floor looks like.',
];
export const COMEBACK: string[] = [
  'Look at that. You were worse, and you are fighting back. Never stop making threats.',
  'The evaluation is swinging back. That is what happens when you keep the pieces on and keep the pressure up.',
];
export const OPP_STREAK_BAD: string[] = [
  'Your opponent keeps giving you chances. Keep checking what they left loose.',
];

// ===========================================================================
// 6. EVALUATION TALK  (four criteria: material, king safety, activity, structure)
// ===========================================================================
export type EvalBand = 'crushing' | 'winning' | 'better' | 'slight' | 'equal' | 'slight-bad' | 'worse' | 'losing' | 'lost';
export function evalBand(pawnsForMover: number): EvalBand {
  const p = pawnsForMover;
  if (p >= 5) return 'crushing';
  if (p >= 2.5) return 'winning';
  if (p >= 1) return 'better';
  if (p >= 0.3) return 'slight';
  if (p > -0.3) return 'equal';
  if (p > -1) return 'slight-bad';
  if (p > -2.5) return 'worse';
  if (p > -5) return 'losing';
  return 'lost';
}
export const EVAL_TALK: Record<EvalBand, string[]> = {
  crushing: [
    'The position is completely winning now ({e}). From here, simple chess: trade pieces, make a second queen, do not get fancy.',
    'This is {e}. The game is basically decided. Do not start playing like a 200 now.',
  ],
  winning: [
    'We are clearly winning, about {e}. Trade when you are up and keep an eye on counterplay.',
    '{e}. That is a winning position. Do not relax, keep checking what they threaten.',
  ],
  better: [
    'Better position, about {e}. Not decided, so keep improving your worst piece.',
    '{e}. You have an edge. Keep it simple and do not open the position for them.',
  ],
  slight: [
    'A small edge, {e}. Basically equal, and the better player will be whoever is more accurate from here.',
    '{e}. Tiny plus. That is a position you play, not a position you celebrate.',
  ],
  equal: [
    'Equal, {e}. Imbalances decide equal positions, so look for one you like: a structure, a bishop pair, an open file.',
    '{e}. Balanced. Nobody is winning yet, so find the plan.',
  ],
  'slight-bad': [
    'Slightly worse, {e}. Nothing terrible, but you have to be careful.',
    '{e}. A small minus. Fixable, if you stay accurate.',
  ],
  worse: [
    'Worse now, {e}. Keep the pieces on, make trouble, and do not trade into a dead ending.',
    '{e}. You are defending, so ask what the threat is before every move.',
  ],
  losing: [
    'Losing, {e}. When you are losing, attack the king. Passive defense just loses slowly.',
    '{e}. Time to create complications. Keep pieces on the board.',
  ],
  lost: [
    'That is lost on paper, {e}. But people play on for a reason: time trouble, tricks, a missed mate. Make it hard.',
    '{e}. Objectively over. Practically, set traps and see if they blink.',
  ],
};

// ===========================================================================
// 7. WHY-IT-WENT-WRONG HABITS  (matched to CauseId in coach-explain.ts)
// ===========================================================================
export const HABIT: Record<string, string[]> = {
  'hung-piece': [
    'Habit to build: before you let go of the piece, ask "can anything of theirs take it?" Every time. Three seconds.',
    'Loose pieces drop off, and that includes your own. Check that the piece you just moved is protected.',
  ],
  'ignored-threat': [
    'They had a threat on the board and the move did not deal with it. Rule: before your move, play their best move in your head.',
    'Ask the question first: what does my opponent want? If you do not know, you cannot play the move.',
  ],
  'missed-tactic': [
    'You had a shot and walked past it. Checks, captures, attacks. Every move. Even the ugly ones.',
    'The board is a big place. Look at the far side too. Long moves are the hardest to see.',
  ],
  'allowed-tactic': [
    'Your move allowed a tactic. Before you commit, look at what their pieces can reach after the move, not before it.',
    'Positions change every move. A piece that used to defend something may have just left.',
  ],
  greedy: [
    'It is not checkers. Taking is not mandatory. Before you grab it, ask what the capture opens up.',
    'Free pawns are the best bait. If it is that free, find out why.',
  ],
  positional: [
    'Nothing hangs, but the position got worse. Quiet mistakes count: they hand the opponent the better plan.',
    'Every pawn move stops guarding something. Ask what this one stopped.',
  ],
  'stalemate-trap': [
    'When you are winning, always leave the king a square. A win thrown away by stalemate hurts the most.',
  ],
};

// ===========================================================================
// 8. TACTIC NAME -> lesson (borrowed from persona, plus streamer extras)
// ===========================================================================
export const TACTIC_TAKEAWAY: Record<string, string[]> = {
  ...TACTIC_LESSONS,
  fork: [
    ...(TACTIC_LESSONS.fork ?? []),
    'Every move, look at where their knight can land. Forks hide in the squares you stopped looking at.',
  ],
  pin: [
    ...(TACTIC_LESSONS.pin ?? []),
    'A piece defended by a pinned piece is not really defended. Add an attacker.',
  ],
};

// ===========================================================================
// 9. PHASE / PLAN ADVICE (what to do next when nothing is forced)
// ===========================================================================
export const PLAN_OPENING: string[] = [
  'Plan: finish development, castle, connect the rooks.',
  'Next up: get the last minor piece out and think about where the king is going.',
  'If they have not taken the center, take it with pawns first.',
  'Do not move the same piece twice without a reason.',
];
export const PLAN_MIDDLE: string[] = [
  'Plan: rook to the open file. When in doubt, bring the rook.',
  'Look at their worst piece, then build around it.',
  'Closed position? Pawn break. Open position? Calculate.',
  'Keep the tension. The player who takes first often regrets it.',
  'Opposite-side castling means a race. Do not get blockaded.',
];
export const PLAN_ENDGAME: string[] = [
  'Plan: activate the king, rook behind the passed pawn.',
  'Make a passed pawn, then cut their king off.',
  'Trade rooks when you are up. Keep rooks when you are down.',
  'Count the pawn race before you commit.',
];
export const PLAN_AHEAD: string[] = [
  'You are up, so trade pieces and keep it simple.',
  'Up material means fewer pieces, fewer tricks.',
];
export const PLAN_BEHIND: string[] = [
  'You are down, so keep pieces on and go after the king.',
  'When you are losing, complications are your friend.',
];

// ===========================================================================
// 10. OPENING TALK (a run of book moves is ONE beat, not twenty)
// ===========================================================================
export const BOOK_RUN: string[] = [
  'The first {n} moves are theory, so I am not going to stop on each one. {name}. Everything follows the principles: center, development, safety.',
  'Moves one to {n} are book. {name}. The question is what happens when the book ends, and that is where the game starts.',
  'So far {n} moves of pure theory ({name}). Nobody has done anything wrong. Now let us see who knows what to do next.',
];
export const BOOK_RUN_NONAME: string[] = [
  'The first {n} moves are standard opening principles: pieces out, center, castle. Nothing to see yet.',
  'Moves one to {n} are all normal. Let us wait for the first real decision.',
];
export const BOOK_ENDS: string[] = [
  'And here the book ends. From now on it is about understanding, not memory.',
  'This is where theory runs out. Now you have to think.',
];

// ===========================================================================
// 11. ENDING OF THE GAME
// ===========================================================================
export const MATE_DELIVERED: string[] = [
  'And that is checkmate. Beautiful.',
  'Checkmate. No more questions.',
  'Mate. The king has nowhere to go and that is the whole game.',
];
export const MATE_RECEIVED: string[] = [
  'And that is checkmate. It hurts, but every game like this teaches you where your king needed help.',
  'Mate. Let us find the moment where we could have avoided it, because there always is one.',
];

// ===========================================================================
// 12. GAME INTRO / TURNING POINT / SUMMARY
// ===========================================================================
export const GAME_INTRO: string[] = [
  'Alright, let us go through this game together, from move one. I will keep the good moves short and slow down on the mistakes.',
  'Okay, here we go. I am seeing this game for the first time, so I will react as we go. Good moves get a quick nod, mistakes get the full treatment.',
  'Buckle up. Whole game, start to finish. Remember what we are doing: checks, captures, attacks, and what does the opponent want.',
];
export const TURNING_POINT: string[] = [
  'This is the turning point of the game. Everything before it was a fight, everything after was damage control.',
  'If you only remember one moment from this game, make it this one.',
  'This is the move that decided it. Pause here and learn it.',
];
export const BIG_SWING: string[] = [
  'The evaluation just swung by {swing} points of win chance. That is the biggest swing in the whole game.',
  'Win chance changed by about {swing} points on this single move. Nothing else in the game moved the needle that much.',
];
export const SUMMARY_LEAD: string[] = [
  'Okay, that was the whole game. Let me tell you how it felt.',
  'And that is the game. Here is what I saw.',
  'Right, game over. Quick review while it is fresh.',
];
export const SUMMARY_GOOD_GAME: string[] = [
  'Honestly a clean game. A few small slips, no disasters.',
  'This was a solid game. Most of your moves were exactly what the position wanted.',
];
export const SUMMARY_ROLLERCOASTER: string[] = [
  'A game of two halves. Good play, then one moment that changed everything.',
  'This one was a rollercoaster. Strong moves, and then one or two that gave it all back.',
];
export const SUMMARY_ROUGH: string[] = [
  'Rough game, and that is okay. Every blunder here is a pattern you can fix.',
  'This was a tough one. But look at the bright side: the same few habits caused most of the damage, so they are easy to train.',
];
export const HOMEWORK: string[] = [
  'Homework: before every move, ask what the opponent threatens. Just that.',
  'Homework: checks, captures, attacks, for both sides, every move for one week.',
  'Homework: after you pick a move, spend three seconds checking whether the piece you moved is protected.',
  'Homework: raise the floor. Your best moves are fine. Your worst moves decided the game.',
];

// ===========================================================================
// 13. PICKERS USED BY coach-game.ts
// ===========================================================================
export const reactFor = (seed: string, q: MoveQuality, byStudent: boolean, vars: Record<string, string | number | undefined>) =>
  say(seed, (byStudent ? REACT : REACT_OPP)[q] ?? REACT.good, vars, 'react');

export const phaseThink = (seed: string, phase: Phase) => vary(seed, PHASE_THINK[phase], 'phase');

export const principleFor = (seed: string) => vary(seed, PRINCIPLES, 'principle');
export const analogyFor = (seed: string) => vary(seed, ANALOGIES, 'analogy');
export const dramaFor = (seed: string) => vary(seed, DRAMA, 'drama');

export const planFor = (seed: string, phase: Phase, standing: 'ahead' | 'behind' | 'even'): string => {
  if (standing === 'ahead' && hash(seed + 'a') % 2 === 0) return vary(seed, PLAN_AHEAD, 'ahead');
  if (standing === 'behind' && hash(seed + 'b') % 2 === 0) return vary(seed, PLAN_BEHIND, 'behind');
  return vary(seed, phase === 'opening' ? PLAN_OPENING : phase === 'endgame' ? PLAN_ENDGAME : PLAN_MIDDLE, 'plan');
};

export const habitFor = (seed: string, cause: string | undefined, tactic?: string): string => {
  if (tactic && TACTIC_TAKEAWAY[tactic]?.length) return vary(seed, TACTIC_TAKEAWAY[tactic], 'tactic');
  if (cause && HABIT[cause]?.length) return vary(seed, HABIT[cause], 'habit');
  return vary(seed, PRINCIPLES, 'principle');
};

export const evalTalk = (seed: string, pawnsForMover: number, label: string): string =>
  say(seed, EVAL_TALK[evalBand(pawnsForMover)], { e: label }, 'eval');
