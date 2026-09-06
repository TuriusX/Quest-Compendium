import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const voices = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck', 'Zephyr', 'Achernar', 'Orus', 'Autonoe', 'Leda'];

async function testVoices() {
  for (const v of voices) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: 'Hello! I am a voice.',
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } }
        }
      });
      const data = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      const hash = crypto.createHash('md5').update(data).digest('hex');
      console.log(v, "Hash:", hash);
    } catch (err) {
      console.log(v, "FAILED", err.message);
    }
  }
}
testVoices();
