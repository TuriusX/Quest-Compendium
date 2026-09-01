import re
with open('src/components/GameGuidesBrowser.tsx', 'r') as f:
    code = f.read()

old_nav = """  const handleNavigate = (targetUrl: string) => {
    let finalUrl = targetUrl.trim();
    if (!finalUrl) return;

    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
        finalUrl = `https://${finalUrl}`;
      } else {
        // Search query
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl + (activeGame ? ` ${activeGame.name} guide walkthrough` : ''))}`;
      }
    }

    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: finalUrl, name: finalUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] } : t));
    setInputUrl(finalUrl);
  };"""

new_nav = """  const handleNavigate = (targetUrl: string) => {
    let finalUrl = targetUrl.trim();
    if (!finalUrl) return;

    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
        finalUrl = `https://${finalUrl}`;
      } else {
        // Search query
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`;
      }
    }

    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: finalUrl, name: finalUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] } : t));
    setInputUrl(finalUrl);
    
    // Force webview navigation directly to bypass any React wrapper quirks
    setTimeout(() => {
      const wv = document.getElementById(`browser-frame-${activeTabId}`) as any;
      if (wv) wv.src = finalUrl;
    }, 10);
  };"""

if old_nav in code:
    code = code.replace(old_nav, new_nav)
    with open('src/components/GameGuidesBrowser.tsx', 'w') as f:
        f.write(code)
    print("Patched handleNavigate")
else:
    print("Could not find handleNavigate")
