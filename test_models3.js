import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  const models = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-3.0-flash', 'gemini-3.5-flash', 'gemini-3.6-flash'];
  for (const m of models) {
    try {
      const res = await ai.models.generateContent({ model: m, contents: 'hi' });
      console.log(`${m} worked`);
      break;
    } catch (e) {
      console.error(`${m} failed`, e.message);
    }
  }
}
run();
