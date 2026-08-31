import re
with open('src/types.ts', 'r') as f:
    code = f.read()
code = code.replace("  customApiKey?: string;", "  customApiKey?: string;\n  openAiApiKey?: string;")
with open('src/types.ts', 'w') as f:
    f.write(code)
