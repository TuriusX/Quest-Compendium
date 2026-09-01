import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: [{ parts: [{ text: "Hello" }] }],
    });
    console.log('3.7-flash works');
  } catch (e) {
    console.error('3.7-flash error:', e);
  }
}
run();
