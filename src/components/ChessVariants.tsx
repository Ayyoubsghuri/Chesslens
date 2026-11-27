import { useState } from 'react';
import { Bot, Zap, Dices } from 'lucide-react';
import { TwistBots } from './TwistBots';
import { PowerUps } from './PowerUps';
import { DrawbackChess } from './DrawbackChess';

type Tab = 'bots' | 'powers' | 'drawbacks';
const TAB_KEY = 'chesslens:variants-tab';
const TABS: { id: Tab; label: string; short: string; icon: typeof Bot }[] = [
  { id: 'bots', label: 'Chess, but…', short: 'Bots', icon: Bot },
  { id: 'powers', label: 'Power-ups', short: 'Power-ups', icon: Zap },
  { id: 'drawbacks', label: 'Secret Drawbacks', short: 'Drawbacks', icon: Dices },
];

/** The variants section: twisted Stockfish bots, power-ups against Stockfish, and Secret Drawbacks. */
export function ChessVariants() {
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = localStorage.getItem(TAB_KEY) as Tab | null; return t && TABS.some((x) => x.id === t) ? t : 'bots'; } catch { return 'bots'; }
  });
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  return (
    <div className="space-y-4">
      <div>
        <h2 className="!text-2xl">Chess variants</h2>
        <p className="text-sm text-ink-400">Stockfish with a twist, unfair power-ups, and chess with a hidden handicap.</p>
      </div>
      <div className="flex gap-1 rounded-xl bg-ink-800 p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => pick(t.id)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm ${tab === t.id ? 'bg-brand-500 text-ink-900' : 'text-ink-300 hover:bg-ink-700'}`}>
            <t.icon size={15} className="shrink-0" /> <span className="truncate sm:hidden">{t.short}</span><span className="hidden truncate sm:inline">{t.label}</span>
          </button>
        ))}
      </div>
      {tab === 'bots' ? <TwistBots /> : tab === 'powers' ? <PowerUps /> : <DrawbackChess />}
    </div>
  );
}
