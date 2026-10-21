import { useState } from 'react';
import { X, Settings as SettingsIcon, Cpu, Sparkles, Volume2 } from 'lucide-react';
import type { Settings } from '@/lib/types';
import { COACH_VOICES, DEFAULT_COACH_VOICE } from '@/lib/tts';

interface SettingsModalProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

/** stockfish-18-lite-single.wasm is unstable above ~18 depth (RuntimeError: unreachable). */
const DEPTH_MIN = 8;
const DEPTH_MAX = 18;
const DEPTH_DEFAULT = 15;

function depthLabel(d: number): string {
  if (d <= 12) return 'Fast';
  if (d <= 15) return 'Standard';
  if (d <= 17) return 'Deep';
  return 'Max (lite)';
}

export function SettingsModal({ settings, onSave, onClose }: SettingsModalProps) {
  const safeDepth = Math.min(
    DEPTH_MAX,
    Math.max(DEPTH_MIN, settings.analysisDepth ?? DEPTH_DEFAULT)
  );
  const [local, setLocal] = useState<Settings>({
    ...settings,
    analysisDepth: safeDepth,
  });

  const handleSave = () => {
    onSave({
      ...local,
      analysisDepth: Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, local.analysisDepth)),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4" onClick={onClose}>
      <div className="card w-full max-w-md animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
          <div className="flex items-center gap-2">
            <SettingsIcon size={18} className="text-brand-400" />
            <h2 className="text-lg font-semibold">Settings</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-ink-200 mb-1.5">
              <Cpu size={14} /> Engine Depth: {local.analysisDepth}
              <span className="ml-auto text-xs font-normal text-ink-400">
                {depthLabel(local.analysisDepth)}
              </span>
            </label>
            <input
              type="range"
              min={DEPTH_MIN}
              max={DEPTH_MAX}
              step={1}
              value={local.analysisDepth}
              onChange={(e) => setLocal({ ...local, analysisDepth: Number(e.target.value) })}
              className="w-full accent-brand-500"
            />
            <div className="flex justify-between text-xs text-ink-400 mt-1">
              <span>{DEPTH_MIN} fast</span>
              <span>15 standard</span>
              <span>{DEPTH_MAX} max</span>
            </div>
            <p className="text-xs text-ink-400 mt-1.5">
              Runs Stockfish lite locally in your browser. It is limited to depth {DEPTH_MAX}; higher values can crash the engine (RuntimeError: unreachable). Use 12–15 for speed, 16–18 for stronger analysis.
            </p>
          </div>
        </div>

        <div className="px-5 pb-5">
          <button
            type="button"
            role="switch"
            aria-checked={!!local.advancedCoach}
            onClick={() => setLocal({ ...local, advancedCoach: !local.advancedCoach })}
            className="w-full flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-800/60 px-3.5 py-3 text-left hover:bg-ink-700/50 transition-colors"
          >
            <Sparkles size={18} className="text-brand-400 shrink-0" />
            <span className="flex-1">
              <span className="block text-sm font-medium text-ink-100">Advanced coach mode</span>
              <span className="block text-xs text-ink-400 mt-0.5">
                The coach bubble explains why a move was played, what happens next, and why not the other moves — step by step on the board.
              </span>
            </span>
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${local.advancedCoach ? 'bg-brand-500' : 'bg-ink-600'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${local.advancedCoach ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
          </button>

          {local.advancedCoach && (
            <div className="mt-3 rounded-xl border border-ink-700 bg-ink-800/60 px-3.5 py-3">
              <button
                type="button"
                role="switch"
                aria-checked={!!local.coachVoice}
                onClick={() => setLocal({ ...local, coachVoice: !local.coachVoice })}
                className="w-full flex items-center gap-3 text-left"
              >
                <Volume2 size={18} className="text-brand-400 shrink-0" />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-ink-100">Speak explanations</span>
                  <span className="block text-xs text-ink-400 mt-0.5">
                    The coach reads each step out loud (free, via Puter.js). Puter may ask you to sign in the first time.
                  </span>
                </span>
                <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${local.coachVoice ? 'bg-brand-500' : 'bg-ink-600'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${local.coachVoice ? 'left-[22px]' : 'left-0.5'}`} />
                </span>
              </button>
              {local.coachVoice && (
                <select
                  value={local.coachVoiceName ?? DEFAULT_COACH_VOICE}
                  onChange={(e) => setLocal({ ...local, coachVoiceName: e.target.value })}
                  className="input mt-3"
                  aria-label="Coach voice"
                >
                  {COACH_VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-700 px-5 py-4">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn-primary">Save</button>
        </div>
      </div>
    </div>
  );
}