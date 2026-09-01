import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

new_use_effect = """
  // Global focus fix for Electron webview stealing focus
  useEffect(() => {
    const handleAppInteraction = (e: Event) => {
      // Don't steal focus if they are actually interacting with the webview
      if (e.target && (e.target as HTMLElement).tagName === 'WEBVIEW') return;
      
      document.querySelectorAll('webview').forEach(wv => {
        (wv as HTMLElement).blur();
      });
      window.focus();
    };

    // Capture phase so we intercept before input gets focus
    window.addEventListener('mousedown', handleAppInteraction, true);
    
    return () => {
      window.removeEventListener('mousedown', handleAppInteraction, true);
    };
  }, []);

  // Listen for local Steam game detection from Electron"""

# Need to replace the previously injected block
old_block = """  // Global focus fix for Electron webview stealing focus
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

if old_block in code:
    code = code.replace(old_block, new_use_effect)
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print("Patched App.tsx with SAFER focus fix")
else:
    print("Could not find old block")

