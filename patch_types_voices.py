import re
with open('src/types.ts', 'r') as f:
    code = f.read()

code = code.replace(
    "ttsVoice: 'Kore' | 'Puck' | 'Fenrir' | 'Zephyr' | 'Charon';",
    "ttsVoice: 'alloy' | 'ash' | 'coral' | 'echo' | 'fable' | 'nova' | 'onyx' | 'sage' | 'shimmer';"
)

with open('src/types.ts', 'w') as f:
    f.write(code)

