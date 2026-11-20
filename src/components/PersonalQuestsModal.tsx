import React, { useState, useEffect, useRef } from 'react';
import { Target, Plus, X } from './icons';
import { GameTab, PersonalQuest } from '../types';
import { playBlipSound } from '../utils/audio';

interface PersonalQuestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: GameTab | null;
  onUpdateQuests: (quests: PersonalQuest[]) => void;
  soundEnabled: boolean;
}

/**
 * The player's own quests for a game. No tick boxes (owner, Nov 20 2026, idea #6): a quest is removed when it's done
 * or no longer wanted (its ✕, with Undo for a few seconds); there's no "completed" list or progress bar. Quests marked
 * completed before stay off the list.
 */
export const PersonalQuestsModal: React.FC<PersonalQuestsModalProps> = ({
  isOpen,
  onClose,
  activeTab,
  onUpdateQuests,
  soundEnabled,
}) => {
  const [quests, setQuests] = useState<PersonalQuest[]>([]);
  const [newQuestTitle, setNewQuestTitle] = useState('');
  const [removed, setRemoved] = useState<{ quest: PersonalQuest; at: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  if (!isOpen) return null;

  const gameName = activeTab?.name || 'Current Game';
  const save = (updated: PersonalQuest[]) => { setQuests(updated); onUpdateQuests(updated); };

  const handleAddQuest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuestTitle.trim()) return;
    const newQuest: PersonalQuest = {
      id: `quest-${Date.now()}`,
      title: newQuestTitle.trim(),
      completed: false,
      createdAt: Date.now()
    };
    save([...quests, newQuest]);
    setNewQuestTitle('');
    playBlipSound(soundEnabled);
  };

  const handleRemoveQuest = (quest: PersonalQuest) => {
    save(quests.filter(q => q.id !== quest.id));
    playBlipSound(soundEnabled);
    setRemoved({ quest, at: quests.findIndex(q => q.id === quest.id) });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setRemoved(null), 6000);
  };
  const handleUndo = () => {
    if (!removed) return;
    const next = [...quests];
    next.splice(Math.min(removed.at, next.length), 0, removed.quest);
    save(next);
    setRemoved(null);
  };

  const shown = quests.filter(q => !q.completed).sort((a, b) => b.createdAt - a.createdAt);

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
              <h3 className="font-fantasy font-bold text-lg tracking-wider text-white">PERSONAL QUESTS</h3>
              <p className="text-xs text-zinc-400 font-mono">{gameName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quests */}
        <div className="flex-1 overflow-y-auto p-5">
          {shown.length === 0 ? (
            <div className="text-center py-8 px-4 border border-dashed border-white/10 rounded-xl bg-white/[0.02]">
              <Target className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
              <p className="text-sm text-zinc-400 font-medium">No quests yet.</p>
              <p className="text-xs text-zinc-500 mt-1">Add a goal of your own. Remove it with its ✕ when it's done.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {shown.map(quest => (
                <div
                  key={quest.id}
                  data-qc-personal-quest={quest.id}
                  className="group flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] transition-colors"
                >
                  <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400/80" aria-hidden="true" />
                  <span className="flex-1 min-w-0 text-sm text-zinc-200 font-medium">{quest.title}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveQuest(quest)}
                    title="Remove"
                    aria-label={`Remove: ${quest.title}`}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {removed && (
          <div role="status" className="flex items-center gap-3 px-5 py-2 border-t border-white/[0.08] bg-[#14141c] text-[12.5px] text-zinc-300">
            <span className="flex-1 min-w-0 truncate">Removed: {removed.quest.title}</span>
            <button type="button" onClick={handleUndo} className="font-semibold text-[var(--accent-color)] hover:brightness-125 cursor-pointer">Undo</button>
          </div>
        )}

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
                placeholder="Add a quest of your own..."
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
