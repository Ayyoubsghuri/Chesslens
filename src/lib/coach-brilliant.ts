import type { AnalyzedMove, Settings } from './types';
import { formatEval } from './engine';
import { getBoardContext } from './board-analysis';

/** Why was this move brilliant? Uses the engine line + our own material facts. */
export async function getBrilliantExplanation(
  move: AnalyzedMove,
  facts: string,
  settings: Settings
): Promise<string> {
  if (!settings.openaiApiKey) {
    return 'Please add your OpenAI API key in Settings to get AI explanations.';
  }
  const ctx = getBoardContext(move.fenBefore);
  const moveNumber = Math.floor(move.index / 2) + 1;

  const prompt = `A chess engine marked this move as BRILLIANT (a sound sacrifice). Explain to the player WHY it is brilliant, in 2-4 simple sentences. Use ONLY the facts below; do not invent tactics.

${ctx.ascii}
FEN: ${move.fenBefore}
Move: ${moveNumber}. ${move.color === 'w' ? '' : '...'}${move.san} (${move.color === 'w' ? 'White' : 'Black'})
Eval before: ${move.evalBefore ? formatEval(move.evalBefore) : 'N/A'}
Eval after: ${move.evalAfter ? formatEval(move.evalAfter) : 'N/A'}

Verified facts about the move:
${facts}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.openaiApiKey}` },
      body: JSON.stringify({
        model: settings.coachModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a precise chess coach. Only describe what the provided facts and board show.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 250,
      }),
    });
    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
    const data = await response.json();
    return data.choices[0]?.message?.content?.trim() || 'No explanation generated.';
  } catch (error) {
    return `Failed to get explanation: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}
