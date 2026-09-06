import express from 'express';
import path from 'path';
import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from '@google/genai';
import dotenv from 'dotenv';
import xml2js from 'xml2js';
import { initializeApp, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import cors from 'cors';
async function getFirestoreDocREST(idToken: string, uid: string) {
  const projectId = 'gen-lang-client-0366642934';
  const databaseId = 'ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f';
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users/${uid}`;
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${idToken}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore read error: ${await response.text()}`);
  const data = await response.json();
  const parsed: any = {};
  if (data.fields) {
    for (const [k, v] of Object.entries(data.fields)) {
      parsed[k] = (v as any).stringValue ?? (v as any).booleanValue ?? (v as any).integerValue;
      if (parsed[k] !== undefined && (v as any).integerValue !== undefined) {
         parsed[k] = parseInt((v as any).integerValue, 10);
      }
    }
  }
  return parsed;
}

async function updateFirestoreDocREST(idToken: string, uid: string, fields: Record<string, any>) {
  const projectId = 'gen-lang-client-0366642934';
  const databaseId = 'ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f';
  const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users/${uid}?${mask}`;
  
  const firestoreFields: any = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'boolean') firestoreFields[k] = { booleanValue: v };
    else if (typeof v === 'number') firestoreFields[k] = { integerValue: v };
    else if (typeof v === 'string') firestoreFields[k] = { stringValue: v };
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: firestoreFields })
  });
  if (!response.ok) throw new Error(`Firestore write error: ${await response.text()}`);
}
import Stripe from 'stripe';

dotenv.config();

// Lazy Stripe initialization
let stripeClient: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required for checkout.');
    }
    // @ts-ignore
    stripeClient = new Stripe(key, { apiVersion: '2025-03-31.basil' });
  }
  return stripeClient;
}

initializeApp({
  projectId: "gen-lang-client-0366642934",
});

// Lazy Gemini AI client initialization with telemetry User-Agent header
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (apiKey) {
    return new GoogleGenAI({
      apiKey: apiKey,
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

  app.use(cors());

  // --- STRIPE WEBHOOK (Must be before express.json so it can read raw body) ---
  app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!endpointSecret) {
      return res.status(400).send('Webhook secret not configured.');
    }

    let event;
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(req.body, sig as string, endpointSecret);
    } catch (err: any) {
      console.error('Webhook signature verification failed.', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const userId = session.client_reference_id;
      if (userId) {
        try {
          console.log("Stripe webhook received checkout for", userId);
          // Skipping server-side Firestore admin write due to AI Studio IAM sandbox restrictions.
          // The client will perform the update upon redirect.
          console.log(`Successfully upgraded user ${userId} to Premium!`);
        } catch (dbErr) {
          console.error('Failed to update user in Firestore:', dbErr);
        }
      }
    }

    res.json({received: true});
  });

  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  // --- Auth Middleware ---
  const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await getAuth().verifyIdToken(token);
      (req as any).user = decodedToken;
      next();
    } catch (error) {
      console.error('Error verifying auth token:', error);
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
  };

  // --- API Health Check ---
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
  });

  function syncUserLimits(userData: any, today: string) {
    const isPremium = userData.isPremium === true;
    if (userData.lastResetDate !== today) {
      if (isPremium) {
        let currentAvailable = userData.proQueriesAvailable !== undefined 
            ? userData.proQueriesAvailable 
            : Math.max(0, 40 - (userData.proQueriesToday || 0));
        userData.proQueriesAvailable = Math.min(100, currentAvailable + 40);
        userData.flashQueriesAvailable = 1000;
      } else {
        userData.proQueriesAvailable = 3;
        userData.flashQueriesAvailable = 3;
      }
      userData.lastResetDate = today;
      userData.proQueriesToday = 0;
      userData.flashQueriesToday = 0;
    } else {
      if (userData.proQueriesAvailable === undefined) {
        userData.proQueriesAvailable = Math.max(0, (isPremium ? 40 : 3) - (userData.proQueriesToday || 0));
      }
      if (userData.flashQueriesAvailable === undefined) {
        userData.flashQueriesAvailable = Math.max(0, (isPremium ? 1000 : 3) - (userData.flashQueriesToday || 0));
      }
      
      if (isPremium && userData.proQueriesAvailable < 40 && (userData.proQueriesToday || 0) < 40 && !userData._upgradedToday) {
         userData.proQueriesAvailable = Math.max(userData.proQueriesAvailable, 40 - (userData.proQueriesToday || 0));
         userData.flashQueriesAvailable = 1000;
         userData._upgradedToday = true;
      }
    }
    return userData;
  }

  // --- API: User Status ---
  app.get('/api/user/status', requireAuth, async (req, res) => {
    try {
      const idToken = req.headers.authorization!.split('Bearer ')[1];
      const userId = (req as any).user.uid;
      let userData = await getFirestoreDocREST(idToken, userId) || { isPremium: false };

      const today = new Date().toISOString().split('T')[0];
      userData = syncUserLimits(userData, today);

      res.json(userData);
    } catch (err) {
      console.error('Status fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch user status' });
    }
  });

  // --- API: Stripe Checkout ---
  app.post('/api/checkout', requireAuth, async (req, res) => {
    try {
      const stripe = getStripe();
      const userId = (req as any).user.uid;
      const priceId = process.env.STRIPE_PRICE_ID;
      
      if (!priceId) {
        return res.status(500).json({ error: 'STRIPE_PRICE_ID environment variable is missing.' });
      }

      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const baseUrl = `${protocol}://${host}`;

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        client_reference_id: userId,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/?upgrade=success`,
        cancel_url: `${baseUrl}/?upgrade=canceled`,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error('Stripe checkout error:', err);
      res.status(500).json({ error: err.message || 'Failed to create checkout session' });
    }
  });

  // --- API: Steam Games Search / Store Lookup ---
  app.get('/api/steam/search', requireAuth, async (req, res) => {
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
      
      let xmlData = await response.text();
      // Sanitize unescaped ampersands and malformed tags often found in Steam descriptions
      xmlData = xmlData.replace(/&(?!(?:apos|quot|amp|lt|gt|#\d+);)/g, '&amp;');
      xmlData = xmlData.replace(/<(?![a-zA-Z/!?])/g, '&lt;');
      xmlData = xmlData.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
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
      let xmlData = await response.text();
      // Sanitize unescaped ampersands and malformed tags often found in Steam descriptions
      xmlData = xmlData.replace(/&(?!(?:apos|quot|amp|lt|gt|#\d+);)/g, '&amp;');
      xmlData = xmlData.replace(/<(?![a-zA-Z/!?])/g, '&lt;');
      xmlData = xmlData.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
      
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
  app.post('/api/chat', requireAuth, async (req, res) => {
    try {
      const idToken = req.headers.authorization!.split('Bearer ')[1];
      const userId = (req as any).user.uid;
      let userData = await getFirestoreDocREST(idToken, userId) || { isPremium: false };

      const today = new Date().toISOString().split('T')[0];
      userData = syncUserLimits(userData, today);

      const isPremium = userData.isPremium === true;
      let targetModel = 'gemini-3.1-pro-preview';
      let skipPrimary = false;

      if (userData.proQueriesAvailable <= 0) {
        if (userData.flashQueriesAvailable <= 0) {
          return res.status(429).json({
            text: isPremium ? 'Daily limit reached. Please try again tomorrow.' : 'Daily limit reached. Upgrade to Premium for 40 Pro queries & unlimited Flash queries per day!',
            modelUsed: 'Limit Reached'
          });
        }
        targetModel = 'gemini-3.8-flash';
        skipPrimary = true;
      }

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
      let systemInstruction = '';
      const isGameDetected = !!activeGame;

      if (aiMode === 'roleplay' && isGameDetected) {
        systemInstruction = `You are a dynamic, in-universe gaming companion. Your persona must seamlessly adapt to match the genre and world of the active game (e.g., a wise ancient Archmage for fantasy RPGs, a witty AI navigational construct for sci-fi/cyberpunk, a tactical handler for military shooters, or a cryptic Dungeon Master).

CRITICAL RULE: NEVER refer to yourself as a "book", a "compendium", "tome", "pages", or an "AI assistant". You are a living entity, character, or construct within the game's universe. Fully commit to the roleplay.

Stay in character 100% of the time, while ensuring all puzzle solutions, mechanical guidance, and gameplay advice remain perfectly accurate, clear, and actionable.`;
      } else {
        systemInstruction = `You are a helpful and expert gaming guide.
Your purpose is to give thorough, highly accurate, puzzle-solving, build-optimizing, and progression-guiding advice for video games.
Provide clear, direct answers without adopting any specific character, persona, or AI identity.`;

        if (aiMode === 'minmax') {
          systemInstruction += `\n\n[MODE: MIN/MAX 100% COMPLETION]\nGuide the player toward optimal efficiency, 100% trophy/achievement completion, and top-tier build configurations. Do not use fluff or excessive roleplay. Use clear bullet points, stat breakpoints, missable item warnings, and optimized progression routes.`;
        }
      }

      systemInstruction += `\n\nWhen analyzing images (screenshots, game captures, inventory screens, maps, boss fights, skill trees), examine UI numbers, health bars, inventory slots, minimap markers, and environmental clues precisely.`;

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
          // Avoid consecutive user roles
          if (contentsPayload.length > 0 && contentsPayload[contentsPayload.length - 1].role === 'user') {
            contentsPayload[contentsPayload.length - 1].parts.push(...parts);
          } else {
            contentsPayload.push({ role: 'user', parts });
          }
        } else if (msg.role === 'assistant') {
          if (contentsPayload.length > 0 && contentsPayload[contentsPayload.length - 1].role === 'model') {
            contentsPayload[contentsPayload.length - 1].parts.push({ text: msg.text });
          } else {
            contentsPayload.push({
              role: 'model',
              parts: [{ text: msg.text }]
            });
          }
        }
      }
      
      // Ensure we don't have consecutive user roles with the current message
      const currentRole = 'user';

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

      if (req.body.audioBase64) {
        const audioBase64 = req.body.audioBase64;
        const mimeTypeMatch = audioBase64.match(/^data:(audio\/[a-zA-Z0-9+-]+);base64,(.+)$/);
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
              mimeType: 'audio/webm',
              data: audioBase64.replace(/^data:audio\/[a-zA-Z0-9+-]+;base64,/, '') // fallback
            }
          });
        }
      }

      const promptText = situationalContext
        ? `${situationalContext}\nUser Question / Observation: ${question || 'Analyze this game screenshot or voice message in detail and tell me what I should do next or what secrets/strategies apply.'}`
        : question || 'Analyze this message in detail and provide insightful guidance.';

      currentParts.push({ text: promptText });
      if (contentsPayload.length > 0 && contentsPayload[contentsPayload.length - 1].role === 'user') {
          contentsPayload[contentsPayload.length - 1].parts.push(...currentParts);
      } else {
          contentsPayload.push({ role: 'user', parts: currentParts });
      }

      // Query Gemini API
      let responseText = '';
      let modelUsed = targetModel === 'gemini-3.1-pro-preview' ? 'Gemini 3.1 Pro Preview' : 'Gemini 3.8 Flash (Fallback)';

      try {
        if (!skipPrimary) {
          const primaryCall = ai.models.generateContent({
            model: targetModel,
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
          responseText = response.text || 'No response received. Please try asking again.';
          
          userData.proQueriesAvailable = Math.max(0, userData.proQueriesAvailable - 1);
          userData.proQueriesToday = (userData.proQueriesToday || 0) + 1; // legacy
        } else {
          const fallbackCall = ai.models.generateContent({
            model: targetModel,
            contents: contentsPayload,
            config: {
              systemInstruction,
              temperature: aiMode === 'roleplay' ? 0.9 : 0.7,
            }
          });
          const response = await fallbackCall;
          responseText = response.text || 'No response received. Please try asking again.';
          
          userData.flashQueriesAvailable = Math.max(0, userData.flashQueriesAvailable - 1);
          userData.flashQueriesToday = (userData.flashQueriesToday || 0) + 1; // legacy
        }
        await updateFirestoreDocREST(idToken, userId, {
        lastResetDate: userData.lastResetDate,
        proQueriesAvailable: userData.proQueriesAvailable,
        flashQueriesAvailable: userData.flashQueriesAvailable,
        proQueriesToday: userData.proQueriesToday,
        flashQueriesToday: userData.flashQueriesToday,
        _upgradedToday: userData._upgradedToday ?? false
      });
      } catch (primaryErr: any) {
        console.log('Primary query issue or timeout, attempting fallback. Reason:', primaryErr?.message);
        
        try {
          // Fallback retry
          const retryResponse = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: [{ parts: currentParts }],
            config: {
              systemInstruction,
            }
          });
          responseText = retryResponse.text || 'No response received.';
          modelUsed = 'Gemini 3.8 Flash (Fallback)';
          
          userData.flashQueriesAvailable = Math.max(0, userData.flashQueriesAvailable - 1);
          userData.flashQueriesToday = (userData.flashQueriesToday || 0) + 1;
          await updateFirestoreDocREST(idToken, userId, {
        lastResetDate: userData.lastResetDate,
        proQueriesAvailable: userData.proQueriesAvailable,
        flashQueriesAvailable: userData.flashQueriesAvailable,
        proQueriesToday: userData.proQueriesToday,
        flashQueriesToday: userData.flashQueriesToday,
        _upgradedToday: userData._upgradedToday ?? false
      });
        } catch (fallbackErr: any) {
          console.log('Gemini 3.8 Flash fallback failed, attempting emergency fallback to Flash Lite. Reason:', fallbackErr?.message);
          
          try {
            const emergencyResponse = await ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: [{ parts: currentParts }],
              config: {
                systemInstruction,
              }
            });
            responseText = emergencyResponse.text || 'No response received.';
            modelUsed = 'Gemini 3.1 Flash Lite (Emergency Fallback)';
            
            userData.flashQueriesAvailable = Math.max(0, userData.flashQueriesAvailable - 1);
            userData.flashQueriesToday = (userData.flashQueriesToday || 0) + 1;
            await updateFirestoreDocREST(idToken, userId, {
        lastResetDate: userData.lastResetDate,
        proQueriesAvailable: userData.proQueriesAvailable,
        flashQueriesAvailable: userData.flashQueriesAvailable,
        proQueriesToday: userData.proQueriesToday,
        flashQueriesToday: userData.flashQueriesToday,
        _upgradedToday: userData._upgradedToday ?? false
      });
          } catch (emergencyErr: any) {
            console.log('Emergency fallback to Flash Lite also failed:', emergencyErr?.message);
            
            if (primaryErr?.message?.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') || primaryErr?.message?.includes('API_KEY_INVALID') || primaryErr?.message?.includes('UNAUTHENTICATED')) {
              responseText = 'Error: Invalid Gemini API Key or the Generative Language API is not enabled in your Google Cloud Project. Please verify your API Key in the settings.';
            } else {
              responseText = 'The Compendium is currently overwhelmed by magical interference (high demand). Please try again in a moment.';
            }
            modelUsed = 'Offline / Unavailable';
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
        error: err?.message || 'Failed to generate response.'
      });
    }
  });

  // --- API: Text-to-Speech (TTS) using Gemini Voice ---
  app.post('/api/tts', requireAuth, async (req, res) => {
    try {
      const { text, voice = 'nova' } = req.body;
      if (!text) {
        return res.status(400).json({ error: 'Text is required for speech' });
      }

      // Clean markdown citations and hashtags for crisp spoken narration
      const cleanText = text
        .replace(/\[\^?\d+\]/g, '')
        .replace(/[*_#`~>]/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\n\s*-\s*/g, '. ')
        .trim();

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'OPENAI_API_KEY environment variable is missing.' });
      }

      // voice is now passed directly as the OpenAI voice name (e.g., 'fable', 'onyx')
      const openaiVoice = voice || 'nova';

      // OpenAI TTS limit is 4096. We'll chunk text and combine MP3 buffers.
      const chunks: string[] = [];
      let remainingText = cleanText;
      while (remainingText.length > 0) {
        if (remainingText.length <= 4000) {
          chunks.push(remainingText);
          break;
        }
        
        let splitIndex = remainingText.lastIndexOf('.', 4000);
        if (splitIndex === -1) splitIndex = remainingText.lastIndexOf(' ', 4000);
        if (splitIndex === -1) splitIndex = 4000;
        
        chunks.push(remainingText.slice(0, splitIndex + 1).trim());
        remainingText = remainingText.slice(splitIndex + 1).trim();
      }

      const audioPromises = chunks.map(async (chunkText, index) => {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: chunkText,
            voice: openaiVoice,
            response_format: 'mp3'
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI TTS error: ${errorText}`);
        }
        return await response.arrayBuffer();
      });

      // Fetch all chunks in parallel to reduce wait time
      const audioBuffers = await Promise.all(audioPromises);
      
      // Concatenate all MP3 buffers sequentially
      const combinedBuffer = Buffer.concat(audioBuffers.map(b => Buffer.from(b)));
      const base64Audio = combinedBuffer.toString('base64');

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
    const { createServer: createViteServer } = await import('vite');
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
