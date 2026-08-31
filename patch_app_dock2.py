import re

with open('src/App.tsx', 'r') as f:
    code = f.read()

dock_classes = """const getDockClasses = (dock: DockPosition) => {
    switch (dock) {
      case 'undocked':
        // When floating freely, make it look like a nice app window with borders and rounded corners.
        // We use h-[98%] and w-[98%] so the shadow doesn't get hard-clipped by the Electron window bounds,
        // and we rely on the flex container to center it.
        return 'w-[98%] h-[98%] rounded-xl border border-[var(--accent-border)] shadow-[0_0_40px_rgba(0,0,0,0.8)] mx-auto my-auto';
      default:
        // Snug fit for all docked corners (no rounded corners, no space)
        return 'w-full h-full rounded-none border-none shadow-[0_0_40px_rgba(0,0,0,0.8)]';
    }
  };"""

code = re.sub(r'const getDockClasses =.*?return \'w-full h-full rounded-none border-none shadow-\[0_0_40px_rgba\(0,0,0,0\.8\)\]\';\n    \}\n  \};', dock_classes, code, flags=re.DOTALL)

with open('src/App.tsx', 'w') as f:
    f.write(code)

