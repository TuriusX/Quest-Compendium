import { GoogleGenAI } from "@google/genai";

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const ttsResult = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: "Hello world this is a test",
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "puck" }
          }
        }
      }
    });
    console.log("Success! Audio generated.");
  } catch (err) {
    console.log("Error from SDK (model: gemini-3.1-flash-tts-preview):", err.message);
  }
}
test();
