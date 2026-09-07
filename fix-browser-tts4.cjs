const fs = require('fs');
let code = fs.readFileSync('src/components/ChatArea.tsx', 'utf-8');

const regex = /\/\/ Global array to prevent Chrome garbage collection of utterances\n[\s\S]*?window\.speechSynthesis\.speak\(utterance\);\n\s*\}\);\n\s*\};/;

const newCode = `// Global array to prevent Chrome garbage collection of utterances
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
      
      window.speechSynthesis.cancel();
      
      // Clean up markdown for TTS
      let cleanText = text.replace(/\\*\\*/g, '')
                          .replace(/\\*/g, '')
                          .replace(/__/g, '')
                          .replace(/_/g, '')
                          .replace(/#/g, '')
                          .replace(/\\[(.*?)\\]\\(.*?\\)/g, '$1') // remove links
                          .replace(/`/g, '');
      
      // Split text into chunks to bypass the Chrome 15-second TTS limit bug
      // We split by punctuation or newlines
      const sentences = cleanText.match(/[^.!?\\n]+[.!?\\n]+(?:\\s|$)|[^.!?\\n]+$/g) || [cleanText];
      const voiceKey = (ttsVoice || 'puck').toLowerCase();
      
      let utterancesFinished = 0;
      
      // We must store utterances globally to prevent garbage collection stopping playback mid-way
      (window as any)._ttsUtterances = []; 
      
      sentences.forEach((sentence, index) => {
        const trimmed = sentence.trim();
        if (!trimmed) {
          utterancesFinished++;
          if (utterancesFinished === sentences.length) setPlayingAudioId(null);
          return;
        }
        
        const utterance = new SpeechSynthesisUtterance(trimmed);
        (window as any)._ttsUtterances.push(utterance);
        
        if (['puck', 'charon', 'fenrir'].includes(voiceKey)) {
          utterance.pitch = 0.8;
        } else {
          utterance.pitch = 1.2;
        }
        
        utterance.onend = () => {
          utterancesFinished++;
          if (utterancesFinished === sentences.length) {
            setPlayingAudioId(null);
            (window as any)._ttsUtterances = []; // Clean up
          }
        };
        
        utterance.onerror = () => {
          utterancesFinished++;
          if (utterancesFinished === sentences.length) {
            setPlayingAudioId(null);
            (window as any)._ttsUtterances = [];
          }
        };
        
        window.speechSynthesis.speak(utterance);
      });
    };`;

if (!code.match(regex)) {
   console.log("Could not find regex!");
} else {
   code = code.replace(regex, newCode);
   fs.writeFileSync('src/components/ChatArea.tsx', code);
   console.log("Replaced successfully!");
}
