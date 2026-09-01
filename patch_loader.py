import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

pattern = r'\{/\* Animated 3D Levitating Tome Loader \*/\}\s*\{isLoading && \(\s*<div className="flex items-center gap-3 px-4 py-3 ml-4 mb-4 rounded-2xl bg-\[\#11121a\]/95 border border-\[var\(--accent-border\)\] w-fit shadow-\[0_8px_30px_rgba\(0,0,0,0\.5\)\]">\s*<div className="w-5 h-5 shrink-0 flex items-center justify-center animate-magical-flip">'

new_code = """{/* Animated 3D Levitating Tome Loader */}
        {isLoading && (
          <div className="flex items-center gap-3 ml-4 mb-4 w-fit">
            <div className="w-5 h-5 shrink-0 flex items-center justify-center animate-magical-flip">"""

if re.search(pattern, code):
    code = re.sub(pattern, new_code, code)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched loader")
else:
    print("Could not find loader block")
