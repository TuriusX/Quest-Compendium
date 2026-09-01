import re

with open('electron/main.cjs', 'r') as f:
    code = f.read()

if "process.noDeprecation = true;" not in code:
    code = "process.noDeprecation = true;\n" + code
    with open('electron/main.cjs', 'w') as f:
        f.write(code)
    print("Patched main.cjs to suppress deprecation warnings")
else:
    print("Already patched")
