import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

old_cond = "if (aiMode === 'immersive' && !image) {"
new_cond = "if (!image) {"

if old_cond in code:
    code = code.replace(old_cond, new_cond)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched successfully")
else:
    print("Could not find block to patch")
