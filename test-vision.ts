import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function test() {
  console.log("sending vision...");
  try {
    // Generate a tiny dummy 1x1 image in base64
    const dummyBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const res = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: dummyBase64 } },
          { text: 'What is this?' }
        ]
      }]
    });
    console.log(res.text);
  } catch (e) {
    console.error(e);
  }
}
test();
