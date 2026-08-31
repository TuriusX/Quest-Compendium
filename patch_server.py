import re
with open('server.ts', 'r') as f:
    code = f.read()

code = code.replace(
    "const { text, voice = 'Kore', customApiKey } = req.body;",
    "const { text, voice = 'Kore', openAiApiKey } = req.body;"
)

code = code.replace(
    "const apiKey = process.env.OPENAI_API_KEY;",
    "const apiKey = openAiApiKey || process.env.OPENAI_API_KEY;"
)

with open('server.ts', 'w') as f:
    f.write(code)

