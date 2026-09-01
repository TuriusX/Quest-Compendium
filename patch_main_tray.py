import re

with open('electron/main.cjs', 'r') as f:
    code = f.read()

code = code.replace("book.bmp", "book.png")

with open('electron/main.cjs', 'w') as f:
    f.write(code)

print("Patched main.cjs to use book.png")
