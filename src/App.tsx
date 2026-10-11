import { useState, useEffect, useCallback } from 'react';
import { Chess } from 'chess.js';
import { ImportModal } from '@/components/ImportModal';
import { SettingsModal } from '@/components/SettingsModal';
import { AnalysisView } from '@/components/AnalysisView';
import { CoachPanel } from '@/components/CoachPanel';
import { DrillsPanel } from '@/components/DrillsPanel';
import { PuzzleTrainer } from '@/components/PuzzleTrainer';
import { ChessStory } from '@/components/ChessStory';
import { PlayVsComputer, type PlayedGame } from '@/components/PlayVsComputer';
import { analyzeGame, computeAccuracy, countByQuality } from '@/lib/analysis';
import { getMoveHistory } from '@/lib/pgn';
import { getGameOutcome } from '@/lib/outcome';
import { loadGames, saveGames, loadAnalyses, saveAnalysis, deleteAnalysis, loadSettings, saveSettings } from '@/lib/storage';
import type { ImportedGame, AnalysisResult, AnalyzedMove, Settings as SettingsType, View } from '@/lib/types';
import { Loader2, Plus, Settings as SettingsIcon, BarChart3, GraduationCap, Target, Crown as ChessIcon, Upload, Swords, Home, Trash2, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';

function App() {
  const [games, setGames] = useState<ImportedGame[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({});
  const [settings, setSettings] = useState<SettingsType>({ openaiApiKey: '', analysisDepth: 12, coachModel: 'gpt-4o-mini' });
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0);
  const [view, setView] = useState<View>('analysis');
  const [page, setPage] = useState<'home' | 'play' | 'puzzles'>('home');
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [coachMove, setCoachMove] = useState<AnalyzedMove | null>(null);
  const [pendingAnalyzeId, setPendingAnalyzeId] = useState<string | null>(null);

  useEffect(() => {
    setGames(loadGames());
    setAnalyses(loadAnalyses());
    setSettings(loadSettings());
  }, []);

  const selectedGame = games.find(g => g.id === selectedGameId) || null;
  const selectedAnalysis = selectedGameId ? analyses[selectedGameId] : null;
  const outcome = selectedGame ? getGameOutcome(selectedGame) : null;

  const handleImport = useCallback((imported: ImportedGame[]) => {
    setGames(prev => {
      const updated = [...imported, ...prev];
      saveGames(updated);
      return updated;
    });
    setShowImport(false);
    if (imported.length > 0) {
      setPage('home');
      setSelectedGameId(imported[0].id);
      setCurrentMoveIndex(0);
      setView('analysis');
    }
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!selectedGame) return;
    setAnalyzing(true);
    setAnalysisProgress({ current: 0, total: 0 });
    try {
      const moves = await analyzeGame(selectedGame, settings.analysisDepth, (current, total) => {
        setAnalysisProgress({ current, total });
      });
      const accuracy = computeAccuracy(moves);
      const counts = countByQuality(moves);
      const result: AnalysisResult = {
        game: selectedGame,
        moves,
        accuracy,
        blunders: counts.blunders,
        mistakes: counts.mistakes,
        inaccuracies: counts.inaccuracies,
        bestMoves: counts.bestMoves,
      };
      setAnalyses(prev => {
        const updated = { ...prev, [selectedGame.id]: result };
        saveAnalysis(selectedGame.id, result, settings.analysisDepth);
        return updated;
      });
    } catch (e) {
      console.error('Analysis failed', e);
    } finally {
      setAnalyzing(false);
    }
  }, [selectedGame, settings.analysisDepth]);

  // Game finished in "Play vs Computer": import it, open it, and start the analysis right away
  const handlePlayedGame = useCallback((g: PlayedGame) => {
    const id = `play-${Date.now()}`;
    const game = {
      id,
      white: g.white,
      black: g.black,
      result: g.result,
      date: new Date().toISOString().slice(0, 10),
      pgn: g.pgn,
    } as unknown as ImportedGame;
    handleImport([game]);
    setPendingAnalyzeId(id);
  }, [handleImport]);

  useEffect(() => {
    if (pendingAnalyzeId && selectedGame && selectedGame.id === pendingAnalyzeId && !analyzing) {
      setPendingAnalyzeId(null);
      handleAnalyze();
    }
  }, [pendingAnalyzeId, selectedGame, analyzing, handleAnalyze]);

  const handleDeleteGame = (id: string) => {
    if (!window.confirm('Delete this game and its analysis? This cannot be undone.')) return;
    setGames(prev => {
      const updated = prev.filter(g => g.id !== id);
      saveGames(updated);
      return updated;
    });
    deleteAnalysis(id);
    setAnalyses(prev => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
    if (selectedGameId === id) { setSelectedGameId(null); setCoachMove(null); }
  };

  const handleDeleteMany = (ids: string[], label: string) => {
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${label} (${ids.length})? This cannot be undone.`)) return;
    const set = new Set(ids);
    ids.forEach(deleteAnalysis);
    setGames(prev => {
      const updated = prev.filter(g => !set.has(g.id));
      saveGames(updated);
      return updated;
    });
    setAnalyses(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !set.has(id))));
    if (selectedGameId && set.has(selectedGameId)) { setSelectedGameId(null); setCoachMove(null); }
  };

  const handleSelectGame = (id: string) => {
    setPage('home');
    setSelectedGameId(id);
    setCurrentMoveIndex(0);
    setView('analysis');
    setCoachMove(null);
  };

  const handleCoachExplain = (move: AnalyzedMove) => {
    setCoachMove(move);
    setView('coach');
  };

  // Coach tab navigation: move through the game without returning to Analysis
  const handleCoachNavigate = (index: number) => {
    setCurrentMoveIndex(index);
    setCoachMove(null);
  };

  const handleSaveSettings = (s: SettingsType) => {
    setSettings(s);
    saveSettings(s);
  };

  const currentMove = selectedAnalysis?.moves[currentMoveIndex] || null;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-ink-800 bg-ink-900/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <button onClick={() => setPage('home')} className="flex items-center gap-2.5 text-left" title="Home">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg">
              <ChessIcon size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">ChessLens</h1>
              <p className="text-xs text-ink-400 -mt-0.5">Analyze. Learn. Improve.</p>
            </div>
          </button>

          <nav className="flex items-center gap-1 order-last sm:order-none w-full sm:w-auto" aria-label="Main">
            <NavTab active={page === 'home'} onClick={() => setPage('home')} icon={Home} label="Home" />
            <NavTab active={page === 'puzzles'} onClick={() => setPage('puzzles')} icon={Target} label="Practice Puzzles" />
            <NavTab active={page === 'play'} onClick={() => setPage('play')} icon={Swords} label="Play vs Computer" />
          </nav>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowImport(true)} className="btn-primary text-sm">
              <Plus size={16} /> Import
            </button>
            <button onClick={() => setShowSettings(true)} className="btn-ghost p-2" title="Settings">
              <SettingsIcon size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {page === 'play' ? (
          <PlayVsComputer settings={settings} onAnalyze={handlePlayedGame} />
        ) : page === 'puzzles' ? (
          <PuzzleTrainer />
        ) : !selectedGame ? (
          /* Home: empty state / game library + story */
          <>
          <div className={`flex flex-col items-center justify-center text-center ${games.length === 0 ? 'min-h-[50vh]' : 'min-h-[30vh]'}`}>
            {games.length === 0 ? (
              <>
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center mb-6 shadow-xl">
                  <ChessIcon size={40} className="text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Welcome to ChessLens</h2>
                <p className="text-ink-400 max-w-md mb-6">
                  Import games from Chess.com or paste PGN to get engine evaluations, blunder detection, and AI-powered coaching for every move.
                </p>
                <button onClick={() => setShowImport(true)} className="btn-primary">
                  <Upload size={18} /> Import Your First Game
                </button>
              </>
            ) : (
              <GameLibrary games={games} analyses={analyses} onSelect={handleSelectGame} onDelete={handleDeleteGame} onDeleteMany={handleDeleteMany} />
            )}
          </div>
          <ChessStory games={games} />
          </>
        ) : (
          <>
            {/* Game header + tabs */}
            <div className="mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <button onClick={() => { setSelectedGameId(null); setCoachMove(null); }} className="text-xs text-ink-400 hover:text-ink-200 mb-1 flex items-center gap-1">
                    ← Back to games
                  </button>
                  <h2 className="text-xl font-bold">{selectedGame.white} vs {selectedGame.black}</h2>
                  <div className="flex items-center gap-3 text-sm text-ink-400 mt-0.5">
                    <span>{selectedGame.result}</span>
                    {outcome && outcome.winner !== null && (
                      <span
                        className={`chip ${
                          outcome.winner === 'draw'
                            ? 'bg-ink-700 text-ink-300'
                            : 'bg-brand-500/20 text-brand-300'
                        }`}
                      >
                        {outcome.winner === 'draw' ? '' : '🏆 '}{outcome.label}
                      </span>
                    )}
                    {selectedGame.eco && <span>· {selectedGame.eco}</span>}
                    {selectedGame.timeControl && <span>· {selectedGame.timeControl}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!selectedAnalysis ? (
                    <button onClick={handleAnalyze} disabled={analyzing} className="btn-primary">
                      {analyzing ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Analyzing... {analysisProgress.total > 0 && `${analysisProgress.current}/${analysisProgress.total}`}
                        </>
                      ) : (
                        <>
                          <BarChart3 size={16} /> Analyze Game
                        </>
                      )}
                    </button>
                  ) : (
                    <button onClick={handleAnalyze} disabled={analyzing} className="btn-secondary text-sm">
                      {analyzing ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
                      Re-analyze
                    </button>
                  )}
                </div>
              </div>

              {analyzing && analysisProgress.total > 0 && (
                <div className="mb-4">
                  <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
                    <div
                      className="h-full bg-brand-500 transition-all duration-300"
                      style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* View tabs */}
              {selectedAnalysis && (
                <div className="flex gap-1 border-b border-ink-800">
                  <TabButton active={view === 'analysis'} onClick={() => setView('analysis')} icon={BarChart3} label="Analysis" />
                  <TabButton active={view === 'coach'} onClick={() => setView('coach')} icon={GraduationCap} label="Coach" />
                  <TabButton active={view === 'drills'} onClick={() => setView('drills')} icon={Target} label="Drills" />
                </div>
              )}
            </div>

            {/* Content */}
            {!selectedAnalysis ? (
              <div className="card p-12 text-center">
                <BarChart3 size={32} className="mx-auto mb-3 text-ink-500" />
                <p className="text-ink-400 mb-1">No analysis yet.</p>
                <p className="text-sm text-ink-500">Click "Analyze Game" to run the engine on every move.</p>
              </div>
            ) : view === 'analysis' ? (
              <AnalysisView
                analysis={selectedAnalysis}
                currentIndex={currentMoveIndex}
                onIndexChange={setCurrentMoveIndex}
                onCoachExplain={handleCoachExplain}
                depth={settings.analysisDepth}
              />
            ) : view === 'coach' ? (
              <CoachPanel move={coachMove || currentMove} settings={settings} moves={selectedAnalysis.moves} onNavigate={handleCoachNavigate} />
            ) : (
              <DrillsPanel moves={selectedAnalysis.moves} settings={settings} />
            )}
          </>
        )}
      </main>

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={handleImport} />}
      {showSettings && <SettingsModal settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function NavTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${active ? 'bg-ink-800 text-white' : 'text-ink-400 hover:text-ink-200 hover:bg-ink-800/60'}`}
    >
      <Icon size={16} /> {label}
    </button>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${active ? 'border-brand-400 text-brand-300' : 'border-transparent text-ink-400 hover:text-ink-200'}`}
    >
      <Icon size={16} /> {label}
    </button>
  );
}

const PAGE_SIZE = 10;

function GameLibrary({ games, analyses, onSelect, onDelete, onDeleteMany }: { games: ImportedGame[]; analyses: Record<string, AnalysisResult>; onSelect: (id: string) => void; onDelete: (id: string) => void; onDeleteMany: (ids: string[], label: string) => void }) {
  const [pageNum, setPageNum] = useState(0);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q
    ? games.filter(g => [g.white, g.black, g.date, g.eco, g.result, g.timeControl].some(v => String(v ?? '').toLowerCase().includes(q)))
    : games;
  const analyzedIds = games.filter(g => analyses[g.id]).map(g => g.id);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Stay on a valid page after deleting the last game of a page
  const current = Math.min(pageNum, pageCount - 1);
  const visible = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  return (
    <div className="w-full max-w-3xl">
      <h2 className="text-xl font-bold mb-4 text-left">Your Games <span className="text-sm font-normal text-ink-500">({q ? `${filtered.length} of ${games.length}` : games.length})</span></h2>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPageNum(0); }}
            placeholder="Search by player, date, opening…"
            className="w-full rounded-lg bg-ink-800 border border-ink-700 text-ink-100 text-sm pl-8 pr-8 py-2 placeholder:text-ink-500"
          />
          {query && (
            <button onClick={() => { setQuery(''); setPageNum(0); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-200" aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => onDeleteMany(analyzedIds, 'all analyzed games')}
          disabled={analyzedIds.length === 0}
          className="btn-ghost text-xs text-red-300 disabled:opacity-40"
        >
          <Trash2 size={13} /> Delete analyzed ({analyzedIds.length})
        </button>
        <button
          onClick={() => onDeleteMany(games.map(g => g.id), 'ALL games')}
          className="btn-ghost text-xs text-red-300"
        >
          <Trash2 size={13} /> Delete all
        </button>
      </div>
      {filtered.length === 0 && <p className="text-sm text-ink-500 text-left py-6">No games match "{query}".</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visible.map(g => {
          const analysis = analyses[g.id];
          return (
            <div key={g.id} className="relative group">
              <button
                onClick={() => onSelect(g.id)}
                className="card p-4 pr-11 text-left hover:border-brand-400/40 transition-colors w-full"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">{g.white} vs {g.black}</span>
                  <span className="text-xs text-ink-400">{getGameOutcome(g).short}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-400">
                  {g.date && <span>{g.date}</span>}
                  {g.eco && <span>· {g.eco}</span>}
                  {analysis && <span className="chip bg-brand-500/20 text-brand-300">Analyzed</span>}
                </div>
              </button>
              <button
                onClick={() => onDelete(g.id)}
                className="absolute right-2 bottom-2 p-1.5 rounded-md text-ink-500 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                title="Delete game"
                aria-label={`Delete ${g.white} vs ${g.black}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4 text-sm text-ink-400">
          <button onClick={() => setPageNum(current - 1)} disabled={current === 0} className="btn-secondary px-2.5 py-1.5 disabled:opacity-40" aria-label="Previous page">
            <ChevronLeft size={16} />
          </button>
          <span className="font-mono">Page {current + 1} / {pageCount}</span>
          <button onClick={() => setPageNum(current + 1)} disabled={current >= pageCount - 1} className="btn-secondary px-2.5 py-1.5 disabled:opacity-40" aria-label="Next page">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;