import re
with open('server.ts', 'r') as f:
    code = f.read()

old_append = """      currentParts.push({ text: promptText });
      contentsPayload.push({ role: 'user', parts: currentParts });"""

new_append = """      currentParts.push({ text: promptText });
      if (contentsPayload.length > 0 && contentsPayload[contentsPayload.length - 1].role === 'user') {
          contentsPayload[contentsPayload.length - 1].parts.push(...currentParts);
      } else {
          contentsPayload.push({ role: 'user', parts: currentParts });
      }"""

if old_append in code:
    code = code.replace(old_append, new_append)
    with open('server.ts', 'w') as f:
        f.write(code)
    print("Patched server append successfully")
else:
    print("Could not find server append to patch")
