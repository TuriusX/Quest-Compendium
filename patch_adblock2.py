import re
with open('electron/main.cjs', 'r') as f:
    code = f.read()

code = code.replace("blocker.enableBlockingInSession(session.defaultSession);", "// blocker.enableBlockingInSession(session.defaultSession); // Removed to prevent double IPC registration crash")

with open('electron/main.cjs', 'w') as f:
    f.write(code)
print("Patched main.cjs")
