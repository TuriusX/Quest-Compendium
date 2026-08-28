import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const res = await ai.models.generateContent({ model: 'gemini-3.1-pro-preview', contents: 'hi' });
    console.log("3.1 pro worked");
  } catch (e) {
    console.error("3.1 pro failed", e.message);
  }
}
run();
