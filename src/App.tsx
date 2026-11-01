import { useState, useEffect, useCallback, useRef } from 'react';
import { Chess } from 'chess.js';
import { ImportModal } from '@/components/ImportModal';
import { SettingsModal } from '@/components/SettingsModal';
import { AnalysisView } from '@/components/AnalysisView';
import { CoachPanel } from '@/components/CoachPanel';
import { DrillsPanel } from '@/components/DrillsPanel';
import { PuzzleTrainer } from '@/components/PuzzleTrainer';
import { ChessStory } from '@/components/ChessStory';
import { PlayVsComputer, type PlayedGame } from '@/components/PlayVsComputer';
import { OpeningsTrainer } from '@/components/OpeningsTrainer';
import { registerAnalyzeHandler } from '@/components/MastersGames';
import { MobileHome } from '@/components/MobileHome';
import { MissionBanner } from '@/components/MissionBanner';
import type { Mission } from '@/lib/mission';
import { LearnPath, type LearnNavigate } from '@/components/LearnPath';
import { analyzeGame, computeAccuracy, countByQuality } from '@/lib/analysis';
import { getMoveHistory } from '@/lib/pgn';
import { getGameOutcome } from '@/lib/outcome';
import { logEvent } from '@/lib/activity';
import { getUsername, setUsername, guessUsername } from '@/lib/player';
import { loadGames, saveGames, loadAnalyses, saveAnalysis, deleteAnalysis, loadSettings, saveSettings } from '@/lib/storage';
import type { ImportedGame, AnalysisResult, Settings as SettingsType, View } from '@/lib/types';
import { onBackButton, onAppForeground, readClipboardText, isNative } from './native';
import { ClipboardPrompt } from '@/components/ClipboardPrompt';
import { looksLikePgn, parsePgnText } from '@/lib/pgn-clean';
import { Loader2, Plus, Settings as SettingsIcon, BarChart3, GraduationCap, Target, Crown as ChessIcon, Upload, Swords, Home, Trash2, ChevronLeft, ChevronRight, Search, X, BookOpen, MoreHorizontal } from 'lucide-react';

const CLIP_KEY = 'chesslens.clipboardHandled';
/** Small stable hash of the clipboard text, so the same PGN is only offered once. */
function hashText(t: string): string {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return `${t.length}:${h}`;
}
const rememberClip = (h: string) => { try { localStorage.setItem(CLIP_KEY, h); } catch { /* ignore */ } };

function App() {
  const [games, setGames] = useState<ImportedGame[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({});
  const [settings, setSettings] = useState<SettingsType>({ analysisDepth: 12, advancedCoach: false } as SettingsType);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0);
  const [view, setView] = useState<View>('analysis');
  const [page, setPage] = useState<'home' | 'play' | 'puzzles' | 'openings' | 'learn'>('home');
  const [puzzleTheme, setPuzzleTheme] = useState<string | undefined>(undefined);
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [pendingAnalyzeId, setPendingAnalyzeId] = useState<string | null>(null);
  const [clipGames, setClipGames] = useState<ImportedGame[] | null>(null);
  const clipHash = useRef('');
  const [missionCtx, setMissionCtx] = useState<{ mission: Mission; page: 'puzzles' | 'play' | 'openings' | 'home' } | null>(null);

  const handleLearnNavigate = useCallback((target: LearnNavigate) => {
    setMissionCtx(target.mission ? { mission: target.mission, page: target.page } : null);
    if (target.page === 'puzzles') {
      setPuzzleTheme(target.theme);
      setPage('puzzles');
    } else {
      setPuzzleTheme(undefined);
      setPage(target.page);
      if (target.page === 'home') {
        setSelectedGameId(null);
      }
    }
  }, []);

  useEffect(() => {
    setGames(loadGames());
    setAnalyses(loadAnalyses());
    setSettings(loadSettings());
  }, []);

  const selectedGame = games.find(g => g.id === selectedGameId) || null;
  const selectedAnalysis = selectedGameId ? analyses[selectedGameId] : null;
  const outcome = selectedGame ? getGameOutcome(selectedGame) : null;

  /**
   * Inside an analyzed game: on phones the header shrinks (no tab row, no tagline, not sticky)
   * so the coach bubble is the first thing you see.
   */
  const inGame = page === 'home' && !!selectedGame && !!selectedAnalysis;

  const handleImport = useCallback((imported: ImportedGame[]) => {
    // First import: the name that appears in every game is the user, the other player is the opponent.
    if (!getUsername()) {
      const guess = guessUsername(imported);
      if (guess) setUsername(guess);
    }
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
      logEvent('review');
    } catch (e) {
      console.error('Analysis failed', e);
    } finally {
      setAnalyzing(false);
    }
  }, [selectedGame, settings.analysisDepth]);

  const handlePlayedGame = useCallback((g: PlayedGame) => {
    const id = `play-${Date.now()}`;
    logEvent('game');
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

  // Register the analyze handler at App level so "Analyze game" in Openings → GM games
  // works even when PlayVsComputer isn't mounted (same path as Play vs Computer).
  useEffect(() => {
    registerAnalyzeHandler((g) =>
      handlePlayedGame({ pgn: g.pgn, white: g.white, black: g.black, result: g.result } as PlayedGame)
    );
    return () => registerAnalyzeHandler(null);
  }, [handlePlayedGame]);

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
    if (selectedGameId === id) setSelectedGameId(null);
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
    if (selectedGameId && set.has(selectedGameId)) setSelectedGameId(null);
  };

  const handleSelectGame = (id: string) => {
    setPage('home');
    setSelectedGameId(id);
    setCurrentMoveIndex(0);
    setView('analysis');
  };

  const handleCoachNavigate = (index: number) => {
    setCurrentMoveIndex(index);
  };

  const handleSaveSettings = (s: SettingsType) => {
    setSettings(s);
    saveSettings(s);
  };

  const currentMove = selectedAnalysis?.moves[currentMoveIndex] || null;

  // Android back button: close a dialog, then leave the game, then go Home, and only then exit.
  const backState = useRef({ showImport, showSettings, selectedGameId, page, missionCtx });
  backState.current = { showImport, showSettings, selectedGameId, page, missionCtx };
  useEffect(() => onBackButton(() => {
    const b = backState.current;
    if (b.showSettings) { setShowSettings(false); return true; }
    if (b.showImport) { setShowImport(false); return true; }
    if (b.page === 'home' && b.selectedGameId) { setSelectedGameId(null); return true; }
    if (b.page !== 'home') { setPage('home'); setMissionCtx(null); return true; }
    return false;
  }), []);

  // A PGN on the clipboard: offer to import + analyze it.
  //  - phone app: checked at launch and whenever the app comes back to the front;
  //  - web: the "Paste game" button (a tap is required by browsers); and, once the browser has been allowed to
  //    read the clipboard, also automatically when the page is shown again (never an unexpected permission prompt).
  const clipState = useRef({ enabled: true, open: false });
  clipState.current = { enabled: settings.clipboardImport !== false, open: !!clipGames };
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const checkClipboard = useCallback(async (manual: boolean) => {
    if (clipState.current.open) return;
    if (!manual && !clipState.current.enabled) return;
    const text = (await readClipboardText()).trim();
    if (!text) { if (manual) showToast("Nothing to paste, or the browser didn't allow reading the clipboard. Use Import and paste the PGN."); return; }
    if (!looksLikePgn(text)) { if (manual) showToast("The clipboard doesn't look like a PGN game."); return; }
    const h = hashText(text);
    if (!manual) {
      let seen = '';
      try { seen = localStorage.getItem(CLIP_KEY) ?? ''; } catch { /* ignore */ }
      if (seen === h) return;
    }
    const parsed = parsePgnText(text);
    if (parsed.length === 0) { if (manual) showToast('Found text, but no valid game in it. Check the moves, or use Import.'); return; }
    if (clipState.current.open) return;
    clipHash.current = h;
    setClipGames(parsed);
  }, [showToast]);

  useEffect(() => {
    let alive = true;
    let t: number | undefined;
    const auto = async () => {
      if (!alive) return;
      if (isNative()) { checkClipboard(false); return; }
      try {
        const st = await (navigator as any).permissions?.query({ name: 'clipboard-read' });
        if (st?.state === 'granted' && document.hasFocus()) checkClipboard(false);
      } catch { /* browser can't tell: only the Paste button works */ }
    };
    const soon = (ms = 700) => { window.clearTimeout(t); t = window.setTimeout(auto, ms); };
    soon();
    const retry = isNative() ? window.setTimeout(auto, 2500) : undefined; // Android only lets the focused app read the clipboard
    const off = onAppForeground(() => soon());
    const vis = () => { if (!document.hidden) soon(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; window.clearTimeout(t); window.clearTimeout(retry); off(); document.removeEventListener('visibilitychange', vis); };
  }, [checkClipboard]);

  const acceptClipboard = () => {
    const g = clipGames;
    if (!g || g.length === 0) return;
    rememberClip(clipHash.current);
    setClipGames(null);
    handleImport(g);
    setPendingAnalyzeId(g[0].id);
  };
  const dismissClipboard = () => { rememberClip(clipHash.current); setClipGames(null); };

  const PAGE_TITLES: Record<string, string> = { learn: 'Learn Path', openings: 'Openings', puzzles: 'Puzzles', play: 'Play vs Computer' };
  const canGoBack = page !== 'home' || !!selectedGame;
  const goBack = () => {
    if (page === 'home' && selectedGameId) setSelectedGameId(null);
    else if (page !== 'home') { setPage('home'); setMissionCtx(null); }
  };
  const barTitle = page !== 'home' ? PAGE_TITLES[page] ?? 'ChessLens' : selectedGame ? `${selectedGame.white} vs ${selectedGame.black}` : 'ChessLens';
  const barSub = page === 'home' && selectedGame
    ? [selectedGame.result, selectedGame.eco, selectedGame.timeControl].filter(Boolean).join(' · ')
    : page === 'home' ? 'Analyze. Learn. Improve.' : '';

  return (
    <div className="min-h-screen flex flex-col">
      {/* Phone: app bar (back arrow + screen title + settings). Replaces the website header. */}
      <header className="appbar safe-top sm:hidden">
        <div className="flex items-center h-12 px-2 gap-1">
          {canGoBack ? (
            <button onClick={goBack} className="appbar-btn" aria-label="Back"><ChevronLeft size={26} /></button>
          ) : (
            <div className="w-9 h-9 mx-1 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg shrink-0">
              <ChessIcon size={19} className="text-white" />
            </div>
          )}
          <div className="flex-1 min-w-0 px-1">
            <h1 className="truncate !text-[1.2rem] leading-tight">{barTitle}</h1>
            {barSub && <p className="truncate text-[11px] text-ink-400 -mt-0.5">{barSub}</p>}
          </div>
          <button onClick={() => setShowSettings(true)} className="appbar-btn" aria-label="Settings"><SettingsIcon size={21} /></button>
        </div>
      </header>

      <header className={`hidden sm:block border-b border-ink-800 bg-ink-900/80 backdrop-blur-md ${inGame ? 'lg:sticky' : 'sticky'} top-0 z-40`}>
        <div className="max-w-7xl mx-auto px-4 py-2.5 sm:py-3 flex items-center justify-between gap-x-4">
          <button onClick={() => { setPage('home'); }} className="flex items-center gap-2.5 text-left" title="Home">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg">
              <ChessIcon size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">ChessLens</h1>
              <p className="hidden sm:block text-xs text-ink-400 -mt-0.5">Analyze. Learn. Improve.</p>
            </div>
          </button>

          <nav
            className="flex items-center gap-1 sm:w-auto overflow-x-auto"
            aria-label="Main"
          >
            <NavTab active={page === 'home'} onClick={() => setPage('home')} icon={Home} label="Home" />
            <NavTab active={page === 'learn'} onClick={() => setPage('learn')} icon={GraduationCap} label="Learn Path" />
            <NavTab active={page === 'openings'} onClick={() => setPage('openings')} icon={BookOpen} label="Openings" />
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

      <main key={`${page}-${selectedGameId ?? ""}`} className="page-enter flex-1 max-w-7xl mx-auto w-full px-4 pt-4 sm:pt-6 pb-[calc(env(safe-area-inset-bottom)+5rem)] sm:pb-6">
        {missionCtx && page === missionCtx.page && (
          <MissionBanner
            mission={missionCtx.mission}
            onBack={() => { setPage('learn'); setMissionCtx(null); }}
            onDismiss={() => setMissionCtx(null)}
          />
        )}
        {page === 'learn' ? (
          <LearnPath onNavigate={handleLearnNavigate} />
        ) : page === 'openings' ? (
          <OpeningsTrainer />
        ) : page === 'play' ? (
          <PlayVsComputer settings={settings} onAnalyze={handlePlayedGame} />
        ) : page === 'puzzles' ? (
          <PuzzleTrainer initialCategory={puzzleTheme} />
        ) : !selectedGame ? (
          <div className="flex flex-col">
          <MobileHome onImport={() => setShowImport(true)} onPaste={() => checkClipboard(true)} onGo={(t) => { setPuzzleTheme(undefined); setMissionCtx(null); setPage(t); }} />
          <div className="order-2 sm:order-1"><ChessStory games={games} /></div>
          <div className={`order-1 sm:order-2 ${games.length === 0 ? 'hidden sm:flex' : 'flex'} flex-col items-center justify-center text-center ${games.length === 0 ? 'sm:min-h-[50vh]' : 'sm:min-h-[30vh]'}`}>
            {games.length === 0 ? (
              <>
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center mb-6 shadow-xl">
                  <ChessIcon size={40} className="text-white" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Welcome to ChessLens</h2>
                <p className="text-ink-400 max-w-md mb-6">
                  Import games from Chess.com or paste PGN to get engine evaluations, blunder detection, and a coach for every move.
                </p>
                <button onClick={() => setShowImport(true)} className="btn-primary">
                  <Upload size={18} /> Import Your First Game
                </button>
              </>
            ) : (
              <GameLibrary games={games} analyses={analyses} onSelect={handleSelectGame} onDelete={handleDeleteGame} onDeleteMany={handleDeleteMany} />
            )}
          </div>
          </div>
        ) : (
          <>
            <div className={`${selectedAnalysis && view === 'analysis' ? 'mb-0' : 'mb-4'} sm:mb-6`}>
              <div className={`${selectedAnalysis ? 'hidden sm:flex' : 'flex'} flex-wrap items-center justify-between gap-3 mb-3 sm:mb-4`}>
                <div className="hidden sm:block">
                  <button onClick={() => setSelectedGameId(null)} className="text-xs text-ink-400 hover:text-ink-200 mb-1 flex items-center gap-1">
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

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {!selectedAnalysis ? (
                    <button onClick={handleAnalyze} disabled={analyzing} className="btn-primary w-full sm:w-auto h-12 sm:h-auto text-base sm:text-sm">
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
                    <button onClick={handleAnalyze} disabled={analyzing} className="btn-secondary text-sm ml-auto">
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

              {selectedAnalysis && (
                <div className={`${view === 'analysis' ? 'hidden sm:flex' : 'flex'} gap-1 p-1 rounded-2xl bg-ink-800 sm:p-0 sm:rounded-none sm:bg-transparent sm:border-b sm:border-ink-800 [&>button]:flex-1 sm:[&>button]:flex-none`}>
                  <TabButton active={view === 'analysis'} onClick={() => setView('analysis')} icon={BarChart3} label="Analysis" />
                  <TabButton active={view === 'coach'} onClick={() => setView('coach')} icon={GraduationCap} label="Coach" />
                  <TabButton active={view === 'drills'} onClick={() => setView('drills')} icon={Target} label="Drills" />
                </div>
              )}
            </div>

            {!selectedAnalysis ? (
              <div className="card p-8 sm:p-12 text-center">
                <BarChart3 size={32} className="mx-auto mb-3 text-ink-500" />
                <p className="text-ink-400 mb-1">No analysis yet.</p>
                <p className="text-sm text-ink-500">Click "Analyze Game" to run the engine on every move.</p>
              </div>
            ) : view === 'analysis' ? (
              <AnalysisView
                analysis={selectedAnalysis}
                currentIndex={currentMoveIndex}
                onIndexChange={setCurrentMoveIndex}
                depth={settings.analysisDepth}
                advancedCoach={!!settings.advancedCoach}
                coachVoice={!!settings.coachVoice}
                coachVoiceName={settings.coachVoiceName}
                endAnimations={settings.endAnimations !== false}
                onViewChange={setView}
                onReanalyze={handleAnalyze}
              />
            ) : view === 'coach' ? (
              <CoachPanel move={currentMove} settings={settings} moves={selectedAnalysis.moves} onNavigate={handleCoachNavigate} />
            ) : (
              <DrillsPanel moves={selectedAnalysis.moves} settings={settings} />
            )}
          </>
        )}
      </main>

      {page === 'home' && !selectedGame && games.length > 0 && (
        <button onClick={() => setShowImport(true)} className="fab sm:hidden" aria-label="Import games"><Plus size={28} /></button>
      )}

      <nav className={`tabbar sm:hidden ${inGame && view === 'analysis' ? 'hidden' : ''}`} aria-label="Main">
        <div className="flex">
          <BottomTab active={page === 'home'} onClick={() => setPage('home')} icon={Home} label="Home" />
          <BottomTab active={page === 'learn'} onClick={() => setPage('learn')} icon={GraduationCap} label="Learn" />
          <BottomTab active={page === 'openings'} onClick={() => setPage('openings')} icon={BookOpen} label="Openings" />
          <BottomTab active={page === 'puzzles'} onClick={() => setPage('puzzles')} icon={Target} label="Puzzles" />
          <BottomTab active={page === 'play'} onClick={() => setPage('play')} icon={Swords} label="Play" />
        </div>
      </nav>

      {toast && (
        <div role="status" className="fixed left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:max-w-md bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] sm:bottom-6 z-[80] rounded-xl bg-[#f5ecd9] px-4 py-3 text-sm font-medium text-[#1a2a24] shadow-xl animate-fade-in">
          {toast}
        </div>
      )}
      {clipGames && <ClipboardPrompt games={clipGames} onImport={acceptClipboard} onDismiss={dismissClipboard} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={handleImport} />}
      {showSettings && <SettingsModal settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function BottomTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button onClick={onClick} aria-current={active ? 'page' : undefined} className="tabbar-item">
      <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
      {label}
    </button>
  );
}

function NavTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${active ? 'bg-ink-800 text-white' : 'text-ink-400 hover:text-ink-200 hover:bg-ink-800/60'}`}
    >
      <Icon size={16} /> {label}
    </button>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors rounded-xl sm:rounded-none sm:border-b-2 ${active ? 'bg-ink-600 text-brand-300 sm:bg-transparent sm:border-brand-400' : 'text-ink-400 sm:border-transparent hover:text-ink-200'}`}
    >
      <Icon size={16} /> {label}
    </button>
  );
}

const PAGE_SIZE = 10;

function GameLibrary({ games, analyses, onSelect, onDelete, onDeleteMany }: { games: ImportedGame[]; analyses: Record<string, AnalysisResult>; onSelect: (id: string) => void; onDelete: (id: string) => void; onDeleteMany: (ids: string[], label: string) => void }) {
  const [pageNum, setPageNum] = useState(0);
  const [query, setQuery] = useState('');
  const [tools, setTools] = useState(false);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? games.filter(g => [g.white, g.black, g.date, g.eco, g.result, g.timeControl].some(v => String(v ?? '').toLowerCase().includes(q)))
    : games;
  const analyzedIds = games.filter(g => analyses[g.id]).map(g => g.id);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
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
        <button onClick={() => setTools(t => !t)} className="btn-ghost p-2 sm:hidden" aria-label="More" aria-expanded={tools}><MoreHorizontal size={20} /></button>
        <div className={`${tools ? 'flex' : 'hidden'} sm:contents items-center gap-2 w-full`}>
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
      </div>
      {filtered.length === 0 && <p className="text-sm text-ink-500 text-left py-6">No games match "{query}".</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visible.map(g => {
          const analysis = analyses[g.id];
          return (
            <div key={g.id} className="relative group">
              <button
                onClick={() => onSelect(g.id)}
                className="card p-3.5 pr-12 text-left hover:border-brand-400/40 active:bg-ink-700 transition-colors w-full flex items-center gap-3"
              >
                <div className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${analysis ? 'bg-brand-500/20 text-brand-300' : 'bg-ink-700 text-ink-400'}`}>
                  {analysis ? <BarChart3 size={19} /> : <ChessIcon size={19} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="font-medium text-sm truncate">{g.white} vs {g.black}</span>
                    <span className="text-xs text-ink-400 shrink-0">{getGameOutcome(g).short}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ink-400 whitespace-nowrap overflow-hidden">
                    {g.date && <span>{g.date}</span>}
                    {g.eco && <span>· {g.eco}</span>}
                    {analysis && <span className="chip bg-brand-500/20 text-brand-300 !py-0.5">Analyzed</span>}
                  </div>
                </div>
              </button>
              <button
                onClick={() => onDelete(g.id)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-md text-ink-500 hover:text-red-300 hover:bg-red-500/10 transition-colors"
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
