import re
with open('src/components/ChatArea.tsx', 'r') as f:
    code = f.read()

old_submit = """  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputQuestion.trim() && !attachedImage) || isLoading) return;

    const question = inputQuestion.trim();
    const image = attachedImage || undefined;

    setInputQuestion('');
    setAttachedImage(null);

    playSnapSound(soundEnabled);
    await onSendMessage(question, image);
    playChimeSound(soundEnabled);
  };"""

new_submit = """  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputQuestion.trim() && !attachedImage) || isLoading) return;

    const question = inputQuestion.trim();
    let image = attachedImage || undefined;

    // Automatic screen capture in Immersive mode if no image is attached manually
    if (aiMode === 'immersive' && !image) {
      try {
        setIsCapturingScreen(true);
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'window' },
          audio: false,
        });
        const video = document.createElement('video');
        video.srcObject = stream;
        await video.play();
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          image = canvas.toDataURL('image/jpeg', 0.85);
        }
        stream.getTracks().forEach(track => track.stop());
        setIsCapturingScreen(false);
      } catch (err) {
        console.error('Auto screen capture cancelled or failed:', err);
        setIsCapturingScreen(false);
        // Continue sending without image if capture was cancelled
      }
    }

    setInputQuestion('');
    setAttachedImage(null);

    playSnapSound(soundEnabled);
    await onSendMessage(question, image);
    playChimeSound(soundEnabled);
  };"""

if old_submit in code:
    code = code.replace(old_submit, new_submit)
    with open('src/components/ChatArea.tsx', 'w') as f:
        f.write(code)
    print("Patched successfully")
else:
    print("Could not find block to patch")

