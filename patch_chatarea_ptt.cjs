const fs = require('fs');
let code = fs.readFileSync('src/components/ChatArea.tsx', 'utf-8');

const oldToggle = `  const toggleVoiceRecording = async () => {
    playBlipSound(soundEnabled);

    if (isRecording && mediaRecorderRef.current) {
      // Stop recording
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    } else {
      // Start recording
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
    }
  };`;

const newToggle = `  const startVoiceRecording = async () => {
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
  };

  const stopVoiceRecording = () => {
    if (isRecording && mediaRecorderRef.current) {
      playBlipSound(soundEnabled);
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const toggleVoiceRecording = () => {
    if (isRecording) stopVoiceRecording();
    else startVoiceRecording();
  };`;

const oldEffect = `  useEffect(() => {
    const handleTrigger = () => {
      toggleVoiceRecording();
    };
    window.addEventListener('trigger-voice-record', handleTrigger);
    return () => window.removeEventListener('trigger-voice-record', handleTrigger);
  }, [isRecording, soundEnabled, attachedImage, onSendMessage]);`;

const newEffect = `  useEffect(() => {
    window.addEventListener('trigger-voice-start', startVoiceRecording);
    window.addEventListener('trigger-voice-stop', stopVoiceRecording);
    return () => {
      window.removeEventListener('trigger-voice-start', startVoiceRecording);
      window.removeEventListener('trigger-voice-stop', stopVoiceRecording);
    };
  }, [isRecording, soundEnabled, attachedImage, onSendMessage]);`;

if (code.includes(oldToggle) && code.includes(oldEffect)) {
  code = code.replace(oldToggle, newToggle);
  code = code.replace(oldEffect, newEffect);
  fs.writeFileSync('src/components/ChatArea.tsx', code);
  console.log("Patched ChatArea.tsx for PTT");
} else {
  console.log("Could not find old logic in ChatArea.tsx");
}
