import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

pattern = r"    // Automatic screen capture in Immersive mode if no image is attached manually.*?setIsCapturingScreen\(false\);\n        return;\n      }\n    }"

new_auto = """    // Automatic screen capture in Immersive mode if no image is attached manually
    if (!image) {
      try {
        setIsCapturingScreen(true);
        
        if ((window as any).electronAPI?.takeScreenshot) {
          const dataUrl = await (window as any).electronAPI.takeScreenshot();
          if (dataUrl) {
            image = dataUrl;
          } else {
            setIsCapturingScreen(false);
            return;
          }
        } else {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            alert("Screen capture is not supported in this desktop environment. Please attach an image or paste a screenshot with Ctrl+V.");
            setIsCapturingScreen(false);
            return;
          }
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
          const video = document.createElement('video');
          video.style.position = 'fixed';
          video.style.top = '-9999px';
          video.style.opacity = '0';
          document.body.appendChild(video);
          video.srcObject = stream;
          video.autoplay = true;
          video.muted = true;
          video.play();
          await new Promise((resolve) => {
            video.onloadeddata = () => resolve(null);
          });
          await new Promise(r => setTimeout(r, 300));
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
          const ctx = canvas.getContext('2d');
          if (ctx && video.videoWidth > 0) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            image = canvas.toDataURL('image/jpeg', 0.85);
          } else {
            image = undefined;
          }
          stream.getTracks().forEach(track => track.stop());
          if (video.parentNode) video.parentNode.removeChild(video);
        }
        setIsCapturingScreen(false);
      } catch (err) {
        console.error('Auto screen capture cancelled or failed:', err);
        setIsCapturingScreen(false);
        return;
      }
    }"""

if re.search(pattern, code, re.DOTALL):
    code = re.sub(pattern, new_auto, code, flags=re.DOTALL)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched auto capture successfully")
else:
    print("Could not find auto capture pattern to patch")
