import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const voices = ['Zephyr', 'Orus', 'Achernar', 'Aoede', 'Charon'];
async function testVoices() {
  for (const v of voices) {
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: 'Hello, I am testing my voice. Do I sound like a man or a woman?',
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } }
        }
      });
      console.log(v, "Success", res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data?.length);
    } catch (err) {
      console.log(v, "FAILED", err.message);
    }
  }
}
testVoices();
