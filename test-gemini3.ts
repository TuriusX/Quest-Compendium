import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'I think I\'ve done everything but the deep down quest' },
            { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' } }
          ]
        }
      ],
      config: {
        tools: [{ googleSearch: {} }]
      }
    });
    console.log("Success! Text length:", response.text.length);
    console.log("Text:", response.text);
    console.log("Candidates:", JSON.stringify(response.candidates, null, 2));
  } catch (e: any) {
    console.log("Error:", e.message);
  }
}
run();
