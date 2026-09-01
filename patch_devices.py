import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

old_manual = """    try {
      setIsCapturingScreen(true);
      playSnapSound(soundEnabled);

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'window',
        },
        audio: false,
      });"""

new_manual = """    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        setIsCapturingScreen(false);
        alert("Screen capture is not supported in this desktop container. Please take a screenshot and paste it here using Ctrl+V.");
        return;
      }

      setIsCapturingScreen(true);
      playSnapSound(soundEnabled);

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });"""

if old_manual in code:
    code = code.replace(old_manual, new_manual)
    print("Patched manual capture")
else:
    print("Could not find manual capture")

old_auto = """    if (!image) {
      try {
        setIsCapturingScreen(true);
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'window' },
          audio: false,
        });"""

new_auto = """    if (!image) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert("Screen capture is not supported in this desktop environment. Please attach an image or paste a screenshot with Ctrl+V.");
        return;
      }
      try {
        setIsCapturingScreen(true);
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });"""

if old_auto in code:
    code = code.replace(old_auto, new_auto)
    print("Patched auto capture")
else:
    print("Could not find auto capture")

with open('src/components/ChatArea.tsx', 'w') as f:
    f.write(code)

