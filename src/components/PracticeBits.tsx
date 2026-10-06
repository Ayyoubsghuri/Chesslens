import { Check, X, Info } from 'lucide-react';
import { formatEval } from '@/lib/engine';
import type { EngineEval } from '@/lib/types';
import { QUALITY_LABEL } from '@/lib/practice';

export function FeedbackBanner({ tone, children }: { tone: 'good' | 'bad' | 'info'; children: React.ReactNode }) {
  const cls =
    tone === 'good'
      ? 'bg-brand-500/15 border-brand-500/30 text-brand-300'
      : tone === 'bad'
        ? 'bg-red-500/15 border-red-500/30 text-red-400'
        : 'bg-ink-800 border-ink-700 text-ink-200';
  const Icon = tone === 'good' ? Check : tone === 'bad' ? X : Info;
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>
      <Icon size={16} className="shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export interface Comparison {
  bestSan: string;
  bestEval: EngineEval | null;
  /** The move the user found (omitted if they asked for the solution). */
  userSan?: string;
  userEval?: EngineEval | null;
  gameSan: string;
  gameQuality: string;
  gameEval: EngineEval | null;
  /** Pawns the game move lost versus best play. */
  gameLoss: number | null;
  /** Pawns the user's move gained versus the game move (mover's view). */
  gain: number | null;
}

function pawns(n: number) {
  const a = Math.abs(n);
  return a >= 10 ? '10+' : a.toFixed(2);
}

export function ComparisonCard({ c }: { c: Comparison }) {
  const ev = (e: EngineEval | null | undefined) => (e ? formatEval(e) : '—');
  return (
    <div className="card p-4 animate-fade-in">
      <h3 className="text-sm font-semibold text-ink-200 mb-3">What you found vs. the game</h3>
      <div className="space-y-2 text-sm">
        <Row label={c.userSan ? 'Your move' : 'Best move'} san={c.userSan ?? c.bestSan} evalText={ev(c.userSan ? c.userEval : c.bestEval)} accent />
        {c.userSan && c.userSan !== c.bestSan && (
          <Row label="Engine's top choice" san={c.bestSan} evalText={ev(c.bestEval)} />
        )}
        <Row
          label="Played in the game"
          san={c.gameSan}
          evalText={ev(c.gameEval)}
          chip={QUALITY_LABEL[c.gameQuality] ?? c.gameQuality}
        />
      </div>
      <div className="mt-3 pt-3 border-t border-ink-800 text-xs text-ink-300 leading-relaxed">
        {c.gameSan === (c.userSan ?? c.bestSan) ? (
          <>This is the same move that was played in the game.</>
        ) : c.gain != null && c.gain > 0.05 ? (
          <>
            Your move was <span className="font-semibold text-brand-300">{pawns(c.gain)}</span> pawns better than what was played in the game.
          </>
        ) : c.gameLoss != null && c.gameLoss > 0.05 ? (
          <>
            The game move lost <span className="font-semibold text-accent-400">{pawns(c.gameLoss)}</span> pawns compared with the best move.
          </>
        ) : (
          <>Both moves are about equal in strength.</>
        )}
      </div>
    </div>
  );
}

function Row({ label, san, evalText, chip, accent }: { label: string; san: string; evalText: string; chip?: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-400 w-36 shrink-0">{label}</span>
      <span className={`font-mono font-semibold ${accent ? 'text-brand-300' : 'text-ink-100'}`}>{san}</span>
      {chip && <span className="chip bg-ink-700 text-ink-300">{chip}</span>}
      <span className="ml-auto font-mono text-xs text-ink-400">{evalText}</span>
    </div>
  );
}
