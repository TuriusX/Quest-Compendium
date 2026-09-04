import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'dummy_key' });
console.log(ai.apiKey);
