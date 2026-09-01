import re
with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

old_code = '<Sliders className="w-3.5 h-3.5" />'
new_code = '<span className="font-bold font-serif text-[15px] leading-none px-0.5">Aa</span>'

if old_code in code:
    code = code.replace(old_code, new_code)
    with open('src/components/GamesSidebar.tsx', 'w') as f:
        f.write(code)
    print("Patched GamesSidebar.tsx Aa button")
else:
    print("Could not find Sliders icon")
