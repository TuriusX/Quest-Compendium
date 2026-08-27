import React, { useState } from 'react';
import confetti from 'canvas-confetti';
import { 
  Trophy, 
  Award, 
  CheckCircle2, 
  Lock, 
  Search, 
  Sparkles, 
  X,
  Filter,
  Flame,
  Newspaper,
  Calendar
} from 'lucide-react';
import { Achievement, SteamGameData } from '../types';
import { playFanfareSound, playBlipSound } from '../utils/audio';

interface AchievementsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  gameData: SteamGameData | null;
  onToggleAchievement: (apiname: string) => void;
  soundEnabled: boolean;
}

export const AchievementsDrawer: React.FC<AchievementsDrawerProps> = ({
  isOpen,
  onClose,
  gameData,
  onToggleAchievement,
  soundEnabled,
}) => {
  const [activeView, setActiveView] = useState<'medals' | 'patches'>('medals');
  const [filter, setFilter] = useState<'all' | 'locked' | 'unlocked' | 'rare'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const achievements = gameData?.achievements || [];
  const patchNotes = gameData?.patchNotes || [];
  const totalCount = achievements.length;
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const percent = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;
  const isPlatinum = totalCount > 0 && unlockedCount === totalCount;

  // Medal Tallies
  const goldCount = achievements.filter(a => a.unlocked && a.tier === 'gold').length;
  const silverCount = achievements.filter(a => a.unlocked && a.tier === 'silver').length;
  const bronzeCount = achievements.filter(a => a.unlocked && a.tier === 'bronze').length;

  const handleToggle = (apiname: string, currentState: boolean) => {
    playBlipSound(soundEnabled);
    onToggleAchievement(apiname);

    // If this unlocks the final achievement for 100%, trigger confetti and fanfare
    if (!currentState && unlockedCount + 1 === totalCount && totalCount > 0) {
      playFanfareSound(soundEnabled);
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.5 }
      });
    }
  };

  // Filtered achievements
  const filtered = achievements.filter(a => {
    const isRare = (a.rarity || 0) < 10;
    const matchesFilter = 
      filter === 'all' ? true :
      filter === 'unlocked' ? a.unlocked :
      filter === 'locked' ? !a.unlocked :
      isRare;

    const matchesSearch = 
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.description.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  const getMedalSvg = (tier: 'gold' | 'silver' | 'bronze') => {
    const colors = {
      gold: '#ffd700',
      silver: '#d1d5db',
      bronze: '#d97706'
    };
    const color = colors[tier];
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" className="drop-shadow-md">
        <path d="M7 2h10l-5 8z" fill="#334155" stroke="#000" strokeWidth="1"/>
        <path d="M9 2h6l-3 4.8z" fill="#3b82f6"/>
        <circle cx="12" cy="15" r="8" fill={color} stroke="#000" strokeWidth="1"/>
        <circle cx="12" cy="15" r="6" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1"/>
        <path d="M12 10.5l1.2 3h3.3l-2.7 2 1 3-2.8-2-2.8 2 1-3-2.7-2h3.3z" fill="rgba(255,255,255,0.95)"/>
      </svg>
    );
  };

  return (
    <aside
      className={`h-full bg-[#0a0b10]/95 backdrop-blur-2xl border-l border-white/[0.08] flex flex-col transition-all duration-300 ease-out z-20 flex-shrink-0 relative ${
        isOpen ? 'w-80 sm:w-96' : 'w-0 overflow-hidden border-none'
      }`}
    >
      {/* Header */}
      <div className="p-3.5 border-b border-white/[0.08] flex items-center justify-between flex-shrink-0 bg-black/30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex flex-col">
            <span className="font-fantasy font-bold text-xs tracking-wider text-white">
              TROPHY CABINET
            </span>
            <span className="text-[10px] text-zinc-400 font-mono">
              {gameData?.name || 'Active Game'}
            </span>
          </div>
        </div>

        {isPlatinum ? (
          <span className="px-2.5 py-1 rounded-full bg-cyan-500/20 border border-cyan-400/50 text-cyan-300 font-mono text-[11px] font-bold flex items-center gap-1 shadow-[0_0_12px_rgba(34,211,238,0.5)] animate-pulse">
            <Award className="w-3.5 h-3.5 text-cyan-300" /> 100% PLATINUM
          </span>
        ) : (
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Sub Tabs: Medals vs Patch Notes */}
      <div className="px-3 pt-2.5 flex gap-1.5 border-b border-white/[0.08] bg-black/20 flex-shrink-0">
        <button
          onClick={() => setActiveView('medals')}
          className={`flex-1 py-1.5 px-2 rounded-t-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeView === 'medals'
              ? 'bg-white/[0.08] text-white border-t border-x border-white/10'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Trophy className="w-3.5 h-3.5 text-amber-400" />
          <span>Achievements ({totalCount})</span>
        </button>
        <button
          onClick={() => setActiveView('patches')}
          className={`flex-1 py-1.5 px-2 rounded-t-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeView === 'patches'
              ? 'bg-white/[0.08] text-white border-t border-x border-white/10'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Newspaper className="w-3.5 h-3.5 text-blue-400" />
          <span>Patch Notes ({patchNotes.length})</span>
        </button>
      </div>

      {activeView === 'medals' ? (
        <>
          {/* Progress & Medal Tallies Card */}
          <div className="p-3 bg-black/40 border-b border-white/[0.08] space-y-2.5 flex-shrink-0">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">
                Completion: <strong className="text-white font-mono">{unlockedCount} / {totalCount}</strong>
              </span>
              <span className="font-mono text-sm font-bold text-[var(--accent-color)]">
                {percent}%
              </span>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden p-0.5 shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isPlatinum 
                    ? 'bg-gradient-to-r from-cyan-400 to-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.8)]' 
                    : 'bg-gradient-to-r from-[var(--accent-color)] to-amber-400 shadow-[0_0_8px_var(--accent-glow)]'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>

            {/* Medal Badges */}
            <div className="flex items-center justify-around pt-2 border-t border-white/[0.06] text-xs">
              <div className="flex items-center gap-1.5" title="Gold Medals (<10% Global Rarity)">
                {getMedalSvg('gold')}
                <span className="font-mono text-xs font-bold text-amber-400">{goldCount} Gold</span>
              </div>
              <div className="flex items-center gap-1.5" title="Silver Medals (10-25% Global Rarity)">
                {getMedalSvg('silver')}
                <span className="font-mono text-xs font-bold text-zinc-300">{silverCount} Silver</span>
              </div>
              <div className="flex items-center gap-1.5" title="Bronze Medals (>25% Global Rarity)">
                {getMedalSvg('bronze')}
                <span className="font-mono text-xs font-bold text-amber-600">{bronzeCount} Bronze</span>
              </div>
            </div>
          </div>

          {/* Filter Tabs & Search */}
          <div className="p-3 space-y-2 border-b border-white/[0.08] bg-black/20 flex-shrink-0">
            <div className="flex gap-1">
              {(['all', 'unlocked', 'locked', 'rare'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    playBlipSound(soundEnabled);
                    setFilter(mode);
                  }}
                  className={`flex-1 py-1 rounded-lg text-[11px] font-semibold capitalize transition-all cursor-pointer ${
                    filter === mode
                      ? 'bg-[var(--accent-color)] text-black shadow-sm font-bold'
                      : 'bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-white'
                  }`}
                >
                  {mode === 'rare' ? '🔥 Rare' : mode}
                </button>
              ))}
            </div>

            {/* Search input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search trophies & descriptions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-black/60 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-[var(--accent-color)] font-sans"
              />
            </div>
          </div>

          {/* Achievement Cards List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-zinc-500 text-xs">
                No trophies matching this filter.
              </div>
            ) : (
              filtered.map((ach) => {
                const isRare = (ach.rarity || 0) < 10;

                return (
                  <div
                    key={ach.apiname}
                    onClick={() => handleToggle(ach.apiname, ach.unlocked)}
                    className={`group rounded-xl border p-3 flex items-start gap-3 transition-all cursor-pointer select-none ${
                      ach.unlocked
                        ? isRare 
                          ? 'rare-achievement-glow text-white shadow-lg'
                          : 'bg-[#151722]/95 border-amber-500/30 text-zinc-200 hover:border-amber-500/50'
                        : 'bg-black/40 border-white/[0.06] text-zinc-500 hover:border-white/20 hover:bg-white/[0.02]'
                    }`}
                  >
                    {/* Checkbox / Medal Icon */}
                    <div className="mt-0.5 flex-shrink-0">
                      {ach.unlocked ? (
                        <div className="relative">
                          {getMedalSvg(ach.tier)}
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 absolute -bottom-1 -right-1 bg-black rounded-full" />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-center group-hover:border-white/30 transition-colors">
                          <Lock className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400" />
                        </div>
                      )}
                    </div>

                    {/* Achievement Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className={`font-semibold text-xs leading-tight ${ach.unlocked ? 'text-white font-bold' : 'text-zinc-400'}`}>
                          {ach.name}
                        </span>

                        {ach.rarity !== undefined && (
                          <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold flex-shrink-0 ${
                            isRare 
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                              : 'bg-white/5 text-zinc-400'
                          }`}>
                            {ach.rarity}%
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-2">
                        {ach.description}
                      </p>

                      {ach.unlocked && ach.unlockDate && (
                        <div className="mt-1 text-[9.5px] font-mono text-zinc-400 flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                          <span>Unlocked: {ach.unlockDate}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        /* Patch Notes & Updates View */
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200">
            <span className="font-semibold block mb-1">Official Steam Updates</span>
            <span>Live balance changes, weapon tuning & DLC patch notes synced for {gameData?.name || 'this game'}.</span>
          </div>

          {patchNotes.map((note, idx) => (
            <div key={idx} className="p-3 rounded-xl bg-black/40 border border-white/[0.08] text-xs text-zinc-300 space-y-1">
              <div className="flex items-center gap-1.5 text-[var(--accent-color)] font-mono text-[11px] font-bold">
                <Calendar className="w-3.5 h-3.5" />
                <span>Update #{patchNotes.length - idx}</span>
              </div>
              <p className="leading-relaxed font-sans text-zinc-300">{note}</p>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
};
