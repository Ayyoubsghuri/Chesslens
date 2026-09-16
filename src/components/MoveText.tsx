import { Fragment, type ReactNode } from 'react';
import { Chess, type Square } from 'chess.js';

export interface MovePreview {
  uci: string;
  from: Square;
  to: Square;
  san: string;
  fen: string;
}

interface MoveTextProps {
  /** The coach/explanation text to render. */
  text: string;
  /** FEN of the position the move tokens in `text` are relative to. */
  fen: string;
  /** Called when the user clicks a recognized move token. */
  onPreview: (preview: MovePreview) => void;
  /** UCI string of the currently-previewed move, if any. */
  activeUci?: string | null;
  className?: string;
  /**
   * When true, each successfully parsed move advances the internal FEN,
   * so subsequent move tokens are validated from the new position.
   * Use this for move-line explanations (e.g. "1. Qd2 2. Kg8 ...").
   */
  line?: boolean;
}

// Matches UCI moves (e2e4, e7e8q) and SAN moves (Nf3, Qxd4, O-O, e8=Q, etc.)
const MOVE_RE = /[a-h][1-8][a-h][1-8][qrbn]?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[\+#]?|O-O(?:-O)?[\+#]?/g;

export function MoveText({ text, fen, onPreview, activeUci, className, line }: MoveTextProps) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  MOVE_RE.lastIndex = 0;

  // In line mode we advance this FEN every time a move validates successfully.
  let currentFen = fen;

  while ((match = MOVE_RE.exec(text)) !== null) {
    const moveStr = match[0];

    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    let preview: MovePreview | null = null;
    try {
      const chess = new Chess(currentFen);

      // Try UCI first
      if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(moveStr)) {
        const result = chess.move({
          from: moveStr.slice(0, 2),
          to: moveStr.slice(2, 4),
          promotion: moveStr.length > 4 ? moveStr[4] : undefined,
        });
        if (result) {
          preview = {
            uci: moveStr,
            from: result.from as Square,
            to: result.to as Square,
            san: result.san,
            fen: chess.fen(),
          };
        }
      }
      // Then try SAN
      else {
        const result = chess.move(moveStr);
        if (result) {
          const uci = result.from + result.to + (result.promotion || '');
          preview = {
            uci,
            from: result.from as Square,
            to: result.to as Square,
            san: result.san,
            fen: chess.fen(),
          };
        }
      }
    } catch {
      preview = null;
    }

    if (preview) {
      const isActive = activeUci === preview.uci;
      const p = preview;
      nodes.push(
        <button
          key={`mv-${key++}`}
          type="button"
          onClick={() => onPreview(p)}
          title={`Show ${p.san} on the board`}
          className={`inline font-mono font-semibold underline decoration-dotted underline-offset-2 transition-colors ${
            isActive
              ? 'text-brand-200 bg-brand-500/20 rounded px-0.5'
              : 'text-brand-300 hover:text-brand-200'
          }`}
        >
          {moveStr}
        </button>
      );

      // Advance the running FEN so the next move in the line is validated
      // from the correct position.
      if (line) {
        currentFen = preview.fen;
      }
    } else {
      nodes.push(moveStr);
    }

    lastIndex = MOVE_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return (
    <span className={className}>
      {nodes.map((n, i) => (
        <Fragment key={i}>{n}</Fragment>
      ))}
    </span>
  );
}