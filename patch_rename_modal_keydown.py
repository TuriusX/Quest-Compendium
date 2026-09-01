with open('src/components/RenameModal.tsx', 'r') as f:
    code = f.read()

code = code.replace("""          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(value);
            if (e.key === 'Escape') onCancel();
          }}""", """          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') onSave(value);
            if (e.key === 'Escape') onCancel();
          }}""")

with open('src/components/RenameModal.tsx', 'w') as f:
    f.write(code)
print("Patched onKeyDown")
