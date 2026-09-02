const fs = require('fs');
let code = fs.readFileSync('src/components/ChatArea.tsx', 'utf-8');

// 1. Add refs for attachedImage and pendingScreenshot
if (!code.includes('attachedImageRef')) {
  code = code.replace(
    "const [attachedImage, setAttachedImage] = useState<string | null>(null);",
    "const [attachedImage, setAttachedImage] = useState<string | null>(null);\n  const attachedImageRef = useRef<string | null>(null);\n  const pendingScreenshotRef = useRef<Promise<string | null> | null>(null);\n\n  useEffect(() => {\n    attachedImageRef.current = attachedImage;\n  }, [attachedImage]);"
  );
}

// 2. Modify captureGameScreen to return string | null
const oldCapture = `  const captureGameScreen = async () => {
    try {
      setIsCapturingScreen(true);
      playSnapSound(soundEnabled);

      if ((window as any).electronAPI?.takeScreenshot) {
        const dataUrl = await (window as any).electronAPI.takeScreenshot();
        if (dataUrl) {
          setAttachedImage(dataUrl);
          playChimeSound(soundEnabled);
        }
        setIsCapturingScreen(false);
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        setIsCapturingScreen(false);
        alert("Screen capture is not supported in this desktop container. Please take a screenshot and paste it here using Ctrl+V.");
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
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setAttachedImage(dataUrl);
        playChimeSound(soundEnabled);
      }

      stream.getTracks().forEach(track => track.stop());
      if (video.parentNode) video.parentNode.removeChild(video);
      setIsCapturingScreen(false);
    } catch (err) {
      console.error('Screen capture cancelled or failed:', err);
      setIsCapturingScreen(false);
    }
  };`;

const newCapture = `  const captureGameScreen = async (): Promise<string | null> => {
    try {
      setIsCapturingScreen(true);
      playSnapSound(soundEnabled);

      if ((window as any).electronAPI?.takeScreenshot) {
        const dataUrl = await (window as any).electronAPI.takeScreenshot();
        if (dataUrl) {
          setAttachedImage(dataUrl);
          playChimeSound(soundEnabled);
        }
        setIsCapturingScreen(false);
        return dataUrl || null;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        setIsCapturingScreen(false);
        alert("Screen capture is not supported in this desktop container. Please take a screenshot and paste it here using Ctrl+V.");
        return null;
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
      
      let dataUrl = null;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (ctx && video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setAttachedImage(dataUrl);
        playChimeSound(soundEnabled);
      }

      stream.getTracks().forEach(track => track.stop());
      if (video.parentNode) video.parentNode.removeChild(video);
      setIsCapturingScreen(false);
      return dataUrl;
    } catch (err) {
      console.error('Screen capture cancelled or failed:', err);
      setIsCapturingScreen(false);
      return null;
    }
  };`;

if (code.includes(oldCapture)) {
  code = code.replace(oldCapture, newCapture);
} else {
  console.log("Could not find old captureGameScreen");
}

// 3. Modify startVoiceRecording
const oldStartVoice = `  const startVoiceRecording = async () => {
    if (isRecording) return;
    playBlipSound(soundEnabled);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          // Automatically send the voice note
          onSendMessage("Voice Message", attachedImage || undefined, base64Audio);
          setAttachedImage(null);
          setInputQuestion('');
        };
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error('Microphone error:', err);
      alert(\`Mic Error: \${err.name} - \${err.message}. If this says NotAllowedError, you must open Windows Settings -> Privacy -> Microphone -> 'Allow desktop apps to access your microphone'.\`);
    }
  };`;

const newStartVoice = `  const startVoiceRecording = async () => {
    if (isRecording) return;
    
    // Automatically capture screen if none is attached
    if (!attachedImageRef.current && !isCapturingScreen) {
      pendingScreenshotRef.current = captureGameScreen();
    }

    playBlipSound(soundEnabled);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        
        let finalImage = attachedImageRef.current;
        if (pendingScreenshotRef.current) {
          const result = await pendingScreenshotRef.current;
          if (result) finalImage = result;
          pendingScreenshotRef.current = null;
        }

        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          // Automatically send the voice note
          onSendMessage("Voice Message", finalImage || undefined, base64Audio);
          setAttachedImage(null);
          setInputQuestion('');
        };
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error('Microphone error:', err);
      alert(\`Mic Error: \${err.name} - \${err.message}. If this says NotAllowedError, you must open Windows Settings -> Privacy -> Microphone -> 'Allow desktop apps to access your microphone'.\`);
    }
  };`;

if (code.includes(oldStartVoice)) {
  code = code.replace(oldStartVoice, newStartVoice);
  console.log("Patched startVoiceRecording");
} else {
  console.log("Could not find old startVoiceRecording");
}

fs.writeFileSync('src/components/ChatArea.tsx', code);
