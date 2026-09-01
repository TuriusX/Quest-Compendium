import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

old_code = """      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();
      await new Promise((resolve) => {
        video.onloadedmetadata = () => resolve(null);
      });
      await new Promise(r => setTimeout(r, 500));
      
      const canvas = document.createElement('canvas');"""

new_code = """      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.muted = true;
      video.play();
      await new Promise((resolve) => {
        video.onloadeddata = () => resolve(null);
      });
      await new Promise(r => setTimeout(r, 300));
      
      const canvas = document.createElement('canvas');"""

if old_code in code:
    code = code.replace(old_code, new_code)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched manual capture successfully")
else:
    print("Could not find manual capture block to patch")
