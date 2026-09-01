import re
with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

code = code.replace("autoFocus\\n                    className=\"w-full", "className=\"w-full")
code = code.replace("autoFocus\\n              className=\"w-full", "className=\"w-full")

with open('src/components/GamesSidebar.tsx', 'w') as f:
    f.write(code)
print("Patched autoFocus")
