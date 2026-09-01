import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

new_use_effect = """
  // Global focus fix for Electron webview stealing focus
  useEffect(() => {
    const handleAppInteraction = () => {
      document.querySelectorAll('webview').forEach(wv => {
        (wv as HTMLElement).blur();
      });
      window.focus();
    };

    // Capture phase so we intercept before input gets focus
    window.addEventListener('mousedown', handleAppInteraction, true);
    window.addEventListener('focusin', handleAppInteraction, true);

    return () => {
      window.removeEventListener('mousedown', handleAppInteraction, true);
      window.removeEventListener('focusin', handleAppInteraction, true);
    };
  }, []);

  // Listen for local Steam game detection from Electron"""

if "// Listen for local Steam game detection from Electron" in code:
    code = code.replace("// Listen for local Steam game detection from Electron", new_use_effect)
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print("Patched App.tsx with focus fix")
else:
    print("Could not find anchor")

