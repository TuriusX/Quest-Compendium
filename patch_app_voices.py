import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

code = code.replace(
    "ttsVoice: 'Kore',",
    "ttsVoice: 'nova',"
)

with open('src/App.tsx', 'w') as f:
    f.write(code)

