import re

with open('src/App.tsx', 'r') as f:
    code = f.read()

# Modify getDockClasses
dock_classes = """const getDockClasses = (dock: DockPosition) => {
    switch (dock) {
      case 'undocked':
        return 'w-full h-full rounded-none border-none';
      default:
        // Snug fit, full height, subtle inner border if desired, but no external margins/rounded corners
        return 'w-full h-full rounded-none border-none shadow-[0_0_40px_rgba(0,0,0,0.8)]';
    }
  };"""

code = re.sub(r'const getDockClasses =.*?return \'w-full h-full rounded-none border-none\';\n    \}\n  \};', dock_classes, code, flags=re.DOTALL)

# Modify the root div wrapper to remove padding and centering
code = code.replace('<div className="w-screen h-screen bg-transparent flex items-center justify-center p-0 sm:p-2 overflow-hidden select-none font-sans">', '<div className="w-screen h-screen bg-transparent flex overflow-hidden select-none font-sans">')


with open('src/App.tsx', 'w') as f:
    f.write(code)

