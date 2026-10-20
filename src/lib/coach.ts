import { Chess } from 'chess.js';
import type { AnalyzedMove, Settings } from './types';
import { formatEval } from './engine';
import { getBoardContext } from './board-analysis';
import { lineOutcome } from './coach-explain';
import { PERSONA_SYSTEM, personaPromptBlock } from './coach-persona';
import { methodPromptBlock, REVIEW_METHOD } from './coach-method';

/** One place for the OpenAI call, so every coach feature shares the same persona + error handling. */
async function askCoach(
  settings: Settings,
  userPrompt: string,
  opts: { maxTokens: number; temperature: number },
): Promise<string> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: settings.coachModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: PERSONA_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content?.trim() || 'No explanation generated.';
  } catch (error) {
    return `Failed to get explanation: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export async function getCoachExplanation(
  move: AnalyzedMove,
  settings: Settings
): Promise<string> {
  if (!settings.openaiApiKey) {
    return 'Please add your OpenAI API key in Settings to get coach explanations.';
  }

  const ctx = getBoardContext(move.fenBefore);
  const moveNumber = Math.floor(move.index / 2) + 1;

  // Where does the engine's own line end? A sacrifice that forces stalemate, a perpetual or a mate changes what the move means.
  const lineUcis = (move.evalAfter?.continuation ?? '').split(/\s+/).filter(Boolean);
  const end = lineOutcome(move.fenAfter, lineUcis);
  const endText = end
    ? `The engine's line ENDS THE GAME: ${end.kind === 'mate' ? 'checkmate' : end.kind === 'stalemate' ? 'stalemate (draw)' : 'a draw (' + end.kind + ')'} after ${end.ply + 1} plies.`
    : 'The engine line does not end the game within its length.';

  const prompt = `Analyze the following move based ONLY on the concrete board position provided. Do NOT invent threats, tactics, or piece placements that are not shown below.

=== POSITION BEFORE THE MOVE ===
${ctx.ascii}

FEN: ${move.fenBefore}
Move number: ${moveNumber}
Turn: ${ctx.turn}
Phase: ${ctx.phase}
Material: ${ctx.materialBalance}
Castling rights: ${ctx.castling}

=== CONCRETE TACTICAL DATA ===
Pieces under attack:
${ctx.attackedPieces.length > 0 ? ctx.attackedPieces.join('\n') : 'None'}

Checks / checkmates available in this position:
${ctx.checksAvailable.length > 0 ? ctx.checksAvailable.join(', ') : 'None'}

=== THE MOVE THAT WAS PLAYED ===
Move: ${moveNumber}. ${move.color === 'w' ? '' : '...'}${move.san}
Played by: ${move.color === 'w' ? 'White' : 'Black'}
Quality: ${move.quality}

=== ENGINE DATA ===
Eval before: ${move.evalBefore ? formatEval(move.evalBefore) : 'N/A'}
Eval after: ${move.evalAfter ? formatEval(move.evalAfter) : 'N/A'}
Eval loss: ${move.evalDelta !== null ? move.evalDelta.toFixed(2) + ' pawns' : 'N/A'}
Best engine move: ${move.evalBefore?.bestMove || 'N/A'}
Suggested continuation: ${move.evalBefore?.continuation || 'N/A'}
Line after the move played: ${move.evalAfter?.continuation || 'N/A'}
${endText}

=== CRITICAL RULES ===
1. You MUST only reference pieces and squares visible in the ASCII board above.
2. If you mention a threat, it MUST be verifiable from the "Pieces under attack" or "Checks available" lists.
3. Do NOT say a piece is hanging unless it appears in the attacked-pieces list.
4. Do NOT invent tactical sequences. Only describe what is concretely present.
5. If the move is a blunder or mistake, explain the concrete tactical refutation using exact squares.
6. Keep your explanation to 2-5 spoken sentences. Be specific and accurate, and keep the voice lively. Jokes may exaggerate the drama, never the facts.
7. Material is not the whole story: if the eval after the move is far better than the material suggests (for example a sacrifice that takes the eval from clearly lost to 0.00), explain what the sacrifice achieves, using the engine line (stalemate, perpetual check, mate, fortress). Never call such a move a blunder just because it gives up material.
8. When you recommend a different move, it MUST be the "Best engine move" or the first move of the "Suggested continuation". Never invent your own suggestion, and never recommend a capture that leaves a bigger piece hanging.
9. Compare king safety, material, piece activity and pawn structure when the position is quiet. When there is a tactic, name it plainly and say why it works.

${personaPromptBlock(move.quality, ctx.phase, ctx.materialBalance)}

${methodPromptBlock(move.quality, ctx.phase)}

Now explain this move the same way (react, read the position, sweep, compare, if-then, score, translate, rule), using ONLY the data above. Why was it ${move.quality}?`;

  return askCoach(settings, prompt, { maxTokens: 420, temperature: 0.6 });
}

export async function getBestLineExplanation(
  fen: string,
  continuation: string,
  settings: Settings
): Promise<string> {
  if (!settings.openaiApiKey) {
    return 'Please add your OpenAI API key in Settings to get line explanations.';
  }

  const ctx = getBoardContext(fen);

  // Convert the engine UCI line to SAN so the model reads familiar notation
  const chess = new Chess(fen);
  const moveList: string[] = [];
  const uciMoves = continuation.split(/\s+/).filter(Boolean);
  for (const uci of uciMoves.slice(0, 8)) {
    try {
      const result = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (result) moveList.push(result.san);
    } catch {
      break;
    }
  }

  const prompt = `Explain the strategic idea behind the following engine line. Base your explanation ONLY on the concrete position shown.

=== POSITION ===
${ctx.ascii}

FEN: ${fen}
Turn: ${ctx.turn}
Phase: ${ctx.phase}
Material: ${ctx.materialBalance}

=== ENGINE LINE (SAN) ===
${moveList.join(' ')}

=== CRITICAL RULES ===
1. Explain the strategic theme (attack, defense, prophylaxis, tactic) in plain spoken English, as if you were thinking out loud: what does the first move do, and what does the opponent want?
2. Reference ONLY actual pieces and squares from the ASCII board.
3. Do NOT invent threats that don't exist.
4. Keep it to 2-4 spoken sentences, same lively voice as always, and finish with one short reusable rule if it fits (for example "when in doubt, bring the rook").

${personaPromptBlock('best', ctx.phase, ctx.materialBalance)}

${methodPromptBlock('best', ctx.phase)}

Strategic explanation (talk through the line as if-then branches, then say the rule):`;

  return askCoach(settings, prompt, { maxTokens: 320, temperature: 0.55 });
}

/** Opening / middlegame / endgame from the FEN and the move number (cheap, no board analysis needed). */
function phaseOfMove(m: AnalyzedMove): 'opening' | 'middlegame' | 'endgame' {
  const moveNumber = Math.floor(m.index / 2) + 1;
  const placement = m.fenBefore.split(' ')[0];
  const pieces = (placement.match(/[qrbn]/gi) ?? []).length;
  if (moveNumber <= 10 && pieces >= 12) return 'opening';
  if (pieces <= 6) return 'endgame';
  return 'middlegame';
}

const BADQ = ['inaccuracy', 'mistake', 'miss', 'blunder'];
const GOODQ = ['brilliant', 'great', 'best'];

/**
 * End-of-game review in the same order a coach goes through a game: opening, middlegame, endgame,
 * then the turning point, what went well, and one rule for next time. Uses only data from the analyzed moves.
 */
export async function getGameSummary(
  moves: AnalyzedMove[],
  settings: Settings,
  playerColor?: 'w' | 'b'
): Promise<string> {
  if (!settings.openaiApiKey) {
    return 'Please add your OpenAI API key in Settings to get a game summary.';
  }
  if (moves.length === 0) return 'No moves to summarize yet.';

  const mine = playerColor ? moves.filter((m) => m.color === playerColor) : moves;
  const label = (m: AnalyzedMove) => {
    const n = Math.floor(m.index / 2) + 1;
    return `${n}${m.color === 'w' ? '.' : '...'} ${m.san}`;
  };

  const phases: Record<'opening' | 'middlegame' | 'endgame', AnalyzedMove[]> = { opening: [], middlegame: [], endgame: [] };
  for (const m of mine) phases[phaseOfMove(m)].push(m);

  const phaseLines = (['opening', 'middlegame', 'endgame'] as const)
    .map((ph) => {
      const ms = phases[ph];
      if (ms.length === 0) return `${ph.toUpperCase()}: no moves.`;
      const bad = ms.filter((m) => BADQ.includes(m.quality));
      const good = ms.filter((m) => GOODQ.includes(m.quality));
      const worst = [...bad].sort((a, b) => (b.evalDelta ?? 0) - (a.evalDelta ?? 0))[0];
      return `${ph.toUpperCase()}: ${ms.length} moves, ${bad.length} slips, ${good.length} strong moves.` +
        (worst ? ` Worst: ${label(worst)} (${worst.quality}, lost ${(worst.evalDelta ?? 0).toFixed(2)} pawns, best was ${worst.evalBefore?.bestMove ?? 'N/A'}).` : '') +
        (good[0] ? ` Best: ${label(good[0])} (${good[0].quality}).` : '');
    })
    .join('\n');

  const turning = [...mine]
    .filter((m) => m.evalDelta !== null && m.evalDelta > 0)
    .sort((a, b) => (b.evalDelta ?? 0) - (a.evalDelta ?? 0))[0];

  const prompt = `Review this game for the student using ONLY the data below.

=== DATA (student side) ===
${phaseLines}
Turning point: ${turning ? `${label(turning)} (${turning.quality}, lost ${(turning.evalDelta ?? 0).toFixed(2)} pawns, best was ${turning.evalBefore?.bestMove ?? 'N/A'})` : 'none, it was a clean game'}

=== RULES ===
1. Only mention moves listed above. Do not invent moves, squares or tactics.
2. Skip any phase that has no moves.
3. Never recommend a move that is not listed as "best was ...".
4. If there was no turning point, say it was a clean game and what kept it clean.

${REVIEW_METHOD}`;

  return askCoach(settings, prompt, { maxTokens: 500, temperature: 0.65 });
}
