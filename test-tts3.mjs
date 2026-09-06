import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  const res = await ai.models.generateContent({
    model: 'gemini-3.1-flash-tts-preview',
    contents: 'Test',
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'INVALID_VOICE' } } }
    }
  });
  console.log("INVALID_VOICE size:", res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data?.length);
}
run();
