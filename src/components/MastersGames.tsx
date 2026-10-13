// "GM games" tab: master games that reached the end of this opening line, replayable on a board.
// Place in src/components/MastersGames.tsx
import { useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import { ChessBoard } from './ChessBoard';
import { CapturedPieces } from './CapturedPieces';
import {
  fetchMastersGames, fetchMasterGame, getLichessToken, setLichessToken,
  MastersError, type MasterGame, type MastersResult, type ParsedGame,
} from '@/lib/masters';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, KeyRound, Loader2, Trophy, BarChart3 } from 'lucide-react';


export type AnalyzeGamePayload = {
  pgn: string;
  white: string;
  black: string;
  result: string;
};

/** App can register once: registerAnalyzeHandler((game) => startAnalysis(game.pgn)) */
let globalAnalyzeHandler: ((game: AnalyzeGamePayload) => void) | null = null;

export function registerAnalyzeHandler(handler: ((game: AnalyzeGamePayload) => void) | null) {
  globalAnalyzeHandler = handler;
}

export function requestAnalyze(game: AnalyzeGamePayload): boolean {
  try {
    sessionStorage.setItem('chess-pending-analyze', JSON.stringify(game));
  } catch { /* ignore */ }
  // Always notify the app (App.tsx should listen or registerAnalyzeHandler once)
  window.dispatchEvent(new CustomEvent('chess-analyze', { detail: game }));
  if (globalAnalyzeHandler) {
    globalAnalyzeHandler(game);
    return true;
  }
  return false;
}

const resultText = (w: MasterGame['winner']) => (w === 'white' ? '1-0' : w === 'black' ? '0-1' : '½-½');
const toErr = (e: unknown) => (e instanceof MastersError ? e : new MastersError('other', 'Something went wrong loading master games.'));

function buildMasterPgn(game: MasterGame, parsed: ParsedGame): string {
  const chess = new Chess();
  for (const san of parsed.sans) {
    try { chess.move(san); } catch { break; }
  }
  const result = resultText(game.winner).replace('½-½', '1/2-1/2');
  const headers: Record<string, string> = {
    Event: 'Master game',
    White: game.white,
    Black: game.black,
    Result: result,
  };
  if (game.year) headers.Date = `${game.year}.??.??`;
  if (game.whiteRating) headers.WhiteElo = String(game.whiteRating);
  if (game.blackRating) headers.BlackElo = String(game.blackRating);
  chess.header(...Object.entries(headers).flat());
  let pgn = chess.pgn();
  if (!/\s(1-0|0-1|1\/2-1\/2|\*)\s*$/.test(pgn.trim())) {
    pgn = `${pgn.trim()} ${result}`;
  }
  return pgn;
}

export function MastersGames({
  uci,
  orientation,
  onAnalyze,
}: {
  uci: string[];
  orientation: 'white' | 'black';
  onAnalyze?: (game: AnalyzeGamePayload) => void;
}) {
  const [token, setToken] = useState(getLichessToken());
  const [draft, setDraft] = useState('');
  const [res, setRes] = useState<MastersResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<MastersError | null>(null);
  const [open, setOpen] = useState<MasterGame | null>(null);
  const key = uci.join(' ');

  useEffect(() => {
    if (!token) return;
    let dead = false;
    setLoading(true);
    setErr(null);
    setRes(null);
    fetchMastersGames(uci)
      .then((r) => { if (!dead) setRes(r); })
      .catch((e) => { if (!dead) setErr(toErr(e)); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [key, token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (open) {
    return (
      <GameViewer
        game={open}
        startPly={uci.length}
        orientation={orientation}
        onBack={() => setOpen(null)}
        onAnalyze={onAnalyze}
      />
    );
  }

  const saveToken = () => {
    const t = draft.trim();
    if (!t) return;
    setLichessToken(t);
    setToken(t);
    setDraft('');
  };

  const tokenForm = (
    <div className="space-y-2">
      <p className="text-sm text-ink-400">
        Master games come from the Lichess masters database, which needs a free personal token (no permissions/scopes).{' '}
        <a href="https://lichess.org/account/oauth/token" target="_blank" rel="noreferrer" className="text-brand-300 underline">
          Create one here
        </a>
        , paste it below. It's stored only in this browser and sent only to Lichess.
      </p>
      <div className="flex gap-2">
        <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="lip_…"
          className="flex-1 min-w-0 rounded-lg bg-ink-800 border border-ink-700 text-ink-100 text-sm font-mono px-3 py-2 placeholder:text-ink-500" />
        <button className="btn-primary text-sm" onClick={saveToken}><KeyRound size={14} /> Save</button>
      </div>
    </div>
  );

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Trophy size={16} className="text-brand-400" />
        <h3 className="text-sm font-semibold text-ink-200">Master games in this line</h3>
        {res && res.total > 0 && <span className="text-xs text-ink-500">{res.total.toLocaleString()} games · top {res.games.length} by rating</span>}
      </div>

      {!token ? tokenForm : loading ? (
        <p className="text-sm text-ink-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading master games…</p>
      ) : err ? (
        <div className="space-y-2">
          <p className="text-sm text-red-300">{err.message}</p>
          {(err.kind === 'auth') && tokenForm}
        </div>
      ) : res && res.games.length === 0 ? (
        <p className="text-sm text-ink-500">No master games reach this exact position. Try a shorter, more common line.</p>
      ) : res ? (
        <div className="space-y-1">
          {res.games.map((g) => (
            <button key={g.id} onClick={() => setOpen(g)}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-700/50 transition-colors">
              <span className="flex-1 min-w-0 truncate text-ink-100">
                {g.white} <span className="text-ink-500 text-xs">{g.whiteRating}</span>
                <span className="text-ink-500"> vs </span>
                {g.black} <span className="text-ink-500 text-xs">{g.blackRating}</span>
              </span>
              <span className="font-mono text-xs text-ink-300 shrink-0">{resultText(g.winner)}</span>
              <span className="text-xs text-ink-500 shrink-0 w-10 text-right">{g.year ?? ''}</span>
            </button>
          ))}
        </div>
      ) : null}

      {token && (
        <button className="text-xs text-ink-500 hover:text-ink-300" onClick={() => { setLichessToken(''); setToken(''); setRes(null); setErr(null); }}>
          Change Lichess token
        </button>
      )}
    </div>
  );
}

function GameViewer({ game, startPly, orientation, onBack, onAnalyze }: {
  game: MasterGame; startPly: number; orientation: 'white' | 'black'; onBack: () => void;
  onAnalyze?: (game: AnalyzeGamePayload) => void;
}) {
  const [parsed, setParsed] = useState<ParsedGame | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [i, setI] = useState(startPly);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    fetchMasterGame(game.id)
      .then((p) => { if (!dead) { setParsed(p); setI(Math.min(startPly, p.sans.length)); } })
      .catch((e) => { if (!dead) setErr(toErr(e).message); });
    return () => { dead = true; };
  }, [game.id, startPly]);

  const total = parsed?.sans.length ?? 0;
  const go = (n: number) => setI(Math.max(0, Math.min(total, n)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      if (e.key === 'ArrowRight') setI((x) => Math.min(total, x + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  function handleAnalyze() {
    if (!parsed) return;
    setAnalyzeMsg(null);
    let pgn: string;
    try {
      pgn = buildMasterPgn(game, parsed);
    } catch (e) {
      console.error('Failed to build PGN for analysis', e);
      const chess = new Chess();
      for (const san of parsed.sans) {
        try { chess.move(san); } catch { break; }
      }
      pgn = chess.pgn();
    }
    const payload: AnalyzeGamePayload = {
      pgn,
      white: game.white,
      black: game.black,
      result: resultText(game.winner).replace('½-½', '1/2-1/2'),
    };
    // Prefer prop (same path as Play vs Computer → analyze page)
    if (onAnalyze) {
      onAnalyze(payload);
      setAnalyzeMsg('Opening analysis…');
      return;
    }
    // Global handler + chess-analyze event (App registers once)
    const handled = requestAnalyze(payload);
    setAnalyzeMsg(handled ? 'Opening analysis…' : 'Connect analysis: pass onAnalyze to OpeningsTrainer (same function as PlayVsComputer).');
  }

  const header = (
    <div className="card p-4 space-y-3">
      <div>
        <button onClick={onBack} className="text-xs text-ink-400 hover:text-ink-200 mb-1 flex items-center gap-1">← All master games</button>
        <h3 className="text-lg font-bold leading-tight">{game.white} vs {game.black}</h3>
        <p className="text-xs text-ink-500 mt-0.5">{resultText(game.winner)}{game.year ? ` · ${game.year}` : ''} · opening ends at move {Math.ceil(startPly / 2)}</p>
      </div>
      {parsed && (
        <button onClick={handleAnalyze} className="btn-primary w-full justify-center py-2.5 font-bold">
          <BarChart3 size={16} /> Analyze game
        </button>
      )}
      {analyzeMsg && <p className="text-xs text-brand-300 text-center">{analyzeMsg}</p>}
    </div>
  );

  if (err) return <div className="space-y-3">{header}<p className="text-sm text-red-300">{err}</p></div>;
  if (!parsed) return <div className="space-y-3">{header}<p className="text-sm text-ink-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading game…</p></div>;

  const pairs: { n: number; w?: number; b?: number }[] = [];
  parsed.sans.forEach((_, k) => {
    const n = Math.floor(k / 2);
    pairs[n] ??= { n: n + 1 };
    if (k % 2 === 0) pairs[n].w = k; else pairs[n].b = k;
  });
  const cell = (k?: number) =>
    k === undefined ? <span /> : (
      <button onClick={() => go(k + 1)}
        className={`text-left rounded px-1 hover:bg-ink-700/60 ${k === i - 1 ? 'bg-brand-500/25 text-brand-200' : k < startPly ? 'text-ink-400' : 'text-ink-100'}`}>
        {parsed.sans[k]}
      </button>
    );

  const fen = parsed.fens[i];
  const topColor: 'white' | 'black' = orientation === 'white' ? 'black' : 'white';
  const bottomColor: 'white' | 'black' = orientation === 'white' ? 'white' : 'black';
  const topName = topColor === 'white' ? game.white : game.black;
  const bottomName = bottomColor === 'white' ? game.white : game.black;
  const topRating = topColor === 'white' ? game.whiteRating : game.blackRating;
  const bottomRating = bottomColor === 'white' ? game.whiteRating : game.blackRating;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,560px)_1fr] gap-4 sm:gap-6">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="-mx-4 w-[calc(100%+2rem)] sm:mx-auto sm:w-full sm:max-w-[560px] space-y-1.5">
          <PlayerBar name={topName} color={topColor} rating={topRating} fen={fen} />
          <ChessBoard fen={fen} orientation={orientation} lastMove={i > 0 ? parsed.moves[i - 1] : null}
            bestMoveUci={null} interactive={false} onUserMove={() => {}} size={560} />
          <PlayerBar name={bottomName} color={bottomColor} rating={bottomRating} fen={fen} />
        </div>
        <div className="flex items-center justify-center gap-2">
          <button className="btn-secondary px-2.5" onClick={() => go(0)} disabled={i === 0}><ChevronsLeft size={16} /></button>
          <button className="btn-secondary px-2.5" onClick={() => go(i - 1)} disabled={i === 0}><ChevronLeft size={16} /></button>
          <span className="px-3 font-mono text-sm text-ink-400">{i} / {total}</span>
          <button className="btn-secondary px-2.5" onClick={() => go(i + 1)} disabled={i >= total}><ChevronRight size={16} /></button>
          <button className="btn-secondary px-2.5" onClick={() => go(total)} disabled={i >= total}><ChevronsRight size={16} /></button>
        </div>
        {i === startPly && <p className="text-xs text-ink-500 text-center">This is where the opening line ends — keep stepping to see how the masters continued.</p>}
      </div>
      <div className="flex flex-col gap-4">
        {header}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-ink-300 mb-2">Moves <span className="font-normal text-ink-500">(opening moves dimmed)</span></h3>
          <div className="grid grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-1 text-sm font-mono">
            {pairs.map((p) => (
              <div key={p.n} className="contents">
                <span className="text-ink-500">{p.n}.</span>
                {cell(p.w)}
                {cell(p.b)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Color chip + name + rating + captured pieces (material taken by this side). */
function PlayerBar({
  name, color, rating, fen,
}: {
  name: string;
  color: 'white' | 'black';
  rating?: number | null;
  fen: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 sm:px-0.5 min-w-0">
      <span
        className="w-2.5 h-2.5 rounded-full border border-ink-600 shrink-0"
        style={{ backgroundColor: color === 'white' ? '#ebecd0' : '#2a2e39' }}
        title={color === 'white' ? 'White' : 'Black'}
      />
      <span className="text-sm font-medium text-ink-200 truncate">
        {name}
        <span className="text-ink-500 font-normal"> · {color === 'white' ? 'White' : 'Black'}</span>
      </span>
      {rating != null && rating > 0 && (
        <span className="text-xs font-mono text-ink-500 shrink-0">{rating}</span>
      )}
      <div className="ml-auto min-w-0">
        <CapturedPieces fen={fen} color={color} />
      </div>
    </div>
  );
}
