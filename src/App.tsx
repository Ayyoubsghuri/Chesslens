import { useState, useEffect, useCallback } from 'react';
import { Chess } from 'chess.js';
import { ImportModal } from '@/components/ImportModal';
import { SettingsModal } from '@/components/SettingsModal';
import { AnalysisView } from '@/components/AnalysisView';
import { CoachPanel } from '@/components/CoachPanel';
import { DrillsPanel } from '@/components/DrillsPanel';
import { analyzeGame, computeAccuracy, countByQuality } from '@/lib/analysis';
import { getMoveHistory } from '@/lib/pgn';
import { loadGames, saveGames, loadAnalyses, saveAnalysis, loadSettings, saveSettings } from '@/lib/storage';
import type { ImportedGame, AnalysisResult, AnalyzedMove, Settings as SettingsType, View } from '@/lib/types';
import { Loader2, Plus, Settings as SettingsIcon, BarChart3, GraduationCap, Target, Crown as ChessIcon, Upload } from 'lucide-react';

function App() {
  const [games, setGames] = useState<ImportedGame[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({});
  const [settings, setSettings] = useState<SettingsType>({ openaiApiKey: '', analysisDepth: 12, coachModel: 'gpt-4o-mini' });
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0);
  const [view, setView] = useState<View>('analysis');
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [coachMove, setCoachMove] = useState<AnalyzedMove | null>(null);

  useEffect(() => {
    setGames(loadGames());
    setAnalyses(loadAnalyses());
    setSettings(loadSettings());
  }, []);

  const selectedGame = games.find(g => g.id === selectedGameId) || null;
  const selectedAnalysis = selectedGameId ? analyses[selectedGameId] : null;

  const handleImport = useCallback((imported: ImportedGame[]) => {
    setGames(prev => {
      const updated = [...imported, ...prev];
      saveGames(updated);
      return updated;
    });
    setShowImport(false);
    if (imported.length > 0) {
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
        saveAnalysis(selectedGame.id, result);
        return updated;
      });
    } catch (e) {
      console.error('Analysis failed', e);
    } finally {
      setAnalyzing(false);
    }
  }, [selectedGame, settings.analysisDepth]);

  const handleSelectGame = (id: string) => {
    setSelectedGameId(id);
    setCurrentMoveIndex(0);
    setView('analysis');
    setCoachMove(null);
  };

  const handleCoachExplain = (move: AnalyzedMove) => {
    setCoachMove(move);
    setView('coach');
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
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg">
              <ChessIcon size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">ChessLens</h1>
              <p className="text-xs text-ink-400 -mt-0.5">Analyze. Learn. Improve.</p>
            </div>
          </div>

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
        {!selectedGame ? (
          /* Empty state / game library */
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
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
              <GameLibrary games={games} analyses={analyses} onSelect={handleSelectGame} />
            )}
          </div>
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
              <CoachPanel move={coachMove || currentMove} settings={settings} />
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

function GameLibrary({ games, analyses, onSelect }: { games: ImportedGame[]; analyses: Record<string, AnalysisResult>; onSelect: (id: string) => void }) {
  return (
    <div className="w-full max-w-3xl">
      <h2 className="text-xl font-bold mb-4 text-left">Your Games</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {games.map(g => {
          const analysis = analyses[g.id];
          return (
            <button
              key={g.id}
              onClick={() => onSelect(g.id)}
              className="card p-4 text-left hover:border-brand-400/40 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">{g.white} vs {g.black}</span>
                <span className="text-xs text-ink-400">{g.result}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-ink-400">
                {g.date && <span>{g.date}</span>}
                {g.eco && <span>· {g.eco}</span>}
                {analysis && <span className="chip bg-brand-500/20 text-brand-300">Analyzed</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default App;