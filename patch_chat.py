import re

with open('src/App.tsx', 'r') as f:
    code = f.read()

code = code.replace(
    '<ChatArea\\n                activeTab={activeTab}',
    '<ChatArea\\n                activeTab={activeTab}\\n                steamName={settings.steamName}\\n                steamAvatar={settings.steamAvatar}'
)
code = code.replace(
    '<ChatArea\n                activeTab={activeTab}',
    '<ChatArea\n                activeTab={activeTab}\n                steamName={settings.steamName}\n                steamAvatar={settings.steamAvatar}'
)

with open('src/App.tsx', 'w') as f:
    f.write(code)

with open('src/components/ChatArea.tsx', 'r') as f:
    code2 = f.read()

# Replace props interface
code2 = code2.replace(
    '  ttsVoice: string;\n  customApiKey?: string;\n}',
    '  ttsVoice: string;\n  customApiKey?: string;\n  steamName?: string;\n  steamAvatar?: string;\n}'
)

# Replace component args
code2 = code2.replace(
    '  onOpenScreenModal,\n  ttsVoice,\n  customApiKey\n}) => {',
    '  onOpenScreenModal,\n  ttsVoice,\n  customApiKey,\n  steamName,\n  steamAvatar\n}) => {'
)

# Replace the PLAYER / Avatar renderer
old_player_block = """                    <>
                      <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="font-semibold text-zinc-300">PLAYER</span>
                      <div className="w-5 h-5 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-zinc-300">
                        <User className="w-3 h-3" />
                      </div>
                    </>"""

new_player_block = """                    <>
                      <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="font-semibold text-zinc-300 uppercase">{steamName || 'PLAYER'}</span>
                      {steamAvatar ? (
                        <img src={steamAvatar} alt="Avatar" className="w-5 h-5 rounded-full border border-white/20" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-zinc-300">
                          <User className="w-3 h-3" />
                        </div>
                      )}
                    </>"""

code2 = code2.replace(old_player_block, new_player_block)

with open('src/components/ChatArea.tsx', 'w') as f:
    f.write(code2)

