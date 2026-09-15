import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'What is this?' },
            { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' } }
          ]
        }
      ],
      config: {
        tools: [{ googleSearch: {} }]
      }
    });
    console.log("Success!");
    console.log("Text:", response.text);
    console.log("Raw:", JSON.stringify(response, null, 2));
  } catch (e: any) {
    console.log("Error:", e.message);
  }
}
run();
