import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

# Add import
import_stmt = "import { PaywallModal } from './components/PaywallModal';\nimport { RenameModal } from './components/RenameModal';"
if "RenameModal" not in code:
    code = code.replace("import { PaywallModal } from './components/PaywallModal';", import_stmt)

# Add state
state_block = """  const [isGameSearchOpen, setIsGameSearchOpen] = useState(false);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameModalMode, setRenameModalMode] = useState<'create' | 'rename'>('create');
  const [renameModalTabId, setRenameModalTabId] = useState<string | null>(null);
  const [renameModalInitialValue, setRenameModalInitialValue] = useState('');"""
if "isRenameModalOpen" not in code:
    code = code.replace("  const [isGameSearchOpen, setIsGameSearchOpen] = useState(false);", state_block)

# Add handlers
handlers = """  const handleCreateTab = (name: string) => {
    const newId = `tab-${Date.now()}`;
    const newTab: GameTab = {
      id: newId,
      name,
      messages: [],
      activeSteamGame: globalActiveGame || undefined,
      lastActive: Date.now()
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
    if (isBrowserMode) setIsBrowserMode(false);
  };

  const handleStartCreateTab = () => {
    setRenameModalMode('create');
    setRenameModalInitialValue('New Compendium');
    setIsRenameModalOpen(true);
  };

  const handleStartRenameTab = (tabId: string, currentName: string) => {
    setRenameModalMode('rename');
    setRenameModalTabId(tabId);
    setRenameModalInitialValue(currentName);
    setIsRenameModalOpen(true);
  };

  const handleRenameModalSave = (newName: string) => {
    if (newName.trim()) {
      if (renameModalMode === 'create') {
        handleCreateTab(newName.trim());
      } else if (renameModalMode === 'rename' && renameModalTabId) {
        handleRenameTab(renameModalTabId, newName.trim());
      }
    }
    setIsRenameModalOpen(false);
  };"""
if "handleStartCreateTab" not in code:
    code = code.replace("""  const handleCreateTab = (name: string) => {
    const newId = `tab-${Date.now()}`;
    const newTab: GameTab = {
      id: newId,
      name,
      messages: [],
      activeSteamGame: globalActiveGame || undefined,
      lastActive: Date.now()
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
    if (isBrowserMode) setIsBrowserMode(false);
  };""", handlers)

# Update GamesSidebar props
old_props = """            onCreateTab={(name) => handleCreateTab(name)}
            onRenameTab={handleRenameTab}"""
new_props = """            onStartCreateTab={handleStartCreateTab}
            onStartRenameTab={handleStartRenameTab}"""
if "onStartCreateTab" not in code:
    code = code.replace(old_props, new_props)

# Render the modal
modal_jsx = """      {/* Rename/Create Modal */}
      <RenameModal
        isOpen={isRenameModalOpen}
        initialValue={renameModalInitialValue}
        title={renameModalMode === 'create' ? 'Create New Compendium' : 'Rename Compendium'}
        onSave={handleRenameModalSave}
        onCancel={() => setIsRenameModalOpen(false)}
      />"""
if "RenameModal\n" not in code:
    code = code.replace("      {/* Auth & Paywall Overlays */}", modal_jsx + "\n\n      {/* Auth & Paywall Overlays */}")

with open('src/App.tsx', 'w') as f:
    f.write(code)
print("Patched App.tsx")
