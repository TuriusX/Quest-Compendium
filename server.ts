import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

// Lazy Gemini AI client initialization with telemetry User-Agent header
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY environment variable is missing.');
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey || '',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  // --- API Health Check ---
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
  });

  // --- API: Steam Games Search / Store Lookup ---
  app.get('/api/steam/search', async (req, res) => {
    const query = (req.query.q as string || '').trim();
    if (!query) {
      return res.json({ games: [] });
    }

    try {
      const response = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      if (response.ok) {
        const data = await response.json();
        const items = data.items || [];
        const games = items.map((item: any) => ({
          appId: item.id,
          name: item.name,
          headerImage: item.tiny_image || `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/header.jpg`,
          price: item.price ? (item.price.final / 100).toFixed(2) : 'Free'
        }));
        return res.json({ games });
      }
    } catch (err) {
      console.error('Steam search error:', err);
    }
    res.json({ games: [] });
  });

  // --- API: Steam Game News / Patch Notes ---
  app.get('/api/steam/news/:appId', async (req, res) => {
    const appId = req.params.appId;
    try {
      const response = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${appId}&count=5&maxlength=600&format=json`);
      if (response.ok) {
        const data = await response.json();
        const newsItems = data?.appnews?.newsitems || [];
        const formatted = newsItems.map((n: any) => ({
          title: n.title,
          date: new Date(n.date * 1000).toLocaleDateString(),
          contents: n.contents.replace(/<[^>]*>?/gm, '').trim(),
          url: n.url
        }));
        return res.json({ news: formatted });
      }
    } catch (err) {
      console.error('Steam news fetch error:', err);
    }
    res.json({ news: [] });
  });

  // --- API: Chat with Quest Compendium & Multimodal Game Vision ---
  app.post('/api/chat', async (req, res) => {
    try {
      const {
        question,
        history = [],
        imageBase64,
        aiMode = 'standard',
        activeGame,
        achievements,
        news,
      } = req.body;

      if (!question && !imageBase64) {
        return res.status(400).json({ error: 'Question or image is required' });
      }

      const ai = getGeminiClient();

      // Persona & Mode System Instructions
      let systemInstruction = `You are the magical, omniscient gaming tome "Quest Compendium", an expert PC gaming companion, insightful analyst, and walkthrough strategist.
Your purpose is to give thorough, highly accurate, puzzle-solving, build-optimizing, and progression-guiding advice for video games.
When analyzing images (screenshots, game captures, inventory screens, maps, boss fights, skill trees), examine UI numbers, health bars, inventory slots, minimap markers, and environmental clues precisely.`;

      if (aiMode === 'minmax') {
        systemInstruction += `\n\n[MODE: MIN/MAX 100% COMPLETION]\nGuide the player toward optimal efficiency, 100% trophy/achievement completion, and top-tier build configurations. Do not use fluff or excessive roleplay. Use clear bullet points, stat breakpoints, missable item warnings, and optimized progression routes.`;
      } else if (aiMode === 'roleplay') {
        systemInstruction += `\n\n[MODE: IMMERSIVE ROLEPLAY]\nAdopt an authentic in-universe companion persona matching the active game genre (e.g. wise ancient Archmage for fantasy RPGs, witty onboard navigational construct for sci-fi/cyberpunk, cunning rogue for stealth games, or cryptic Dungeon Master). Stay in character while keeping all puzzle solutions, mechanical guidance, and advice 100% accurate and actionable.`;
      }

      // Situational Game Context
      let situationalContext = '';
      if (activeGame) {
        situationalContext += `\n[CONFIRMED ACTIVE GAME: ${activeGame.name} (AppID: ${activeGame.appId || 'Custom'})]\n`;
        if (activeGame.genre) situationalContext += `[Genre: ${activeGame.genre}]\n`;
        if (activeGame.developer) situationalContext += `[Developer: ${activeGame.developer}]\n`;
      }

      if (achievements && achievements.length > 0) {
        const unlocked = achievements.filter((a: any) => a.unlocked).map((a: any) => a.name);
        const locked = achievements.filter((a: any) => !a.unlocked).map((a: any) => a.name);
        situationalContext += `\n[Player Achievements Status: Unlocked (${unlocked.length}): ${unlocked.slice(0, 15).join(', ')} | Locked (${locked.length}): ${locked.slice(0, 15).join(', ')}]\n`;
      }

      if (news && news.length > 0) {
        situationalContext += `\n[Recent Game Patch Notes / News: ${news.slice(0, 3).map((n: any) => n.title || n).join('; ')}]\n`;
      }

      // Build Multi-turn Contents
      const contentsPayload: any[] = [];

      // Add past conversation turns
      for (const msg of history.slice(-10)) {
        if (msg.role === 'user') {
          const parts: any[] = [{ text: msg.text }];
          if (msg.imageUrl && msg.imageUrl.startsWith('data:image')) {
            const match = msg.imageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
            if (match) {
              parts.unshift({
                inlineData: {
                  mimeType: match[1],
                  data: match[2]
                }
              });
            }
          }
          contentsPayload.push({ role: 'user', parts });
        } else if (msg.role === 'assistant') {
          contentsPayload.push({
            role: 'model',
            parts: [{ text: msg.text }]
          });
        }
      }

      // Current User Turn
      const currentParts: any[] = [];

      if (imageBase64) {
        const mimeTypeMatch = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (mimeTypeMatch) {
          currentParts.push({
            inlineData: {
              mimeType: mimeTypeMatch[1],
              data: mimeTypeMatch[2]
            }
          });
        } else {
          currentParts.push({
            inlineData: {
              mimeType: 'image/png',
              data: imageBase64
            }
          });
        }
      }

      const promptText = situationalContext
        ? `${situationalContext}\nUser Question / Observation: ${question || 'Analyze this game screenshot in detail and tell me what I should do next or what secrets/strategies apply.'}`
        : question || 'Analyze this game screenshot in detail and provide insightful guidance.';

      currentParts.push({ text: promptText });
      contentsPayload.push({ role: 'user', parts: currentParts });

      // Query Gemini API
      let responseText = '';
      let modelUsed = 'Gemini 3.7 Flash';

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.7-flash',
          contents: contentsPayload,
          config: {
            systemInstruction,
            temperature: aiMode === 'roleplay' ? 0.9 : 0.7,
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ]
          }
        });

        responseText = response.text || 'The Compendium pondered the riddle, but no runes formed. Please try asking again.';
      } catch (primaryErr: any) {
        console.warn('Gemini 3.7 Flash query issue, attempting retry:', primaryErr?.message);
        
        // Fallback retry
        const retryResponse = await ai.models.generateContent({
          model: 'gemini-3.7-flash',
          contents: [{ parts: currentParts }],
          config: {
            systemInstruction: "You are the Quest Compendium game guide assistant.",
          }
        });
        responseText = retryResponse.text || 'Quest Compendium provided insights.';
        modelUsed = 'Gemini 3.7 Flash (Fallback)';
      }

      return res.json({
        text: responseText,
        modelUsed
      });

    } catch (err: any) {
      console.error('API /api/chat error:', err);
      return res.status(500).json({
        error: err?.message || 'Failed to consult the Quest Compendium.'
      });
    }
  });

  // --- API: Text-to-Speech (TTS) using Gemini Voice ---
  app.post('/api/tts', async (req, res) => {
    try {
      const { text, voice = 'Kore' } = req.body;
      if (!text) {
        return res.status(400).json({ error: 'Text is required for speech' });
      }

      // Clean markdown citations and hashtags for crisp spoken narration
      const cleanText = text
        .replace(/\[\^?\d+\]/g, '')
        .replace(/[*_#`~>]/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\n\s*-\s*/g, '. ')
        .trim()
        .slice(0, 1000); // Reasonable single utterance limit

      const ai = getGeminiClient();

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [{ parts: [{ text: cleanText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice as any || 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        return res.status(500).json({ error: 'Audio data not generated' });
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: 'audio/mp3'
      });
    } catch (err: any) {
      console.error('API /api/tts error:', err);
      res.status(500).json({ error: err?.message || 'TTS generation error' });
    }
  });

  // --- Vite Middleware for Development / Static in Production ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Quest Compendium Server running on http://localhost:${PORT}`);
  });
}

startServer();
