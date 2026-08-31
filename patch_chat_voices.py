import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

code = code.replace(
    "voice: ttsVoice || 'Kore',",
    "voice: ttsVoice || 'nova',"
)

with open('src/components/ChatArea.tsx', 'w') as f:
    f.write(code)

