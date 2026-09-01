import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

# Fix default Elden Ring notes
old_elden_notes = """        notes: `<h3>Elden Ring Quest Notes</h3>
<ul>
  <li>Ranni the Witch: Meet at Three Sisters tower after Caria Manor.</li>
  <li>Alexander Iron Fist: Stuck in cliffside near Saintsbridge.</li>
  <li>Margit Shackle: Purchase from Patches in Murkwater Cave.</li>
</ul>`"""

new_elden_notes = "        notes: ''"

if old_elden_notes in code:
    code = code.replace(old_elden_notes, new_elden_notes)

# Fix new tab notes
old_new_notes = "      notes: `<h3>${name} Notes</h3>\\n<p>Start recording playthrough tips here...</p>`,"
new_new_notes = "      notes: '',"

if old_new_notes in code:
    code = code.replace(old_new_notes, new_new_notes)
    
with open('src/App.tsx', 'w') as f:
    f.write(code)

print("Patched App.tsx default notes")
