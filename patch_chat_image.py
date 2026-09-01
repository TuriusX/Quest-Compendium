import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

old_code = """                  {/* Screenshot Attachment Preview with Analysis Frame */}
                  {msg.imageUrl && (
                    <div className="mb-3 relative group overflow-hidden rounded-xl border border-white/20 bg-black/60">
                      <img
                        src={msg.imageUrl}
                        alt="Game Screenshot Analysis"
                        className="max-h-72 sm:max-h-96 w-auto rounded-xl object-contain cursor-pointer hover:scale-[1.01] transition-transform mx-auto"
                        onClick={() => onOpenScreenModal(msg.imageUrl!)}
                      />
                      <button
                        onClick={() => onOpenScreenModal(msg.imageUrl!)}
                        className="absolute bottom-2.5 right-2.5 px-3 py-1.5 rounded-lg bg-black/85 backdrop-blur-md text-xs font-mono text-white flex items-center gap-1.5 opacity-90 group-hover:opacity-100 hover:bg-black border border-white/20 shadow-lg cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5 text-[var(--accent-color)]" /> Full Resolution View
                      </button>
                    </div>
                  )}"""

new_code = """                  {/* Screenshot Attachment Preview with Analysis Frame */}
                  {msg.imageUrl && (
                    <div className="mb-2.5 flex items-center gap-2">
                      <button
                        onClick={() => onOpenScreenModal(msg.imageUrl!)}
                        title="View Screen Capture"
                        className="px-2.5 py-1.5 rounded-lg bg-black/40 hover:bg-black/80 border border-white/10 hover:border-[var(--accent-border)] flex items-center gap-2 text-xs font-mono text-zinc-300 hover:text-[var(--accent-color)] transition-all cursor-pointer shadow-sm group"
                      >
                        <Camera className="w-3.5 h-3.5 opacity-70 group-hover:opacity-100" />
                        <span>Screen Capture Attached</span>
                        <Eye className="w-3 h-3 ml-1 opacity-50 group-hover:opacity-100" />
                      </button>
                    </div>
                  )}"""

if old_code in code:
    code = code.replace(old_code, new_code)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched image preview successfully")
else:
    print("Could not find image preview block to patch")
