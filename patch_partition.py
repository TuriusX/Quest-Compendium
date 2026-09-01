import re
with open('src/components/GameGuidesBrowser.tsx', 'r') as f:
    code = f.read()

old_wv = """          useragent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36","""
new_wv = """          useragent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          partition: "persist:browser_session","""

if old_wv in code:
    code = code.replace(old_wv, new_wv)
    with open('src/components/GameGuidesBrowser.tsx', 'w') as f:
        f.write(code)
    print("Patched GameGuidesBrowser with partition")
else:
    print("Could not find useragent block")

