import re

with open('src/components/HeaderBar.tsx', 'r') as f:
    code = f.read()

# Replace the giant button wrapping both icon and text with separate elements.
old_structure_start = """        <button
          style={{ WebkitAppRegion: "no-drag" } as any}
          onClick={() => {
            playPageTurnSound(soundEnabled);
            onToggleSidebar();
          }}
          title={isSidebarOpen ? "Collapse Games Library" : "Expand Games Library"}
          className="group flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-white/[0.06] border border-transparent hover:border-white/10 transition-all cursor-pointer"
        >"""

old_structure_end = """          </div>
        </button>"""

# We'll regex out the entire block and replace it.
pattern = r'<button[^>]+style={{ WebkitAppRegion: "no-drag" } as any}[^>]+onClick={\(\) => \{[^}]+\}\}[^>]+title={isSidebarOpen[^>]+className="group flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-white/\[0.06\] border border-transparent hover:border-white/10 transition-all cursor-pointer"[^>]*>.*?<div className="relative flex-shrink-0">.*?<svg.*?</svg>\s*</div>\s*<div className="flex flex-col text-left">.*?</div>\s*</button>'

# Actually, it's easier to just do string replacements since we know the exact text.
import sys

# Step 1: Read lines, manually parse and rebuild
lines = code.split('\n')
new_lines = []
in_left_side = False
i = 0
while i < len(lines):
    line = lines[i]
    if "<!-- Left side: Brand Logo" in line or "{/* Left side: Brand Logo + Game Library Toggle */}" in line:
        new_lines.append(line)
        new_lines.append('      <div className="flex items-center gap-2.5 sm:gap-3">')
        new_lines.append('        <button')
        new_lines.append('          style={{ WebkitAppRegion: "no-drag" } as any}')
        new_lines.append('          onClick={() => {')
        new_lines.append('            playPageTurnSound(soundEnabled);')
        new_lines.append('            onToggleSidebar();')
        new_lines.append('          }}')
        new_lines.append('          title={isSidebarOpen ? "Collapse Games Library" : "Expand Games Library"}')
        new_lines.append('          className="group relative flex items-center justify-center p-2 rounded-xl hover:bg-white/[0.06] border border-transparent hover:border-white/10 transition-all cursor-pointer"')
        new_lines.append('        >')
        new_lines.append('          {/* Magical Aura */}')
        new_lines.append('          <div className="absolute inset-0 rounded-xl bg-[var(--accent-glow)] blur-md opacity-40 group-hover:opacity-80 animate-pulse transition-opacity" />')
        new_lines.append('          ')
        new_lines.append('          <div className="relative flex-shrink-0 z-10">')
        new_lines.append('            <svg')
        new_lines.append('               width="28"')
        new_lines.append('               height="28"')
        new_lines.append('               viewBox="0 0 32 32"')
        new_lines.append('               fill="none"')
        new_lines.append('               className="drop-shadow-[0_0_10px_var(--accent-glow)] group-hover:scale-105 transition-transform"')
        new_lines.append('            >')
        new_lines.append('              <rect x="5" y="28" width="24" height="2" fill="#050508" opacity="0.7"/>')
        new_lines.append('              <rect x="24" y="6" width="4" height="20" fill="#d9cdb4" />')
        new_lines.append('              <rect x="25" y="6" width="1" height="20" fill="#b3a58b" />')
        new_lines.append('              <rect x="27" y="6" width="1" height="20" fill="#b3a58b" />')
        new_lines.append('              <rect x="28" y="5" width="1" height="22" fill="#0d0817" />')
        new_lines.append('              <rect x="8" y="4" width="16" height="24" fill="#140d24" />')
        new_lines.append('              <rect x="4" y="4" width="4" height="24" fill="#0d0817" />')
        new_lines.append('              <rect x="6" y="4" width="1" height="24" fill="#241a38" />')
        new_lines.append('              <rect x="8" y="4" width="4" height="2" fill="#e5b838" />')
        new_lines.append('              <rect x="8" y="6" width="2" height="2" fill="#e5b838" />')
        new_lines.append('              <rect x="20" y="4" width="4" height="2" fill="#e5b838" />')
        new_lines.append('              <rect x="22" y="6" width="2" height="2" fill="#e5b838" />')
        new_lines.append('              <rect x="8" y="26" width="4" height="2" fill="#e5b838" />')
        new_lines.append('              <rect x="8" y="24" width="2" height="2" fill="#e5b838" />')
        new_lines.append('              <rect x="20" y="26" width="4" height="2" fill="#e5b838" />')
        new_lines.append('              <rect x="22" y="24" width="2" height="2" fill="#e5b838" />')
        new_lines.append('              <rect x="3" y="7" width="5" height="2" fill="#a07d1c" />')
        new_lines.append('              <rect x="3" y="23" width="5" height="2" fill="#a07d1c" />')
        new_lines.append('              <rect x="15" y="12" width="2" height="8" fill="var(--accent-color)" />')
        new_lines.append('              <rect x="13" y="14" width="6" height="4" fill="var(--accent-color)" />')
        new_lines.append('              <rect x="14" y="13" width="4" height="6" fill="var(--accent-color)" />')
        new_lines.append('              <rect x="14" y="14" width="4" height="4" fill="var(--accent-glow)" />')
        new_lines.append('              <rect x="15" y="15" width="2" height="2" fill="#ffffff" />')
        new_lines.append('            </svg>')
        new_lines.append('          </div>')
        new_lines.append('        </button>')
        new_lines.append('        ')
        new_lines.append('        <div className="flex flex-col text-left py-1">')
        new_lines.append('          <div className="flex items-center gap-1.5">')
        new_lines.append('            <span className="font-fantasy font-bold text-sm tracking-wider text-white">')
        new_lines.append('              QUEST COMPENDIUM')
        new_lines.append('            </span>')
        new_lines.append('            <span className="hidden xl:inline-block px-1.5 py-0.2 rounded text-[10px] font-pixel bg-[var(--accent-dim)] text-[var(--accent-color)] border border-[var(--accent-border)]">')
        new_lines.append('              AI HUD')
        new_lines.append('            </span>')
        new_lines.append('          </div>')
        new_lines.append('          <span className="flex items-center gap-1 text-[10px] text-zinc-400 font-mono uppercase overflow-hidden whitespace-nowrap text-ellipsis max-w-[180px]">')
        new_lines.append('            <span className={`w-1.5 h-1.5 flex-shrink-0 rounded-full ${isGameRunningLocally ? \'bg-emerald-400 animate-pulse\' : \'bg-red-500\'}`} />')
        new_lines.append('            <span className="truncate">{isGameRunningLocally ? `ACTIVE: ${activeGame?.name}` : \'NO ACTIVE STEAM GAME\'}</span>')
        new_lines.append('          </span>')
        new_lines.append('        </div>')
        new_lines.append('      </div>')
        
        # skip over the old structure
        while "{/* Right Controls Toolbar */}" not in lines[i]:
            i += 1
        new_lines.append(lines[i]) # add Right controls comment
    else:
        new_lines.append(line)
    i += 1

with open('src/components/HeaderBar.tsx', 'w') as f:
    f.write('\n'.join(new_lines))

