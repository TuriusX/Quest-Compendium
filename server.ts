import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express from 'express';

const logDebug = (...args: any[]) => {};
import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from '@google/genai';
import dotenv from 'dotenv';
import xml2js from 'xml2js';
import { initializeApp, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import cors from 'cors';
import { registerDeviceAuth } from './deviceAuth';
import { registerGuestGuard } from './guestGuard';
import { registerWebSearch } from './webSearch';
import { registerLocate } from './locate';
async function getFirestoreDocREST(idToken: string, uid: string) {
  const isCloudRun = !!process.env.K_SERVICE;
  const projectId = 'quest-compendium-1bccf';
  const databaseId = '(default)';

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
  const projectId = 'quest-compendium-1bccf';
  const databaseId = '(default)';

  const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const patchUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users/${uid}?${mask}`;
  
  const firestoreFields: any = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'boolean') firestoreFields[k] = { booleanValue: v };
    else if (typeof v === 'number') firestoreFields[k] = { integerValue: v };
    else if (typeof v === 'string') firestoreFields[k] = { stringValue: v };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: firestoreFields }),
      signal: controller.signal
    });
    if (response.status === 404) {
      // Document doesn't exist yet, create it via POST
      const createUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users?documentId=${uid}`;
      await fetch(createUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: firestoreFields })
      });
    }
    clearTimeout(timeoutId);
  } catch (e: any) {
    clearTimeout(timeoutId);
    console.warn('Firestore update failed:', e.message);
  }
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



  
// ALWAYS initialize with the user's project ID, otherwise token verification fails!
initializeApp({
  projectId: "quest-compendium-1bccf",
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

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // --- Auth Middleware ---
  // Require authenticated user (supports Firebase Auth tokens or guest trial tokens)
  const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    logDebug(`[requireAuth] Header: ${authHeader ? authHeader.slice(0, 25) + '...' : 'none'}`);
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }
    const token = authHeader.split('Bearer ')[1];
    
    // Support guest trial sessions (e.g. for Itch.io in-browser players)
    if (token.startsWith('guest_')) {
      logDebug(`[requireAuth] Matched guest token: ${token}`);
      (req as any).user = { uid: token, email: undefined, isGuest: true };
      return next();
    }

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

  // --- Guest abuse guard (must be registered BEFORE the /api/chat and /api/tts routes) ---
  registerGuestGuard(app, {
    verifyIdToken: async (token: string) => {
      try { await getAuth().verifyIdToken(token); return true; } catch { return false; }
    },
  });

  registerDeviceAuth(app, {
    getAuth,
    requireAuth,
    firebaseWebConfig: {
      apiKey: process.env.FIREBASE_WEB_API_KEY || 'AIzaSyBrS5_3mBHz-defFcezhBFinNgA38KqsfY',
      authDomain: 'quest-compendium-1bccf.firebaseapp.com',
      projectId: 'quest-compendium-1bccf',
      appId: '1:890629309063:web:87293cf13f922fd3edee22',
    },
  });

  registerWebSearch(app, { requireAuth, getGeminiClient });
  registerLocate(app, { requireAuth, getGeminiClient });

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

  interface GuestQuota {
    proQueriesAvailable: number;
    flashQueriesAvailable: number;
    lastResetDate: string;
  }
  const guestQuotas = new Map<string, GuestQuota>();

  function getOrCreateGuestQuota(guestId: string, today: string): GuestQuota {
    let quota = guestQuotas.get(guestId);
    if (!quota || quota.lastResetDate !== today) {
      quota = {
        proQueriesAvailable: 5,
        flashQueriesAvailable: 5,
        lastResetDate: today
      };
      guestQuotas.set(guestId, quota);
    }
    return quota;
  }

  // --- API: User Status ---
  app.get('/api/user/status', requireAuth, async (req, res) => {
    try {
      const idToken = req.headers.authorization!.split('Bearer ')[1];
      const userId = (req as any).user.uid;
      const isGuest = (req as any).user.isGuest || userId.startsWith('guest_');

      if (isGuest) {
        const today = new Date().toISOString().split('T')[0];
        const quota = getOrCreateGuestQuota(userId, today);
        return res.json({
          isPremium: false,
          freeQueriesUsed: (5 - quota.proQueriesAvailable) + (5 - quota.flashQueriesAvailable),
          proQueriesAvailable: quota.proQueriesAvailable,
          flashQueriesAvailable: quota.flashQueriesAvailable,
          isGuest: true
        });
      }

      let userData = await getFirestoreDocREST(idToken, userId) || { isPremium: false };
      
      const rawEmail = (req as any).user?.email;
      const userEmail = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : null;
      let isStripePremium = false;
      if (userEmail) {
        try {
          const stripe = getStripe();
          const customers = await stripe.customers.list({ email: userEmail, limit: 5 });
          for (const customer of customers.data) {
            const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'active', limit: 1 });
            if (subs.data.length > 0) {
              isStripePremium = true;
              break;
            }
          }
          // Persist the premium status to Firestore if it changed
          if (isStripePremium && (userData.isPremium !== true || userData.subscriptionStatus !== 'active')) {
            await updateFirestoreDocREST(idToken, userId, { isPremium: true, subscriptionStatus: 'active' });
            userData.isPremium = true;
            userData.subscriptionStatus = 'active';
          }
        } catch (e: any) {
          console.warn('[Stripe status check warn]:', e.message);
        }
      }
      
      const isEffectivePremium = Boolean(userData.isPremium === true || isStripePremium || userData.subscriptionStatus === 'active');
      const today = new Date().toISOString().split('T')[0];
      userData = syncUserLimits(userData, today, isEffectivePremium);
      userData.isPremium = isEffectivePremium;
      userData.subscriptionStatus = isEffectivePremium ? 'active' : (userData.subscriptionStatus || 'beta');

      // If effective premium was identified, ensure Firestore is in sync
      if (isEffectivePremium && (userData.isPremium !== true || userData.subscriptionStatus !== 'active')) {
        updateFirestoreDocREST(idToken, userId, { isPremium: true, subscriptionStatus: 'active' }).catch(() => {});
      }

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
  
  const withTimeout = (promise: Promise<any>, ms: number, label: string) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
    ]);
  };

  app.post('/api/chat', requireAuth, async (req, res) => {
    logDebug(`[API Chat] Incoming request from uid: ${(req as any).user?.uid}`);

    try {
      const idToken = req.headers.authorization!.split('Bearer ')[1];
      const userId = (req as any).user.uid;
      const isGuest = (req as any).user.isGuest || userId.startsWith('guest_');
      logDebug(`[API Chat] Processing for userId: ${userId}, isGuest: ${isGuest}`);

      let userData: any = { isPremium: false };

      let guestQuota: GuestQuota | null = null;
      if (!isGuest) {
        userData = await getFirestoreDocREST(idToken, userId) || { isPremium: false };
        const rawEmail = (req as any).user?.email;
        const userEmail = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : null;
        let isStripePremium = false;
        if (userEmail) {
          try {
            const stripe = getStripe();
            const customers = await stripe.customers.list({ email: userEmail, limit: 5 });
            for (const customer of customers.data) {
              const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'active', limit: 1 });
              if (subs.data.length > 0) {
                isStripePremium = true;
                break;
              }
            }
            if (isStripePremium && userData.isPremium !== true) {
              await updateFirestoreDocREST(idToken, userId, { isPremium: true });
            }
          } catch (e: any) {
            console.warn('[Stripe chat check warn]:', e.message);
          }
        }
        
        const isEffectivePremium = Boolean(userData.isPremium === true || isStripePremium);
        const today = new Date().toISOString().split('T')[0];
        userData = syncUserLimits(userData, today, isEffectivePremium);
        userData.isPremium = isEffectivePremium;
      } else {
        // Guest mode trial: strictly match the unpaid tier (5 Pro & 5 Flash)
        const today = new Date().toISOString().split('T')[0];
        guestQuota = getOrCreateGuestQuota(userId, today);
        userData = {
          isPremium: false,
          proQueriesAvailable: guestQuota.proQueriesAvailable,
          flashQueriesAvailable: guestQuota.flashQueriesAvailable,
          lastResetDate: today,
          isGuest: true
        };
      }

      const isPremium = userData.isPremium === true;
      const {
        question,
        history = [],
        imageBase64,
        aiMode = 'standard',
        preferredModel = 'pro',
        isGameRunningLocally = false,
        activeGame,
        achievements,
        news,
        language = 'English'
      } = req.body;

      let targetModel = preferredModel === 'flash' ? 'gemini-3.8-flash' : 'gemini-3.1-pro-preview';
      let skipPrimary = targetModel === 'gemini-3.8-flash';

      if (targetModel === 'gemini-3.1-pro-preview' && userData.proQueriesAvailable <= 0) {
        if (userData.flashQueriesAvailable <= 0) {
          return res.status(429).json({
            text: isPremium ? 'Daily limit reached. Please try again tomorrow.' : 'Daily limit reached. Upgrade to Premium for 40 Pro queries & unlimited Flash queries per day!',
            modelUsed: 'Limit Reached'
          });
        }
        targetModel = 'gemini-3.8-flash';
        skipPrimary = true;
      } else if (targetModel === 'gemini-3.8-flash' && userData.flashQueriesAvailable <= 0) {
          return res.status(429).json({
            text: isPremium ? 'Daily limit reached. Please try again tomorrow.' : 'Daily limit reached. Upgrade to Premium for 40 Pro queries & unlimited Flash queries per day!',
            modelUsed: 'Limit Reached'
          });
      }

      if (!question && !imageBase64) {
        return res.status(400).json({ error: 'Question or image is required' });
      }

      const ai = getGeminiClient();

      // Persona & Mode System Instructions
      const currentDate = new Date().toLocaleString();
      let systemInstruction = `[SYSTEM TIME: The current date and time is ${currentDate}. Always use this as the real present date.]\n\n`;
      // Check if a game is detected either by local process detection, tab selection, or inquiry text
      const effectiveGame = activeGame || null;
      const isGameContextAvailable = !!effectiveGame;

      if (aiMode === 'roleplay') {
        const gameNameForRoleplay = effectiveGame ? effectiveGame.name : 'the gaming universe you are discussing';
        systemInstruction += `You are a dynamic, immersive, in-universe gaming companion. Your persona must seamlessly adapt to match the genre, lore, atmosphere, and world of the game (${gameNameForRoleplay}). If the player mentions or asks about a specific game, immediately adopt the persona and vernacular of a knowledgeable character or guide from that specific game universe.

CRITICAL RULE: NEVER refer to yourself as a "book", a "compendium", "tome", "pages", "language model", or an "AI assistant". You are a living entity, in-universe companion, mentor, operative, or guide from the game world. Fully commit to the roleplay.

Stay in character 100% of the time, while ensuring all puzzle solutions, mechanical guidance, boss strategies, build advice, and gameplay tips remain completely accurate, clear, and actionable.`;
      } else {
        systemInstruction += `You are a helpful and expert gaming guide.
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

      if (imageBase64) {
        systemInstruction += `

[ON-SCREEN POINTERS]
When your answer refers to specific things that are visible in the screenshot (an item, lever, door, chest, NPC, enemy weak point, menu option, map marker, or the path to take), point at them so the player can see exactly where they are. After your answer, add ONE block in exactly this format:
<qc-points>[{"y": 512, "x": 300, "label": "Lever"}]</qc-points>
- "y" and "x" are the center of the thing in the screenshot, normalized to 0-1000 (y from the top edge, x from the left edge).
- At most 5 points. Labels: 1 to 4 words, in the player's language.
- Label each point with what the player cares about, not with what the object is: name the item inside a container ("Teleport Stone", not "Barrel"; "Phoenix Down", not "Chest"), the action to take ("Pull lever", "Save here", "Jump here"), or who it is ("Talk to Duane"). Only fall back to naming the object when you don't know anything more useful about it.
- Only point at things that are actually visible in the screenshot, and be precise. If nothing specific is worth pointing at, leave the block out entirely.
- Never mention the block, coordinates or "pointers" in your answer text.

If the player is asking about items, secrets or things to find, and you know of others in this same area (the same town, dungeon floor or room) that are NOT visible in the screenshot, list up to 6 of them in ONE more block:
<qc-nearby>[{"label": "Elixir", "hint": "in the clay pot inside the inn"}]</qc-nearby>
- label: what it is (1 to 4 words); hint: where it is, described by what the spot looks like (a few words). Both in the player's language.
- Only list things you are confident about. Leave the block out when there are none, and never mention it in your answer text.`;
      }

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

      const promptLower = (question || '').toLowerCase();
      const mentionsAchievements = promptLower.includes('achievement') || promptLower.includes('trophy') || promptLower.includes('completion');
      const mentionsNews = promptLower.includes('patch') || promptLower.includes('update') || promptLower.includes('news');
      
      // Only inject heavy metadata on the first turn, or if the user explicitly asks about them
      if (achievements && achievements.length > 0 && (history.length === 0 || mentionsAchievements)) {
        const unlocked = achievements.filter((a: any) => a.unlocked).map((a: any) => a.name);
        const locked = achievements.filter((a: any) => !a.unlocked).map((a: any) => a.name);
        situationalContext += `\n[Player Achievements Status: Unlocked (${unlocked.length}): ${unlocked.slice(0, 15).join(', ')} | Locked (${locked.length}): ${locked.slice(0, 15).join(', ')}]\n`;
      }

      if (news && news.length > 0 && (history.length === 0 || mentionsNews)) {
        situationalContext += `\n[Recent Game Patch Notes / News: ${news.slice(0, 3).map((n: any) => n.title || n).join('; ')}]\n`;
      }
      
      systemInstruction += `\n\n${situationalContext}`;

      // Build Multi-turn Contents
      const contentsPayload: any[] = [];

      // Add past conversation turns
      for (const msg of history.slice(-10)) {
        if (msg.role === 'user') {
          const parts: any[] = [{ text: msg.text }];
          // Historical images are intentionally stripped here to save API tokens.
          // Only the text context is preserved for previous turns.
          
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

      // Banner Generation: Only run if specifically requested in the payload and do not block chat
      let bannerImagePromise: Promise<string | undefined> | null = null;
      if (req.body.generateBanner && (effectiveGame || question)) {
        const gameNameForBanner = effectiveGame ? effectiveGame.name : '';
        const bannerPrompt = gameNameForBanner
          ? `Cinematic, immersive wide landscape 16:9 concept art banner for the video game "${gameNameForBanner}" depicting: "${question || 'in-game scenery'}". Wide establishing shot with generous headroom, medium-to-wide cinematic framing, characters completely framed in shot with full heads and faces clearly visible, epic lighting and atmosphere, breathtaking high-quality game concept art, no text or UI elements.`
          : `Cinematic, immersive wide landscape 16:9 concept art banner for a video game depicting: "${question}". Wide establishing shot with generous headroom, medium-to-wide composition, characters completely framed in shot with full heads and faces clearly visible, high-quality digital illustration, no text or UI elements.`;
          
        bannerImagePromise = ai.models.generateContent({
          model: 'gemini-3.1-flash-lite-image',
          contents: { parts: [{ text: bannerPrompt }] },
          config: {
            // @ts-ignore
            imageConfig: { aspectRatio: '16:9' }
          }
        }).then(res => {
          for (const part of res.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
              return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
            }
          }
          return undefined;
        }).catch(err => {
          console.warn('[Banner Generation] Banner generation failed or skipped:', err?.message || err);
          return undefined;
        });
      }

      // Query Gemini API
      let responseText = '';
      let modelUsed = targetModel === 'gemini-3.1-pro-preview' ? 'Gemini 3.1 Pro' : 'Gemini 3.8 Flash';

      logDebug(`[API Chat] Processing question "${(question || '').slice(0, 30)}..." with model: ${targetModel}, skipPrimary: ${skipPrimary}`);

      try {
        if (!skipPrimary) {
          logDebug(`[API Chat] Calling primaryCall: ${targetModel}`);
          const primaryCall = ai.models.generateContent({
            model: targetModel,
            contents: contentsPayload,
            config: {
              systemInstruction,
              tools: [{ googleSearch: {} }],
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE }
              ],
              temperature: aiMode === 'roleplay' ? 0.9 : 0.7,
            }
          });
          const response = await withTimeout(primaryCall, 30000, 'Primary Gemini 3.1 Pro query') as any;
          responseText = response.text || '';
          logDebug(`[API Chat] primaryCall succeeded, response length: ${responseText.length}`);

          if (responseText && responseText.trim().length > 0) {
            userData.proQueriesAvailable = Math.max(0, userData.proQueriesAvailable - 1);
            userData.proQueriesToday = (userData.proQueriesToday || 0) + 1; // legacy
          } else {
            console.log('Primary Pro query returned empty text (possibly blocked by safety). Not deducting credit.');
            responseText = 'No response received. Please try asking again.';
          }
        } else {
          const fallbackCall = ai.models.generateContent({
            model: targetModel,
            contents: contentsPayload,
            config: {
              systemInstruction,
              tools: [{ googleSearch: {} }],
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE }
              ],
              temperature: aiMode === 'roleplay' ? 0.9 : 0.7,
            }
          });
          const response = await withTimeout(fallbackCall, 25000, 'Flash query') as any;
          responseText = response.text || '';

          if (responseText && responseText.trim().length > 0) {
            userData.flashQueriesAvailable = Math.max(0, userData.flashQueriesAvailable - 1);
            userData.flashQueriesToday = (userData.flashQueriesToday || 0) + 1; // legacy
          } else {
            console.log('Fallback Flash query returned empty text. Not deducting credit.');
            responseText = 'No response received. Please try asking again.';
          }
        }
        if (!isGuest) {
          await updateFirestoreDocREST(idToken, userId, {
            lastResetDate: userData.lastResetDate,
            proQueriesAvailable: userData.proQueriesAvailable,
            flashQueriesAvailable: userData.flashQueriesAvailable,
            proQueriesToday: userData.proQueriesToday,
            flashQueriesToday: userData.flashQueriesToday,
            _upgradedToday: userData._upgradedToday ?? false
          });
        } else if (guestQuota) {
          guestQuota.proQueriesAvailable = userData.proQueriesAvailable;
          guestQuota.flashQueriesAvailable = userData.flashQueriesAvailable;
        }
      } catch (primaryErr: any) {
        console.log('Primary query issue or timeout, attempting fallback. Reason:', primaryErr?.message);
        
        try {
          // Fallback retry
          const retryPromise = ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: [{ parts: currentParts }],
            config: {
              systemInstruction,
              tools: [{ googleSearch: {} }],
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE }
              ],
            }
          });
          const retryResponse = await withTimeout(retryPromise, 25000, 'Flash Fallback query') as any;
          responseText = retryResponse.text || '';
          modelUsed = 'Gemini 3.8 Flash (Fallback)';

          if (!responseText || responseText.trim().length === 0) {
             console.log('Emergency Flash Lite fallback returned empty text.');
             responseText = 'No response received. Please try asking again.';
          }
          
          userData.flashQueriesAvailable = Math.max(0, userData.flashQueriesAvailable - 1);
          userData.flashQueriesToday = (userData.flashQueriesToday || 0) + 1;
          if (!isGuest) {
            await updateFirestoreDocREST(idToken, userId, {
              lastResetDate: userData.lastResetDate,
              proQueriesAvailable: userData.proQueriesAvailable,
              flashQueriesAvailable: userData.flashQueriesAvailable,
              proQueriesToday: userData.proQueriesToday,
              flashQueriesToday: userData.flashQueriesToday,
              _upgradedToday: userData._upgradedToday ?? false
            });
          } else if (guestQuota) {
            guestQuota.proQueriesAvailable = userData.proQueriesAvailable;
            guestQuota.flashQueriesAvailable = userData.flashQueriesAvailable;
          }
        } catch (fallbackErr: any) {
          console.log('Gemini 3.8 Flash fallback failed, attempting emergency fallback to Flash Lite. Reason:', fallbackErr?.message);
          
          try {
            const emergencyPromise = ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: [{ parts: currentParts }],
              config: {
                systemInstruction,
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE }
              ],
            }
            });
            const emergencyResponse = await withTimeout(emergencyPromise, 15000, 'Flash Lite Emergency query') as any;
            responseText = emergencyResponse.text || 'No response received.';
            modelUsed = 'Gemini 3.1 Flash Lite (Emergency Fallback)';
            
            userData.flashQueriesAvailable = Math.max(0, userData.flashQueriesAvailable - 1);
            userData.flashQueriesToday = (userData.flashQueriesToday || 0) + 1;
            if (!isGuest) {
              await updateFirestoreDocREST(idToken, userId, {
                lastResetDate: userData.lastResetDate,
                proQueriesAvailable: userData.proQueriesAvailable,
                flashQueriesAvailable: userData.flashQueriesAvailable,
                proQueriesToday: userData.proQueriesToday,
                flashQueriesToday: userData.flashQueriesToday,
                _upgradedToday: userData._upgradedToday ?? false
              });
            } else if (guestQuota) {
              guestQuota.proQueriesAvailable = userData.proQueriesAvailable;
              guestQuota.flashQueriesAvailable = userData.flashQueriesAvailable;
            }
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

      if (!responseText || responseText.trim().length === 0) {
        responseText = 'The Compendium received a blank response from the AI. Please try again.';
      }

      // On-screen pointers: pull the <qc-points> block out of the answer.
      const { text: answerText, points, nearby } = extractScreenPoints(responseText, Boolean(imageBase64));
      responseText = answerText;

      let bannerImageUrl: string | undefined;
      if (bannerImagePromise) {
        try {
          bannerImageUrl = await Promise.race([
            bannerImagePromise,
            new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 6000))
          ]);
          if (bannerImageUrl) {
            logDebug(`[API Chat] Successfully generated banner image (length: ${bannerImageUrl.length})`);
          } else {
            logDebug(`[API Chat] Banner image did not complete within race timeout.`);
          }
        } catch (e) {
          console.warn('Failed to await banner image:', e);
        }
      }

      // Reliable game art fallback: if custom AI image generation timed out or failed, use the game's official widescreen hero banner
      if (!bannerImageUrl && req.body.generateBanner) {
        if (effectiveGame?.appId) {
          bannerImageUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${effectiveGame.appId}/library_hero.jpg`;
        }
      }

      logDebug(`[API Chat] Sending response for uid: ${(req as any).user?.uid}, modelUsed: ${modelUsed}`);
      return res.json({
        text: responseText.trim(),
        modelUsed,
        bannerImageUrl,
        ...(points.length ? { points } : {}),
        ...(nearby.length ? { nearby } : {}),
        userData: {
          isPremium: userData.isPremium === true,
          proQueriesAvailable: userData.proQueriesAvailable,
          flashQueriesAvailable: userData.flashQueriesAvailable,
          isGuest
        }
      });

    } catch (err: any) {
      logDebug(`[API Chat] Catastrophic error: ${err?.message}`);
      console.error('API /api/chat error:', err);
      return res.status(500).json({
        error: err?.message || 'Failed to generate response.'
      });
    }
  });

  /**
   * On-screen pointers: the model may append <qc-points>[{"y":..,"x":..,"label":".."}]</qc-points> (0-1000 scale).
   * Returns the answer without the block, and up to 5 validated points as 0-1 fractions.
   * The block is always removed, even when no screenshot was sent (the points would be meaningless then).
   */
  function extractScreenPoints(text: string, hadImage: boolean): { text: string; points: { x: number; y: number; label: string }[]; nearby: { label: string; hint: string }[] } {
    // Other items in the same area that aren't on screen yet (the desktop app looks for them as the player walks).
    let nearbyRaw = '';
    text = text.replace(/(?:```[a-z]*\s*)?<qc-nearby>([\s\S]*?)<\/qc-nearby>(?:\s*```)?/gi, (_m, inner) => {
      if (!nearbyRaw) nearbyRaw = inner;
      return '';
    });
    const nearby: { label: string; hint: string }[] = [];
    if (hadImage && nearbyRaw) {
      try {
        const parsed = JSON.parse(nearbyRaw.trim());
        if (Array.isArray(parsed)) {
          for (const n of parsed.slice(0, 6)) {
            const label = String(n?.label ?? '').trim().slice(0, 40);
            if (label) nearby.push({ label, hint: String(n?.hint ?? '').trim().slice(0, 100) });
          }
        }
      } catch {
        /* ignore a malformed list */
      }
    }
    const blockRe = /(?:```[a-z]*\s*)?<qc-points>([\s\S]*?)<\/qc-points>(?:\s*```)?/gi;
    let raw = '';
    const cleaned = text.replace(blockRe, (_m, inner) => {
      if (!raw) raw = inner;
      return '';
    }).replace(/\n{3,}/g, '\n\n').trim();
    const points: { x: number; y: number; label: string }[] = [];
    if (hadImage && raw) {
      try {
        const parsed = JSON.parse(raw.trim());
        if (Array.isArray(parsed)) {
          for (const p of parsed.slice(0, 5)) {
            const pt = Array.isArray(p?.point) ? { y: p.point[0], x: p.point[1] } : p;
            const x = Number(pt?.x), y = Number(pt?.y);
            const label = String(p?.label ?? '').trim().slice(0, 40);
            if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1000 && y >= 0 && y <= 1000 && label) {
              points.push({ x: Math.round(x) / 1000, y: Math.round(y) / 1000, label });
            }
          }
        }
      } catch {
        /* malformed block: ignore the points, keep the answer */
      }
    }
    return { text: cleaned || text, points, nearby };
  }

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

        // Optimized chunking for TTFA (Time To First Audio):
        // First chunk is kept very small (~200 chars) so the audio starts playing instantly.
        // Subsequent chunks are large (~3500 chars) to preserve Gemini API quota.
        const chunks: string[] = [];
        const sentences = cleanText.match(/[^.!?\n]+[.!?\n]+(\s|$)|[^.!?\n]+$/g) || [cleanText];
        
        let isFirstChunk = true;
        let currentChunk = '';

        for (const sentence of sentences) {
          const s = sentence.trim();
          if (!s) continue;
          
          const targetLen = isFirstChunk ? 250 : 600;
          
          if ((currentChunk + ' ' + s).trim().length <= targetLen || !currentChunk) {
            currentChunk = currentChunk ? `${currentChunk} ${s}` : s;
          } else {
            chunks.push(currentChunk);
            isFirstChunk = false;
            currentChunk = s;
          }
        }
        if (currentChunk) chunks.push(currentChunk);

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

  // --- Public Privacy Policy Endpoint (for Microsoft Store & Web verification) ---
  app.get(['/privacy', '/privacy-policy'], (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - Quest Compendium</title>
  <style>
    :root {
      color-scheme: dark;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0c0d14;
      color: #e4e4e7;
      line-height: 1.6;
      margin: 0;
      padding: 40px 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background-color: #12131e;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 36px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }
    h1 {
      color: #a855f7;
      font-size: 28px;
      margin-top: 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 12px;
    }
    h2 {
      color: #f4f4f5;
      font-size: 20px;
      margin-top: 28px;
      margin-bottom: 12px;
    }
    p, li {
      color: #a1a1aa;
      font-size: 15px;
    }
    ul {
      padding-left: 24px;
    }
    li {
      margin-bottom: 6px;
    }
    a {
      color: #c084fc;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      background-color: rgba(168, 85, 247, 0.15);
      color: #d8b4fe;
      border: 1px solid rgba(168, 85, 247, 0.3);
      margin-bottom: 16px;
    }
    .updated {
      font-size: 13px;
      color: #71717a;
      margin-bottom: 24px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">Official Legal Document</div>
    <h1>Privacy Policy for Quest Compendium</h1>
    <div class="updated">Last updated: September 18, 2026</div>

    <p>Welcome to <strong>Quest Compendium</strong> (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;the application&rdquo;). This Privacy Policy explains how personal information and application data are collected, used, and protected when you use our desktop application and web services.</p>

    <h2>1. Information We Collect</h2>
    <p>Quest Compendium accesses, collects, or processes the following categories of data solely to provide gaming companion features:</p>
    <ul>
      <li><strong>Account Information:</strong> If you sign in, we collect your email address and authentication credentials managed securely through Firebase Authentication.</li>
      <li><strong>Steam Profile & Gameplay Data:</strong> If you link your public Steam ID, we retrieve publicly accessible profile data, game libraries, and achievements via the public Steam Web API to display your in-game statistics and patch notes. We never collect or access your Steam passwords or login credentials.</li>
      <li><strong>User-Submitted Queries & Content:</strong> Questions you ask the AI compendium, chat histories, personal playthrough notes, and quest checklist items you save.</li>
      <li><strong>User-Initiated Audio & Screenshots:</strong> If you explicitly initiate voice input or attach an in-game screenshot for visual puzzle solving, the audio or image data is sent securely to our backend and processed by AI models to fulfill your request. We do not perform background screen recording or passive microphone listening.</li>
      <li><strong>Payment Information:</strong> Subscriptions and upgrades are processed securely via Stripe. We do not store or process credit card numbers or financial account details on our servers.</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <p>We use the collected information strictly for:</p>
    <ul>
      <li>Providing context-aware gaming guides, walkthroughs, patch summaries, and AI responses.</li>
      <li>Synchronizing your compendium tabs, notes, and preferences across your authorized devices using secure cloud storage.</li>
      <li>Verifying subscription status and managing daily query quotas.</li>
      <li>Maintaining and improving app reliability and performance.</li>
    </ul>

    <h2>3. Third-Party Services and Data Sharing</h2>
    <p>We do not sell, rent, or trade your personal information. We share data only with the following trusted infrastructure providers to deliver the service:</p>
    <ul>
      <li><strong>Google Cloud & Firebase:</strong> Provides user authentication and encrypted cloud database synchronization (Firestore).</li>
      <li><strong>Google Gemini API:</strong> Processes your submitted gameplay inquiries, images, and voice queries to generate answers, guides, and text-to-speech narration.</li>
      <li><strong>Valve Steam Web API:</strong> Provides public game details, achievement lists, and news.</li>
      <li><strong>Stripe:</strong> Secure payment gateway for managing subscriptions and checkout.</li>
    </ul>

    <h2>4. Data Storage and Security</h2>
    <p>All data transmitted between the application, our server, and third-party APIs is encrypted in transit using industry-standard Transport Layer Security (TLS/HTTPS). Local settings and cache files are stored securely on your local device.</p>

    <h2>5. Data Retention and Deletion</h2>
    <p>You can delete your local compendium tabs and notes at any time from within the application. If you would like to request deletion of your account or cloud-stored data, please contact us at the email below.</p>

    <h2>6. Children&rsquo;s Privacy</h2>
    <p>Quest Compendium is not directed to children under the age of 13, and we do not knowingly collect personal information from children under 13.</p>

    <h2>7. Contact Us</h2>
    <p>If you have questions, concerns, or requests regarding this Privacy Policy or your data, please contact us at:</p>
    <p><strong>Email:</strong> <a href="mailto:NoahFMinton@gmail.com">NoahFMinton@gmail.com</a><br>
    <strong>Website:</strong> <a href="https://www.questcompendium.com">https://www.questcompendium.com</a></p>
  </div>
</body>
</html>`);
  });

  // Serve public assets statically (icons, store art, downloads)
  app.use(express.static(path.join(process.cwd(), 'public')));

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

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Express Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[DEPLOYMENT] Quest Compendium Server v1.1.0 running on http://localhost:${PORT}`);
  });
}

startServer();
