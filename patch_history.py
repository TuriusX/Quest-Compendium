import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

old_fetch = """        body: JSON.stringify({
          question: text,
          history: updatedMessages,
          imageBase64,"""
new_fetch = """        body: JSON.stringify({
          question: text,
          history: activeTab.messages,
          imageBase64,"""

if old_fetch in code:
    code = code.replace(old_fetch, new_fetch)
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print("Patched history successfully")
else:
    print("Could not find block to patch")
