import re
with open('server.ts', 'r') as f:
    code = f.read()

code = code.replace(
    ".slice(0, 1000); // Reasonable single utterance limit",
    ".slice(0, 4000); // OpenAI limit is 4096"
)

with open('server.ts', 'w') as f:
    f.write(code)

