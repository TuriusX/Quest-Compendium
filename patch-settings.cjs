const fs = require('fs');
let code = fs.readFileSync('src/components/SettingsModal.tsx', 'utf-8');

const oldCode = `                {/* Voice Profile */}`;

const newCode = `                {/* Language Settings */}
                <div className="space-y-2.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-[var(--accent-color)]" />
                    <span>AI Language</span>
                  </label>
                  <select
                    value={settings.language || 'English'}
                    onChange={(e) => {
                      playBlipSound(soundEnabled);
                      onUpdateSettings({ language: e.target.value });
                    }}
                    className="w-full bg-black/60 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-[var(--accent-border)] cursor-pointer"
                  >
                    {[
                      'English', 'Spanish', 'French', 'German', 'Italian',
                      'Japanese', 'Korean', 'Chinese (Simplified)', 'Chinese (Traditional)',
                      'Portuguese', 'Russian', 'Arabic', 'Hindi'
                    ].map((lang) => (
                      <option key={lang} value={lang} className="bg-zinc-900 text-white">
                        {lang}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Voice Profile */}`;

if (code.includes(oldCode)) {
  code = code.replace(oldCode, newCode);
  fs.writeFileSync('src/components/SettingsModal.tsx', code);
  console.log("Successfully updated SettingsModal.tsx");
} else {
  console.log("Could not find the target code string to replace in SettingsModal.tsx");
}
