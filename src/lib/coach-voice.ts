/**
 * coach-voice.ts
 * The coach's personality for the TEMPLATE sentences in coach-explain.ts (the Advanced coach panel).
 *
 * Rules that keep the panel working:
 *  - Everything is DETERMINISTIC (seeded by position + move): the same move always gets the same wording,
 *    so scenes rebuilt by React compare equal and the voice never "changes its mind" on re-render.
 *  - No square names (like "e4") in the flavor lines, because the voice player lights up squares it hears named.
 *  - Flavor lines are short: scene duration grows with text length.
 *  - Only chess FACTS come from the engine / chess.js; this file only adds attitude around them.
 */
import { OPENERS, ANALOGIES } from './coach-persona';

/** Same seed + same options always gives the same pick. */
export const v = (seed: string, opts: string[]): string => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return opts[h % opts.length];
};

type Q = 'brilliant' | 'best' | 'great' | 'excellent' | 'good' | 'book' | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';

// ---------------------------------------------------------------------------
// Scene 1: the verdict
// ---------------------------------------------------------------------------
const GOOD_EXTRA: Record<string, string[]> = {
  brilliant: ['You have to see this one.', 'That is the kind of move you screenshot.', 'Not easy to spot, take a bow.'],
  best: ['Exactly what the position was asking for.', 'The engine nods.', 'Simple, strong, no drama.'],
  great: ['Very nice practical move.', 'Good vision.', 'That puts the piece right where it wants to be.'],
  excellent: ['Nice and clean.', 'No notes.', 'Simple chess wins games.'],
  good: ['Totally fine.', 'Boring is good.', 'No weaknesses, keep going.'],
  book: ['Everybody knows this one.', 'Develop, fight for the center, castle.', 'Principles, not calculation.'],
};

export const goodOpen = (q: string, seed: string): string =>
  v(seed, [...(OPENERS[q as Q] ?? ['Good move.']), ...(GOOD_EXTRA[q] ?? [])]);

const BAD_EXTRA: Record<string, string[]> = {
  inaccuracy: ['You already had two windows, why build a third?', 'Finish your development first.', 'Look at what this move stops guarding.'],
  mistake: ['Every pawn move stops guarding something.', 'Looks natural, and that is why it is so common.', 'Careful, your opponent gets what they wanted.'],
  miss: ['There was a way to win material here.', 'Free material was on the board.', 'Loose pieces drop off, and you walked past one.'],
  blunder: ['Folks, stay calm.', 'Not ideal.', 'Three seconds on that move was too fast.', 'I would grab the board and shout if I could.'],
};

/** Opening reaction for a bad move (inaccuracy / mistake / miss / blunder). */
export const badOpen = (q: string, seed: string): string =>
  v(seed, [...(OPENERS[q as Q] ?? ['Hmm.']), ...(BAD_EXTRA[q] ?? [])]);

export const topChoice = (seed: string): string =>
  v(seed, [" It's also the engine's top choice.", ' And the engine agrees, it is the top choice.', " That's the engine's number one pick too.", ' The engine loves it too.']);

// ---------------------------------------------------------------------------
// What happens next
// ---------------------------------------------------------------------------
/** "White ___: Bishop to e5." for the first reply of a line. */
export const answerVerb = (seed: string): string => v(seed, ['answers', 'replies', 'hits back', 'now plays']);
/** "___: Bishop to e5." for later plies. */
export const thenLead = (seed: string): string => v(seed, ['Then', 'After that', 'Next']);

export const resultLead = (kind: 'stalemate' | 'mate' | 'lost' | 'losing' | 'worse', seed: string): string => {
  switch (kind) {
    case 'stalemate': return v(seed, ['Plot twist.', 'Wow, goodness me.', 'Not what anyone wanted.']);
    case 'mate': return v(seed, ['Oh no.', 'And that is the game.', 'Ouch.']);
    case 'lost': return v(seed, ['Ouch.', 'That hurts.', 'Folks, that is a disaster.']);
    case 'losing': return v(seed, ['Not good.', 'Now we are in trouble.', 'That is a rough one.']);
    default: return v(seed, ['Not ideal.', 'Hmm.', 'Now it is uphill.']);
  }
};

/** An everyday analogy for a blunder; ONLY for non-advanced players and about one blunder in two, so it stays special. */
export const blunderAnalogy = (seed: string, level?: string): string => {
  if (level === 'advanced') return '';
  const h = v(seed + 'a', ['y', 'n']);
  return h === 'y' ? ' ' + v(seed + 'b', ANALOGIES) : '';
};

// ---------------------------------------------------------------------------
// The better move
// ---------------------------------------------------------------------------
export const betterText = (bad: boolean, seed: string, move: string, why: string, evalStr: string, quiet = false): string =>
  bad
    ? v(seed, [
        `A much better choice was ${move}. It ${why}, and the position would have stayed around **${evalStr}**.`,
        `Here is what I wanted: ${move}. It ${why}, and you keep the position around **${evalStr}**.`,
        `Look at ${move} instead. It ${why}, so the position holds around **${evalStr}**.`,
        `What you were looking for: ${move}. It ${why}, and the position stays around **${evalStr}**.`,
        `How do you put ${move} into words? Simple: it ${why}, and the position stays around **${evalStr}**.`,
      ]) + (quiet ? ' Honestly, that is a computer move: do not worry if you could not find it from the move alone. The practical idea is to keep improving your worst piece.' : '')
    : v(seed, [
        `The engine likes ${move} a little more: it ${why}.`,
        `Small note: ${move} was a hair stronger, because it ${why}.`,
        `Fine move, but ${move} was slightly sharper: it ${why}.`,
      ]);

// ---------------------------------------------------------------------------
// The "Why" scene
// ---------------------------------------------------------------------------
export const causeLead = (seed: string): string => v(seed, ['The cause: ', 'Here is why: ', 'The problem: ', 'What happened: ']);

const HABITS: Record<string, string[]> = {
  'hung-piece': [
    'Habit to build: loose pieces drop off, so before you move a piece, check it is still protected where it lands.',
    'Before you put a piece somewhere, ask one question: who protects it there?',
  ],
  'ignored-threat': [
    'Habit to build: before every move, ask what your opponent wants. What is the threat right now?',
    'Look at what just changed in the position. A threat does not go away because you ignored it.',
  ],
  'missed-tactic': [
    'Habit to build: look for forcing moves for both sides first. That is where tactics hide.',
    'The shot was there. Next time look at the forcing moves before you decide.',
  ],
  'allowed-tactic': [
    'Habit to build: once you pick a move, ask what your opponent can do in reply. It is not checkers.',
    'Before you click, look at what your opponent can do in reply.',
  ],
  greedy: [
    'Habit to build: it is not checkers. Before you grab material, ask what the capture lets them do.',
    'Free material is lovely, but ask what the capture opens up first.',
  ],
  positional: [
    'Habit to build: when nothing is hanging, compare moves by king safety, piece activity and pawn structure.',
    'Simple chess: improve your worst piece, and when in doubt, bring the rook to the open file.',
  ],
  'stalemate-trap': [
    'Habit to build: when you are far ahead, count their legal moves before you box the king in. Do not stalemate a won game.',
    'When you are winning, play simple and keep checking what they can still do.',
  ],
};
export const habitFor = (id: string, seed: string): string => v(seed + id, HABITS[id] ?? ['Habit to build: look at what your opponent wants before every move.']);

export const missedVerb = (seed: string): string => v(seed, ['missed', 'walked right past', 'overlooked']);

// ---------------------------------------------------------------------------
// Game story / retry / why-not
// ---------------------------------------------------------------------------
export const whereLead = (seed: string): string => v(seed, ['Where we stand: ', 'Big picture: ', 'So where are we? Well, ']);

export const retryPrompt = (word: string, side: string, seed: string): string =>
  v(seed, [
    `That was ${word}. Can you find a better move for ${side}?`,
    `Okay, ${word}. Your turn: what would you play for ${side} instead?`,
    `${word.charAt(0).toUpperCase() + word.slice(1)}. Think about what the opponent wants, then find a better move for ${side}.`,
  ]);

export const retryOk = (seed: string): string =>
  v(seed, ["Yes, that's the engine's move. Well found!", "Boom. That's the engine's move. Nicely done!", "That's the one. You see the board well."]);

export const retryNo = (seed: string): string =>
  v(seed, ['Want a hint?', 'Not quite. Want a hint?', 'Close, but no. Want a hint?']);

export const whyNotLead = (bad: boolean, san: string, seed: string): string =>
  bad
    ? v(seed, [`Why not ${san}? `, `Why not ${san}? Let us check. `, `${san}? Okay, let us see what happens. `])
    : v(seed, [`Nothing wrong with ${san}. `, `${san} is totally fine. `, `${san}? That works. `]);
