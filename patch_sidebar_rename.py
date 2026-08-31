import re

with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

# Replace the edit input to have WebkitAppRegion: 'no-drag' and select-text
old_input = """                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(tab.id);
                      if (e.key === 'Escape') setEditingTabId(null);
                    }}
                    autoFocus
                    className="w-full bg-black/90 border border-[var(--accent-color)] rounded-lg px-2.5 py-1 text-white text-xs outline-none font-sans"
                  />"""

new_input = """                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(tab.id);
                      if (e.key === 'Escape') setEditingTabId(null);
                    }}
                    autoFocus
                    className="w-full bg-black/90 border border-[var(--accent-color)] rounded-lg px-2.5 py-1 text-white text-xs outline-none font-sans select-text"
                    style={{ WebkitAppRegion: 'no-drag' } as any}
                  />"""

code = code.replace(old_input, new_input)
with open('src/components/GamesSidebar.tsx', 'w') as f:
    f.write(code)

