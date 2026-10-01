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
} from './icons';
import { PixelMedal, PixelTrophy, useLofi } from './pixelArt';
import { Achievement, SteamGameData } from '../types';
import { playFanfareSound, playBlipSound } from '../utils/audio';
import { useLocale, useT } from '../i18n';
import { openGuideArea, tipMatches, useAchievementGuide } from '../utils/achievementGuide';

interface AchievementsDrawerProps {
  width: number;
  isDragging: boolean;
  isOpen: boolean;
  onClose: () => void;
  gameData: SteamGameData | null;
  soundEnabled: boolean;
}

export const AchievementsDrawer: React.FC<AchievementsDrawerProps> = ({
  width,
  isDragging,
  isOpen,
  onClose,
  gameData,
  soundEnabled,
}) => {
  const t = useT();
  const lofi = useLofi();
  const [activeView, setActiveView] = useState<'medals' | 'roadmap' | 'patches'>('medals');
  const [filter, setFilter] = useState<'all' | 'locked' | 'unlocked' | 'rare' | 'missable'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [openTip, setOpenTip] = useState<string | null>(null);
  // How to get each achievement, which can be missed, and where (from the achievement guide, when the game has one).
  const locale = useLocale();
  const guide = useAchievementGuide(gameData?.name, gameData?.appId, locale);
  const tipFor = (name: string) => guide?.list.find((x) => tipMatches(x, name));
  const hasMissables = !!guide?.list.some((x) => x.missable);

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

  // Filtered achievements
  const filtered = achievements.filter(a => {
    const isRare = (a.rarity || 0) < 10;
    const matchesFilter = 
      filter === 'all' ? true :
      filter === 'unlocked' ? a.unlocked :
      filter === 'locked' ? !a.unlocked :
      filter === 'missable' ? !!tipFor(a.name)?.missable && !a.unlocked :
      isRare;

    const matchesSearch = 
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.description.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  const getMedalSvg = (tier: 'gold' | 'silver' | 'bronze') => {
    if (lofi) return <PixelMedal tier={tier} size={20} />;
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
      className={`h-full z-20 flex-shrink-0 relative ${!isDragging ? 'transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)]' : ''} ${
        !isOpen ? 'border-none' : ''
      }`}
      style={{ perspective: '2000px', width: isOpen ? `${width}px` : '0px' }}
    >
      <div 
        className="h-full bg-[#0a0b10]/95 backdrop-blur-2xl border-l border-white/[0.08] flex flex-col overflow-hidden"
        style={{
          width: `${width}px`,
          transformOrigin: 'right center',
          transform: isOpen ? 'rotateY(0deg)' : 'rotateY(90deg)',
          opacity: isOpen ? 1 : 0,
          transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s ease',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
      {/* Header */}
      <div className="p-3.5 border-b border-white/[0.08] flex items-center justify-between flex-shrink-0 bg-black/30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex flex-col">
            <span className="font-fantasy font-bold text-sm text-white leading-tight">
              {t('common.achievements')}
            </span>
            <span className="text-[10px] text-zinc-400 font-mono uppercase truncate">
              {gameData?.name ? t('ach.fromSteam', { game: gameData.name }) : t('header.noGame')}
            </span>
          </div>
        </div>

        <button
          onClick={onClose}
          aria-label={t('ach.close')}
          title={t('common.close')}
          className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
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
          <span>{t('ach.tabAch', { n: totalCount })}</span>
        </button>
        {guide?.roadmap && (
          <button
            onClick={() => setActiveView('roadmap')}
            className={`flex-1 py-1.5 px-2 rounded-t-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeView === 'roadmap' ? 'bg-white/[0.08] text-white border-t border-x border-white/10' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-[var(--accent-color)]" />
            <span>{t('ach.roadmap')}</span>
          </button>
        )}
        <button
          onClick={() => setActiveView('patches')}
          className={`flex-1 py-1.5 px-2 rounded-t-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeView === 'patches'
              ? 'bg-white/[0.08] text-white border-t border-x border-white/10'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Newspaper className="w-3.5 h-3.5 text-blue-400" />
          <span>{t('ach.tabPatch', { n: patchNotes.length })}</span>
        </button>
      </div>

      {activeView === 'medals' ? (
        <>
          {/* Progress & Medal Tallies Card */}
          <div className="px-4 py-3 bg-[#1e2029] border-b border-white/[0.08] space-y-2 flex-shrink-0 relative overflow-hidden">
            {isPlatinum ? (
              <div className="flex flex-col gap-1.5 z-10 relative">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {lofi ? <PixelTrophy size={28} /> : <Award className="w-[20px] h-[20px] text-sky-400 drop-shadow-[0_0_8px_rgba(56,189,248,0.5)] flex-shrink-0" />}
                    <span className="text-white font-black text-[11px] tracking-wide uppercase drop-shadow-md">
                      {t('ach.allUnlocked', { n: totalCount })}
                    </span>
                  </div>
                  <span className="text-white font-black text-[11px] tracking-wide drop-shadow-md">(100%)</span>
                </div>
                {/* 100% Progress Bar line */}
                <div className="w-full h-[3px] rounded-full bg-cyan-900/30 overflow-hidden shadow-inner mt-1 qc-seg qc-seg-gold">
                  <div className="h-full bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.6)]" style={{ width: '100%' }} />
                </div>
                
                {/* Optional glow effect behind */}
                <div className="absolute top-0 left-0 w-full h-full bg-cyan-500/10 pointer-events-none -z-10 blur-xl"></div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-[11px] tracking-wide">
                  <span className="text-zinc-400 font-bold uppercase">
                    {t('ach.completion')} <strong className="text-white font-mono">{unlockedCount}/{totalCount}</strong>
                  </span>
                  <span className="font-mono text-sm font-bold text-[var(--accent-color)]">
                    {percent}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-[4px] rounded-full bg-white/10 overflow-hidden shadow-inner qc-seg">
                  <div
                    className="h-full rounded-full bg-[var(--accent-color)] transition-all duration-500 shadow-[0_0_8px_var(--accent-glow)]"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </>
            )}

            {/* Medal Badges */}
            <div className="flex items-center justify-around pt-2 border-t border-white/[0.06] text-xs">
              <div className="flex items-center gap-1.5" title={t('ach.goldTitle')}>
                {getMedalSvg('gold')}
                <span className="font-mono text-xs font-bold text-amber-400">{t('ach.gold', { n: goldCount })}</span>
              </div>
              <div className="flex items-center gap-1.5" title={t('ach.silverTitle')}>
                {getMedalSvg('silver')}
                <span className="font-mono text-xs font-bold text-zinc-300">{t('ach.silver', { n: silverCount })}</span>
              </div>
              <div className="flex items-center gap-1.5" title={t('ach.bronzeTitle')}>
                {getMedalSvg('bronze')}
                <span className="font-mono text-xs font-bold text-amber-600">{t('ach.bronze', { n: bronzeCount })}</span>
              </div>
            </div>
          </div>

          {/* Filter Tabs & Search */}
          <div className="p-3 space-y-2 border-b border-white/[0.08] bg-black/20 flex-shrink-0">
            <div className="flex gap-1">
              {(['all', 'unlocked', 'locked', 'rare', ...(hasMissables ? (['missable'] as const) : [])] as const).map((mode) => (
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
                  {t(`ach.filter.${mode}`)}
                </button>
              ))}
            </div>

            {/* Search input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={t('ach.search')}
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
                {t('ach.empty')}
              </div>
            ) : (
              filtered.map((ach) => {
                const isRare = (ach.rarity || 0) < 10;
                const tip = tipFor(ach.name);
                const open = openTip === ach.apiname;

                return (
                  <div
                    key={ach.apiname}
                    onClick={() => tip?.how && setOpenTip(open ? null : ach.apiname)}
                    className={`group rounded-xl border p-3 flex items-start gap-3 transition-all ${
                      ach.unlocked
                        ? isRare 
                          ? 'rare-achievement-glow text-white shadow-lg'
                          : 'bg-white/[0.02] border-white/[0.06] text-zinc-200'
                        : 'bg-black/40 border-white/[0.06] text-zinc-500 hover:border-white/20'
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
                      {tip?.missable && !ach.unlocked && (
                        <span className="inline-block mt-1 text-[9.5px] font-bold uppercase tracking-wide text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5">
                          {t('ach.missable')}
                        </span>
                      )}
                      {tip?.how && !open && <div className="mt-1 text-[10px] text-[var(--accent-color)]">{t('ach.howTo')} ▸</div>}
                      {tip?.how && open && (
                        <div className="mt-1.5 p-2 rounded-lg bg-white/[0.04] border border-white/10 text-[11px] leading-relaxed text-zinc-200">
                          {tip.how}
                          {tip.area && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openGuideArea(tip.area!);
                              }}
                              className="block mt-1.5 text-[10.5px] font-semibold text-[var(--accent-color)] hover:brightness-125 cursor-pointer"
                            >
                              {t('ach.inGuide', { area: tip.areaName || tip.area })} →
                            </button>
                          )}
                        </div>
                      )}

                      {ach.unlocked && ach.unlockDate && (
                        <div className="mt-1 text-[9.5px] font-mono text-zinc-400 flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                          <span>{t('ach.unlockedOn', { date: ach.unlockDate })}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : activeView === 'roadmap' && guide?.roadmap ? (
        /* Roadmap to 100% (from the achievement guide) */
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              [t('ach.rmTime'), guide.roadmap.time],
              [t('ach.rmDifficulty'), guide.roadmap.difficulty],
              [t('ach.rmPlaythroughs'), guide.roadmap.playthroughs],
              [t('ach.rmMissables'), guide.roadmap.missables],
            ]
              .filter(([, v]) => v)
              .map(([label, v]) => (
                <div key={label} className="p-2.5 rounded-xl bg-white/[0.03] border border-white/10">
                  <div className="text-sm font-bold text-white leading-tight">{v}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{label}</div>
                </div>
              ))}
          </div>
          {!!guide.roadmap.noReturn?.length && (
            <div className="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] space-y-1.5">
              <div className="text-xs font-bold text-amber-200">⚠ {t('ach.rmNoReturn')}</div>
              {guide.roadmap.noReturn.map((n, i) => (
                <div key={i} className="text-[11px] leading-snug text-zinc-200">
                  <span className="font-semibold text-white">{n.point}</span>: {n.lost}
                </div>
              ))}
            </div>
          )}
          {!!guide.roadmap.steps?.length && (
            <div>
              <div className="text-xs font-bold text-white mb-1.5">{t('ach.rmSteps')}</div>
              <ol className="space-y-1.5">
                {guide.roadmap.steps.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[11px] leading-snug text-zinc-300">
                    <span className="flex-shrink-0 w-5 h-5 rounded-md bg-[var(--accent-dim)] border border-[var(--accent-border)] text-[10px] font-bold text-white flex items-center justify-center">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      ) : (
        /* Patch Notes & Updates View */
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200">
            <span className="font-semibold block mb-1">{t('ach.steamUpdates')}</span>
            <span>{t('ach.steamUpdatesBody', { game: gameData?.name || t('ach.thisGame') })}</span>
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
      </div>
    </aside>
  );
};
