with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

code = code.replace(
    "customApiKey?: string;",
    "customApiKey?: string;\n  openAiApiKey?: string;"
)

code = code.replace(
    "  customApiKey,",
    "  customApiKey,\n  openAiApiKey,"
)

code = code.replace(
    "body: JSON.stringify({ text, voice: ttsVoice || 'Kore', customApiKey }),",
    "body: JSON.stringify({ text, voice: ttsVoice || 'Kore', customApiKey, openAiApiKey }),"
)

with open('src/components/ChatArea.tsx', 'w') as f:
    f.write(code)

