import re

with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

# For the create input
code = code.replace(
    'className="w-full bg-black/90 border border-white/20 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-[var(--accent-color)] font-sans"',
    'className="w-full bg-black/90 border border-white/20 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-[var(--accent-color)] font-sans select-text"\n              style={{ WebkitAppRegion: \'no-drag\' } as any}'
)

# For the edit input
code = code.replace(
    'onKeyDown={(e) => {\n                      if (e.key === \'Enter\') handleSaveRename(tab.id);\n                      if (e.key === \'Escape\') setEditingTabId(null);\n                    }}\n                    className="w-full bg-black/90 border border-white/20 rounded px-2 py-1 text-[11px] text-white outline-none"',
    'onKeyDown={(e) => {\n                      if (e.key === \'Enter\') handleSaveRename(tab.id);\n                      if (e.key === \'Escape\') setEditingTabId(null);\n                    }}\n                    className="w-full bg-black/90 border border-white/20 rounded px-2 py-1 text-[11px] text-white outline-none select-text"\n                    style={{ WebkitAppRegion: \'no-drag\' } as any}'
)

with open('src/components/GamesSidebar.tsx', 'w') as f:
    f.write(code)

