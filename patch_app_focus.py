import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

pattern = re.compile(r'\s*// Global focus fix for Electron webview stealing focus\s*useEffect\(\(\) => \{.*?\},\s*\[\]\);', re.DOTALL)
if pattern.search(code):
    code = pattern.sub('', code)
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print("Patched App.tsx focus hack")
else:
    print("Could not find focus hack")
