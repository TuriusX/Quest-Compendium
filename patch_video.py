import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

old_video_auto = """        const video = document.createElement('video');
        video.srcObject = stream;
        await video.play();
        const canvas = document.createElement('canvas');"""

new_video_auto = """        const video = document.createElement('video');
        video.srcObject = stream;
        await new Promise((resolve) => {
          video.onloadedmetadata = () => resolve(null);
        });
        await video.play();
        const canvas = document.createElement('canvas');"""

if old_video_auto in code:
    code = code.replace(old_video_auto, new_video_auto)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched video in handleSubmit successfully")
else:
    print("Could not find auto block to patch")

