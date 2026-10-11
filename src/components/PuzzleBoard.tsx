import { Chess } from 'chess.js';
import type { Square } from 'chess.js';

const FILES = 'abcdefgh';

// Text-presentation selector (\uFE0E) stops the pawn from rendering as an emoji
const GLYPH: Record<string, string> = {
  k: '\u265A\uFE0E',
  q: '\u265B\uFE0E',
  r: '\u265C\uFE0E',
  b: '\u265D\uFE0E',
  n: '\u265E\uFE0E',
  p: '\u265F\uFE0E',
};

interface Props {
  fen: string;
  orientation: 'white' | 'black';
  selected: string | null;
  targets: string[];
  lastMove: { from: string; to: string } | null;
  hint: string | null;
  wrong: string | null;
  onSquareClick: (square: string) => void;
}

export function PuzzleBoard({ fen, orientation, selected, targets, lastMove, hint, wrong, onSquareClick }: Props) {
  let board: ReturnType<Chess['board']>;
  try {
    board = new Chess(fen).board();
  } catch {
    board = new Chess().board(); // never crash the page on a malformed FEN
  }
  const flip = orientation === 'black';

  const rows = [...Array(8).keys()];
  const cols = [...Array(8).keys()];
  const rowOrder = flip ? [...rows].reverse() : rows;
  const colOrder = flip ? [...cols].reverse() : cols;

  return (
    <div
      className="grid grid-cols-8 w-full aspect-square rounded-lg overflow-hidden select-none shadow-xl ring-1 ring-black/40"
      role="grid"
      aria-label="Chess board"
    >
      {rowOrder.flatMap(r =>
        colOrder.map(c => {
          const sq = `${FILES[c]}${8 - r}` as Square;
          const piece = board[r][c];
          const light = (r + c) % 2 === 0;
          const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
          const isSel = selected === sq;
          const isTarget = targets.includes(sq);
          const showFile = flip ? r === 0 : r === 7;
          const showRank = flip ? c === 7 : c === 0;

          return (
            <button
              key={sq}
              type="button"
              onClick={() => onSquareClick(sq)}
              aria-label={`${sq}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ''}`}
              className="relative flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-300"
              style={{ background: light ? '#e6dcc3' : '#7b9462' }}
            >
              {/* square highlights */}
              {isLast && <span className="absolute inset-0" style={{ background: 'rgba(255, 221, 60, 0.45)' }} />}
              {isSel && <span className="absolute inset-0" style={{ background: 'rgba(255, 235, 59, 0.6)' }} />}
              {wrong === sq && <span className="absolute inset-0" style={{ background: 'rgba(220, 38, 38, 0.65)' }} />}
              {hint === sq && <span className="absolute inset-1 rounded-full ring-4 ring-sky-400/80" />}

              {/* legal-move markers */}
              {isTarget && !piece && <span className="absolute w-[28%] h-[28%] rounded-full bg-black/25" />}
              {isTarget && piece && <span className="absolute inset-0.5 rounded-full ring-[5px] ring-black/25" />}

              {/* coordinates */}
              {showRank && (
                <span
                  className="absolute top-0.5 left-1 text-[10px] font-semibold leading-none"
                  style={{ color: light ? '#7b9462' : '#e6dcc3' }}
                >
                  {8 - r}
                </span>
              )}
              {showFile && (
                <span
                  className="absolute bottom-0.5 right-1 text-[10px] font-semibold leading-none"
                  style={{ color: light ? '#7b9462' : '#e6dcc3' }}
                >
                  {FILES[c]}
                </span>
              )}

              {piece && (
                <span
                  className="relative leading-none"
                  style={{
                    fontSize: 'min(8.5vw, 52px)',
                    color: piece.color === 'w' ? '#fffdf5' : '#1b1b1b',
                    textShadow:
                      piece.color === 'w'
                        ? '0 0 2px #000, 0 0 2px #000, 0 1px 1px #000'
                        : '0 0 1px rgba(255,255,255,0.35)',
                    fontFamily: '"Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", sans-serif',
                  }}
                >
                  {GLYPH[piece.type]}
                </span>
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}