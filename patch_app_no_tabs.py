import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

old_render = """            {isBrowserMode ? (
              <GameGuidesBrowser
                activeGame={activeGame}
                soundEnabled={settings.soundEnabled}
              />
            ) : (
              <ChatArea"""

new_render = """            {isBrowserMode ? (
              <GameGuidesBrowser
                activeGame={activeGame}
                soundEnabled={settings.soundEnabled}
              />
            ) : tabs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center bg-[#07070b] crt-grid">
                 <div className="text-zinc-500 text-center space-y-4 p-6 bg-black/40 border border-white/5 rounded-2xl shadow-xl backdrop-blur-sm max-w-md">
                   <p className="text-2xl font-fantasy text-[var(--accent-color)]">No Compendium Active</p>
                   <p className="text-sm">Click "+ Add New Compendium" in the sidebar to start a new session.</p>
                 </div>
              </div>
            ) : (
              <ChatArea"""

if old_render in code:
    code = code.replace(old_render, new_render)
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print("Patched App.tsx no tabs view")
else:
    print("Could not find old_render")
