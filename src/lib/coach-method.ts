/**
 * coach-method.ts
 * HOW the coach explains, not just how it sounds.
 * The order of thought below is what repeats in every game review in the transcripts:
 *
 *   1. REACT        a gut reaction and the verdict, in a few words.
 *   2. READ         "what does my opponent want?" / what just changed in the position.
 *   3. SWEEP        checks, captures, attacks, for both sides (the CCA ritual).
 *   4. CANDIDATES   "I see this, and I also see that", then compare them.
 *   5. IF-THEN      walk the line as spoken branches: "if they take, I take, then...".
 *   6. SCORE        compare the four criteria (material, king safety, piece activity, pawn structure / space).
 *                   If the engine number disagrees, there is a tactic: the wild card.
 *   7. TRANSLATE    put the engine's move into human words, or admit it is a computer move.
 *   8. RULE         finish with one reusable rule, tied to the student's habit.
 *   9. NEXT         what to look at on the next move.
 *
 * Used by coach.ts (the GPT coach: instructions + worked examples) and coach-explain.ts (the template scenes).
 * Template helpers are deterministic (seeded) so the same move always reads the same.
 */
import { v } from './coach-voice';
import { OPENING_LINES, MIDDLEGAME_LINES, ENDGAME_LINES } from './coach-persona';

// ===========================================================================
// 1. Instructions for the LLM coach
// ===========================================================================
export const METHOD_BEATS = `HOW TO EXPLAIN (follow this order of thought; skip a beat only when it does not apply)
1. REACT: one short reaction and the verdict ("Oh no.", "Love that move.").
2. READ THE POSITION: say what changed after the move and what the OPPONENT wants now. Ask it out loud, then answer it.
3. SWEEP: say what the checks, captures and attacks were for both sides, and whether the move used or ignored them. (Use only the lists you were given.)
4. CANDIDATES: name the move that was played and the engine's move, and compare them in one sentence ("I see this one, and I also see that one").
5. IF-THEN: walk the engine line as spoken branches, at most three plies ("if they take, I take, and now..."). Only moves from the data.
6. SCORE IT: in a quiet position compare material, king safety, piece activity and pawn structure/space; in a tactical position name the tactic plainly and say why it works. If the evaluation disagrees with the four criteria, say a tactic is the wild card.
7. TRANSLATE: turn the engine move into a human reason (it activates a rook, it stops a jump, it removes a target). If there is no human reason, say honestly that it is a computer move and give the practical idea instead.
8. RULE: end with ONE reusable rule or habit, tied to what the student actually did.
9. NEXT: if there is room, say what to look at on the next move.
Keep it spoken, first person, 2-5 sentences for a normal move. Do not label the beats. Do not number them. Just talk in that order.`;

// ===========================================================================
// 2. Worked examples (structure only: NEVER reuse their squares or pieces)
// ===========================================================================
type ShotKind = 'bad' | 'good' | 'quiet' | 'endgame';
interface Shot { kind: ShotKind; facts: string; spoken: string }

export const FEW_SHOT: Shot[] = [
  {
    kind: 'bad',
    facts: 'Blunder. Before the move a knight was already aimed at a pawn next to the king. The move did not deal with it. Engine reply: knight takes that pawn with a fork on queen and rook. Best was a move that protects the pawn.',
    spoken: "Okay, so what does my opponent want here? Look at that knight, it was already staring at the pawn next to the king, and that is the thing you have to see before you move. Instead you walked right into the fork, and now the queen and the rook are both attacked, so something has to fall. The move that protects the pawn keeps everything equal. Checks, captures, attacks: if their piece is already aimed at something, protect it first.",
  },
  {
    kind: 'quiet',
    facts: 'Book move in the opening. No checks, no captures, nothing attacked. Move develops a knight toward the center.',
    spoken: "Standard stuff, and that is exactly right. No checks, no captures, nothing hanging, so this is just development: knight out toward the center, where it wants to be. Remember, knights before bishops. Next I want the bishop out and then castle. Do not overthink the opening, just follow the principles.",
  },
  {
    kind: 'bad',
    facts: 'Inaccuracy, lost half a pawn. Engine prefers a rook move that gives up a pawn to activate the rook. No concrete tactic in the line.',
    spoken: "This is one of those where the computer wants something a human would not find from the move alone. It likes the rook move, and the idea is simply to get the rook active, even if it costs a pawn. Can I put that in words? Kind of: an active rook is worth more than that pawn. But for you, this move is not a crime, it just wastes a tempo. When in doubt, bring the rook.",
  },
  {
    kind: 'good',
    facts: 'Brilliant. Quiet rook move. Opponent had a bishop check coming, but after this move any bishop move loses to a capture. Engine line: bishop moves, rook takes with check.',
    spoken: "Oh, this is a very nice move. You stayed patient for one move. Look at what they want: a bishop check that wins time. But now any bishop move loses to rook takes, and they cannot stop both threats. A computer would grumble about the quiet move, but a human sees the idea. Sometimes the strongest move is the quiet one that takes away their only defense.",
  },
  {
    kind: 'good',
    facts: 'Good move under attack. Opponent has queen and rook pointed at the king. Move offers a bishop trade. Material equal.',
    spoken: "When you are under attack, the first question is: what is the threat? Queen and rook pointing at the king, so you cannot just sit there. Offering the trade is the right instinct, fewer attackers, fewer problems. Notice you did not push the king forward and you did not panic. Material is level, you are not losing, you are just defending. When you are attacked, trade the attacker.",
  },
  {
    kind: 'bad',
    facts: 'Mistake. Queen took a pawn on the far side of the board. Engine reply: rook to the open file traps the queen. Best was to castle.',
    spoken: "It is not checkers, folks. The pawn looks free, but ask what the capture lets them do, and here the rook lands on the open file and the queen has nowhere safe to go. I understand the idea, I just do not like the result. Castling gets the king to safety and keeps the position healthy. Before you grab a pawn, ask what it opens.",
  },
  {
    kind: 'endgame',
    facts: 'Best move. Rook behind the passed pawn. Enemy king is cut off on the second rank. Engine says winning.',
    spoken: "Rook behind the passed pawn, that is the textbook move. Look at their king, it is cut off, so it cannot help. Now it is simple: push, and let the rook support the pawn. Do not go chasing the other pawns, that is the greedy way. And when you make a queen, make sure they still have a legal move so you do not stalemate. Active king, rook behind the pawn.",
  },
];

/** Worked examples that fit this move (kept to 3 so the prompt stays small). */
export function fewShotBlock(quality: string, phase: string): string {
  const bad = ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(quality);
  const wantEnd = /end/i.test(phase);
  const wantOpen = /open/i.test(phase) || quality === 'book';
  const pool = FEW_SHOT.filter((s) =>
    bad ? s.kind === 'bad'
      : wantEnd ? s.kind === 'endgame' || s.kind === 'good'
      : wantOpen ? s.kind === 'quiet' || s.kind === 'good'
      : s.kind === 'good' || s.kind === 'quiet');
  const chosen = pool.slice(0, 3);
  return chosen
    .map((s, i) => `EXAMPLE ${i + 1} (structure only; never reuse its squares or pieces)\nData: ${s.facts}\nCoach: ${s.spoken}`)
    .join('\n\n');
}

/** Full block appended to the user prompt in coach.ts. */
export function methodPromptBlock(quality: string, phase: string): string {
  return `${METHOD_BEATS}\n\n${fewShotBlock(quality, phase)}`;
}

/** Post-game review in the same order he reviews a game: opening, middlegame, endgame, time/habits, turning point, homework. */
export const REVIEW_METHOD = `HOW TO REVIEW THE WHOLE GAME (talk through it in this order)
1. First feel of the game in one sentence.
2. OPENING: did they follow the principles (develop, center, castle)? Did they get a good position out of it?
3. MIDDLEGAME: did they spot tactics, find a plan, and look at what the opponent wanted? Name the turning point and the habit behind it.
4. ENDGAME / CONVERSION (if there was one): did they convert simply (trade when up, active king, rook behind the pawn)?
5. One thing they did well, said sincerely.
6. How to fight back or how to avoid it next time, with one concrete rule.
7. Say honestly if the computer disagrees with the practical choice, and which one matters at their level.
Spoken, first person, 6-9 sentences, no lists.`;

// ===========================================================================
// 3. Deterministic template helpers for coach-explain.ts
// ===========================================================================
const list = (xs: string[], max = 3) => {
  if (xs.length === 0) return 'none';
  const shown = xs.slice(0, max);
  const more = xs.length - shown.length;
  return shown.join(', ') + (more > 0 ? ` and ${more} more` : '');
};

/** Step 3, the sweep: "checks, captures, attacks" read out, then what the played move did with them. */
export function ccaText(o: {
  checks: string[]; captures: string[]; attacked: string[];
  playedKind: 'check' | 'capture' | 'quiet'; bestKind: 'check' | 'capture' | 'quiet' | null;
  bad: boolean; seed: string;
}): string {
  const intro = v(o.seed, ['Let me run my checklist first: checks, captures, attacks.', 'Before judging it, checks, captures, attacks.', 'Okay, CCA before anything else.']);
  const body = `Checks: ${list(o.checks)}. Captures: ${list(o.captures)}. Under attack: ${list(o.attacked)}.`;
  let verdict = '';
  if (o.bad && o.bestKind === 'check' && o.playedKind !== 'check') verdict = ' The best move was one of those checks, and that is exactly why you look at checks first, even the ugly ones.';
  else if (o.bad && o.bestKind === 'capture' && o.playedKind !== 'capture') verdict = ' The best move was a capture. Free material does not stay free for long.';
  else if (o.bad && o.attacked.length > 0 && o.playedKind === 'quiet') verdict = ' Something of yours was already under attack, and the move did not deal with it. Always ask what they want first.';
  else if (o.checks.length + o.captures.length === 0 && o.attacked.length === 0) verdict = ' Nothing forcing for either side, so this is a quiet position and it is all about the plan.';
  else if (!o.bad) verdict = v(o.seed + 'k', [' You looked at what was forcing and chose well.', ' Nothing here was ignored.', '']);
  return `${intro} ${body}${verdict}`;
}

/** Step 6, scoring: the opening line of the four-criteria scene. */
export const criteriaIntro = (seed: string): string =>
  v(seed, ['Let us score it the way a coach does: material, king safety, piece activity, pawn structure.', 'Four things decide who is better: material, king safety, piece activity, and pawn structure and space.', 'Quick evaluation: material, king, pieces, pawns.']);

/** Step 6, scoring: compares the four-criteria verdict with the engine number. */
export function criteriaClose(leader: string | null, engineLead: string | null, evalStr: string, seed: string): string {
  const agree = leader === engineLead;
  if (agree && leader) return v(seed, [`So on these four, ${leader} comes out ahead, and the engine agrees: **${evalStr}**.`, `${leader} wins the comparison, and the engine says the same: **${evalStr}**.`]);
  if (agree) return v(seed, [`So it is balanced on all four, and the engine agrees: **${evalStr}**.`, `Nothing separates the two sides, and the engine says **${evalStr}**.`]);
  if (!leader) return `The four criteria look balanced, but the engine says **${evalStr}**. When the numbers disagree, look for a tactic: it is the wild card that overrides everything else.`;
  return `On these four, ${leader} looks better, but the engine says **${evalStr}**. When the numbers disagree, look for a tactic: it is the wild card that overrides everything else.`;
}

/** Step 2, "what does my opponent want?": the opponent's threat, asked and answered. */
export const wantsText = (opp: string, san: string, does: string, seed: string): string =>
  v(seed, [
    `So what does ${opp} want here? **${san}**, which ${does}.`,
    `Ask yourself what ${opp} wants: **${san}**, which ${does}.`,
    `Watch out: ${opp} now threatens **${san}**, which ${does}.`,
    `Look at what ${opp} is aiming at: **${san}**, which ${does}.`,
  ]);

/** Step 5, if-then: the lead-in before the opponent's reply to a bad move. */
export const watchLead = (seed: string): string =>
  v(seed, ['Watch this.', 'Here is the problem.', 'Look at what they have now.', 'Now see what happens.']);

/** Step 8, the rule: a short principle for the phase, only on some good moves so it stays special. */
export function principleTail(quality: string, phase: string, seed: string): string {
  if (!['good', 'excellent', 'great', 'best', 'book'].includes(quality)) return '';
  if (v(seed + 'g', ['y', 'n', 'n']) !== 'y') return '';
  const pool = /end/i.test(phase) ? ENDGAME_LINES : /open/i.test(phase) ? OPENING_LINES : MIDDLEGAME_LINES;
  return ' ' + v(seed + 'r', pool);
}
