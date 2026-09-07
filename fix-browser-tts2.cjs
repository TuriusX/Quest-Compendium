const fs = require('fs');
let code = fs.readFileSync('src/components/ChatArea.tsx', 'utf-8');

const regex = /const fallbackToBrowserTTS = \(reason: string\) => \{[\s\S]*?window\.speechSynthesis\.speak\(utterance\);\n\s*\};/;

const newCode = `const fallbackToBrowserTTS = (reason: string) => {
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
      
      // Split text into chunks to bypass the Chrome 15-second TTS limit bug
      const sentences = text.match(/[^.!?\\n]+[.!?\\n]+(?:\\s|$)|[^.!?\\n]+$/g) || [text];
      const voiceKey = (ttsVoice || 'puck').toLowerCase();
      
      let utterancesFinished = 0;
      
      sentences.forEach((sentence, index) => {
        if (!sentence.trim()) {
          utterancesFinished++;
          if (utterancesFinished === sentences.length) setPlayingAudioId(null);
          return;
        }
        
        const utterance = new SpeechSynthesisUtterance(sentence.trim());
        if (['puck', 'charon', 'fenrir'].includes(voiceKey)) {
          utterance.pitch = 0.8;
        } else {
          utterance.pitch = 1.2;
        }
        
        utterance.onend = () => {
          utterancesFinished++;
          if (utterancesFinished === sentences.length) {
            setPlayingAudioId(null);
          }
        };
        
        utterance.onerror = () => {
          utterancesFinished++;
          if (utterancesFinished === sentences.length) {
            setPlayingAudioId(null);
          }
        };
        
        window.speechSynthesis.speak(utterance);
      });
    };`;

code = code.replace(regex, newCode);
fs.writeFileSync('src/components/ChatArea.tsx', code);
console.log("Successfully replaced fallback code!");
