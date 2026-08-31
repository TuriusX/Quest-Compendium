with open('src/components/SettingsModal.tsx', 'r') as f:
    code = f.read()

old_key = """          {/* Custom API Key */}
          <div className="space-y-2.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Key className="w-4 h-4 text-[var(--accent-color)]" />
              <span>Bring Your Own Gemini API Key (Required)</span>
            </label>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={settings.customApiKey || ''}
              onChange={(e) => {
                onUpdateSettings({ customApiKey: e.target.value });
              }}
              className="w-full bg-black/60 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-[var(--accent-border)] font-mono"
            />
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              This API key is required to use the Compendium. Your key is stored locally in your browser and sent securely to the server during queries.
            </p>
          </div>"""

new_key = """          {/* Custom API Key */}
          <div className="space-y-2.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Key className="w-4 h-4 text-[var(--accent-color)]" />
              <span>Bring Your Own Gemini API Key (Required)</span>
            </label>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={settings.customApiKey || ''}
              onChange={(e) => {
                onUpdateSettings({ customApiKey: e.target.value });
              }}
              className="w-full bg-black/60 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-[var(--accent-border)] font-mono"
            />
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              This API key is required to use the Compendium. Your key is stored locally in your browser and sent securely to the server during queries.
            </p>
          </div>
          
          <div className="space-y-2.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Key className="w-4 h-4 text-[var(--accent-color)]" />
              <span>Bring Your Own OpenAI API Key (For TTS)</span>
            </label>
            <input
              type="password"
              placeholder="sk-proj-..."
              value={settings.openAiApiKey || ''}
              onChange={(e) => {
                onUpdateSettings({ openAiApiKey: e.target.value });
              }}
              className="w-full bg-black/60 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-[var(--accent-border)] font-mono"
            />
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              This API key is required to use the voice playback feature. Your key is stored locally in your browser and sent securely to the server during TTS requests.
            </p>
          </div>"""

code = code.replace(old_key, new_key)

with open('src/components/SettingsModal.tsx', 'w') as f:
    f.write(code)

