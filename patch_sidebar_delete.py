import re
with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

# 1. Add state for delete confirmation
state_pattern = r'  const \[showFontControl, setShowFontControl\] = useState\(false\);'
new_state = """  const [showFontControl, setShowFontControl] = useState(false);
  const [tabToDelete, setTabToDelete] = useState<{id: string, name: string} | null>(null);"""
code = re.sub(state_pattern, new_state, code)

# 2. Update the delete button onClick
old_onclick = """                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete game session "${tab.name}"?`)) {
                              onDeleteTab(tab.id);
                            }
                          }}"""

new_onclick = """                          onClick={(e) => {
                            e.stopPropagation();
                            setTabToDelete({ id: tab.id, name: tab.name });
                          }}"""
code = code.replace(old_onclick, new_onclick)

# 3. Add the custom Delete Modal at the end of the sidebar
modal_code = """      {/* Delete Confirmation Modal */}
      {tabToDelete && (
        <div 
          className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[9999] flex items-center justify-center"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          onClick={(e) => {
             e.stopPropagation();
             setTabToDelete(null);
          }}
        >
          <div 
            className="bg-[#1a1a1a] border-2 border-red-500 p-5 rounded-lg flex flex-col gap-4 shadow-[4px_4px_0px_rgba(239,68,68,0.4)] min-w-[300px]"
            onClick={(e) => e.stopPropagation()}
          >
            <label className="font-fantasy text-red-500 text-xl tracking-wide">Delete Compendium?</label>
            <p className="text-zinc-300 text-sm">
              Are you sure you want to delete <strong className="text-white">"{tabToDelete.name}"</strong>?<br/>
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2.5 mt-2">
              <button 
                onClick={() => setTabToDelete(null)}
                className="bg-transparent border border-red-500 text-red-500 px-4 py-1.5 rounded font-fantasy text-lg font-bold cursor-pointer hover:bg-red-500/10"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  onDeleteTab(tabToDelete.id);
                  setTabToDelete(null);
                }}
                className="bg-red-500 text-white border-none px-4 py-1.5 rounded font-fantasy text-lg font-bold cursor-pointer hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};"""

code = code.replace("    </aside>\n  );\n};", modal_code)

with open('src/components/GamesSidebar.tsx', 'w') as f:
    f.write(code)
print("Patched GamesSidebar delete modal")
