with open('src/components/RenameModal.tsx', 'r') as f:
    code = f.read()

old_use_effect = """  useEffect(() => {
    setValue(initialValue);
  }, [isOpen, initialValue]);"""

new_use_effect = """  useEffect(() => {
    setValue(initialValue);
    if (isOpen) {
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 10);
    }
  }, [isOpen, initialValue]);"""

if old_use_effect in code:
    code = code.replace(old_use_effect, new_use_effect)
    with open('src/components/RenameModal.tsx', 'w') as f:
        f.write(code)
    print("Patched RenameModal with select")
else:
    print("Could not find old_use_effect")
