import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

pattern = r"      const video = document.createElement\('video'\);\n      video\.srcObject = stream;\n      await video\.play\(\);\n      const canvas = document\.createElement\('canvas'\);"
replacement = r"""      const video = document.createElement('video');
      video.srcObject = stream;
      await new Promise((resolve) => {
        video.onloadedmetadata = () => resolve(null);
      });
      await video.play();
      const canvas = document.createElement('canvas');"""

code = re.sub(pattern, replacement, code)
with open('src/components/ChatArea.tsx', 'w') as f:
    f.write(code)
print("Patched video in manual successfully")
