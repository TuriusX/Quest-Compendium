import React, { useState } from 'react';
import { Search, Gamepad2, Plus, Sparkles, X, Trophy, ExternalLink, ChevronRight } from 'lucide-react';
import { SteamGameData } from '../types';
import { POPULAR_STEAM_GAMES } from '../data/mockGames';
import { playBlipSound, playPageTurnSound } from '../utils/audio';
import { getApiBaseUrl } from '../utils/api';
import { auth } from '../lib/firebase';

interface QuickGameSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectGame: (game: SteamGameData) => void;
  soundEnabled: boolean;
}

export const QuickGameSearchModal: React.FC<QuickGameSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectGame,
  soundEnabled,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SteamGameData[]>([]);
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);

  if (!isOpen) return null;

  const handleSearch = async (term: string) => {
    setSearchTerm(term);
    if (!term.trim()) {
      setSearchResults([]);
      return;
    }

    // First filter local popular library
    const localMatches = POPULAR_STEAM_GAMES.filter(g => 
      g.name.toLowerCase().includes(term.toLowerCase()) ||
      g.genre?.toLowerCase().includes(term.toLowerCase())
    );
    setSearchResults(localMatches);

    // Online Steam store search lookup
    if (term.length >= 2) {
      try {
        setIsSearchingOnline(true);
        const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
        const res = await fetch(`${getApiBaseUrl()}/api/steam/search?q=${encodeURIComponent(term)}`, {
          headers: {
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.games && data.games.length > 0) {
            const onlineGames: SteamGameData[] = data.games.map((g: any) => ({
              name: g.name,
              appId: g.appId,
              headerImage: g.headerImage,
              genre: 'Steam Game',
              developer: 'Steam Store',
              achievements: [],
              totalAchievements: 0,
              unlockedAchievements: 0
            }));
            
            // Combine, avoiding duplicates
            const combined = [...localMatches];
            onlineGames.forEach(og => {
              if (!combined.some(c => c.appId === og.appId || c.name.toLowerCase() === og.name.toLowerCase())) {
                combined.push(og);
              }
            });
            setSearchResults(combined);
          }
        }
      } catch (err) {
        console.log('Steam online search fallback:', err);
      } finally {
        setIsSearchingOnline(false);
      }
    }
  };

  const handleChoose = (game: SteamGameData) => {
    playPageTurnSound(soundEnabled);
    onSelectGame(game);
    onClose();
  };

  const handleCustomGame = () => {
    if (searchTerm.trim()) {
      const customGame: SteamGameData = {
        name: searchTerm.trim(),
        appId: Math.floor(Math.random() * 900000) + 100000,
        genre: 'Custom Game',
        developer: 'User Library',
        achievements: [],
        totalAchievements: 0,
        unlockedAchievements: 0
      };
      handleChoose(customGame);
    }
  };

  const displayList = searchTerm.trim() ? searchResults : POPULAR_STEAM_GAMES;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-[#0c0d14] border border-white/15 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_30px_var(--accent-glow)] overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header & Search Bar */}
        <div className="p-4 border-b border-white/[0.08] bg-black/40 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center">
                <Gamepad2 className="w-4 h-4 text-[var(--accent-color)]" />
              </div>
              <div>
                <h3 className="font-fantasy font-bold text-sm tracking-wider text-white">
                  GAME COMPENDIUM SELECTOR
                </h3>
                <p className="text-[11px] text-zinc-400 font-mono">
                  Link active PC game or load custom quest guide
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

          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search Elden Ring, Baldur's Gate 3, Cyberpunk, Hades, or type any title..."
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              autoFocus
              className="w-full bg-[#13141d] border border-white/15 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-[var(--accent-color)] font-sans"
            />
          </div>
        </div>

        {/* Results List */}
        <div className="p-4 overflow-y-auto space-y-2 flex-1">
          {displayList.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <p className="text-xs text-zinc-400">No Steam title matched "{searchTerm}"</p>
              <button
                onClick={handleCustomGame}
                className="px-4 py-2.5 rounded-xl bg-[var(--accent-color)] text-black font-semibold text-xs hover:opacity-90 transition-opacity cursor-pointer inline-flex items-center gap-2 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Open Compendium for "{searchTerm}"
              </button>
            </div>
          ) : (
            displayList.map((game) => (
              <div
                key={game.appId || game.name}
                onClick={() => handleChoose(game)}
                className="p-3 rounded-xl border border-white/[0.08] bg-black/40 hover:bg-white/[0.06] hover:border-[var(--accent-border)] transition-all cursor-pointer flex items-center justify-between group shadow-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {game.headerImage ? (
                    <img 
                      src={game.headerImage} 
                      alt={game.name} 
                      className="w-16 h-10 object-cover rounded-lg border border-white/15 flex-shrink-0" 
                    />
                  ) : (
                    <div className="w-16 h-10 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center flex-shrink-0">
                      <Gamepad2 className="w-5 h-5 text-zinc-400 group-hover:text-[var(--accent-color)] transition-colors" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="font-semibold text-xs text-white group-hover:text-[var(--accent-color)] transition-colors truncate">
                      {game.name}
                    </div>
                    <div className="text-[11px] text-zinc-400 font-sans flex items-center gap-2 truncate">
                      <span>{game.genre || 'Action / RPG'}</span>
                      {game.developer && <span className="hidden sm:inline text-zinc-500">• {game.developer}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-zinc-400 flex-shrink-0">
                  {game.achievements && game.achievements.length > 0 && (
                    <span className="hidden sm:flex items-center gap-1 font-mono text-[11px] text-amber-400">
                      <Trophy className="w-3 h-3" />
                      {game.achievements.length}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
