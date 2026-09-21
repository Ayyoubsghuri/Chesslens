import { useState } from 'react';
import { X, Key, Eye, EyeOff, Settings as SettingsIcon, Cpu } from 'lucide-react';
import type { Settings } from '@/lib/types';

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
  const [showKey, setShowKey] = useState(false);

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
              <Key size={14} /> OpenAI API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={local.openaiApiKey}
                onChange={(e) => setLocal({ ...local, openaiApiKey: e.target.value })}
                placeholder="sk-..."
                className="input pr-10"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-200"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-xs text-ink-400 mt-1.5">
              Used for the AI coach explanations. Your key is stored locally in your browser only.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-ink-200 mb-1.5 block">Coach Model</label>
            <select
              value={local.coachModel}
              onChange={(e) => setLocal({ ...local, coachModel: e.target.value })}
              className="input"
            >
              <option value="gpt-4o-mini">GPT-4o Mini (faster)</option>
              <option value="gpt-4o">GPT-4o (smarter)</option>
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo (budget)</option>
            </select>
          </div>

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
              Stockfish lite is limited to depth {DEPTH_MAX}. Higher values can crash the engine
              (RuntimeError: unreachable). Use 12–15 for speed, 16–18 for stronger analysis.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-700 px-5 py-4">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn-primary">Save</button>
        </div>
      </div>
    </div>
  );
}
