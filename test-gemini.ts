import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function test() {
  console.log("sending");
  try {
    const res = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: 'Hello, respond with OK.'
    });
    console.log(res.text);
  } catch (e) {
    console.error(e);
  }
}
test();
