import re

with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

# 1. Remove "Custom Compendium"
old_span = """                        <span className="text-[10px] text-zinc-400 truncate">\n                          {game?.genre || 'Custom Compendium'}\n                        </span>"""
code = code.replace(old_span, "")

# 2. Add inputRef and useEffect
old_imports = "import React, { useState } from 'react';"
new_imports = "import React, { useState, useRef, useEffect } from 'react';"
code = code.replace(old_imports, new_imports)

old_state = "  const [isCreating, setIsCreating] = useState(false);\n  const [newGameName, setNewGameName] = useState('');"
new_state = """  const [isCreating, setIsCreating] = useState(false);
  const [newGameName, setNewGameName] = useState('');
  
  const createInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isCreating && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [isCreating]);
"""
code = code.replace(old_state, new_state)

old_input = """            <input
              type="text"
              placeholder="e.g. Elden Ring, Skyrim, Hades..."
              value={newGameName}
              onChange={(e) => setNewGameName(e.target.value)}
              autoFocus
              className="w-full bg-black/90 border border-white/20 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-[var(--accent-color)] font-sans select-text"
              style={{ WebkitAppRegion: 'no-drag' } as any}
            />"""
new_input = """            <input
              ref={createInputRef}
              type="text"
              placeholder="e.g. Elden Ring, Skyrim, Hades..."
              value={newGameName}
              onChange={(e) => setNewGameName(e.target.value)}
              autoFocus
              className="w-full bg-black/90 border border-white/20 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-[var(--accent-color)] font-sans select-text"
              style={{ WebkitAppRegion: 'no-drag' } as any}
            />"""
code = code.replace(old_input, new_input)

with open('src/components/GamesSidebar.tsx', 'w') as f:
    f.write(code)

