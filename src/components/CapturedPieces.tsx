type PT = 'p' | 'n' | 'b' | 'r' | 'q';
const ORDER: PT[] = ['q', 'r', 'b', 'n', 'p'];
const INITIAL: Record<PT, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE: Record<PT, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
// filled glyphs for black pieces, outlined for white pieces
const GLYPH: Record<'w' | 'b', Record<PT, string>> = {
  w: { q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

type Counts = Record<PT, number>;
const empty = (): Counts => ({ p: 0, n: 0, b: 0, r: 0, q: 0 });

/** Reads the piece placement of a FEN. */
function countPieces(fen: string): { w: Counts; b: Counts } {
  const w = empty();
  const b = empty();
  for (const ch of fen.split(' ')[0]) {
    const lower = ch.toLowerCase() as PT;
    if (!(lower in INITIAL)) continue;
    (ch === lower ? b : w)[lower]++;
  }
  return { w, b };
}

/** Pieces of `side` that are missing from the board (promotions are accounted for). */
function missing(c: Counts): Counts {
  const out = empty();
  let extras = 0;
  for (const t of ORDER) {
    if (t === 'p') continue;
    out[t] = Math.max(0, INITIAL[t] - c[t]);
    extras += Math.max(0, c[t] - INITIAL[t]);
  }
  out.p = Math.max(0, INITIAL.p - c.p - extras);
  return out;
}

const points = (c: Counts) => ORDER.reduce((s, t) => s + c[t] * VALUE[t], 0);

/** Pieces `color` has captured + that side's material lead (e.g. "+3"). */
export function CapturedPieces({ fen, color }: { fen: string; color: 'white' | 'black' }) {
  const { w, b } = countPieces(fen);
  const me = color === 'white' ? 'w' : 'b';
  const them = me === 'w' ? 'b' : 'w';
  const taken = missing(me === 'w' ? b : w); // opponent pieces I captured
  const lead = points(me === 'w' ? w : b) - points(me === 'w' ? b : w);
  const any = ORDER.some((t) => taken[t] > 0);

  return (
    <span
      className="flex items-center gap-1.5 min-h-[20px] text-ink-200"
      title={any ? 'Pieces captured' : 'No captures yet'}
    >
      <span className="flex items-center leading-none text-[17px] tracking-[-0.15em]">
        {ORDER.map((t) =>
          Array.from({ length: taken[t] }, (_, i) => <span key={`${t}${i}`}>{GLYPH[them][t]}</span>),
        )}
      </span>
      {lead > 0 && <span className="text-xs font-bold text-brand-300 font-mono">+{lead}</span>}
    </span>
  );
}
