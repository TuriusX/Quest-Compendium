import re
with open('src/components/GameGuidesBrowser.tsx', 'r') as f:
    code = f.read()

old_block = """    // Force webview navigation directly to bypass any React wrapper quirks
    setTimeout(() => {
      const wv = document.getElementById(`browser-frame-${activeTabId}`) as any;
      if (wv) wv.src = finalUrl;
    }, 10);"""

if old_block in code:
    code = code.replace(old_block, "// (Removed redundant wv.src setter that was causing ERR_ABORTED double-load warnings)")
    with open('src/components/GameGuidesBrowser.tsx', 'w') as f:
        f.write(code)
    print("Patched GameGuidesBrowser")
else:
    print("Could not find block")
