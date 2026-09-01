import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

pattern = r"      const video = document\.createElement\('video'\);\n      video\.srcObject = stream;\n      await new Promise\(\(resolve\) => {\n        video\.onloadedmetadata = \(\) => resolve\(null\);\n      }\);\n      await video\.play\(\);\n      const canvas = document\.createElement\('canvas'\);\n      canvas\.width = video\.videoWidth;\n      canvas\.height = video\.videoHeight;\n      const ctx = canvas\.getContext\('2d'\);\n      if \(ctx\) {\n        ctx\.drawImage\(video, 0, 0, canvas\.width, canvas\.height\);\n        const dataUrl = canvas\.toDataURL\('image/jpeg', 0\.85\);"

replacement = r"""      const video = document.createElement('video');
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

if re.search(pattern, code):
    code = re.sub(pattern, replacement, code)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched manual video successfully")
else:
    print("Could not find manual video to patch")

