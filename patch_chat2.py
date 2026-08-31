import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

code = code.replace(
    '  customApiKey,\n}) => {',
    '  customApiKey,\n  steamName,\n  steamAvatar,\n}) => {'
)

with open('src/components/ChatArea.tsx', 'w') as f:
    f.write(code)
