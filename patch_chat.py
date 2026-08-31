import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

old_loading = re.search(r'\{isLoading && \(\s*<div className="flex items-center gap-3\.5 p-4 rounded-2xl bg-\[\#11121a\]/95 border border-\[var\(--accent-border\)\].*?Synthesizing game vision frames, stat scaling \& insightful guidance\s*</span>\s*</div>\s*</div>\s*\)\}', code, re.DOTALL)
if old_loading:
    print("Found old loading block")
    new_loading = """        {isLoading && (
          <div className="flex items-center gap-3 px-4 py-3 ml-4 mb-4 rounded-2xl bg-[#11121a]/95 border border-[var(--accent-border)] w-fit shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
            <div className="w-5 h-5 shrink-0 flex items-center justify-center animate-magical-flip">
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 4C6 2.89543 6.89543 2 8 2H22C23.1046 2 24 2.89543 24 4V28C24 29.1046 23.1046 30 22 30H8C6.89543 30 6 29.1046 6 28V4Z" fill="#140d24" />
                <path d="M6 4C6 2.89543 6.89543 2 8 2H10V30H8C6.89543 30 6 29.1046 6 28V4Z" fill="#d9cdb4" />
                <rect x="5" y="28" width="24" height="2" fill="#050508" opacity="0.7"/>
                <rect x="24" y="6" width="4" height="20" fill="#d9cdb4" />
                <rect x="8" y="4" width="16" height="24" fill="#140d24" />
                <rect x="15" y="12" width="2" height="8" fill="var(--accent-color)" />
                <rect x="13" y="14" width="6" height="4" fill="var(--accent-color)" />
                <rect x="14" y="14" width="4" height="4" fill="var(--accent-glow)" />
              </svg>
            </div>
            <span className="font-fantasy font-bold text-xs text-[var(--accent-color)] tracking-wide animate-pulse mt-1">
              Consulting the Quest Compendium...
            </span>
          </div>
        )}"""
    code = code[:old_loading.start()] + new_loading + code[old_loading.end():]
else:
    print("Could not find old loading block")

with open('src/components/ChatArea.tsx', 'w') as f:
    f.write(code)

