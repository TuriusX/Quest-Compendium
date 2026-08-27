import React from 'react';
import { 
  X, 
  Sparkles, 
  Palette, 
  Volume2, 
  ShieldAlert, 
  Gamepad2, 
  Check,
  Bot,
  Sliders,
  Compass,
  SlidersHorizontal,
  VolumeX,
  Radio,
  SlidersVertical
} from 'lucide-react';
import { AppSettings, AiMode, ColorTheme, DockPosition } from '../types';
import { playBlipSound } from '../utils/audio';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  soundEnabled: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  soundEnabled,
}) => {
  if (!isOpen) return null;

  const themes: { id: ColorTheme; name: string; color: string; desc: string }[] = [
    { id: 'purple', name: 'Amethyst Lore (Default)', color: '#a87ffb', desc: 'Mystical violet aura' },
    { id: 'crimson', name: 'Dark Urge Crimson', color: '#ff4d4d', desc: 'Fiery arcane intensity' },
    { id: 'cyan', name: 'Cyberpunk Neon', color: '#00f0ff', desc: 'High-tech HUD glow' },
    { id: 'amber', name: 'Solar Amber / CRT', color: '#ffb84d', desc: 'Warm retro terminal' },
    { id: 'emerald', name: 'Emerald Sylph', color: '#00e676', desc: 'Lush woodland aura' },
  ];

  const aiModes: { id: AiMode; label: string; desc: string; icon: string }[] = [
    { 
      id: 'standard', 
      label: 'Standard Compendium', 
      desc: 'Expert gaming strategist with balanced walkthroughs, puzzle solutions, and insightful advice.',
      icon: '🧙‍♂️'
    },
    { 
      id: 'roleplay', 
      label: 'Immersive In-Universe Roleplay', 
      desc: 'Adopts an authentic in-universe companion persona (Archmage, Navigational Construct, Dungeon Master).',
      icon: '🎭'
    },
    { 
      id: 'minmax', 
      label: 'Min/Max (100% Completionist)', 
      desc: 'Laser-focused on optimal builds, missable collectibles, zero filler, and speedrun routes.',
      icon: '⚡'
    },
  ];

  const voices = [
    { id: 'Kore', name: 'Kore (Warm / Epic Storyteller)' },
    { id: 'Puck', name: 'Puck (Playful / Witty Companion)' },
    { id: 'Fenrir', name: 'Fenrir (Deep / Heroic Warrior)' },
    { id: 'Zephyr', name: 'Zephyr (Smooth / Navigator AI)' },
    { id: 'Charon', name: 'Charon (Mystic / Cryptic Oracle)' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#0c0d14] border border-white/15 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_30px_var(--accent-glow)] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-white/[0.08] flex items-center justify-between bg-black/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-[var(--accent-color)]" />
            </div>
            <div>
              <h3 className="font-fantasy font-bold text-sm tracking-wider text-white">
                COMPENDIUM SETTINGS
              </h3>
              <p className="text-[11px] text-zinc-400 font-mono">
                Persona, Audio, & Visual HUD Preferences
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              playBlipSound(soundEnabled);
              onClose();
            }}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings Body */}
        <div className="p-5 space-y-6 overflow-y-auto font-sans">
          {/* AI Companion Mode */}
          <div className="space-y-2.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Bot className="w-4 h-4 text-[var(--accent-color)]" />
              <span>AI Companion Persona Mode</span>
            </label>
            <div className="space-y-2">
              {aiModes.map((mode) => {
                const isSelected = settings.aiMode === mode.id;
                return (
                  <div
                    key={mode.id}
                    onClick={() => {
                      playBlipSound(soundEnabled);
                      onUpdateSettings({ aiMode: mode.id });
                    }}
                    className={`p-3 rounded-xl border transition-all cursor-pointer select-none flex items-start gap-3 ${
                      isSelected
                        ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white shadow-[0_0_15px_var(--accent-glow)]'
                        : 'bg-black/40 border-white/[0.08] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                    }`}
                  >
                    <span className="text-lg mt-0.5">{mode.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between font-semibold text-xs text-white mb-0.5">
                        <span>{mode.label}</span>
                        {isSelected && <Check className="w-4 h-4 text-[var(--accent-color)]" />}
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">{mode.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Voice Profile */}
          <div className="space-y-2.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-[var(--accent-color)]" />
              <span>Voice Profile (TTS Narration)</span>
            </label>
            <select
              value={settings.ttsVoice}
              onChange={(e) => {
                playBlipSound(soundEnabled);
                onUpdateSettings({ ttsVoice: e.target.value as any });
              }}
              className="w-full bg-black/60 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-[var(--accent-border)] cursor-pointer"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id} className="bg-zinc-900 text-white">
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          {/* Color Themes */}
          <div className="space-y-2.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Palette className="w-4 h-4 text-[var(--accent-color)]" />
              <span>HUD Color Aura</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {themes.map((t) => {
                const isSelected = settings.theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      playBlipSound(soundEnabled);
                      onUpdateSettings({ theme: t.id });
                    }}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white/[0.08] border-white/40 shadow-sm'
                        : 'bg-black/30 border-white/[0.08] hover:border-white/20'
                    }`}
                  >
                    <span 
                      className="w-4 h-4 rounded-full flex-shrink-0 shadow-[0_0_8px_currentColor]"
                      style={{ backgroundColor: t.color, color: t.color }}
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-xs text-white leading-tight truncate">{t.name}</div>
                      <div className="text-[10px] text-zinc-400 leading-tight">{t.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sound FX Toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/[0.08]">
            <div className="flex items-center gap-2.5">
              <Volume2 className="w-4 h-4 text-zinc-300" />
              <div>
                <span className="font-semibold text-xs text-white block">HUD Sound Effects</span>
                <span className="text-[11px] text-zinc-400">Interface clicks, page turns & victory fanfares</span>
              </div>
            </div>
            <button
              onClick={() => {
                onUpdateSettings({ soundEnabled: !settings.soundEnabled });
              }}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                settings.soundEnabled ? 'bg-[var(--accent-color)]' : 'bg-white/10'
              }`}
            >
              <div 
                className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                  settings.soundEnabled ? 'right-1' : 'left-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
