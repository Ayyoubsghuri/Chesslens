import { useState } from 'react';
import { X, Search, ClipboardPaste, Loader2, ChevronRight } from 'lucide-react';
import { getMonthlyArchives, parseArchiveUrls, getGamesForMonth, type MonthInfo } from '@/lib/chesscom';
import { parsePastedGames } from '@/lib/chesscom';
import type { ImportedGame } from '@/lib/types';

interface ImportModalProps {
  onClose: () => void;
  onImport: (games: ImportedGame[]) => void;
}

/** Tidies pasted PGN so common copy/paste problems don't make the parser fail. */
function cleanPgn(text: string): string {
  let t = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  // Drop any text before the first header (e.g. copied page text).
  const first = t.search(/^\s*\[\s*\w+\s+"/m);
  if (first > 0) t = t.slice(first);
  // Moves only, no headers: give the parser a header to work with.
  if (!/^\s*\[\s*\w+\s+"/m.test(t)) t = `[Event "Pasted game"]\n\n${t}`;
  // Make sure there is a blank line between the headers and the moves.
  t = t.replace(/(\]\s*)\n(?=[^\[\n])/g, '$1\n\n');
  return t;
}

/** Last resort: remove {comments}, (variations), $NAGs and ;comments from the move text. */
function stripMoveExtras(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('[')) return line; // header line
      let l = line.replace(/\{[^}]*\}/g, ' ').replace(/;.*$/, '').replace(/\$\d+/g, ' ');
      for (let i = 0; i < 5; i++) l = l.replace(/\([^()]*\)/g, ' ');
      return l;
    })
    .join('\n');
}

export function ImportModal({ onClose, onImport }: ImportModalProps) {
  const [tab, setTab] = useState<'chesscom' | 'pgn'>('chesscom');
  const [username, setUsername] = useState('');
  const [archives, setArchives] = useState<MonthInfo[]>([]);
  const [loadingArchives, setLoadingArchives] = useState(false);
  const [loadingGames, setLoadingGames] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [monthGames, setMonthGames] = useState<ImportedGame[]>([]);
  const [pgnText, setPgnText] = useState('');
  const [error, setError] = useState('');

  async function handleFetchArchives() {
    if (!username.trim()) return;
    setLoadingArchives(true);
    setError('');
    try {
      const urls = await getMonthlyArchives(username.trim());
      const months = parseArchiveUrls(urls).reverse();
      setArchives(months);
      if (months.length > 0) {
        setSelectedMonth(months[0].url);
        await loadMonthGames(months[0].url);
      }
    } catch {
      setError('Could not fetch games. Check the username and try again.');
    } finally {
      setLoadingArchives(false);
    }
  }

  async function loadMonthGames(url: string) {
    setLoadingGames(true);
    setError('');
    try {
      const games = await getGamesForMonth(url);
      // Chess.com's monthly archive endpoint returns games in the order they were
      // played (oldest first), so reverse to show the most recent game on top.
      setMonthGames(games.slice().reverse());
    } catch {
      setError('Could not load games for this month.');
    } finally {
      setLoadingGames(false);
    }
  }

  function handleSelectMonth(url: string) {
    setSelectedMonth(url);
    loadMonthGames(url);
  }

  function handleImportPgn() {
    const cleaned = cleanPgn(pgnText);
    let games: ImportedGame[] = [];
    // Try as pasted, then cleaned, then with comments/variations stripped.
    for (const candidate of [pgnText, cleaned, stripMoveExtras(cleaned)]) {
      try {
        games = parsePastedGames(candidate);
      } catch (e) {
        console.warn('PGN parse failed', e);
        games = [];
      }
      if (games.length > 0) break;
    }
    if (games.length === 0) {
      setError('No valid PGN games found. Make sure the moves are legal and, for a game from a custom position, that the [FEN] header is included.');
      return;
    }
    setError('');
    onImport(games);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[85vh] overflow-hidden animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
          <h2 className="text-lg font-semibold">Import Games</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-1 px-5 pt-4">
          <button
            onClick={() => setTab('chesscom')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'chesscom' ? 'bg-brand-500 text-white' : 'text-ink-300 hover:bg-ink-700'}`}
          >
            Chess.com
          </button>
          <button
            onClick={() => setTab('pgn')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'pgn' ? 'bg-brand-500 text-white' : 'text-ink-300 hover:bg-ink-700'}`}
          >
            Paste PGN
          </button>
        </div>

        <div className="p-5 overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {tab === 'chesscom' && (
            <div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Chess.com username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleFetchArchives()}
                  className="input"
                />
                <button onClick={handleFetchArchives} disabled={loadingArchives || !username.trim()} className="btn-primary whitespace-nowrap">
                  {loadingArchives ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                  Search
                </button>
              </div>

              {archives.length > 0 && (
                <div className="mt-4 flex flex-col sm:flex-row gap-4">
                  <div className="flex sm:flex-col gap-1 overflow-x-auto sm:overflow-x-visible sm:w-40 sm:shrink-0 sm:space-y-1 sm:max-h-48 sm:overflow-y-auto pb-1 sm:pb-0">
                    {archives.map((m) => (
                      <button
                        key={m.url}
                        onClick={() => handleSelectMonth(m.url)}
                        className={`shrink-0 sm:w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between gap-1 whitespace-nowrap ${selectedMonth === m.url ? 'bg-brand-500/20 text-brand-300' : 'text-ink-300 hover:bg-ink-700'}`}
                      >
                        {m.label}
                        <ChevronRight size={14} className="hidden sm:block" />
                      </button>
                    ))}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2 max-h-48 overflow-y-auto">
                    {loadingGames ? (
                      <div className="flex items-center justify-center py-8 text-ink-400">
                        <Loader2 size={20} className="animate-spin" />
                      </div>
                    ) : monthGames.length === 0 ? (
                      <p className="text-sm text-ink-400 py-8 text-center">No games found for this month.</p>
                    ) : (
                      monthGames.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => onImport([g])}
                          className="w-full text-left rounded-lg border border-ink-700 bg-ink-800/50 px-3 py-2 hover:border-brand-400/50 hover:bg-ink-700/50 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="font-medium truncate">{g.white} vs {g.black}</span>
                            <span className="text-ink-400 text-xs shrink-0">{g.result}</span>
                          </div>
                          <div className="text-xs text-ink-400 mt-0.5">
                            {g.eco && <span className="mr-2">{g.eco}</span>}
                            {g.timeControl && <span>{g.timeControl}</span>}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'pgn' && (
            <div>
              <textarea
                placeholder="Paste PGN text here. You can paste one or multiple games..."
                value={pgnText}
                onChange={(e) => setPgnText(e.target.value)}
                className="input font-mono text-xs"
                rows={10}
              />
              <div className="mt-3 flex justify-end">
                <button onClick={handleImportPgn} disabled={!pgnText.trim()} className="btn-primary">
                  <ClipboardPaste size={16} />
                  Import PGN
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}