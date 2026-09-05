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
  Zap
} from 'lucide-react';
import { AppSettings, AiMode, ColorTheme, DockPosition } from '../types';
import { playBlipSound } from '../utils/audio';
import { logOut } from '../lib/firebase';
import { getApiBaseUrl } from '../utils/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  soundEnabled: boolean;
}

type TabId = 'appearance' | 'persona' | 'shortcuts' | 'account';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  soundEnabled,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('appearance');

  if (!isOpen) return null;

  const themes: { id: ColorTheme; name: string; color: string; desc: string }[] = [
    { id: 'purple', name: 'Illithid Violet', color: '#a87ffb', desc: 'Psionic illithid aura' },
    { id: 'red', name: 'Mario Red', color: '#E52521', desc: 'Classic plumber intensity' },
    { id: 'cyan', name: 'Megaman Cyan', color: '#00f0ff', desc: 'Retro plasma cannon glow' },
    { id: 'blue', name: 'Sonic Blue', color: '#1E63F8', desc: 'High-speed hedgehog blur' },
    { id: 'amber', name: 'Estus Amber', color: '#ffb84d', desc: 'Warm bonfire healing' },
    { id: 'luigi', name: 'Luigi Green', color: '#55D731', desc: 'Player 2 ghost-hunting green' },
    { id: 'masterchief', name: 'Masterchief Green', color: '#6A7D51', desc: 'Spartan armor tactical glow' },
    { id: 'gold', name: 'Triforce Gold', color: '#ffd700', desc: 'Courage, wisdom, and power' },
    { id: 'pink', name: 'Chun-Li Pink', color: '#ff69b4', desc: 'Fierce Player 2 energy' },
    { id: 'silver', name: 'Witcher Silver', color: '#c0c0c0', desc: 'Monster-slaying shine' },
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
    { id: 'fable', name: 'Fable (The British Storyteller)' },
    { id: 'onyx', name: 'Onyx (The Dark Overlord)' },
    { id: 'nova', name: 'Nova (The Energetic Guide)' },
    { id: 'echo', name: 'Echo (The Wise Mentor)' },
    { id: 'shimmer', name: 'Shimmer (The Ethereal Spirit)' },
    { id: 'sage', name: 'Sage (The Mystical Oracle)' },
    { id: 'ash', name: 'Ash (The Bold Adventurer)' },
    { id: 'coral', name: 'Coral (The Cheerful Sidekick)' },
    { id: 'alloy', name: 'Alloy (The Neutral Construct)' }
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
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive 
                      ? 'bg-[var(--accent-dim)] text-white border border-[var(--accent-border)] shadow-sm' 
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-[var(--accent-color)]' : 'text-zinc-500'}`} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Main Content Area */}
          <div className="flex-1 p-5 overflow-y-auto space-y-6">

            {activeTab === 'appearance' && (
              <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
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
                      value={(settings.uiScale || 1.0) * 100}
                      onChange={(e) => {
                        onUpdateSettings({ uiScale: Number(e.target.value) / 100 });
                      }}
                      onMouseUp={() => playBlipSound(soundEnabled)}
                      className="flex-1 accent-[var(--accent-color)] cursor-pointer h-1.5 bg-white/20 rounded"
                    />
                    <span className="font-mono text-zinc-300 w-10 text-right font-bold text-xs">{Math.round((settings.uiScale || 1.0) * 100)}%</span>
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
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Slide App In/Out</label>
                      <input
                        type="text"
                        value={settings.hideAppShortcut}
                        onChange={(e) => onUpdateSettings({ hideAppShortcut: e.target.value })}
                        className="w-full bg-black/60 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-[var(--accent-border)] font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Trigger Voice Input</label>
                      <input
                        type="text"
                        value={settings.voiceInputShortcut}
                        onChange={(e) => onUpdateSettings({ voiceInputShortcut: e.target.value })}
                        className="w-full bg-black/60 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-[var(--accent-border)] font-mono"
                      />
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      Format: <code>CmdOrCtrl+Shift+H</code> etc. Note: Requires restart to apply if changing the slide toggle.
                    </p>
                  </div>
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
                      // Sandbox downgrade trigger
                      window.location.href = window.location.pathname + '?downgrade=true';
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer mb-2"
                  >
                    Reset Premium Status (Dev Tool)
                  </button>

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
