import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const voices = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck', 'Zephyr', 'Achernar', 'Orus', 'Autonoe', 'Leda'];

async function testVoices() {
  for (const v of voices) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: 'Test',
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } }
        }
      });
      console.log(v, "Success, audio bytes:", res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data?.length);
    } catch (err) {
      console.log(v, "FAILED", err.message);
    }
  }
}
testVoices();
