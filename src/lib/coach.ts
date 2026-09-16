import { Chess } from 'chess.js';
import type { AnalyzedMove, Settings } from './types';
import { formatEval } from './engine';
import { getBoardContext } from './board-analysis';

export async function getCoachExplanation(
  move: AnalyzedMove,
  settings: Settings
): Promise<string> {
  if (!settings.openaiApiKey) {
    return 'Please add your OpenAI API key in Settings to get coach explanations.';
  }

  const ctx = getBoardContext(move.fenBefore);
  const moveNumber = Math.floor(move.index / 2) + 1;

  const prompt = `You are an expert chess coach. Analyze the following move based ONLY on the concrete board position provided. Do NOT invent threats, tactics, or piece placements that are not shown below.

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

=== CRITICAL RULES ===
1. You MUST only reference pieces and squares visible in the ASCII board above.
2. If you mention a threat, it MUST be verifiable from the "Pieces under attack" or "Checks available" lists.
3. Do NOT say a piece is hanging unless it appears in the attacked-pieces list.
4. Do NOT invent tactical sequences. Only describe what is concretely present.
5. If the move is a blunder or mistake, explain the concrete tactical refutation using exact squares.
6. Keep your explanation to 2-4 sentences. Be specific and accurate.

Explain why this move was ${move.quality}:`;

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
          {
            role: 'system',
            content:
              'You are a precise chess coach. You only describe what is actually on the board. You never hallucinate threats, tactics, or piece placements.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
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

  const prompt = `You are an expert chess coach. Explain the strategic idea behind the following engine line. Base your explanation ONLY on the concrete position shown.

=== POSITION ===
${ctx.ascii}

FEN: ${fen}
Turn: ${ctx.turn}
Material: ${ctx.materialBalance}

=== ENGINE LINE (SAN) ===
${moveList.join(' ')}

=== CRITICAL RULES ===
1. Explain the strategic theme (attack, defense, prophylaxis, tactic).
2. Reference ONLY actual pieces and squares from the ASCII board.
3. Do NOT invent threats that don't exist.
4. Keep it to 2-3 sentences.

Strategic explanation:`;

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
          {
            role: 'system',
            content:
              'You are a precise chess coach. You only describe what is actually on the board.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 250,
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