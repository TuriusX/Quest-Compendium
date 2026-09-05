const fs = require('fs');
let code = fs.readFileSync('src/components/ChatArea.tsx', 'utf8');

const regex = /<span className="font-semibold text-zinc-300 uppercase">PLAYER<\/span>\n\s*<div className="w-5 h-5 rounded-full bg-white\/10 border border-white\/20 flex items-center justify-center text-zinc-300">\n\s*<User className="w-3 h-3" \/>\n\s*<\/div>\n\s*<\/>\n\s*\)}/;

const replacement = `<span className="font-semibold text-zinc-300 uppercase">PLAYER</span>
                      <div className="w-5 h-5 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-zinc-300">
                        <User className="w-3 h-3" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-5 h-5 rounded-md bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent-color)]">
                        <Sparkles className="w-3 h-3" />
                      </div>
                      <span className="font-fantasy font-bold text-zinc-200">QUEST COMPENDIUM</span>
                      <span className="px-1.5 py-0.2 rounded bg-white/10 text-[9.5px] text-zinc-400">
                        {msg.modelUsed || 'GEMINI'}
                      </span>
                    </>
                  )}`;
code = code.replace(regex, replacement);
fs.writeFileSync('src/components/ChatArea.tsx', code);
