import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  Palette, 
  Volume2, 
  Gamepad2, 
  Check,
  Bot,
  Key,
  LogOut,
  Monitor,
  Keyboard,
  Gamepad,
  User,
  Zap,
  Server,
  Wifi,
  RefreshCw,
  ExternalLink,
  Globe,
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  Download,
  Package,
  Cloud,
  Copy
} from './icons';
import { AppSettings, AiMode, ColorTheme, DockPosition, CloudSyncDiagnostics } from '../types';
import { playBlipSound } from '../utils/audio';
import { logOut } from '../lib/firebase';
import { getApiBaseUrl, setApiBaseUrl, testBackendHealth, DEFAULT_CLOUD_URL } from '../utils/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  soundEnabled: boolean;
  syncDiagnostics?: CloudSyncDiagnostics | null;
}

type TabId = 'appearance' | 'persona' | 'shortcuts' | 'connection' | 'account';

const ShortcutInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  label: string;
}> = ({ value, onChange, label }) => {
  const [isRecording, setIsRecording] = useState(false);

  React.useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const key = e.key;
      
      // Cancel on Escape
      if (key === 'Escape') {
        setIsRecording(false);
        return;
      }

      // Ignore if it's just a modifier key being pressed alone
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
        return;
      }

      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('CmdOrCtrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');

      let normalizedKey = key.toUpperCase();
      if (key === ' ') normalizedKey = 'Space';
      if (key === '+') normalizedKey = 'Plus'; 
      
      parts.push(normalizedKey);
      
      onChange(parts.join('+'));
      setIsRecording(false);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isRecording, onChange]);

  return (
    <div>
      <label className="block text-[11px] text-zinc-400 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setIsRecording(true)}
        className={`w-full text-left bg-black/60 border rounded-xl px-3.5 py-2.5 text-xs font-mono outline-none transition-all cursor-pointer ${
          isRecording 
            ? 'border-indigo-500/50 text-indigo-400 bg-indigo-500/5 shadow-[0_0_10px_rgba(99,102,241,0.2)]' 
            : 'border-white/15 text-white hover:border-white/30 hover:bg-white/[0.02]'
        }`}
      >
        {isRecording ? 'Listening for shortcut... (Press Esc to cancel)' : (value || 'None')}
      </button>
    </div>
  );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  soundEnabled,
  syncDiagnostics,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('appearance');
  const [backendStatus, setBackendStatus] = useState<'idle' | 'checking' | 'healthy' | 'error'>('idle');
  const [copiedDiag, setCopiedDiag] = useState(false);
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [syncNowSuccess, setSyncNowSuccess] = useState(false);
  const effectiveDiag = syncDiagnostics || (typeof window !== 'undefined' ? (window as any).__questSyncDiagnostics : null);
  const [customBackendInput, setCustomBackendInput] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('quest_compendium_backend_url') || '';
    }
    return '';
  });
  const [localUiScale, setLocalUiScale] = useState(settings.uiScale || 1.0);

  React.useEffect(() => {
    setLocalUiScale(settings.uiScale || 1.0);
  }, [settings.uiScale]);

  if (!isOpen) return null;

  const themes: { id: ColorTheme; name: string; color: string; desc: string }[] = [
    { id: 'purple', name: 'Arcane Violet', color: '#a87ffb', desc: 'Psionic glow (default)' },
    { id: 'red', name: 'Crimson Hero', color: '#E52521', desc: 'Classic platformer red' },
    { id: 'cyan', name: 'Plasma Cyan', color: '#00f0ff', desc: 'Retro blaster glow' },
    { id: 'blue', name: 'Hyper Blue', color: '#1E63F8', desc: 'High-speed blur' },
    { id: 'amber', name: 'Bonfire Amber', color: '#ffb84d', desc: 'Warm checkpoint glow' },
    { id: 'luigi', name: 'Player Two Green', color: '#55D731', desc: 'Ghost-hunting green' },
    { id: 'masterchief', name: 'Spartan Olive', color: '#6A7D51', desc: 'Tactical armor glow' },
    { id: 'gold', name: 'Relic Gold', color: '#ffd700', desc: 'Treasure-room shine' },
    { id: 'pink', name: 'Arcade Pink', color: '#ff69b4', desc: 'Fighting-game energy' },
    { id: 'silver', name: 'Silver Blade', color: '#c0c0c0', desc: 'Monster-slayer steel' },
  ];

  const aiModes: { id: AiMode; label: string; desc: string; icon: string; experimental?: boolean }[] = [
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
      icon: '🎭',
      experimental: true,
    },
    { 
      id: 'minmax', 
      label: 'Min/Max (100% Completionist)', 
      desc: 'Laser-focused on optimal builds, missable collectibles, zero filler, and speedrun routes.',
      icon: '⚡',
      experimental: true,
    },
  ];

  const voices = [
    { id: 'puck', name: 'Puck (Warm & Energetic Male - Recommended)' },
    { id: 'charon', name: 'Charon (Deep & Resonant Male)' },
    { id: 'fenrir', name: 'Fenrir (Wise & Commanding Male)' },
    { id: 'kore', name: 'Kore (Clear & Calm Female)' },
    { id: 'aoede', name: 'Aoede (Expressive & Melodic Female)' },
  ];

  const controllerButtons = [
    { id: 'disabled', name: 'Disabled' },
    { id: '4+8', name: 'LB + Select (Back/Share)' },
    { id: '5+9', name: 'RB + Start (Options)' },
    { id: '4+5', name: 'LB + RB (L1 + R1)' },
    { id: '6+7', name: 'LT + RT (L2 + R2)' },
    { id: '8+9', name: 'Select + Start (Back + Options)' },
    { id: '10+11', name: 'L3 + R3 (Click Both Sticks)' },
    { id: '4+12', name: 'LB + D-Pad Up' },
    { id: '4+13', name: 'LB + D-Pad Down' },
    { id: '4+14', name: 'LB + D-Pad Left' },
    { id: '4+15', name: 'LB + D-Pad Right' },
  ];

  const tabs: { id: TabId; label: string; icon: React.FC<any> }[] = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'persona', label: 'Persona & Voice', icon: Bot },
    { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
    { id: 'connection', label: 'Cloud & Server', icon: Server },
    { id: 'account', label: 'Account', icon: User },
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-4xl bg-[#0c0d14] border border-white/15 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_30px_var(--accent-glow)] overflow-hidden flex flex-col max-h-[90vh]">
        
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
                System configuration & preferences
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

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-48 bg-black/40 border-r border-white/[0.08] p-3 space-y-1 overflow-y-auto">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    playBlipSound(soundEnabled);
                    setActiveTab(tab.id);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive 
                      ? 'bg-[var(--accent-dim)] text-white border border-[var(--accent-border)] shadow-sm' 
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-[var(--accent-color)]' : 'text-zinc-500'}`} />
                    <span className="truncate">{tab.label}</span>
                  </div>
                  {tab.id === 'connection' && (
                    effectiveDiag?.lastWriteError ? (
                      <span className="w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" title="Sync error" />
                    ) : effectiveDiag?.isListenerAttached ? (
                      <span className="w-2 h-2 rounded-full bg-emerald-500/80 flex-shrink-0" title="Sync active" />
                    ) : null
                  )}
                </button>
              );
            })}
          </div>

          {/* Main Content Area */}
          <div className="flex-1 p-5 overflow-y-auto space-y-6">

            {activeTab === 'appearance' && (
              <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
                {/* Interface style: Lo-fi pixel (default) or Classic */}
                <div className="space-y-2.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[var(--accent-color)]" />
                    <span>Interface Style</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { id: 'lofi', name: 'Lo-fi Pixel', desc: 'Pixel icons, fonts and meters' },
                      { id: 'classic', name: 'Classic', desc: 'The original smooth look' },
                    ] as const).map((opt) => {
                      const isSelected = (settings.uiStyle ?? 'lofi') === opt.id;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => {
                            playBlipSound(soundEnabled);
                            onUpdateSettings({ uiStyle: opt.id });
                          }}
                          aria-pressed={isSelected}
                          className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-[var(--accent-dim)] border-[var(--accent-border)]'
                              : 'bg-black/30 border-white/[0.08] hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-white leading-tight">{opt.name}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent-color)]" />}
                          </div>
                          <div className="text-[10px] text-zinc-400 leading-tight mt-0.5">{opt.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Color Themes */}
                <div className="space-y-2.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <Palette className="w-4 h-4 text-[var(--accent-color)]" />
                    <span>HUD Themes</span>
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

                {/* Thematic Inquiry Banners Toggle - High Prominence */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-[var(--accent-dim)] border border-[var(--accent-border)] shadow-[0_0_15px_var(--accent-glow)]">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[var(--accent-color)]/20 border border-[var(--accent-border)] flex items-center justify-center flex-shrink-0">
                      <ImageIcon className="w-5 h-5 text-[var(--accent-color)]" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-white block">Thematic Inquiry Banners</span>
                        <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent-color)]/20 text-[var(--accent-color)] border border-[var(--accent-border)]">
                          Immersion
                        </span>
                      </div>
                      <span className="text-[11px] text-zinc-300">
                        Generate cinematic game artwork and thematic concept banners atop AI answers
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      playBlipSound(soundEnabled);
                      onUpdateSettings({ enableThematicBanners: settings.enableThematicBanners === false });
                    }}
                    className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer flex-shrink-0 ml-3 ${
                      settings.enableThematicBanners !== false ? 'bg-[var(--accent-color)]' : 'bg-white/10'
                    }`}
                  >
                    <div 
                      className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                        settings.enableThematicBanners !== false ? 'right-1' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Docking Location */}
                <div className="space-y-2.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-[var(--accent-color)]" />
                    <span>Dock Position</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'top-right', label: 'Top Right' },
                      { id: 'top-left', label: 'Top Left' },
                      { id: 'bottom-right', label: 'Bottom Right' },
                      { id: 'bottom-left', label: 'Bottom Left' },
                      { id: 'undocked', label: 'Undocked (Free Floating)' }
                    ].map(dock => (
                      <button
                        key={dock.id}
                        onClick={() => {
                          playBlipSound(soundEnabled);
                          onUpdateSettings({ dockPosition: dock.id as any });
                        }}
                        className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          settings.dockPosition === dock.id
                            ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-white shadow-sm'
                            : 'bg-black/30 border-white/[0.08] text-zinc-400 hover:border-white/20'
                        } ${dock.id === 'undocked' ? 'col-span-2 text-center justify-center' : ''}`}
                      >
                        <span className="font-semibold text-xs">{dock.label}</span>
                        {settings.dockPosition === dock.id && dock.id !== 'undocked' && (
                          <Check className="w-4 h-4 text-[var(--accent-color)]" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Window Opacity */}
                <div className="space-y-2.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-zinc-500" />
                    <span>Background Opacity</span>
                  </label>
                  <div className="flex items-center gap-3 bg-black/30 border border-white/[0.08] p-3 rounded-xl">
                    <input 
                      type="range"
                      min="10"
                      max="100"
                      value={settings.windowOpacity}
                      onChange={(e) => {
                        onUpdateSettings({ windowOpacity: Number(e.target.value) });
                      }}
                      onMouseUp={() => playBlipSound(soundEnabled)}
                      className="flex-1 accent-[var(--accent-color)] cursor-pointer h-1.5 bg-white/20 rounded"
                    />
                    <span className="font-mono text-zinc-300 w-8 text-right font-bold text-xs">{settings.windowOpacity}%</span>
                  </div>
                </div>

                {/* UI Scale */}
                <div className="space-y-2.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-[var(--accent-color)]" />
                    <span>App UI Scale (4K / Display Size)</span>
                  </label>
                  <div className="flex items-center gap-3 bg-black/30 border border-white/[0.08] p-3 rounded-xl">
                    <input 
                      type="range"
                      min="50"
                      max="200"
                      step="5"
                      value={localUiScale * 100}
                      onChange={(e) => {
                        setLocalUiScale(Number(e.target.value) / 100);
                      }}
                      onMouseUp={() => {
                        onUpdateSettings({ uiScale: localUiScale });
                        playBlipSound(soundEnabled);
                      }}
                      onTouchEnd={() => {
                        onUpdateSettings({ uiScale: localUiScale });
                        playBlipSound(soundEnabled);
                      }}
                      className="flex-1 accent-[var(--accent-color)] cursor-pointer h-1.5 bg-white/20 rounded"
                    />
                    <span className="font-mono text-zinc-300 w-10 text-right font-bold text-xs">{Math.round(localUiScale * 100)}%</span>
                  </div>
                </div>

                {/* Sound FX Toggle */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/[0.08]">
                  <div className="flex items-center gap-2.5">
                    <Volume2 className="w-4 h-4 text-[var(--accent-color)]" />
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
            )}

            {activeTab === 'persona' && (
              <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
                {/* AI Persona */}
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
                              <div className="flex items-center gap-2">
                                <span>{mode.label}</span>
                                {mode.experimental && (
                                  <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                    Experimental
                                  </span>
                                )}
                              </div>
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
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
                <div className="space-y-4">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <Keyboard className="w-4 h-4 text-[var(--accent-color)]" />
                    <span>Keyboard Shortcuts</span>
                  </label>
                  <div className="space-y-3">
                    <ShortcutInput
                      label="Slide App In/Out"
                      value={settings.hideAppShortcut}
                      onChange={(val) => onUpdateSettings({ hideAppShortcut: val })}
                    />
                    <ShortcutInput
                      label="Trigger Voice Input"
                      value={settings.voiceInputShortcut}
                      onChange={(val) => onUpdateSettings({ voiceInputShortcut: val })}
                    />
                    <ShortcutInput
                      label="Auto Screenshot & Ask"
                      value={settings.autoScreenshotShortcut || 'CmdOrCtrl+Shift+S'}
                      onChange={(val) => onUpdateSettings({ autoScreenshotShortcut: val })}
                    />
                    <p className="text-[11px] text-zinc-400 leading-relaxed col-span-2">
                      Note: Changing the slide toggle shortcut requires an app restart to take full effect.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'connection' && (
              <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
                {/* Cloud Sync Status & Diagnostics */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                      <Cloud className="w-4 h-4 text-[var(--accent-color)]" />
                      <span>Cloud Sync Status</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          playBlipSound(soundEnabled);
                          if (effectiveDiag?.triggerSyncNow && !isSyncingNow) {
                            setIsSyncingNow(true);
                            const ok = await effectiveDiag.triggerSyncNow();
                            setIsSyncingNow(false);
                            if (ok) {
                              setSyncNowSuccess(true);
                              setTimeout(() => setSyncNowSuccess(false), 2000);
                            }
                          }
                        }}
                        disabled={isSyncingNow || !effectiveDiag?.triggerSyncNow}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer flex-shrink-0 ${
                          syncNowSuccess 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-[var(--accent-dim)] hover:bg-[var(--accent-dim)]/80 text-white border border-[var(--accent-border)]'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        title="Immediately upload all local tabs and settings to your cloud profile"
                      >
                        {isSyncingNow ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Syncing...</span>
                          </>
                        ) : syncNowSuccess ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Synced!</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Sync Now</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={async () => {
                          playBlipSound(soundEnabled);
                          if (effectiveDiag?.copyDiagnostics) {
                            const ok = await effectiveDiag.copyDiagnostics();
                            if (ok) {
                              setCopiedDiag(true);
                              setTimeout(() => setCopiedDiag(false), 2000);
                            }
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors cursor-pointer flex-shrink-0"
                      >
                        {copiedDiag ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Diagnostics</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-black/40 border border-white/[0.08] space-y-3.5">
                    {/* Status Header Badge */}
                    <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-300 font-medium">Firestore Engine Status:</span>
                        {effectiveDiag?.lastWriteError ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            Sync Error Recorded
                          </span>
                        ) : effectiveDiag?.isListenerAttached ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Listener Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-zinc-500/20 text-zinc-400 border border-zinc-500/30">
                            Offline / Unattached
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 font-mono">
                        Doc: users/{effectiveDiag?.uidLast6 ? `...${effectiveDiag.uidLast6}` : 'unauthenticated'}
                      </div>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs font-mono">
                      {/* 1. Account Email & UID */}
                      <div className="p-2.5 rounded-lg bg-black/50 border border-white/[0.06] flex flex-col justify-between">
                        <span className="text-[10px] uppercase text-zinc-500 font-sans font-semibold">Account Email & UID</span>
                        <div className="text-zinc-200 truncate font-semibold mt-1" title={effectiveDiag?.accountEmail || 'Not signed in'}>
                          {effectiveDiag?.accountEmail || 'Not signed in'}
                        </div>
                        <div className="text-[10px] text-zinc-400 mt-1">
                          UID: <span className="text-zinc-200">...{effectiveDiag?.uidLast6 || 'N/A'}</span>
                        </div>
                      </div>

                      {/* 2. Subscription Status & Initializing */}
                      <div className="p-2.5 rounded-lg bg-black/50 border border-white/[0.06] flex flex-col justify-between">
                        <span className="text-[10px] uppercase text-zinc-500 font-sans font-semibold">Subscription & Engine</span>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-zinc-200 font-semibold uppercase">{effectiveDiag?.subscriptionStatus || 'loading'}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            effectiveDiag?.isInitializing 
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' 
                              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          }`}>
                            {effectiveDiag?.isInitializing ? 'isInitializing: true' : 'isInitializing: false'}
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-400 mt-1">
                          Writes blocked while initializing
                        </div>
                      </div>

                      {/* 3. Snapshot Listener Status */}
                      <div className="p-2.5 rounded-lg bg-black/50 border border-white/[0.06] flex flex-col justify-between">
                        <span className="text-[10px] uppercase text-zinc-500 font-sans font-semibold">Snapshot Listener</span>
                        <div className="text-zinc-200 font-semibold mt-1">
                          {effectiveDiag?.isListenerAttached ? (
                            <span className="text-emerald-400">Attached (Subscribed)</span>
                          ) : (
                            <span className="text-zinc-500">Not Attached</span>
                          )}
                        </div>
                        <div className="text-[10px] text-zinc-400 mt-1">
                          onSnapshot(users/{"{uid}"})
                        </div>
                      </div>

                      {/* 4. Last Snapshot Details */}
                      <div className="p-2.5 rounded-lg bg-black/50 border border-white/[0.06] flex flex-col justify-between">
                        <span className="text-[10px] uppercase text-zinc-500 font-sans font-semibold">Last Snapshot Info</span>
                        <div className="text-zinc-200 font-semibold mt-1">
                          {effectiveDiag?.lastSnapshotTime 
                            ? new Date(effectiveDiag.lastSnapshotTime).toLocaleTimeString() 
                            : 'No snapshot yet'}
                        </div>
                        <div className="text-[10px] text-zinc-400 mt-1">
                          fromCache: <span className="text-zinc-200">{String(effectiveDiag?.lastSnapshotFromCache ?? 'N/A')}</span> | pendingWrites: <span className="text-zinc-200">{String(effectiveDiag?.lastSnapshotPendingWrites ?? 'N/A')}</span>
                        </div>
                      </div>

                      {/* 5. Tabs Count: Local vs Cloud Snapshot */}
                      <div className="p-2.5 rounded-lg bg-black/50 border border-white/[0.06] flex flex-col justify-between">
                        <span className="text-[10px] uppercase text-zinc-500 font-sans font-semibold">Tabs (Local vs Cloud)</span>
                        <div className="flex items-baseline gap-2 mt-1">
                          <span className="text-sm font-bold text-white">{effectiveDiag?.localTabsCount ?? 0}</span>
                          <span className="text-zinc-500 text-[11px]">local</span>
                          <span className="text-zinc-600">/</span>
                          <span className="text-sm font-bold text-indigo-400">{effectiveDiag?.cloudTabsCount ?? 'N/A'}</span>
                          <span className="text-zinc-500 text-[11px]">cloud</span>
                        </div>
                        <div className="text-[10px] text-zinc-400 mt-1">
                          {effectiveDiag?.localTabsCount === effectiveDiag?.cloudTabsCount ? (
                            <span className="text-emerald-400">Tab counts match</span>
                          ) : (
                            <span className="text-amber-400">Tab count mismatch</span>
                          )}
                        </div>
                      </div>

                      {/* 6. Estimated Upload Size (1MB Limit) */}
                      <div className="p-2.5 rounded-lg bg-black/50 border border-white/[0.06] flex flex-col justify-between">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase text-zinc-500 font-sans font-semibold">Estimated Payload Size</span>
                          <span className="text-[10px] text-zinc-400">Limit: 1024 KB</span>
                        </div>
                        <div className="flex items-baseline gap-1.5 mt-1">
                          <span className="text-sm font-bold text-zinc-100">{effectiveDiag?.estimatedUploadSizeKb ?? 0} KB</span>
                          <span className="text-[10px] text-zinc-500">({effectiveDiag?.estimatedUploadSizeBytes ?? 0} B)</span>
                        </div>
                        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden mt-1">
                          <div 
                            className={`h-full ${
                              (effectiveDiag?.estimatedUploadSizeKb ?? 0) > 900 
                                ? 'bg-rose-500' 
                                : (effectiveDiag?.estimatedUploadSizeKb ?? 0) > 500 
                                  ? 'bg-amber-500' 
                                  : 'bg-[var(--accent-color)]'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(1, (((effectiveDiag?.estimatedUploadSizeBytes ?? 0) / 1048576) * 100)))}%` }}
                          />
                        </div>
                      </div>

                      {/* 7. Last Successful Write Time */}
                      <div className="p-2.5 rounded-lg bg-black/50 border border-white/[0.06] flex flex-col justify-between sm:col-span-2 lg:col-span-3">
                        <span className="text-[10px] uppercase text-zinc-500 font-sans font-semibold">Last Successful Write Time</span>
                        <div className="text-zinc-200 font-semibold mt-1">
                          {effectiveDiag?.lastSuccessfulWriteTime ? (
                            <span className="text-emerald-400 flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {new Date(effectiveDiag.lastSuccessfulWriteTime).toLocaleTimeString()} ({Math.max(0, Math.round((Date.now() - effectiveDiag.lastSuccessfulWriteTime) / 1000))}s ago)
                            </span>
                          ) : (
                            <span className="text-zinc-500">No write completed yet in this session</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Last Write Error */}
                    {effectiveDiag?.lastWriteError ? (
                      <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono flex items-start gap-2.5">
                        <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-rose-200">
                            Last Write Error [Code: {effectiveDiag.lastWriteError.code || 'UNKNOWN'}]
                          </div>
                          <div className="text-[11px] text-rose-300 mt-0.5 break-words">
                            {effectiveDiag.lastWriteError.message}
                          </div>
                          <div className="text-[10px] text-rose-400/80 mt-1">
                            Recorded at: {new Date(effectiveDiag.lastWriteError.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-2 px-3 rounded-lg bg-emerald-500/5 border border-emerald-500/15 text-emerald-400 text-xs font-mono flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>No write errors recorded.</span>
                      </div>
                    )}

                    {/* Event Log (Last 20 events) */}
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                        <span>Recent Sync Events Log ({effectiveDiag?.eventLogs?.length ?? 0}/20)</span>
                        <span className="text-zinc-500">Auto-recorded & console logged</span>
                      </div>
                      <div className="max-h-36 overflow-y-auto bg-black/70 border border-white/[0.08] rounded-lg p-2.5 space-y-1 font-mono text-[10px] select-text">
                        {effectiveDiag?.eventLogs && effectiveDiag.eventLogs.length > 0 ? (
                          effectiveDiag.eventLogs.map(log => (
                            <div 
                              key={log.id} 
                              className={`flex items-start gap-1.5 leading-tight ${
                                log.isError 
                                  ? 'text-rose-400 bg-rose-500/10 px-1 py-0.5 rounded' 
                                  : log.type.includes('WRITE') 
                                    ? 'text-sky-300' 
                                    : log.type.includes('SNAPSHOT')
                                      ? 'text-purple-300'
                                      : 'text-zinc-300'
                              }`}
                            >
                              <span className="text-zinc-500 flex-shrink-0 font-semibold">[{log.timeFormatted}]</span>
                              <span className="font-semibold flex-shrink-0">[{log.type}]</span>
                              <span className="truncate flex-1" title={log.details}>{log.details}</span>
                            </div>
                          ))
                        ) : (
                          <div className="text-zinc-500 py-2 text-center italic">
                            No sync events logged yet.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Active Backend Endpoint */}
                <div className="space-y-2.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <Server className="w-4 h-4 text-[var(--accent-color)]" />
                    <span>Active AI Backend Server</span>
                  </label>
                  <div className="p-4 rounded-xl bg-black/40 border border-white/[0.08] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 pr-3">
                        <span className="text-[11px] text-zinc-400 block font-mono">Current Endpoint URL</span>
                        <span className="text-xs text-zinc-200 font-mono font-medium truncate block">
                          {getApiBaseUrl() || '(Local Relative / Dev Server)'}
                        </span>
                      </div>
                      <button
                        onClick={async () => {
                          playBlipSound(soundEnabled);
                          setBackendStatus('checking');
                          const ok = await testBackendHealth();
                          setBackendStatus(ok ? 'healthy' : 'error');
                        }}
                        disabled={backendStatus === 'checking'}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors cursor-pointer flex-shrink-0"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${backendStatus === 'checking' ? 'animate-spin' : ''}`} />
                        <span>Test Health</span>
                      </button>
                    </div>

                    {backendStatus === 'healthy' && (
                      <div className="flex items-center gap-2 text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-lg">
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                        <span>Backend is online and responding normally.</span>
                      </div>
                    )}

                    {backendStatus === 'error' && (
                      <div className="flex items-center gap-2 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-lg">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>Unable to reach backend endpoint. Check internet or server status.</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Custom Backend URL Override */}
                <div className="space-y-2.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-[var(--accent-color)]" />
                    <span>Custom Backend Endpoint (Optional)</span>
                  </label>
                  <p className="text-[11px] text-zinc-400">
                    The desktop overlay connects directly to your published Cloud Run server ({DEFAULT_CLOUD_URL}). You can specify a custom endpoint override if needed.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder={DEFAULT_CLOUD_URL}
                      value={customBackendInput}
                      onChange={(e) => setCustomBackendInput(e.target.value)}
                      className="flex-1 bg-black/60 border border-white/15 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-[var(--accent-border)] font-mono"
                    />
                    <button
                      onClick={() => {
                        playBlipSound(soundEnabled);
                        setApiBaseUrl(customBackendInput);
                        setBackendStatus('idle');
                      }}
                      className="px-4 py-2 bg-[var(--accent-dim)] border border-[var(--accent-border)] text-white hover:bg-[var(--accent-color)]/20 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex-shrink-0"
                    >
                      Save
                    </button>
                    {customBackendInput && (
                      <button
                        onClick={() => {
                          playBlipSound(soundEnabled);
                          setCustomBackendInput('');
                          setApiBaseUrl('');
                          setBackendStatus('idle');
                        }}
                        className="px-3 py-2 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded-xl text-xs transition-colors cursor-pointer flex-shrink-0"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                {/* Itch.io Web Game Distribution */}
                <div className="pt-4 border-t border-white/10 space-y-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-emerald-400" />
                      <h4 className="text-sm font-medium text-zinc-200">Itch.io Web Package (HTML5)</h4>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Pre-bundled ZIP archive ready for direct upload as an HTML5 playable game/overlay on Itch.io. Pre-configured to communicate directly with your published Cloud Run server.
                    </p>
                  </div>
                  <a
                    href="/quest-compendium-itch.zip"
                    download="quest-compendium-itch.zip"
                    onClick={() => playBlipSound(soundEnabled)}
                    className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 hover:text-emerald-200 rounded-xl text-xs font-semibold transition-all shadow-md cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    Download quest-compendium-itch.zip
                  </a>
                </div>
              </div>
            )}

            {activeTab === 'account' && (
              <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">

                {/* Steam Sign-in */}
                <div className="space-y-2.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <Gamepad2 className="w-4 h-4 text-[var(--accent-color)]" />
                    <span>Steam Connection</span>
                  </label>
                  
                  {settings.steamId ? (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-black/60 border border-white/15">
                      <div className="flex flex-col">
                        <span className="text-xs text-white font-semibold">Connected</span>
                        <span className="text-[11px] text-zinc-400 font-mono">{settings.steamId}</span>
                      </div>
                      <button
                        onClick={() => {
                          playBlipSound(soundEnabled);
                          onUpdateSettings({ steamId: '' });
                        }}
                        className="px-3 py-1.5 text-xs font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors cursor-pointer"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <div>
                      <button 
                        onClick={() => {
                          playBlipSound(soundEnabled);
                          if ((window as any).electronAPI) {
                            (window as any).electronAPI.startSteamLogin();
                          } else {
                            const popup = window.open(`${getApiBaseUrl()}/api/auth/steam`, 'steam_login', 'width=800,height=600');
                            if (!popup) {
                              alert('Please allow popups to sign in with Steam.');
                            }
                          }
                        }}
                        className="w-full flex items-center justify-center gap-2 bg-[#171a21] hover:bg-[#2a475e] text-white border border-[#2a475e] rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Sign in through Steam
                      </button>
                      <p className="text-[11px] text-zinc-400 leading-relaxed mt-2.5">
                        Sign in securely via Steam to automatically sync your game achievements instead of using the local mock data.
                      </p>
                    </div>
                  )}
                </div>

                {/* Account */}
                <div className="space-y-2.5 pt-4 border-t border-white/[0.08]">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <LogOut className="w-4 h-4 text-red-400" />
                    <span className="text-red-400">Account Management</span>
                  </label>
                  
                  <button
                    onClick={() => {
                      playBlipSound(soundEnabled);
                      logOut();
                      onClose();
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Sign out of Compendium
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
