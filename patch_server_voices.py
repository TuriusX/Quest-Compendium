import re
with open('server.ts', 'r') as f:
    code = f.read()

code = code.replace(
    "const { text, voice = 'Kore', openAiApiKey } = req.body;",
    "const { text, voice = 'nova', openAiApiKey } = req.body;"
)

old_voice_map = """      const voiceMap: Record<string, string> = {
        'Kore': 'nova',
        'Puck': 'shimmer',
        'Fenrir': 'onyx',
        'Zephyr': 'alloy',
        'Charon': 'echo'
      };
      
      const openaiVoice = voiceMap[voice] || 'nova';"""

new_voice_map = """      // voice is now passed directly as the OpenAI voice name (e.g., 'fable', 'onyx')
      const openaiVoice = voice || 'nova';"""

code = code.replace(old_voice_map, new_voice_map)

with open('server.ts', 'w') as f:
    f.write(code)

