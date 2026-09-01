import re
with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

code = code.replace("onClick={(e) => handleStartRename(tab, e)}", "onClick={(e) => { e.stopPropagation(); onStartRenameTab(tab.id, tab.name); }}")

with open('src/components/GamesSidebar.tsx', 'w') as f:
    f.write(code)
print("Patched GamesSidebar rename button")
