import type { PieceSymbol, Color } from 'chess.js';

const PIECE_PATHS: Record<PieceSymbol, string> = {
  k: 'M22 9.5c0 2.5-1.5 4.5-4 5.5v2h4v2h-4v3h4v2h-4v3h-4v-3h-4v3H6v-3H2v-2h4v-3H2v-2h4v-2c-2.5-1-4-3-4-5.5C2 6 5 4 9 4s5 2 5 5.5zM9 4c1.5 0 2.5-1 2.5-2.5S10.5 0 9 0 6.5 1 6.5 2.5 7.5 4 9 4z',
  q: 'M9 13c-3.3 0-6-2.7-6-6 0-2.2 1.2-4.2 3-5.2L5 4l2-2 2 2 2-2 2 2-1-2.2c1.8 1 3 3 3 5.2 0 3.3-2.7 6-6 6zm0 2c3.3 0 6 1.5 6 3.5V20H3v-1.5C3 16.5 5.7 15 9 15z',
  r: 'M3 4h12v3H3zM3 7h12v2H3zM4 9h10v8H4zM5 17h8v3H5z',
  b: 'M9 0c1.5 1 2.5 2.5 2.5 4.5S10.5 8 9 9c-1.5-1-2.5-2.5-2.5-4.5S7.5 1 9 0zm0 9c3 0 5 2 5 5v6H4v-6c0-3 2-5 5-5zM7 20h4v2H7z',
  n: 'M5 20v-2h8v2H5zm0-3c-1 0-2-1-2-2 0-1 0.5-2 1.5-3 1-1 2-2 3-4 1-2 2-3 3.5-3 1 0 2 0.5 2.5 1.5 0.5-0.5 1-1 1.5-1 1 0 1.5 0.5 1.5 1.5v3c0 1-0.5 2-1.5 3-1 1-2 2-3.5 3-1.5 1-3 1.5-5 1.5z',
  p: 'M9 8c1.7 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.3-3 3-3zm0 6c2 0 3 1 3 2v4H6v-4c0-1 1-2 3-2z',
};

export function Piece({ piece, color, size = 45 }: { piece: PieceSymbol; color: Color; size?: number }) {
  const isWhite = color === 'w';
  const fill = isWhite ? '#f8f8f8' : '#2a2e39';
  const stroke = isWhite ? '#3d4351' : '#0a0b0e';
  const path = PIECE_PATHS[piece];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      className="piece-svg"
      style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
    >
      <path d={path} fill={fill} stroke={stroke} strokeWidth={0.5} strokeLinejoin="round" />
    </svg>
  );
}
