import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

old_cleanup = """        stream.getTracks().forEach(track => track.stop());
        setIsCapturingScreen(false);"""

new_cleanup = """        stream.getTracks().forEach(track => track.stop());
        if (video.parentNode) video.parentNode.removeChild(video);
        setIsCapturingScreen(false);"""

if old_cleanup in code:
    # use replace but specify count=1 just in case, wait, there are two!
    # I should patch both.
    code = code.replace(old_cleanup, new_cleanup)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched auto capture cleanup successfully")
else:
    print("Could not find cleanup block to patch")
