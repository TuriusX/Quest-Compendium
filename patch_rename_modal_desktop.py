with open('src/components/RenameModal.tsx', 'r') as f:
    code = f.read()

code = code.replace("""          className="bg-black border border-[var(--accent-color)] text-white px-2.5 py-2 rounded font-sans outline-none w-full"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          autoFocus
        />""", """          className="bg-black border border-[var(--accent-color)] text-white px-2.5 py-2 rounded font-sans outline-none w-full"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          autoFocus
          onFocus={() => {
            if ((window as any).electronAPI) {
              (window as any).electronAPI.forceFocus?.();
            }
          }}
        />""")

with open('src/components/RenameModal.tsx', 'w') as f:
    f.write(code)
print("Patched RenameModal with desktop trick")
