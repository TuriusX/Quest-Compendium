import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const res = await ai.models.generateContent({ model: 'gemini-1.5-flash', contents: 'hello' });
    console.log("SUCCESS:", res.text);
  } catch (e) {
    console.log("ERROR:", e);
  }
}
run();
