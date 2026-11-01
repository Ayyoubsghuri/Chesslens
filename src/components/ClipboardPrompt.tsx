import { ClipboardPaste } from 'lucide-react';
import type { ImportedGame } from '@/lib/types';

/** Bottom sheet asking permission to import the PGN found on the clipboard. */
export function ClipboardPrompt({ games, onImport, onDismiss }: { games: ImportedGame[]; onImport: () => void; onDismiss: () => void }) {
  const first = games[0] as any;
  const plies = (() => { try { return String(first?.pgn ?? '').match(/\b\d+\.(?!\.)/g)?.length ?? 0; } catch { return 0; } })();
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in sm:p-4" onClick={onDismiss} role="dialog" aria-modal="true" aria-label="Import game from clipboard">
      <div className="card w-full max-w-md rounded-b-none sm:rounded-b-2xl rounded-t-3xl sm:rounded-2xl sheet-up pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:pb-4" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle sm:hidden" />
        <div className="px-5 pt-4">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-full bg-brand-500/15 text-brand-300 flex items-center justify-center shrink-0"><ClipboardPaste size={21} /></span>
            <div className="min-w-0">
              <h3 className="!text-lg leading-tight">Game found in your clipboard</h3>
              <p className="text-xs text-ink-400 mt-0.5">Import it and run the analysis now?</p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-ink-700 bg-ink-800/60 px-3.5 py-3 text-sm">
            <p className="font-semibold text-ink-100 truncate">{first?.white ?? 'White'} vs {first?.black ?? 'Black'}</p>
            <p className="text-xs text-ink-400 mt-0.5">
              {[first?.result, first?.date, plies ? `${plies} moves` : ''].filter(Boolean).join(' · ')}
              {games.length > 1 ? ` · +${games.length - 1} more game${games.length > 2 ? 's' : ''} (the first one will be analyzed)` : ''}
            </p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={onDismiss} className="btn-secondary h-12">Not now</button>
            <button onClick={onImport} className="btn-primary h-12">Import &amp; analyze</button>
          </div>
        </div>
      </div>
    </div>
  );
}

