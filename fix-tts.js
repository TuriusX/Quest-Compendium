const fs = require('fs');
let code = fs.readFileSync('src/components/ChatArea.tsx', 'utf-8');

const fallbackCode = `
    const fallbackToBrowserTTS = (reason: string) => {
      console.warn('[TTS] Falling back to browser native TTS:', reason);
      if (!('speechSynthesis' in window)) {
        setTtsStatusError({ msgId, error: reason });
        setPlayingAudioId(null);
        setAudioLoadingId(null);
        return;
      }
      setTtsStatusError(null);
      setAudioLoadingId(null);
      
      const utterance = new SpeechSynthesisUtterance(text);
      const voiceKey = (ttsVoice || 'puck').toLowerCase();
      if (['puck', 'charon', 'fenrir'].includes(voiceKey)) {
        utterance.pitch = 0.8;
      } else {
        utterance.pitch = 1.2;
      }
      
      utterance.onend = () => setPlayingAudioId(null);
      utterance.onerror = () => setPlayingAudioId(null);
      
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    };
`;

code = code.replace(
  "const abortController = new AbortController();",
  fallbackCode + "\n    const abortController = new AbortController();"
);

code = code.replace(
  "throw new Error('TTS Rate limit exceeded (100 requests/day for gemini-3.1-flash-tts) or generation failed. Try again later.');",
  "fallbackToBrowserTTS('TTS Rate limit exceeded (100 requests/day for gemini-3.1-flash-tts). Using local fallback.'); return;"
);

code = code.replace(
  "console.error('[TTS] Server audio failed:', helpfulError);\n      setTtsStatusError({ msgId, error: helpfulError });\n      setPlayingAudioId(null);\n      setAudioLoadingId(null);",
  "fallbackToBrowserTTS(helpfulError);"
);

code = code.replace(
  "console.error('[TTS] Network error requesting TTS:', err);\n      const networkHelp = `Cannot connect to server at ${getApiBaseUrl() || window.location.origin}. Please open Settings ⚙️ > Server Connection to verify your endpoint.`;\n      setTtsStatusError({ msgId, error: networkHelp });\n      setPlayingAudioId(null);\n      setAudioLoadingId(null);",
  "const networkHelp = `Cannot connect to server at ${getApiBaseUrl() || window.location.origin}.`;\n      fallbackToBrowserTTS(networkHelp);"
);

fs.writeFileSync('src/components/ChatArea.tsx', code);
