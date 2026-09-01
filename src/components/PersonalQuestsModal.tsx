import React, { useState, useEffect, useRef } from 'react';
import { Target, Plus, Check, Trash2, X, Sparkles, Circle, CheckCircle2 } from 'lucide-react';
import { GameTab, PersonalQuest } from '../types';
import { playBlipSound } from '../utils/audio';

interface PersonalQuestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: GameTab | null;
  onUpdateQuests: (quests: PersonalQuest[]) => void;
  soundEnabled: boolean;
}

export const PersonalQuestsModal: React.FC<PersonalQuestsModalProps> = ({
  isOpen,
  onClose,
  activeTab,
  onUpdateQuests,
  soundEnabled,
}) => {
  const [quests, setQuests] = useState<PersonalQuest[]>([]);
  const [newQuestTitle, setNewQuestTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeTab) {
      setQuests(activeTab.personalQuests || []);
    }
  }, [activeTab]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const gameName = activeTab?.name || 'Current Game';
  
  const handleAddQuest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuestTitle.trim()) return;

    const newQuest: PersonalQuest = {
      id: `quest-${Date.now()}`,
      title: newQuestTitle.trim(),
      completed: false,
      createdAt: Date.now()
    };

    const updated = [...quests, newQuest];
    setQuests(updated);
    onUpdateQuests(updated);
    setNewQuestTitle('');
    playBlipSound(soundEnabled);
  };

  const handleToggleQuest = (id: string) => {
    const updated = quests.map(q => 
      q.id === id ? { ...q, completed: !q.completed } : q
    );
    setQuests(updated);
    onUpdateQuests(updated);
    playBlipSound(soundEnabled);
  };

  const handleDeleteQuest = (id: string) => {
    const updated = quests.filter(q => q.id !== id);
    setQuests(updated);
    onUpdateQuests(updated);
    playBlipSound(soundEnabled);
  };

  const activeQuests = quests.filter(q => !q.completed).sort((a, b) => b.createdAt - a.createdAt);
  const completedQuests = quests.filter(q => q.completed).sort((a, b) => b.createdAt - a.createdAt);
  const progress = quests.length > 0 ? (completedQuests.length / quests.length) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-[#0c0d14] border border-white/15 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_30px_var(--accent-glow)] flex flex-col h-[80vh] max-h-[700px] overflow-hidden relative">
        
        {/* Header */}
        <div className="p-5 border-b border-white/[0.08] flex items-center justify-between bg-black/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Target className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="font-fantasy font-bold text-lg tracking-wider text-white flex items-center gap-2">
                PERSONAL QUESTS
                {completedQuests.length === quests.length && quests.length > 0 && (
                  <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
                )}
              </h3>
              <p className="text-xs text-zinc-400 font-mono">
                {gameName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        {quests.length > 0 && (
          <div className="px-5 py-3 bg-black/20 border-b border-white/[0.04]">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-2 font-mono">
              <span>Quest Progress</span>
              <span>{completedQuests.length} / {quests.length} Completed</span>
            </div>
            <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-500 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Quests Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          
          {/* Active Quests */}
          <div>
            <h4 className="text-xs font-bold text-zinc-500 tracking-widest uppercase mb-3 px-1">Active Objectives</h4>
            {activeQuests.length === 0 ? (
              <div className="text-center py-8 px-4 border border-dashed border-white/10 rounded-xl bg-white/[0.02]">
                <Target className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-sm text-zinc-400 font-medium">No active quests.</p>
                <p className="text-xs text-zinc-500 mt-1">Add a personal goal to start tracking your journey.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {activeQuests.map(quest => (
                  <div 
                    key={quest.id}
                    className="group flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/20 transition-all cursor-pointer"
                    onClick={() => handleToggleQuest(quest.id)}
                  >
                    <button className="flex-shrink-0 text-zinc-500 hover:text-emerald-400 transition-colors">
                      <Circle className="w-5 h-5" />
                    </button>
                    <span className="flex-1 text-sm text-zinc-200 font-medium select-none">{quest.title}</span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDeleteQuest(quest.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Completed Quests */}
          {completedQuests.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-zinc-500 tracking-widest uppercase mb-3 px-1">Completed</h4>
              <div className="space-y-2">
                {completedQuests.map(quest => (
                  <div 
                    key={quest.id}
                    className="group flex items-center gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 hover:bg-emerald-500/10 transition-all cursor-pointer"
                    onClick={() => handleToggleQuest(quest.id)}
                  >
                    <button className="flex-shrink-0 text-emerald-500">
                      <CheckCircle2 className="w-5 h-5" />
                    </button>
                    <span className="flex-1 text-sm text-zinc-500 font-medium line-through select-none">{quest.title}</span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDeleteQuest(quest.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Add Quest Footer */}
        <div className="p-4 border-t border-white/[0.08] bg-black/60">
          <form onSubmit={handleAddQuest} className="flex gap-2">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <Plus className="w-4 h-4 text-zinc-500" />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={newQuestTitle}
                onChange={e => setNewQuestTitle(e.target.value)}
                placeholder="Add a new personal objective..."
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-9 pr-4 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[var(--accent-color)] focus:bg-white/10 transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={!newQuestTitle.trim()}
              className="px-5 rounded-xl bg-[var(--accent-color)] text-white font-medium text-sm hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_var(--accent-glow)] flex items-center gap-2"
            >
              Add
            </button>
          </form>
        </div>

      </div>
    </div>
  );
};
