import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

old_block = """  // Global focus fix for Electron webview stealing focus
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
  }, []);"""

new_block = """  // Global focus fix for Electron webview stealing focus
  useEffect(() => {
    const handleAppInteraction = (e: Event) => {
      // Don't steal focus if they are actually interacting with the webview
      if (e.target && (e.target as HTMLElement).tagName === 'WEBVIEW') return;
      
      // If we are clicking an input or textarea, let the native focus happen naturally.
      // We just need to make sure webviews are blurred so they don't trap focus.
      document.querySelectorAll('webview').forEach(wv => {
        (wv as HTMLElement).blur();
      });
      // Removed window.focus() because it steals focus from the input the user just clicked!
    };

    // Capture phase so we intercept before input gets focus
    window.addEventListener('mousedown', handleAppInteraction, true);
    
    return () => {
      window.removeEventListener('mousedown', handleAppInteraction, true);
    };
  }, []);"""

if old_block in code:
    code = code.replace(old_block, new_block)
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print("Patched App.tsx with proper focus fix")
else:
    print("Could not find old focus block")

