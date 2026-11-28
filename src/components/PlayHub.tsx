import { useState } from 'react';
import { Cpu, Users } from 'lucide-react';
import { PlayVsComputer, type PlayedGame } from './PlayVsComputer';
import { FriendPlay } from './FriendPlay';
import type { Settings } from '@/lib/types';

const KEY = 'chesslens:play-mode';
export type PlayMode = 'computer' | 'friend';

/** The Play page: against the computer, or against a friend on another device. */
export function PlayHub({ settings, onAnalyze, initial }: { settings: Settings; onAnalyze?: (g: PlayedGame) => void; initial?: PlayMode }) {
  const [mode, setMode] = useState<PlayMode>(() => {
    if (initial) return initial;
    try { return localStorage.getItem(KEY) === 'friend' ? 'friend' : 'computer'; } catch { return 'computer'; }
  });
  const pick = (m: PlayMode) => { setMode(m); try { localStorage.setItem(KEY, m); } catch { /* ignore */ } };
  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-md gap-1 rounded-full bg-ink-800 p-1" role="tablist" aria-label="Opponent">
        {([['computer', 'Computer', Cpu], ['friend', 'Friend', Users]] as const).map(([m, label, Icon]) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => pick(m)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition-colors ${mode === m ? 'bg-brand-500 text-ink-950' : 'text-ink-300 hover:bg-ink-700'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {mode === 'computer' ? <PlayVsComputer settings={settings} onAnalyze={onAnalyze} /> : <FriendPlay onAnalyze={onAnalyze} />}
    </div>
  );
}
