with open('src/App.tsx', 'r') as f:
    code = f.read()

code = code.replace(
    'text: `Welcome to **${name}**! The Compendium is ready to analyze your screen, track achievements, and guide your quest.`,',
    'text: `A new session has begun! The Compendium is ready to analyze your screen, track achievements, and guide your quest.`,')

with open('src/App.tsx', 'w') as f:
    f.write(code)

