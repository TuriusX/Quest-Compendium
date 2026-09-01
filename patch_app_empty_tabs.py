import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

pattern = re.compile(r'  const \[tabs, setTabs\] = useState<GameTab\[\]>\(\(\) => \{.*?\n    \];\n  \}\);', re.DOTALL)
new_tabs_init = """  const [tabs, setTabs] = useState<GameTab[]>(() => {
    try {
      const saved = localStorage.getItem('quest_compendium_tabs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });"""

if pattern.search(code):
    code = pattern.sub(new_tabs_init, code)
    
    old_active = """  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return tabs[0]?.id || 'tab-1';
  });"""
    new_active = """  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return tabs[0]?.id || '';
  });"""
    code = code.replace(old_active, new_active)
    
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print("Patched App.tsx empty tabs")
else:
    print("Could not find tabs init")
