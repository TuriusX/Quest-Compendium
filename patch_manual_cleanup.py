import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

old_cleanup = """      // Stop all video tracks
      stream.getTracks().forEach(track => track.stop());
      setIsCapturingScreen(false);"""

new_cleanup = """      // Stop all video tracks
      stream.getTracks().forEach(track => track.stop());
      if (video.parentNode) video.parentNode.removeChild(video);
      setIsCapturingScreen(false);"""

if old_cleanup in code:
    code = code.replace(old_cleanup, new_cleanup)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched manual cleanup successfully")
else:
    print("Could not find manual cleanup block to patch")
