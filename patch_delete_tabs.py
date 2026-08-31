import re

# In App.tsx
with open('src/App.tsx', 'r') as f:
    code = f.read()

# find handleDeleteTab
old_handle_delete = """  const handleDeleteTab = (tabId: string) => {
    const remaining = tabs.filter(t => t.id !== tabId);
    if (remaining.length === 0) {
      handleCreateTab('New Game');
      return;
    }
    setTabs(remaining);
    if (activeTabId === tabId) {
      setActiveTabId(remaining[0].id);
    }
  };"""

new_handle_delete = """  const handleDeleteTab = (tabId: string) => {
    const remaining = tabs.filter(t => t.id !== tabId);
    setTabs(remaining);
    if (activeTabId === tabId) {
      setActiveTabId(remaining.length > 0 ? remaining[0].id : '');
    }
  };"""

code = code.replace(old_handle_delete, new_handle_delete)
with open('src/App.tsx', 'w') as f:
    f.write(code)

# In GamesSidebar.tsx
with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

# find the delete button condition
code = code.replace('{tabs.length > 1 && (', '{true && (')

with open('src/components/GamesSidebar.tsx', 'w') as f:
    f.write(code)
