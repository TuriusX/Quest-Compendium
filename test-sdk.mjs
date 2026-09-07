import { GoogleGenAI } from "@google/genai";
import fs from 'fs';

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const ttsResult = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts',
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
    console.log("Error from SDK (model: gemini-3.1-flash-tts):", err.message);
  }
}
test();
