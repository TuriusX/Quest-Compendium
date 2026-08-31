import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from '@google/genai';
import dotenv from 'dotenv';
import xml2js from 'xml2js';

dotenv.config();

// Lazy Gemini AI client initialization with telemetry User-Agent header
function getGeminiClient(customApiKey?: string): GoogleGenAI {
  if (customApiKey && customApiKey.trim() !== '') {
    return new GoogleGenAI({
      apiKey: customApiKey.trim(),
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  
  throw new Error('A Gemini API key is required. Please add it in the settings menu.');
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

  // --- API: Steam OpenID Authentication ---
  app.get('/api/auth/steam', (req, res) => {
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const baseUrl = `${protocol}://${host}`;
    const returnTo = `${baseUrl}/api/auth/steam/return`;
    
    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo,
      'openid.realm': baseUrl,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
    });

    res.redirect(`https://steamcommunity.com/openid/login?${params.toString()}`);
  });

  app.get('/api/auth/steam/return', async (req, res) => {
    const renderPopupClosingScript = (steamId?: string, error?: string) => `
      <html><body><script>
        try {
          if (${!!steamId}) {
            localStorage.setItem('steam_auth_id', '${steamId}');
            localStorage.setItem('steam_auth_time', Date.now().toString());
          } else {
            localStorage.setItem('steam_auth_error', '${error}');
            localStorage.setItem('steam_auth_time', Date.now().toString());
          }
        } catch (e) {}

        try {
          if (window.opener) {
            window.opener.postMessage(${steamId ? `{ type: 'STEAM_AUTH_SUCCESS', steamId: '${steamId}' }` : `{ type: 'STEAM_AUTH_ERROR', error: '${error}' }`}, '*');
          }
        } catch (e) {}
        
        window.close();
        
        // Fallback if window doesn't close
        setTimeout(() => {
          window.location.href = '${steamId ? `/?steamId=${steamId}` : `/?error=${error}`}';
        }, 1000);
      </script>
      <p>Authentication complete. This window should close automatically.</p>
      </body></html>
    `;

    try {
      const params = new URLSearchParams(req.query as any);
      params.set('openid.mode', 'check_authentication');

      const response = await fetch('https://steamcommunity.com/openid/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      
      const text = await response.text();
      if (text.includes('is_valid:true')) {
        const claimedId = req.query['openid.claimed_id'] as string;
        const steamIdMatch = claimedId.match(/\/id\/(\d+)$/);
        if (steamIdMatch) {
          return res.send(renderPopupClosingScript(steamIdMatch[1]));
        }
      }
      return res.send(renderPopupClosingScript(undefined, 'steam_login_failed'));
    } catch (err) {
      console.error('Steam OpenID error:', err);
      return res.send(renderPopupClosingScript(undefined, 'steam_login_error'));
    }
  });

  // --- API: Steam Profile (XML) ---
  app.get('/api/steam/profile', async (req, res) => {
    const { steamId } = req.query;
    if (!steamId || typeof steamId !== 'string') {
      return res.status(400).json({ error: 'steamId query parameter is required' });
    }
    
    let url = '';
    if (/^\d{17}$/.test(steamId)) {
      url = `https://steamcommunity.com/profiles/${steamId}/?xml=1`;
    } else {
      url = `https://steamcommunity.com/id/${steamId}/?xml=1`;
    }
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(404).json({ error: 'Steam profile not found' });
      }
      
      const xmlData = await response.text();
      const result = await new xml2js.Parser({ explicitArray: false }).parseStringPromise(xmlData);
      
      const profile = result.profile;
      if (!profile) {
        return res.status(404).json({ error: 'Invalid profile data' });
      }
      
      return res.json({
        steamName: profile.steamID,
        avatarFull: profile.avatarFull,
        avatarMedium: profile.avatarMedium,
        avatarIcon: profile.avatarIcon
      });
    } catch (err) {
      console.error('Failed to fetch Steam profile:', err);
      return res.status(500).json({ error: 'Failed to parse Steam profile' });
    }
  });

  // --- API: Steam Achievements (Public XML) ---
  app.get('/api/steam/achievements/:appId', async (req, res) => {
    const { appId } = req.params;
    const { steamId } = req.query;

    if (!steamId || typeof steamId !== 'string') {
      return res.status(400).json({ error: 'steamId query parameter is required' });
    }

    let url = '';
    // Check if it's a numeric 64-bit ID or a vanity URL
    if (/^\d{17}$/.test(steamId)) {
      url = `https://steamcommunity.com/profiles/${steamId}/stats/${appId}/?xml=1`;
    } else {
      url = `https://steamcommunity.com/id/${steamId}/stats/${appId}/?xml=1`;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(500).json({ error: 'Failed to fetch Steam profile XML' });
      }
      const xmlData = await response.text();
      
      const parser = new xml2js.Parser({ explicitArray: false });
      const result = await parser.parseStringPromise(xmlData);

      if (result?.playerstats?.error) {
        return res.status(404).json({ error: result.playerstats.error });
      }

      const rawAchievements = result?.playerstats?.achievements?.achievement;
      if (!rawAchievements) {
        return res.json({ achievements: [] });
      }

      // If there's only one achievement, xml2js parses it as an object instead of array
      const achievementsList = Array.isArray(rawAchievements) ? rawAchievements : [rawAchievements];

      // Fetch Global Achievement Percentages
      let globalStatsMap = new Map();
      try {
        const globalRes = await fetch(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appId}`);
        if (globalRes.ok) {
          const globalData = await globalRes.json();
          const achievements = globalData?.achievementpercentages?.achievements || [];
          for (const a of achievements) {
            globalStatsMap.set(a.name.toLowerCase(), parseFloat(a.percent));
          }
        }
      } catch (err) {
        console.error('Failed to fetch global achievement percentages', err);
      }

      const formatted = achievementsList.map((ach: any) => {
        const unlocked = ach['$']?.closed === "1"; // "1" means unlocked in Steam XML
        
        const rarity = globalStatsMap.get(ach.apiname.toLowerCase()) || 0;
        let tier = 'bronze';
        if (rarity > 0) {
          if (rarity < 10) tier = 'gold';
          else if (rarity < 30) tier = 'silver';
        }

        return {
          apiname: ach.apiname,
          name: ach.name,
          description: ach.description,
          unlocked,
          unlockDate: unlocked && ach.unlockTimestamp ? new Date(parseInt(ach.unlockTimestamp) * 1000).toLocaleDateString() : undefined,
          icon: unlocked ? ach.iconClosed : ach.iconOpen,
          rarity: Number(rarity.toFixed(1)),
          tier
        };
      });

      return res.json({ achievements: formatted });
    } catch (err) {
      console.error('Steam achievements fetch error:', err);
      return res.status(500).json({ error: 'Failed to parse Steam XML' });
    }
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
        customApiKey,
      } = req.body;

      if (!question && !imageBase64) {
        return res.status(400).json({ error: 'Question or image is required' });
      }

      const ai = getGeminiClient(customApiKey);

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
      let modelUsed = 'Gemini 3.1 Pro Preview';

      try {
        const primaryCall = ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
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

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('30s timeout exceeded')), 30000);
        });

        const response = await Promise.race([primaryCall, timeoutPromise]) as any;

        responseText = response.text || 'The Compendium pondered the riddle, but no runes formed. Please try asking again.';
      } catch (primaryErr: any) {
        console.log('Gemini 3.1 Pro Preview query issue or timeout, attempting fallback. Reason:', primaryErr?.message);
        
        try {
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
        } catch (fallbackErr: any) {
          console.log('Gemini 3.7 Flash fallback failed, attempting emergency fallback to 3.6 Flash. Reason:', fallbackErr?.message);
          
          try {
            const emergencyResponse = await ai.models.generateContent({
              model: 'gemini-3.6-flash',
              contents: [{ parts: currentParts }],
              config: {
                systemInstruction: "You are the Quest Compendium game guide assistant.",
              }
            });
            responseText = emergencyResponse.text || 'Quest Compendium provided insights.';
            modelUsed = 'Gemini 3.6 Flash (Emergency Fallback)';
          } catch (emergencyErr: any) {
            console.log('Emergency fallback to 3.6 Flash also failed. Service is currently unavailable.');
            responseText = 'The Compendium is currently overwhelmed by magical interference (high demand). Please try again in a moment.';
            modelUsed = 'Compendium Offline';
          }
        }
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
      const { text, voice = 'Kore', customApiKey } = req.body;
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

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY environment variable is missing.' });
      }

      const voiceMap: Record<string, string> = {
        'Kore': 'nova',
        'Puck': 'shimmer',
        'Fenrir': 'onyx',
        'Zephyr': 'alloy',
        'Charon': 'echo'
      };
      
      const openaiVoice = voiceMap[voice] || 'nova';

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: cleanText,
          voice: openaiVoice,
          response_format: 'mp3'
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: `OpenAI TTS error: ${errorText}` });
      }

      const audioBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(audioBuffer).toString('base64');

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
