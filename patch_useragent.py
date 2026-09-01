import re
with open('src/components/GameGuidesBrowser.tsx', 'r') as f:
    code = f.read()

old_wv = """        {React.createElement('webview', {
          id: `browser-frame-${activeTabId}`,
          src: activeTab.url,
          title: activeTab.name,
          style: {
            transform: `scale(${zoomLevel / 100})`,
            transformOrigin: 'top left',
            width: `${100 / (zoomLevel / 100)}%`,
            height: `${100 / (zoomLevel / 100)}%`,
          },
          className: "border-none w-full h-full bg-[#111218]"
        } as any)}"""

new_wv = """        {React.createElement('webview', {
          id: `browser-frame-${activeTabId}`,
          src: activeTab.url,
          title: activeTab.name,
          useragent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          style: {
            transform: `scale(${zoomLevel / 100})`,
            transformOrigin: 'top left',
            width: `${100 / (zoomLevel / 100)}%`,
            height: `${100 / (zoomLevel / 100)}%`,
          },
          className: "border-none w-full h-full bg-[#111218]"
        } as any)}"""

if old_wv in code:
    code = code.replace(old_wv, new_wv)
    with open('src/components/GameGuidesBrowser.tsx', 'w') as f:
        f.write(code)
    print("Patched GameGuidesBrowser with useragent")
else:
    print("Could not find webview block")

