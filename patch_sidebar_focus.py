import re
with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

new_block = """  useEffect(() => {
    if (isCreating && createInputRef.current) {
      if ((window as any).electronAPI) {
        (window as any).electronAPI.forceFocus?.();
      }
      setTimeout(() => {
        createInputRef.current?.focus();
        createInputRef.current?.select();
      }, 50);
    }
  }, [isCreating]);

  useEffect(() => {
    if (editingTabId && renameInputRef.current) {
      if ((window as any).electronAPI) {
        (window as any).electronAPI.forceFocus?.();
      }
      setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 50);
    }
  }, [editingTabId]);"""

old_block = """  useEffect(() => {
    if (isCreating && createInputRef.current) {
      createInputRef.current.blur();
      setTimeout(() => {
        createInputRef.current?.focus();
        createInputRef.current?.select();
      }, 100);
    }
  }, [isCreating]);

  useEffect(() => {
    if (editingTabId && renameInputRef.current) {
      renameInputRef.current.blur();
      setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 100);
    }
  }, [editingTabId]);"""

if old_block in code:
    code = code.replace(old_block, new_block)
    with open('src/components/GamesSidebar.tsx', 'w') as f:
        f.write(code)
    print("Patched GamesSidebar.tsx with forceFocus")
else:
    print("Could not find old block in GamesSidebar.tsx")
