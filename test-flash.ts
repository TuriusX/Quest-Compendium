import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [{ role: 'user', parts: [
        { text: 'What is this?' },
        { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' } }
      ]}],
      config: { tools: [{ googleSearch: {} }] }
    });
    console.log("Success! Flash text:", response.text);
  } catch (e: any) {
    console.log("Error Flash:", e.message);
  }
}
run();
