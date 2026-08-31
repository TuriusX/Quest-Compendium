with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

code = code.replace(
    'SAVED GAME TOMES',
    'SAVED GAMES')

with open('src/components/GamesSidebar.tsx', 'w') as f:
    f.write(code)

