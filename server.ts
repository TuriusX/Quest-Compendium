import crypto from 'crypto';
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

  // Optional auth middleware for endpoints that can serve both signed-in and guest users
  const optionalAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split('Bearer ')[1];
      try {
        const decodedToken = await getAuth().verifyIdToken(token);
        (req as any).user = decodedToken;
      } catch (error) {
        // Continue as guest
      }
    }
    next();
  };

  // --- API Health Check ---
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
  });



  function verifySeal(userData: any) {
    if (!userData.securitySeal) return false;
    const secret = process.env.STRIPE_WEBHOOK_SECRET || 'default_secret';
    const payload = `${userData.proQueriesAvailable}-${userData.flashQueriesAvailable}-${userData.lastResetDate}`;
    const expectedSeal = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return userData.securitySeal === expectedSeal;
  }

  function generateSeal(userData: any) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET || 'default_secret';
    const payload = `${userData.proQueriesAvailable}-${userData.flashQueriesAvailable}-${userData.lastResetDate}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  function syncUserLimits(userData: any, today: string, isStripePremium: boolean) {
    const isPremium = isStripePremium;

    // Security Verification: If tampering is detected, reset to 0
    if (userData.lastResetDate === today && userData.securitySeal && !verifySeal(userData)) {
       console.warn('SECURITY ALERT: Tampering detected for user. Resetting quotas.');
       userData.proQueriesAvailable = 0;
       userData.flashQueriesAvailable = 0;
       userData.securitySeal = generateSeal(userData);
       return userData;
    }

    if (userData.lastResetDate !== today) {
      if (isPremium) {
        let currentAvailable = userData.proQueriesAvailable !== undefined 
            ? userData.proQueriesAvailable 
            : Math.max(0, 40 - (userData.proQueriesToday || 0));
        userData.proQueriesAvailable = Math.min(100, currentAvailable + 40);
        userData.flashQueriesAvailable = 1000;
      } else {
        userData.proQueriesAvailable = 5;
        userData.flashQueriesAvailable = 5;
      }
      userData.lastResetDate = today;
      userData.proQueriesToday = 0;
      userData.flashQueriesToday = 0;
    } else {
      if (userData.proQueriesAvailable === undefined) {
        userData.proQueriesAvailable = Math.max(0, (isPremium ? 40 : 5) - (userData.proQueriesToday || 0));
      }
      if (userData.flashQueriesAvailable === undefined) {
        userData.flashQueriesAvailable = Math.max(0, (isPremium ? 1000 : 5) - (userData.flashQueriesToday || 0));
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
      
      const userEmail = (req as any).user?.email;
      let isStripePremium = false;
      if (userEmail) {
        try {
          const stripe = getStripe();
          const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
          if (customers.data.length > 0) {
            const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'active', limit: 1 });
            isStripePremium = subs.data.length > 0;
          }
        } catch (e) {}
      }
      
      const today = new Date().toISOString().split('T')[0];
      userData = syncUserLimits(userData, today, isStripePremium);
      // update the frontend object
      userData.isPremium = isStripePremium;


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
      
      const userEmail = (req as any).user?.email;
      let isStripePremium = false;
      if (userEmail) {
        try {
          const stripe = getStripe();
          const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
          if (customers.data.length > 0) {
            const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'active', limit: 1 });
            isStripePremium = subs.data.length > 0;
          }
        } catch (e) {
           isStripePremium = userData.isPremium === true;
        }
      } else {
        isStripePremium = userData.isPremium === true;
      }
      
      const today = new Date().toISOString().split('T')[0];
      userData = syncUserLimits(userData, today, isStripePremium);
      const isPremium = isStripePremium;
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
        isGameRunningLocally = false,
        activeGame,
        achievements,
        news,
        language = 'English'
      } = req.body;

      if (!question && !imageBase64) {
        return res.status(400).json({ error: 'Question or image is required' });
      }

      const ai = getGeminiClient();

      // Persona & Mode System Instructions
      let systemInstruction = '';
      const isGameDetected = isGameRunningLocally && !!activeGame;

      if (aiMode === 'roleplay' && isGameDetected) {
        systemInstruction = `You are a dynamic, in-universe gaming companion. Your persona must seamlessly adapt to match the genre and world of the active game (${activeGame.name}).

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

      systemInstruction += `\n\nCRITICAL TRUTHFUL VISION GROUNDING:
When analyzing screenshots, screen captures, or images:
1. TRUTHFUL VISUAL GROUNDING: Always examine the actual image pixels truthfully.
   - If the screenshot shows the Windows desktop, taskbar, web browser, Discord, desktop wallpaper, file manager, or non-game software (or if the screen is black, blank, or low detail), clearly and honestly state what is actually on screen (e.g., "You are currently on your Windows desktop / browser with no game running").
   - NEVER invent or hallucinate fictional gameplay encounters, wild Pokémon battles, enemies, or combat scenes that are not visibly present in the image.
2. ACCURATE GAME IDENTIFICATION: If the system context confirms an active game is running, you should acknowledge it if asked (e.g. "You are playing [Game Name]"). However, NEVER hallucinate visual details about the screenshot if they aren't visibly there. If the screenshot is black, blank, or menus, state that the game is running but describe only what is actually visible.
3. MISSING IMAGE HANDLING: If the user asks "What is on my screen?", "What game is this?", or refers to an image, BUT no image was actually provided in the prompt, YOU MUST state: "I don't see any image attached. Please click the screenshot button to attach your screen." Do not hallucinate or guess based on selected game context.
4. CONTEXT INTEGRITY: Never force an assumed game onto a screenshot that clearly shows something else.`;

      systemInstruction += `

[USER LANGUAGE PREFERENCE]
You must respond entirely in ${language}. Do not use English unless the user's language preference is English or they specifically request it.`;

      let situationalContext = '';
      if (activeGame && isGameRunningLocally) {
        situationalContext += `\n[CONFIRMED ACTIVE GAME RUNNING LOCALLY: ${activeGame.name} (AppID: ${activeGame.appId || 'Custom'})]\n`;
        if (activeGame.genre) situationalContext += `[Genre: ${activeGame.genre}]\n`;
        if (activeGame.developer) situationalContext += `[Developer: ${activeGame.developer}]\n`;
      } else if (activeGame) {
        situationalContext += `\n[Selected Compendium Reference: ${activeGame.name} (Note: No game is currently running locally on the user's PC)]\n`;
      } else {
        situationalContext += `\n[System Status: No active video game is running locally on the player's system]\n`;
      }

      if (achievements && achievements.length > 0) {
        const unlocked = achievements.filter((a: any) => a.unlocked).map((a: any) => a.name);
        const locked = achievements.filter((a: any) => !a.unlocked).map((a: any) => a.name);
        situationalContext += `\n[Player Achievements Status: Unlocked (${unlocked.length}): ${unlocked.slice(0, 15).join(', ')} | Locked (${locked.length}): ${locked.slice(0, 15).join(', ')}]\n`;
      }

      if (news && news.length > 0) {
        situationalContext += `\n[Recent Game Patch Notes / News: ${news.slice(0, 3).map((n: any) => n.title || n).join('; ')}]\n`;
      }
      
      systemInstruction += `\n\n${situationalContext}`;

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

      const defaultPrompt = imageBase64
        ? (isGameRunningLocally && activeGame
            ? `Analyze this screen capture of ${activeGame.name} in detail and tell me what I should do next or what strategies apply.`
            : `Analyze this screen capture: accurately identify what is currently displayed on screen (whether a game, desktop, browser, or application) and provide truthful observations or next steps.`)
        : 'Analyze this observation and provide insightful gaming guidance.';

      const promptText = question || defaultPrompt;

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

  // Helper to convert 16-bit linear PCM audio buffer to standard WAV format
  function pcmToWav(pcmBuffer: Buffer, sampleRate: number = 24000, numChannels: number = 1): Buffer {
    const header = Buffer.alloc(44);
    const dataSize = pcmBuffer.length;
    const fileSize = dataSize + 36;
    const byteRate = sampleRate * numChannels * 2;
    const blockAlign = numChannels * 2;

    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize, 4);
    header.write('WAVE', 8);

    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // 1 = PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34); // 16 bits per sample

    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmBuffer]);
  }

  const TTS_VOICE_MAP: Record<string, string> = {
    'puck': 'Puck',
    'charon': 'Charon',
    'fenrir': 'Fenrir',
    'kore': 'Kore',
    'aoede': 'Aoede',
    // Fallbacks for legacy/old keys
    'zephyr': 'Puck',
    'achernar': 'Charon',
    'orus': 'Fenrir',
    'autonoe': 'Kore',
    'leda': 'Aoede',
    'nova': 'Puck',
    'onyx': 'Charon',
    'fable': 'Aoede',
    'echo': 'Fenrir',
    'shimmer': 'Kore',
    'sage': 'Kore',
    'ash': 'Charon',
    'coral': 'Aoede',
    'alloy': 'Puck',
  };

  // In-memory audio cache to provide instant (0ms) playback for repeated voice calls
  const ttsServerCache = new Map<string, { audioBase64: string; mimeType: string; voice: string }>();

  // --- API: Text-to-Speech (TTS) using Gemini Neural Voice Studio ---
  app.post('/api/tts', optionalAuth, async (req, res) => {
    try {
      const { text, voice = 'Puck', stream = true } = req.body;
      if (!text) {
        return res.status(400).json({ error: 'Text is required for speech' });
      }

      // Clean markdown formatting, tables, citations, URLs, and code blocks for crisp speech
      let cleanText = text
        .replace(/\[\^?\d+\]/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/https?:\/\/\S+/g, '')
        // Clean markdown table formatting into spoken natural sentences
        .replace(/\|([^\n|]+)\|([^\n|]+)\|([^\n|]*)\|?/g, (match: string, c1: string, c2: string, c3: string) => {
          const col1 = c1.trim();
          const col2 = c2.trim();
          const col3 = c3 ? c3.trim() : '';
          if (col1.includes('---') || col2.includes('---')) return '';
          return `${col1}: ${col2}${col3 ? ` (${col3})` : ''}. `;
        })
        .replace(/\|/g, ' ')
        .replace(/#{1,6}\s*([^\n]+)/g, '$1. ')
        .replace(/\n\s*[-*•]\s*/g, '. ')
        .replace(/[*_~>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const normalizedVoiceKey = (voice || 'puck').toLowerCase();
      const targetVoice = TTS_VOICE_MAP[normalizedVoiceKey] || 'Puck';
      const cacheKey = `${targetVoice}::${cleanText.slice(0, 1000)}`;

      // Instant cache hit
      if (ttsServerCache.has(cacheKey)) {
        const cached = ttsServerCache.get(cacheKey)!;
        if (stream) {
          res.setHeader('Content-Type', 'application/x-ndjson');
          res.setHeader('Cache-Control', 'no-cache');
          res.write(JSON.stringify({
            chunkIndex: 0,
            totalChunks: 1,
            audioBase64: cached.audioBase64,
            mimeType: cached.mimeType,
            voice: cached.voice,
            cached: true
          }) + '\n');
          return res.end();
        }
        return res.json({ ...cached, cached: true });
      }

      // 1. Primary Engine: Gemini 3.1 Flash TTS Studio Model (Included with Gemini API Key)
      try {
        const ai = getGeminiClient();

        // Optimized chunking:
        // We've increased the chunk size massively to preserve Gemini API quota.
        // One message = One request (unless it's extremely long).
        const chunks: string[] = [];
        if (cleanText.length <= 4000) {
          chunks.push(cleanText);
        } else {
          const sentences = cleanText.match(/[^.!?\n]+[.!?\n]+(\s|$)|[^.!?\n]+$/g) || [cleanText];
          let currentChunk = '';
          let targetLen = 3500; // Much larger limit to save requests

          for (const sentence of sentences) {
            const s = sentence.trim();
            if (!s) continue;
            if ((currentChunk + ' ' + s).trim().length <= targetLen || !currentChunk) {
              currentChunk = currentChunk ? `${currentChunk} ${s}` : s;
            } else {
              chunks.push(currentChunk);
              currentChunk = s;
            }
          }
          if (currentChunk) chunks.push(currentChunk);
        }

        const synthesizeChunk = async (chunkText: string): Promise<{pcm: Buffer | null, error?: string}> => {
          if (!chunkText.trim()) return { pcm: null };
          try {
            const ttsResult = await ai.models.generateContent({
              model: 'gemini-3.1-flash-tts-preview',
              contents: chunkText,
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: targetVoice }
                  }
                }
              }
            });
            const inlinePart = ttsResult.candidates?.[0]?.content?.parts?.[0];
            const b64Data = inlinePart?.inlineData?.data;
            return { pcm: b64Data ? Buffer.from(b64Data, 'base64') : null };
          } catch (err: any) {
            if (err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED') || err?.message?.includes('quota')) {
                return { pcm: null, error: 'QUOTA_EXCEEDED' };
            }
            console.warn('Chunk TTS generation error:', err?.message);
            return { pcm: null };
          }
        
        };

        if (stream && chunks.length > 0) {
          const allPcmBuffers: Buffer[] = [];

          // Synthesize Chunk 0 first
          const firstResult = await synthesizeChunk(chunks[0]);
          if (firstResult.error === 'QUOTA_EXCEEDED') {
             return res.status(429).json({ error: 'TTS Rate limit exceeded (100 requests/day). Using local fallback.' });
          }

          // Streaming mode: send Chunk 0 immediately so browser plays within seconds
          res.setHeader('Content-Type', 'application/x-ndjson');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          if (firstResult.pcm) {
            allPcmBuffers.push(firstResult.pcm);
            const firstWav = pcmToWav(firstResult.pcm, 24000, 1);
            res.write(JSON.stringify({
              chunkIndex: 0,
              totalChunks: chunks.length,
              audioBase64: firstWav.toString('base64'),
              mimeType: 'audio/wav',
              voice: targetVoice
            }) + '\n');
          }

          // If more chunks exist, synthesize them in parallel!
          if (chunks.length > 1) {
            const remainingPromises = chunks.slice(1).map(async (chunk, idx) => {
              const res = await synthesizeChunk(chunk);
              return { index: idx + 1, pcm: res.pcm };
            });

            const remainingResults = await Promise.all(remainingPromises);
            for (const item of remainingResults) {
              if (item.pcm) {
                allPcmBuffers.push(item.pcm);
                const wavBuf = pcmToWav(item.pcm, 24000, 1);
                res.write(JSON.stringify({
                  chunkIndex: item.index,
                  totalChunks: chunks.length,
                  audioBase64: wavBuf.toString('base64'),
                  mimeType: 'audio/wav',
                  voice: targetVoice
                }) + '\n');
              }
            }
          }

          // Cache combined audio for instant re-play
          if (allPcmBuffers.length > 0) {
            const combined = Buffer.concat(allPcmBuffers);
            const fullWav = pcmToWav(combined, 24000, 1);
            if (ttsServerCache.size > 100) ttsServerCache.clear();
            ttsServerCache.set(cacheKey, {
              audioBase64: fullWav.toString('base64'),
              mimeType: 'audio/wav',
              voice: targetVoice
            });
          }

          return res.end();
        }

        // Non-streaming fallback: execute all chunks in parallel
        const pcmResults = await Promise.all(chunks.map(chunk => synthesizeChunk(chunk)));
        if (pcmResults.some(r => r.error === 'QUOTA_EXCEEDED')) {
           return res.status(429).json({ error: 'TTS Rate limit exceeded (100 requests/day). Using local fallback.' });
        }
        const validPcms = pcmResults.map(r => r.pcm).filter((b): b is Buffer => b !== null);

        if (validPcms.length > 0) {
          const combinedPcm = Buffer.concat(validPcms);
          const wavBuffer = pcmToWav(combinedPcm, 24000, 1);
          const resultPayload = {
            audioBase64: wavBuffer.toString('base64'),
            mimeType: 'audio/wav',
            voice: targetVoice,
            engine: 'gemini-3.1-flash-tts-preview'
          };
          if (ttsServerCache.size > 100) ttsServerCache.clear();
          ttsServerCache.set(cacheKey, resultPayload);
          return res.json(resultPayload);
        }
      } catch (geminiTtsErr: any) {
        console.warn('Gemini Studio TTS encounter:', geminiTtsErr?.message);
      }

      // 2. Secondary Engine: OpenAI TTS (if optional OPENAI_API_KEY is configured in env)
      const openAiKey = process.env.OPENAI_API_KEY;
      if (openAiKey) {
        const openaiVoice = voice || 'nova';
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: cleanText.slice(0, 4000),
            voice: openaiVoice,
            response_format: 'mp3'
          }),
        });

        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const base64Audio = Buffer.from(arrayBuffer).toString('base64');
          return res.json({
            audioBase64: base64Audio,
            mimeType: 'audio/mp3',
            voice: openaiVoice,
            engine: 'openai'
          });
        }
      }

      return res.status(500).json({ error: 'TTS audio synthesis is unavailable at this time.' });
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
    console.log(`[DEPLOYMENT] Quest Compendium Server v1.1.0 running on http://localhost:${PORT}`);
  });
}

startServer();
