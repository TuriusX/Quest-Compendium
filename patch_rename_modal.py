import re
with open('src/components/RenameModal.tsx', 'r') as f:
    code = f.read()

old_use_effect = """  useEffect(() => {
    setValue(initialValue);
    if (isOpen) {
      if ((window as any).electronAPI) {
        (window as any).electronAPI.forceFocus?.();
      }
      
      // Forces Electron to clear its confused focus state
      if (inputRef.current) inputRef.current.blur();
      
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 100);
    }
  }, [isOpen, initialValue]);"""

new_use_effect = """  useEffect(() => {
    setValue(initialValue);
    if (isOpen) {
      if ((window as any).electronAPI) {
        (window as any).electronAPI.forceFocus?.();
      }
      
      // Forces Electron to clear its confused focus state
      if (inputRef.current) inputRef.current.blur();
      
      // MUST blur webviews programmatically, otherwise they silently eat keystrokes
      // (except Backspace) even when the input looks focused!
      document.querySelectorAll('webview').forEach(wv => {
        (wv as HTMLElement).blur();
      });
      
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 150);
    }
  }, [isOpen, initialValue]);"""

code = code.replace(old_use_effect, new_use_effect)

with open('src/components/RenameModal.tsx', 'w') as f:
    f.write(code)
print("Patched RenameModal")
