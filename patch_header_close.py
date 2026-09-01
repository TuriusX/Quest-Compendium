import re
with open('src/components/HeaderBar.tsx', 'r') as f:
    code = f.read()

old_font = '<Type className="w-4 h-4" />'
new_font = '<span className="font-bold font-serif text-[15px] leading-none px-0.5">Aa</span>'

if old_font in code:
    code = code.replace(old_font, new_font)

old_settings = """        <button
          style={{ WebkitAppRegion: "no-drag" } as any}
          onClick={() => {
            playBlipSound(soundEnabled);
            onOpenSettings();
          }}
          title="Compendium Settings (AI Persona, Gemini Voice, Theme)"
          className="p-2 rounded-xl text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/[0.06] transition-all cursor-pointer"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>"""

new_settings = """        <button
          style={{ WebkitAppRegion: "no-drag" } as any}
          onClick={() => {
            playBlipSound(soundEnabled);
            onOpenSettings();
          }}
          title="Compendium Settings (AI Persona, Gemini Voice, Theme)"
          className="p-2 rounded-xl text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/[0.06] transition-all cursor-pointer"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
        
        {/* Close Button */}
        <button
          style={{ WebkitAppRegion: "no-drag" } as any}
          onClick={() => {
            if ((window as any).electronAPI?.closeApp) {
              (window as any).electronAPI.closeApp();
            }
          }}
          title="Close Quest Compendium"
          className="p-2 rounded-xl text-zinc-400 hover:text-red-400 hover:bg-red-500/20 transition-all cursor-pointer ml-1"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>"""

if old_settings in code:
    code = code.replace(old_settings, new_settings)
    print("Patched HeaderBar.tsx")
else:
    print("Could not find old settings")

with open('src/components/HeaderBar.tsx', 'w') as f:
    f.write(code)

