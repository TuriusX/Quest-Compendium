import re
with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

old_code = """        {isCreating ? (
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
                className="px-3.5 py-1 rounded-lg bg-[var(--accent-color)] text-black font-semibold text-xs hover:opacity-90 cursor-pointer shadow-sm"
              >
                Add Game
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

new_code = """        <button
          onClick={() => {
            playBlipSound(soundEnabled);
            onStartCreateTab();
          }}
          className="w-full py-2.5 px-3 rounded-xl border border-dashed border-white/15 text-zinc-400 hover:text-[var(--accent-color)] hover:border-[var(--accent-border)] hover:bg-[var(--accent-dim)] transition-all flex items-center justify-center gap-2 text-xs font-semibold cursor-pointer group"
        >
          <Plus className="w-3.5 h-3.5 group-hover:scale-125 transition-transform" />
          <span>+ Add New Compendium</span>
        </button>"""

if old_code in code:
    code = code.replace(old_code, new_code)
    with open('src/components/GamesSidebar.tsx', 'w') as f:
        f.write(code)
    print("Patched GamesSidebar form")
else:
    print("Could not find old code in GamesSidebar.tsx")
