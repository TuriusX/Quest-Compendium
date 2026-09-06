import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  const result = await ai.models.generateContent({
    model: 'gemini-3.1-flash-tts-preview',
    contents: 'Hello, this is Charon.',
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Charon' }
        }
      }
    }
  });
  console.log("Charon generated length:", result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data?.length);
  
  const result2 = await ai.models.generateContent({
    model: 'gemini-3.1-flash-tts-preview',
    contents: 'Hello, this is Puck.',
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Puck' }
        }
      }
    }
  });
  console.log("Puck generated length:", result2.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data?.length);
}
run().catch(console.error);
