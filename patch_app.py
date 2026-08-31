with open('src/App.tsx', 'r') as f:
    code = f.read()

# Pass openAiApiKey to ChatArea
code = code.replace(
    "customApiKey={settings.customApiKey}",
    "customApiKey={settings.customApiKey}\n                openAiApiKey={settings.openAiApiKey}"
)

# Also remove the little div from the edge slide tab
bad_div = '<div className="w-1 h-8 rounded-full bg-black/40" />'
code = code.replace(bad_div, '')

with open('src/App.tsx', 'w') as f:
    f.write(code)

