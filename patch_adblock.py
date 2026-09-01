import re
with open('electron/main.cjs', 'r') as f:
    code = f.read()

adblock_code = """
  // Initialize AdBlocker for the webview partition
  const { ElectronBlocker } = require('@ghostery/adblocker-electron');
  const fetch = require('cross-fetch');
  ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
    blocker.enableBlockingInSession(session.defaultSession);
    blocker.enableBlockingInSession(session.fromPartition('persist:browser_session'));
    console.log("Adblocker enabled for browser sessions");
  }).catch((err) => console.error("Adblocker failed:", err));
"""

if "ElectronBlocker" not in code:
    code = code.replace(
      "const { session } = require('electron');",
      "const { session } = require('electron');" + adblock_code
    )
    with open('electron/main.cjs', 'w') as f:
        f.write(code)
    print("Patched main.cjs with adblocker")
else:
    print("Adblocker already present")
