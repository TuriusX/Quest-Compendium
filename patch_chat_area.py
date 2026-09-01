import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

old_handleSubmit_video = """        const video = document.createElement('video');
        video.srcObject = stream;
        await new Promise((resolve) => {
          video.onloadedmetadata = () => resolve(null);
        });
        await video.play();
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          image = canvas.toDataURL('image/jpeg', 0.85);
        }"""

new_handleSubmit_video = """        const video = document.createElement('video');
        video.srcObject = stream;
        video.play();
        await new Promise((resolve) => {
          video.onloadedmetadata = () => resolve(null);
        });
        await new Promise(r => setTimeout(r, 500));
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (ctx && video.videoWidth > 0) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          image = canvas.toDataURL('image/jpeg', 0.85);
        } else {
          image = undefined;
        }"""

if old_handleSubmit_video in code:
    code = code.replace(old_handleSubmit_video, new_handleSubmit_video)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched handleSubmit video successfully")
else:
    print("Could not find handleSubmit video to patch")

old_manual_video = """      const video = document.createElement('video');
      video.srcObject = stream;
      await new Promise((resolve) => {
        video.onloadedmetadata = () => resolve(null);
      });
      await video.play();
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);"""

new_manual_video = """      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();
      await new Promise((resolve) => {
        video.onloadedmetadata = () => resolve(null);
      });
      await new Promise(r => setTimeout(r, 500));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (ctx && video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);"""

if old_manual_video in code:
    code = code.replace(old_manual_video, new_manual_video)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched manual video successfully")
else:
    print("Could not find manual video to patch")

