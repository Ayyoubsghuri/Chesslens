import { Chess, type Color, type PieceSymbol } from 'chess.js';

const VAL: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

function balance(chess: Chess, color: Color): number {
  let s = 0;
  for (const row of chess.board())
    for (const sq of row) if (sq) s += (sq.color === color ? 1 : -1) * VAL[sq.type];
  return s;
}

/**
 * Explains a brilliant move from the board itself (no API needed).
 * `continuation` is the engine line AFTER the move (UCI), opponent to move.
 */
export function explainBrilliant(
  fenBefore: string,
  san: string,
  color: Color,
  continuation?: string | null,
  evalText?: string | null,
): string {
  try {
    const chess = new Chess(fenBefore);
    const opp: Color = color === 'w' ? 'b' : 'w';
    const start = balance(chess, color);
    const m = chess.move(san);
    const parts: string[] = [];

    parts.push(
      m.captured
        ? `${san} captures a ${NAME[m.captured]} with the ${NAME[m.piece]}.`
        : `${san} puts the ${NAME[m.piece]} on ${m.to}.`,
    );

    if (m.piece !== 'p' && chess.isAttacked(m.to, opp)) {
      const defended = chess.isAttacked(m.to, color);
      parts.push(
        defended
          ? `The ${NAME[m.piece]} can be captured there, but it is defended.`
          : `The ${NAME[m.piece]} can simply be captured there — it is offered as a sacrifice.`,
      );
    }

    let worst = balance(chess, color);
    let last = worst;
    const line: string[] = [];
    let mate = false;
    for (const uci of (continuation ?? '').split(/\s+/).filter(Boolean).slice(0, 8)) {
      try {
        const r = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        line.push(r.san);
        last = balance(chess, color);
        worst = Math.min(worst, last);
        if (r.san.includes('#')) mate = true;
      } catch {
        break;
      }
    }

    const given = start - worst;
    if (given >= 2) {
      parts.push(`In the engine's line you give up about ${given} points of material.`);
      if (mate) parts.push('But the line ends in checkmate.');
      else if (last >= start) parts.push('You win it all back by the end of the line.');
      else
        parts.push(
          `You stay ${start - last} point${start - last === 1 ? '' : 's'} down, but the attack/position is worth it${evalText ? ` (eval ${evalText})` : ''}.`,
        );
    } else if (mate) {
      parts.push('The engine line leads to checkmate.');
    } else {
      parts.push('It looks risky, but the engine shows the resulting position is better for you than it appears.');
    }

    if (line.length) parts.push(`Key line: ${line.join(' ')}`);
    return parts.join(' ');
  } catch {
    return 'This move gives up material for a stronger position, and the engine confirms it keeps your advantage.';
  }
}
