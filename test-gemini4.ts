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
            { inlineData: { mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=' } }
          ]
        }
      ],
      config: {
        tools: [{ googleSearch: {} }]
      }
    });
    console.log("Success! Text length:", response.text.length);
    console.log("Text:", response.text);
  } catch (e: any) {
    console.log("Error:", e.message);
  }
}
run();
