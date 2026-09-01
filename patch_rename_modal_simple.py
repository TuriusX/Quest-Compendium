import re
with open('src/components/RenameModal.tsx', 'r') as f:
    code = f.read()

# We completely simplify the useEffect
old_use_effect = """  useEffect(() => {
    setValue(initialValue);
    if (isOpen) {
      // Force webviews to blur so they don't trap the typing cursor
      document.querySelectorAll('webview').forEach(wv => {
        (wv as HTMLElement).blur();
      });
      
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen, initialValue]);"""

new_use_effect = """  useEffect(() => {
    setValue(initialValue);
  }, [isOpen, initialValue]);"""

if old_use_effect in code:
    code = code.replace(old_use_effect, new_use_effect)
    # We add autoFocus to the input instead of programmatic focus
    code = code.replace("""          className="bg-black border border-[var(--accent-color)] text-white px-2.5 py-2 rounded font-sans outline-none w-full"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        />""", """          className="bg-black border border-[var(--accent-color)] text-white px-2.5 py-2 rounded font-sans outline-none w-full"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          autoFocus
        />""")
    
    with open('src/components/RenameModal.tsx', 'w') as f:
        f.write(code)
    print("Patched RenameModal")
else:
    print("Could not find old_use_effect")
