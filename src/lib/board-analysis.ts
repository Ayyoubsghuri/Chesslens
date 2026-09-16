import { Chess, type Square } from 'chess.js';

export interface BoardContext {
  ascii: string;
  turn: string;
  phase: string;
  materialBalance: string;
  castling: string;
  attackedPieces: string[];
  checksAvailable: string[];
}

export function getBoardContext(fen: string): BoardContext {
  const chess = new Chess(fen);
  const ascii = chess.ascii();
  const turn = chess.turn() === 'w' ? 'White' : 'Black';

  // Material balance
  let whiteVal = 0, blackVal = 0;
  const pieceValues: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const board = chess.board();
  for (const row of board) {
    for (const sq of row) {
      if (sq) {
        const val = pieceValues[sq.type] || 0;
        if (sq.color === 'w') whiteVal += val;
        else blackVal += val;
      }
    }
  }
  const materialBalance =
    whiteVal === blackVal
      ? 'Equal'
      : whiteVal > blackVal
        ? `White +${whiteVal - blackVal}`
        : `Black +${blackVal - whiteVal}`;

  // Rough phase from full-move counter in FEN
  const fenParts = fen.split(' ');
  const fullMove = parseInt(fenParts[5] || '1');
  const phase = fullMove < 10 ? 'Opening' : fullMove < 25 ? 'Middlegame' : 'Endgame';

  // Castling rights straight from FEN
  const castlingFen = fenParts[2] || '-';
  const castling = castlingFen === '-' ? 'None' : castlingFen;

  // Concrete attacked / undefended pieces
  const attackedPieces: string[] = [];
  const squares: Square[] = [];
  for (const f of 'abcdefgh') {
    for (const r of '12345678') {
      squares.push((f + r) as Square);
    }
  }

  for (const sq of squares) {
    const piece = chess.get(sq);
    if (!piece) continue;
    const oppColor = piece.color === 'w' ? 'b' : 'w';
    if (chess.isAttacked(sq, oppColor)) {
      const isDefended = chess.isAttacked(sq, piece.color);
      const name = `${piece.color === 'w' ? 'White' : 'Black'} ${piece.type.toUpperCase()} on ${sq}`;
      if (!isDefended) {
        attackedPieces.push(`${name} — ATTACKED and UNDEFENDED`);
      } else {
        attackedPieces.push(`${name} — attacked but defended`);
      }
    }
  }

  // Checks available in this position
  const checksAvailable: string[] = [];
  const moves = chess.moves({ verbose: true });
  for (const m of moves) {
    if (m.san.includes('#')) {
      checksAvailable.push(`${m.san} (checkmate)`);
    } else if (m.san.includes('+')) {
      checksAvailable.push(m.san);
    }
  }

  return {
    ascii,
    turn,
    phase,
    materialBalance,
    castling,
    attackedPieces,
    checksAvailable,
  };
}