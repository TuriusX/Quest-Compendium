import re
with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

# Replace the states and refs
old_states = """  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newGameName, setNewGameName] = useState('');
  
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (isCreating && createInputRef.current) {
      if ((window as any).electronAPI) {
        (window as any).electronAPI.forceFocus?.();
      }
      setTimeout(() => {
        createInputRef.current?.focus();
        createInputRef.current?.select();
      }, 50);
    }
  }, [isCreating]);

  useEffect(() => {
    if (editingTabId && renameInputRef.current) {
      if ((window as any).electronAPI) {
        (window as any).electronAPI.forceFocus?.();
      }
      setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 50);
    }
  }, [editingTabId]);

  const [showFontControl, setShowFontControl] = useState(false);

  const handleStartRename = (tab: GameTab, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingTabId(tab.id);
    setEditName(tab.name);
  };

  const handleSaveRename = (tabId: string) => {
    if (editName.trim()) {
      onRenameTab(tabId, editName.trim());
    }
    setEditingTabId(null);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newGameName.trim()) {
      onCreateTab(newGameName.trim());
      setNewGameName('');
      setIsCreating(false);
      playPageTurnSound(soundEnabled);
    }
  };"""

new_states = """  const [showFontControl, setShowFontControl] = useState(false);"""
code = code.replace(old_states, new_states)

# Replace the map variables
old_map_vars = """        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isEditing = tab.id === editingTabId;
          const game = tab.activeSteamGame;
          const achievements = game?.achievements || [];
          const unlockedCount = achievements.filter(a => a.unlocked).length;
          const totalCount = achievements.length;
          const progressPercent = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

          return (
            <div
              key={tab.id}
              onClick={() => {
                if (!isEditing) {
                  playBlipSound(soundEnabled);
                  onSelectTab(tab.id);
                }
              }}"""

new_map_vars = """        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const game = tab.activeSteamGame;
          const achievements = game?.achievements || [];
          const unlockedCount = achievements.filter(a => a.unlocked).length;
          const totalCount = achievements.length;
          const progressPercent = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

          return (
            <div
              key={tab.id}
              onClick={() => {
                  playBlipSound(soundEnabled);
                  onSelectTab(tab.id);
              }}"""
code = code.replace(old_map_vars, new_map_vars)

# Replace the inline input with just the text
old_inline = """              {isEditing ? (
                <div className="flex items-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={isEditing ? renameInputRef : null}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(tab.id);
                      if (e.key === 'Escape') setEditingTabId(null);
                    }}
                    className="w-full bg-black/90 border border-[var(--accent-color)] rounded-lg px-2.5 py-1 text-white text-xs outline-none font-sans select-text"
                    style={{ WebkitAppRegion: 'no-drag' } as any}
                  />
                  <button
                    onClick={() => handleSaveRename(tab.id)}
                    className="p-1 rounded-md bg-[var(--accent-color)] text-black hover:opacity-90 cursor-pointer"
                    title="Save"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setEditingTabId(null)}
                    className="p-1 rounded-md bg-white/10 text-zinc-400 hover:text-white cursor-pointer"
                    title="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between w-full min-w-0 gap-2">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span 
                          className="font-fantasy font-bold tracking-wide truncate text-white"
                          style={{ fontSize: `${tabFontSize}px` }}
                        >
                          {tab.name}
                        </span>
                      </div>
                    </div>
                    {/* Action buttons on hover */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={(e) => handleStartRename(tab, e)}
                        className="p-1 rounded-md hover:bg-white/20 text-zinc-400 hover:text-white cursor-pointer"
                        title="Rename Game"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      {true && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete game session "${tab.name}"?`)) {
                              onDeleteTab(tab.id);
                            }
                          }}
                          className="p-1 rounded-md hover:bg-red-500/20 text-zinc-400 hover:text-red-400 cursor-pointer"
                          title="Delete Game Session"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {game && (
                    <div className="flex items-center justify-between w-full mt-1.5">
                      <span className="text-[10px] text-zinc-500 font-mono truncate mr-2">
                        {game.name}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--accent-color)] font-bold">
                        <Trophy className="w-3 h-3" />
                        {progressPercent}%
                      </span>
                    </div>
                  )}
                </>
              )}"""

new_inline = """                  <div className="flex items-start justify-between w-full min-w-0 gap-2">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span 
                          className="font-fantasy font-bold tracking-wide truncate text-white"
                          style={{ fontSize: `${tabFontSize}px` }}
                        >
                          {tab.name}
                        </span>
                      </div>
                    </div>
                    {/* Action buttons on hover */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); onStartRenameTab(tab.id, tab.name); }}
                        className="p-1 rounded-md hover:bg-white/20 text-zinc-400 hover:text-white cursor-pointer"
                        title="Rename Game"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      {true && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete game session "${tab.name}"?`)) {
                              onDeleteTab(tab.id);
                            }
                          }}
                          className="p-1 rounded-md hover:bg-red-500/20 text-zinc-400 hover:text-red-400 cursor-pointer"
                          title="Delete Game Session"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {game && (
                    <div className="flex items-center justify-between w-full mt-1.5">
                      <span className="text-[10px] text-zinc-500 font-mono truncate mr-2">
                        {game.name}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--accent-color)] font-bold">
                        <Trophy className="w-3 h-3" />
                        {progressPercent}%
                      </span>
                    </div>
                  )}"""

code = code.replace(old_inline, new_inline)

# Replace the create form
old_create = """        {/* Add New Game Form / Button */}
        {isCreating ? (
          <form onSubmit={handleCreateSubmit} className="p-3 rounded-xl bg-black/60 border border-[var(--accent-border)] space-y-2.5 shadow-lg">
            <div className="flex items-center gap-1.5 text-xs text-zinc-300 font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-[var(--accent-color)]" />
              <span>Create New Compendium</span>
            </div>
            <input
              ref={createInputRef}
              type="text"
              placeholder="e.g. Elden Ring, Skyrim, Hades..."
              value={newGameName}
              onChange={(e) => setNewGameName(e.target.value)}
              className="w-full bg-black/90 border border-white/20 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-[var(--accent-color)] font-sans select-text"
              style={{ WebkitAppRegion: 'no-drag' } as any}
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-2.5 py-1 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-2.5 py-1 rounded-lg text-xs bg-[var(--accent-color)] text-black font-semibold hover:opacity-90 cursor-pointer"
              >
                Create
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => {
              playBlipSound(soundEnabled);
              setIsCreating(true);
            }}
            className="w-full py-2.5 px-3 rounded-xl border border-dashed border-white/15 text-zinc-400 hover:text-[var(--accent-color)] hover:border-[var(--accent-border)] hover:bg-[var(--accent-dim)] transition-all flex items-center justify-center gap-2 text-xs font-semibold cursor-pointer group"
          >
            <Plus className="w-3.5 h-3.5 group-hover:scale-125 transition-transform" />
            <span>+ Add New Compendium</span>
          </button>
        )}"""

new_create = """        {/* Add New Game Form / Button */}
        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onStartCreateTab();
          }}
          className="w-full py-2.5 px-3 rounded-xl border border-dashed border-white/15 text-zinc-400 hover:text-[var(--accent-color)] hover:border-[var(--accent-border)] hover:bg-[var(--accent-dim)] transition-all flex items-center justify-center gap-2 text-xs font-semibold cursor-pointer group"
        >
          <Plus className="w-3.5 h-3.5 group-hover:scale-125 transition-transform" />
          <span>+ Add New Compendium</span>
        </button>"""

code = code.replace(old_create, new_create)

with open('src/components/GamesSidebar.tsx', 'w') as f:
    f.write(code)
print("Patched GamesSidebar internals")
