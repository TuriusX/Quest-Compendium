const fs = require('fs');
let code = fs.readFileSync('src/components/ChatArea.tsx', 'utf-8');

const oldEffect = `  useEffect(() => {
    window.addEventListener('trigger-voice-start', startVoiceRecording);
    window.addEventListener('trigger-voice-stop', stopVoiceRecording);
    return () => {
      window.removeEventListener('trigger-voice-start', startVoiceRecording);
      window.removeEventListener('trigger-voice-stop', stopVoiceRecording);
    };
  }, [isRecording, soundEnabled, attachedImage, onSendMessage]);`;

const newEffect = `  useEffect(() => {
    window.addEventListener('trigger-voice-start', startVoiceRecording);
    window.addEventListener('trigger-voice-stop', stopVoiceRecording);
    window.addEventListener('trigger-voice-record', toggleVoiceRecording);
    return () => {
      window.removeEventListener('trigger-voice-start', startVoiceRecording);
      window.removeEventListener('trigger-voice-stop', stopVoiceRecording);
      window.removeEventListener('trigger-voice-record', toggleVoiceRecording);
    };
  }, [isRecording, soundEnabled, attachedImage, onSendMessage]);`;

if (code.includes(oldEffect)) {
  code = code.replace(oldEffect, newEffect);
  fs.writeFileSync('src/components/ChatArea.tsx', code);
  console.log("Patched ChatArea.tsx");
}
