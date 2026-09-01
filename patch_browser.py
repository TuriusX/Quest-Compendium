import re
with open('src/components/GameGuidesBrowser.tsx', 'r') as f:
    code = f.read()

# 1. Back button
code = code.replace(
"""          onClick={() => {
            playBlipSound(soundEnabled);
            const iframe = document.getElementById(`browser-frame-${activeTabId}`) as HTMLIFrameElement;
            if (iframe?.contentWindow) iframe.contentWindow.history.back();
          }}""",
"""          onClick={() => {
            playBlipSound(soundEnabled);
            const wv = document.getElementById(`browser-frame-${activeTabId}`) as any;
            if (wv && wv.canGoBack && wv.canGoBack()) wv.goBack();
          }}"""
)

# 2. Forward button
code = code.replace(
"""          onClick={() => {
            playBlipSound(soundEnabled);
            const iframe = document.getElementById(`browser-frame-${activeTabId}`) as HTMLIFrameElement;
            if (iframe?.contentWindow) iframe.contentWindow.history.forward();
          }}""",
"""          onClick={() => {
            playBlipSound(soundEnabled);
            const wv = document.getElementById(`browser-frame-${activeTabId}`) as any;
            if (wv && wv.canGoForward && wv.canGoForward()) wv.goForward();
          }}"""
)

# 3. Reload button
code = code.replace(
"""          onClick={() => {
            playBlipSound(soundEnabled);
            const iframe = document.getElementById(`browser-frame-${activeTabId}`) as HTMLIFrameElement;
            if (iframe) iframe.src = activeTab.url;
          }}""",
"""          onClick={() => {
            playBlipSound(soundEnabled);
            const wv = document.getElementById(`browser-frame-${activeTabId}`) as any;
            if (wv && wv.reload) wv.reload();
          }}"""
)

# 4. Remove Bookmarks bar
bookmarks_bar = """      {/* Curated Gaming Bookmarks Bar */}
      <div className="px-3 py-1.5 bg-black/30 border-b border-white/[0.06] flex items-center gap-2 overflow-x-auto text-[11px]">
        <span className="text-zinc-500 font-mono text-[10px] flex-shrink-0">TOP GUIDES:</span>
        {bookmarks.map((bm, idx) => (
          <button
            key={idx}
            onClick={() => handleNavigate(bm.url)}
            className="px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-blue-500/20 text-zinc-400 hover:text-blue-300 border border-white/[0.06] hover:border-blue-500/30 whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5"
          >
            <BookOpen className="w-3 h-3 text-blue-400" />
            <span>{bm.name}</span>
          </button>
        ))}
      </div>"""

if bookmarks_bar in code:
    code = code.replace(bookmarks_bar, "")
else:
    print("Could not find bookmarks bar")

# 5. Replace iframe with webview
iframe_code = """        <iframe
          id={`browser-frame-${activeTabId}`}
          src={activeTab.url}
          title={activeTab.name}
          style={{
            transform: `scale(${zoomLevel / 100})`,
            transformOrigin: 'top left',
            width: `${100 / (zoomLevel / 100)}%`,
            height: `${100 / (zoomLevel / 100)}%`,
          }}
          className="border-none w-full h-full bg-[#111218]"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
        />"""

webview_code = """        {React.createElement('webview', {
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

if iframe_code in code:
    code = code.replace(iframe_code, webview_code)
else:
    print("Could not find iframe")

with open('src/components/GameGuidesBrowser.tsx', 'w') as f:
    f.write(code)

print("Patched GameGuidesBrowser")
