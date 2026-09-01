import re
with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

code = code.replace("  onCreateTab: (name: string) => void;\n  onRenameTab: (tabId: string, newName: string) => void;", "  onStartCreateTab: () => void;\n  onStartRenameTab: (tabId: string, currentName: string) => void;")

code = code.replace("""  onCreateTab,
  onRenameTab,""", """  onStartCreateTab,
  onStartRenameTab,""")

with open('src/components/GamesSidebar.tsx', 'w') as f:
    f.write(code)
print("Patched Props")
