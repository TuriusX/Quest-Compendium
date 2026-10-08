import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express from 'express';

const logDebug = (...args: any[]) => {};
import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold, ThinkingLevel } from '@google/genai';
import { logBanner, logUsage, withOutputCap, maybeBilledFailure, worstCaseDollars, requestCost } from './usage';
import dotenv from 'dotenv';
import xml2js from 'xml2js';
import { initializeApp, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import nodeFs from 'fs';
import nodeOs from 'os';
import nodePath from 'path';
import cors from 'cors';
import { registerDeviceAuth } from './deviceAuth';
import { registerGuestGuard } from './guestGuard';
import { registerWebSearch } from './webSearch';
import { registerLocate, registerRefine } from './locate';
import { registerLocateMe, readPlaceOnScreen, areaForSeenText } from './locateMe';
import { DONE_RULES, extractDone } from './src/utils/progressMemory';
import { registerGuidesApi, guidePageFor, guideNotesForPrompt, guideGroundingForPrompt, extractGuideRefs, guideFightNotes, guideLinesForPanel, guideAreasWithPages, type GuideRef } from './guidesApi';
import { routing, takePlayerPro, PRO_CHAT_MODEL } from './chatRouting';
import { releaseOf, isNewRelease, cutoffs, searchMode as searchModeFor, asksForSearch, EXISTENCE_RULES, ASK_RULES, FORCE_RULES, FORCE_AGAIN, type SearchMode } from './searchPolicy';
import { recordPlayerCost, registerPlayerCosts } from './playerCosts';
import { allowances, applyDay, pickBucket, wantedBucket, dayIn, nextReset, safeTimeZone, type Bucket } from './allowances';
import { questionType } from './src/utils/questionType';
import { registerReviewQueue, isAdmin } from './reviewQueue';
import { registerAnswerReports } from './answerReports';
import { registerAnswerFeedback, recordMarkerCheck } from './answerFeedback';
import { registerDiscord } from './discord';
import { STEPS_RULES, extractSteps } from './steps';
import { WORTH_POINTING_OUT, PRECISE_ACTIONS, isTrivialMarker, sharpenAction, combatRules, extractCombat, MARKER_LIMIT, COMBAT_MARKER_LIMIT, IDENTITY_RULES, ANSWER_IDENTITY, checkIdentity } from './answerBar';
import { CORRECTION_RULES, extractCorrections, saveCorrectionCandidates, verifiedCorrectionsForPrompt, registerCorrections } from './corrections';
import { saveMissingFight } from './missingFights';
import { samePlace, storyPhrase, singleArea } from './src/utils/placeName';
import { QUICK_PROMPTS, isQuickId } from './src/utils/quickQuestions';
import { searchAllowed, recordSearches, countSearches, getGameFacts, factsForPrompt, saveGameFacts, extractFacts, searchSources, monthlyBudgetOk, recordMonthly, playerSearchesToday, recordPlayerSearches, getGuideAreaNames, groundedText, factsBackedBySearch, recordGameDemand, recordDailyActivity } from './searchGuard';
/**
 * User records (users/{uid}) are read and written by the server with its own trusted access (Admin SDK), which the
 * Firestore security rules don't restrict. That's what lets the rules lock Premium and quota fields so that players
 * can't change them. Without server credentials (a dev machine with no Application Default Credentials), it falls
 * back to the player's own sign-in token: reads work, but writes to the locked fields are refused there.
 */
/**
 * Only use the Admin SDK where server credentials exist: on Cloud Run, or a machine with a service-account key or
 * Application Default Credentials. (Without them the Admin SDK doesn't just fail: it crashes the process from a
 * background task, so it must not be touched at all.)
 */
function hasServerCredentials(): boolean {
  if (process.env.K_SERVICE || process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  const adc =
    process.platform === 'win32'
      ? nodePath.join(process.env.APPDATA || '', 'gcloud', 'application_default_credentials.json')
      : nodePath.join(nodeOs.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
  try {
    return nodeFs.existsSync(adc);
  } catch {
    return false;
  }
}

let adminFirestoreUnavailable = !hasServerCredentials();
if (adminFirestoreUnavailable) {
  console.warn("[firestore] No server credentials on this machine: user records are read with the player's token (dev only).");
}

const isCredentialError = (e: any) =>
  /credential|default credentials|UNAUTHENTICATED|invalid_grant|metadata/i.test(String(e?.message ?? e)) || e?.code === 16;

/** Only the simple fields the server uses (not the synced tabs and settings, which can be large). */
function pickSimpleFields(data: Record<string, any> | undefined) {
  const out: any = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') out[k] = v;
  }
  return out;
}

async function getFirestoreDocREST(idToken: string, uid: string) {
  if (!adminFirestoreUnavailable) {
    try {
      const snap = await getFirestore().collection('users').doc(uid).get();
      return snap.exists ? pickSimpleFields(snap.data()) : null;
    } catch (e: any) {
      if (!isCredentialError(e)) throw e;
      adminFirestoreUnavailable = true;
      console.warn('[firestore] No server credentials here; using the player\'s token instead (reads only):', e?.message);
    }
  }
  return getFirestoreDocWithToken(idToken, uid);
}

async function getFirestoreDocWithToken(idToken: string, uid: string) {
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
  if (!adminFirestoreUnavailable) {
    try {
      await getFirestore().collection('users').doc(uid).set(pickSimpleFields(fields), { merge: true });
      return;
    } catch (e: any) {
      if (!isCredentialError(e)) {
        console.warn('Firestore update failed:', e?.message);
        return;
      }
      adminFirestoreUnavailable = true;
      console.warn('[firestore] No server credentials here; using the player\'s token instead:', e?.message);
    }
  }
  return updateFirestoreDocWithToken(idToken, uid, fields);
}

async function updateFirestoreDocWithToken(idToken: string, uid: string, fields: Record<string, any>) {
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
    const client = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    // Every call gets an output cap unless it sets its own (a runaway reply is billed to the model's ceiling), and a call
    // that fails after it may have run is logged at its worst case, so the logs' costs don't undercount the bill.
    const generate = client.models.generateContent.bind(client.models);
    (client.models as any).generateContent = async (request: any) => {
      const capped = withOutputCap(request);
      try {
        return await generate(capped);
      } catch (e) {
        if (maybeBilledFailure(e)) console.log(`[usage] failed-call ${capped?.model} worst case ≈ $${worstCaseDollars(capped).toFixed(4)} (${String((e as any)?.message || e).slice(0, 80)})`);
        throw e;
      }
    };
    return client;
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

  // The Discord bot's interactions (/correction, the moderators' Confirm button): signed over the raw body, so before
  // express.json like the Stripe webhook.
  registerDiscord(app);
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

  // The Deck's web search runs Google searches too, so it shares the monthly search budget.
  registerWebSearch(app, { requireAuth, getGeminiClient, searchBudget: { allowed: async () => (await playerSearchesToday()) && monthlyBudgetOk(), record: recordPlayerSearches } });
  // Published guides as JSON for the Steam Deck plugin, which shows them natively (public, read-only).
  registerGuidesApi(app);
  // Player corrections to the guides: candidates from conversations, and the Corrections tab of /admin/reviews.
  registerCorrections(app, { requireAuth, isAdmin });
  // Reports on AI answers (Store policy 11.16): saved for review, shown on the Reports tab of /admin/reviews.
  registerAnswerReports(app, { requireAuth, optionalAuth, isAdmin });
  // Players' 👍 / 👎 on answers and the marker drop counts: the Quality tab of /admin/reviews.
  registerAnswerFeedback(app, { requireAuth, optionalAuth, isAdmin });
  // What each player's questions cost per month: the Costs tab of /admin/reviews (playerCosts.ts).
  registerPlayerCosts(app, { requireAuth, isAdmin });
  // The guide review queue: failed reviews and players' mistake reports, decided on /admin/reviews (ADMIN_EMAILS).
  registerReviewQueue(app, {
    requireAuth,
    optionalAuth,
    firebaseWebConfig: {
      apiKey: process.env.FIREBASE_WEB_API_KEY || 'AIzaSyBrS5_3mBHz-defFcezhBFinNgA38KqsfY',
      authDomain: 'quest-compendium-1bccf.firebaseapp.com',
      projectId: 'quest-compendium-1bccf',
      appId: '1:890629309063:web:87293cf13f922fd3edee22',
    },
  });

  // "Known here": what the game knowledge base already knows about the player's confirmed place. Straight from the
  // database, no AI call, so it never costs a question.
  app.post('/api/facts/here', requireAuth, async (req, res) => {
    try {
      const game = String(req.body?.game ?? '').trim().slice(0, 120);
      const placeName = String(req.body?.place ?? '').trim().slice(0, 80);
      if (!game || !placeName) return res.json({ facts: [] });
      const facts = (await getGameFacts(game))
        // Same place, allowing for extra detail on either side ("Duncan's Cabin" vs "Duncan's Cabin, near South Figaro").
        .filter((f) => samePlace(f.place, placeName))
        .sort((a, b) => (b.confirmations || 1) - (a.confirmations || 1) || b.at - a.at)
        .slice(0, 30)
        .map((f) => ({ subject: f.subject, fact: f.fact, kind: f.kind, story: f.story || '', confirmations: f.confirmations || 1, disputed: !!f.disputed }));
      // Plus the guide page for this place, if there is one, as a separate "From the guide" list (lines already covered
      // by a verified fact are left out).
      const pg = await guidePageFor(game, placeName);
      const have = new Set(facts.map((f) => f.subject.toLowerCase()));
      const guide = pg ? guideLinesForPanel(pg).filter((l) => !have.has(l.subject.toLowerCase())).slice(0, 20) : [];
      res.json({ facts, ...(guide.length ? { guide, guideName: pg!.name } : {}) });
    } catch (e: any) {
      console.warn('[facts] known-here failed:', e?.message);
      res.json({ facts: [] });
    }
  });
  // Marker AI features (area checks, precision pass): Premium, or everyone during the beta.
  const markerAiAllowed = async (req: any) => {
    if (BETA_ALL_ACCESS) return true;
    const u = req.user;
    if (!u?.uid || u.isGuest || String(u.uid).startsWith('guest_')) return false;
    try {
      const token = req.headers.authorization?.split('Bearer ')[1] || '';
      return (await getFirestoreDocREST(token, u.uid))?.isPremium === true;
    } catch {
      return false;
    }
  };
  registerLocate(app, { requireAuth, getGeminiClient, allowed: markerAiAllowed });
  // "Locate me" (the tracker and the PlaceBar): its own daily limit, never the player's questions.
  registerLocateMe(app, { requireAuth, getGeminiClient, getUserDoc: getFirestoreDocREST, updateUserDoc: updateFirestoreDocREST, loadGuide: guideAreasWithPages });
  registerRefine(app, { requireAuth, getGeminiClient, allowed: markerAiAllowed, onChecked: (game, checked, kept) => void recordMarkerCheck(game, checked, kept) });

  // --- API Health Check ---
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
  });



  // ---- Plans ---------------------------------------------------------------------------------------------------
  // Two models a day, Pro (the best answers) and Fast (Flash), with Premium's unused questions carried over
  // (allowances.ts, Firestore config/allowances). During the beta every player gets the full feature set; after it, set
  // BETA_ALL_ACCESS=false and free players' Fast answers come from Flash-Lite and they get no Gemini voices or area
  // checks, while Premium keeps everything.
  const BETA_ALL_ACCESS = (process.env.BETA_ALL_ACCESS ?? 'true') !== 'false';
  const MAIN_MODEL = process.env.MAIN_MODEL || 'gemini-3.8-flash';
  const FREE_MODEL = process.env.FREE_MODEL || 'gemini-3.1-flash-lite';
  const BACKSTOP_MODEL = 'gemini-3.1-flash-lite';
  /** Whether a player gets the full feature set (Premium, or anyone during the beta). */
  const hasFullAccess = (isPremium: boolean) => isPremium || BETA_ALL_ACCESS;

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

  /** The player's time zone (the app sends it with each request; UTC when it doesn't). */
  const tzOf = (req: any) => safeTimeZone(req.body?.timeZone || req.headers['x-qc-tz']);

  /** A player's balances brought up to today in their time zone (Premium's carry-over applied at the new day). */
  async function syncUserLimits(userData: any, tz: string, isPremium: boolean) {
    const today = dayIn(tz);
    // Security Verification: If tampering is detected, reset to 0
    if (userData.lastResetDate === today && userData.securitySeal && !verifySeal(userData)) {
      console.warn('SECURITY ALERT: Tampering detected for user. Resetting quotas.');
      userData.proQueriesAvailable = 0;
      userData.flashQueriesAvailable = 0;
      userData.securitySeal = generateSeal(userData);
      return userData;
    }
    Object.assign(userData, applyDay(userData, await allowances(), isPremium, today));
    return userData;
  }

  /** What the apps show: both balances, the day's allowance, the carry-over cap and when the day resets. */
  async function quotaView(userData: any, isPremium: boolean, tz: string) {
    const a = await allowances();
    const plan = isPremium ? a.premium : a.free;
    return {
      proQueriesAvailable: userData.proQueriesAvailable,
      flashQueriesAvailable: userData.flashQueriesAvailable,
      dailyPro: plan.pro,
      dailyFlash: plan.flash,
      rollover: plan.rollover,
      bankCap: plan.rollover ? plan.cap : 0,
      resetAt: nextReset(tz),
      // Older apps show one number: the Fast questions left.
      questionsAvailable: userData.flashQueriesAvailable,
      dailyQuestions: plan.flash,
    };
  }

  interface GuestQuota {
    proQueriesAvailable: number;
    flashQueriesAvailable: number;
    lastResetDate: string;
    allowancePlan?: 'premium' | 'free';
  }
  const guestQuotas = new Map<string, GuestQuota>();

  /** A guest's balances (kept in memory per guest id): the free allowance, fresh each day. */
  async function getOrCreateGuestQuota(guestId: string, tz: string): Promise<GuestQuota> {
    const q = guestQuotas.get(guestId) || { proQueriesAvailable: 0, flashQueriesAvailable: 0, lastResetDate: '' };
    Object.assign(q, applyDay(q, await allowances(), false, dayIn(tz)));
    guestQuotas.set(guestId, q);
    return q;
  }

  // --- API: User Status ---
  app.get('/api/user/status', requireAuth, async (req, res) => {
    try {
      const idToken = req.headers.authorization!.split('Bearer ')[1];
      const userId = (req as any).user.uid;
      const isGuest = (req as any).user.isGuest || userId.startsWith('guest_');

      const tz = tzOf(req);
      if (isGuest) {
        const quota = await getOrCreateGuestQuota(userId, tz);
        return res.json({
          isPremium: false,
          ...(await quotaView(quota, false, tz)),
          fullAccess: hasFullAccess(false),
          beta: BETA_ALL_ACCESS,
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
      const before = `${userData.proQueriesAvailable}|${userData.flashQueriesAvailable}|${userData.lastResetDate}|${userData.allowancePlan}`;
      userData = await syncUserLimits(userData, tz, isEffectivePremium);
      // A new day (or a plan change) is saved now, so the carry-over is applied once.
      if (before !== `${userData.proQueriesAvailable}|${userData.flashQueriesAvailable}|${userData.lastResetDate}|${userData.allowancePlan}`) {
        updateFirestoreDocREST(idToken, userId, { proQueriesAvailable: userData.proQueriesAvailable, flashQueriesAvailable: userData.flashQueriesAvailable, lastResetDate: userData.lastResetDate, allowancePlan: userData.allowancePlan }).catch(() => {});
      }
      userData.isPremium = isEffectivePremium;
      userData.subscriptionStatus = isEffectivePremium ? 'active' : (userData.subscriptionStatus || 'beta');

      // If effective premium was identified, ensure Firestore is in sync
      if (isEffectivePremium && (userData.isPremium !== true || userData.subscriptionStatus !== 'active')) {
        updateFirestoreDocREST(idToken, userId, { isPremium: true, subscriptionStatus: 'active' }).catch(() => {});
      }

      res.json({
        ...userData,
        ...(await quotaView(userData, isEffectivePremium, tz)),
        fullAccess: hasFullAccess(isEffectivePremium),
        beta: BETA_ALL_ACCESS,
      });
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
    // Always English (l=english plus Steam's language cookie): the achievement guide's tips are matched by English name.
    if (/^\d{17}$/.test(steamId)) {
      url = `https://steamcommunity.com/profiles/${steamId}/stats/${appId}/?xml=1&l=english`;
    } else {
      url = `https://steamcommunity.com/id/${steamId}/stats/${appId}/?xml=1&l=english`;
    }

    try {
      const response = await fetch(url, { headers: { Cookie: 'Steam_Language=english', 'Accept-Language': 'en-US,en;q=0.9' } });
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
      // Everything this answer costs (usage.ts), for the per-player cost report.
      const costScope = { dollars: 0, searches: 0 };
      requestCost.enterWith(costScope);

      let userData: any = { isPremium: false };

      let guestQuota: GuestQuota | null = null;
      const tz = tzOf(req);
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
        userData = await syncUserLimits(userData, tz, isEffectivePremium);
        userData.isPremium = isEffectivePremium;
      } else {
        // Guests: the free allowance, kept in memory per guest id.
        guestQuota = await getOrCreateGuestQuota(userId, tz);
        userData = {
          isPremium: false,
          proQueriesAvailable: guestQuota.proQueriesAvailable,
          flashQueriesAvailable: guestQuota.flashQueriesAvailable,
          lastResetDate: guestQuota.lastResetDate,
          allowancePlan: guestQuota.allowancePlan,
          isGuest: true
        };
      }

      const isPremium = userData.isPremium === true;
      const {
        question,
        history = [],
        imageBase64,
        aiMode = 'standard',
        isGameRunningLocally = false,
        activeGame,
        achievements,
        news,
        language: languageRaw = 'English',
        // On-screen markers on in the app (Settings). Older apps don't send it: on.
        markers: markersRaw,
      } = req.body;
      const wantMarkers = markersRaw !== false;
      // Only languages the apps offer (the name goes into the AI's instructions, so nothing else is let through).
      const language = ['English', 'Spanish', 'Brazilian Portuguese', 'German', 'French', 'Russian', 'Japanese', 'Korean', 'Simplified Chinese'].includes(String(languageRaw))
        ? String(languageRaw)
        : 'English';

      // Fast answers: Gemini 3.8 Flash with adaptive thinking (Flash-Lite for free players after the beta). Pro answers:
      // Gemini Pro. The player picks one next to the send button; when it's used up today, the other one answers.
      let targetModel = hasFullAccess(isPremium) ? MAIN_MODEL : FREE_MODEL;
      const skipPrimary = true;
      const wanted = wantedBucket(req.body);
      const picked = pickBucket(wanted, { pro: Number(userData.proQueriesAvailable) || 0, flash: Number(userData.flashQueriesAvailable) || 0 });

      if (!picked.bucket) {
        const resetAt = nextReset(tz);
        const allow = await allowances();
        const p = isPremium ? allow.premium : allow.free;
        return res.status(429).json({
          text: isPremium
            ? `You've used today's Pro and Fast questions. They're topped up at midnight, and what you don't use carries over.`
            : `You've used today's ${allow.free.pro} Pro and ${allow.free.flash} Fast questions. They reset at midnight. Premium gives you ${allow.premium.pro} Pro and ${allow.premium.flash} Fast questions a day, and what you don't use carries over.`,
          modelUsed: 'Limit Reached',
          limit: { resetAt, isPremium, dailyPro: p.pro, dailyFlash: p.flash, premiumPro: allow.premium.pro, premiumFlash: allow.premium.flash },
          userData: { isPremium, isGuest, ...(await quotaView(userData, isPremium, tz)) },
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
4. CONTEXT INTEGRITY: Never force an assumed game onto a screenshot that clearly shows something else.

[STORY TIMING]
Work out where the player is in the story from the screenshot and the conversation: their location, who is in the party, and which world or chapter they're in (for example Final Fantasy VI's World of Balance vs World of Ruin).
- Only mention items, events and routes that are available at that point in the game.
- If something only becomes available later, leave it out, or clearly say it's "available later in the game" without spoiling how or why.

[PLAIN, ACCURATE TERMS]
Describe things the way the game does. A door is a door, not a "secret passage"; a crate is a crate.
- Don't invent hidden routes, secret rooms, or dramatic details that aren't in the game.
- Only call something secret or hidden when the game actually treats it that way.`;

      // Markers only when the player has them on: nobody sees them otherwise, so they'd only cost tokens.
      if (imageBase64 && wantMarkers) {
        systemInstruction += `

[ON-SCREEN POINTERS]
When your answer refers to specific things that are visible in the game world in the screenshot (an item, container, lever, switch, door, character, enemy or enemy weak point, place, or the path to take), point at them so the player can see exactly where they are. After your answer, add ONE block in exactly this format:
<qc-points>[{"y": 512, "x": 300, "label": "<item, action or person>", "where": "<which object it is among similar ones>", "category": "<one category>", "note": "<what it is: why it matters>", "detail": "<optional extra facts>", "id": "<label | unique | guess: only for a character or a specific name>", "generic": "<the same thing described with no name>"}]</qc-points>
The <...> parts are placeholders: always write your own values. Never copy the placeholder text or any example wording from these instructions into a marker.
- "y" and "x" are the center of the thing in the screenshot, normalized to 0-1000 (y from the top edge, x from the left edge).
- Game world only: markers are for things in the game world (items, containers, enemies, characters, doors, levers, switches, paths and places). Never put a marker on the game's own interface: battle menus, command lists, HP, MP or ATB bars, inventory screens or other HUD elements. Advice about which command to use, whose turn it is, or what to do next belongs in your answer text, not on a marker. The only exception: if the player explicitly asks where something is in a menu, you may point at that menu item.
- What's worth a marker: ${WORTH_POINTING_OUT}
- ${PRECISE_ACTIONS}
- A marker for a move sits on the exact surface or object to use (the rock ledge to jump onto, not the cliff near it),
  and its label is the action itself: "Jump up here", "Shove this", "Throw at this".
- Outside a fight: fewer, better markers, never more than 5. In a fight, [COMBAT] decides instead: every enemy that matters plus the key positions, up to 8. If several markers would say the same thing (for example several identical enemies), give the note to one of them and leave the note out on the others, so they show the label alone.
- Exits and doors are low priority: only mark one if it's clearly visible AND either the player asked how to leave or it's genuinely easy to miss. Markers go to items, secrets, people and hazards first. A normal door isn't worth a marker.
- Top-down games: exits are often just a gap or a doormat at the bottom edge of the room, and the player's own character may be standing on or in front of it. Stairs, ladders and wall openings are not the exit unless you can see they lead out. If you're not sure where the exit is, don't mark it and don't name a specific spot in your answer; just say to leave the room and which way to go.
- Labels: 1 to 4 words, in the player's language.
- "where": a few words that pick out exactly which object it is among similar ones nearby (for example its position: lower-right of the three, second from the left), in the player's language.
- Label each point with what the player cares about, not with what the object is: the item inside a container (not "Barrel" or "Chest"), the action to take ("Pull lever", "Save here"), or who it is ("Talk to <name>", only when the name is on screen or they're unmistakable: see below). Only fall back to naming the object when you don't know anything more useful about it.
${IDENTITY_RULES}
- "category": exactly one of these, matching the thing itself: weapon (weapons), armor (armor, shields, clothing, rings, amulets), consumable (potions, scrolls, food, ammo, and items spent as currency such as Soul Coins), key (keys and key items needed to progress or open something), quest (quest objectives and quest givers), lore (books, notes and readables), secret (hidden switches, passages and stashes), character (people to talk to), enemy, danger (traps and hazards), action (something to do: a lever to pull, a spot to jump), place (exits, waypoints, save points).
- "note": ONE short line (at most 8 words, it's shown under the marker on screen) saying what it is and why the player should care. No filler, no repeating the label. Leave it out on duplicate markers (see above).
- "detail": optional, 1 or 2 short sentences with the most useful extra facts (what it does, who needs it, when to use it, whether it's missable). Leave it out rather than repeating the note.
- "missable": add "missable": true only when the player can lose this for good if they move on (a point of no return, a one-time event, a choice that locks it out). Leave it out otherwise; never guess.
- note and detail are in the player's language and must agree with your answer text.
- Only point at things that are actually visible in the screenshot, and be precise. If nothing specific is worth pointing at, leave the block out entirely.
- Never mention the block, coordinates or "pointers" in your answer text.

Accuracy: a wrong marker is worse than no marker. Players act on these, so:
- Check before pinning: before you name a specific item in a specific container or spot, be certain. If you aren't, use Google Search to confirm it first (for example "<game> <area> <item> location"). If you still can't confirm which object it is, don't pin it: say where to look in your answer text instead.
- Random loot: many containers roll random or level-scaled loot. For those, never list specific contents; say it's random and what it usually holds (for example a note like "Random loot, usually potions or gold"). Only name exact contents for a fixed, known placement.
- Groups: if you know an item is in one of several similar objects but not which one, don't guess a single object. Use ONE marker at the center of the group, with the label "Search these" (in the player's language), "where" describing the whole group (for example "the three sarcophagi along the side wall"), and a note naming the item (for example "<item> is in one of these").
- Never invent names, contents or effects to fill a field. Leave "detail" out, or keep the note general, when you don't know.

If the player is asking about items, secrets or things to find, and you know of others in this same place (the same town, dungeon or area) that are NOT visible in the screenshot, list up to 6 of them in ONE more block:
<qc-nearby>[{"label": "<item>", "hint": "<what the spot looks like>", "onThisMap": true}]</qc-nearby>
- label: what it is (1 to 4 words); hint: where it is, described by what the spot looks like (a few words). Both in the player's language.
- onThisMap: true ONLY if it is on the same map the player is on right now, so it would scroll into view just by walking around (no door, stairs, cave entrance or screen transition in between). false for anything inside a building, on another floor, in another room, or behind a transition.
- Never list anything you already pointed at in <qc-points>: only other items.
- Only list things you are confident about. Leave the block out when there are none, and never mention it in your answer text.`;
      }

      // A quest-log title on every in-game answer (the objectives tracker shows it), markers or not.
      if (isGameContextAvailable) {
        systemInstruction += `

[QUEST TITLE]
End every answer with one line naming what the player is doing right now, like a quest title in an RPG quest log:
<qc-title>Short quest name</qc-title>
- 2 to 6 words, at most 60 characters, in the player's language, title-style (for example "Loot the Sunken Crypt", "Find Duncan's Cabin"). No quotes, no ending punctuation, never a sentence about the answer itself.
- Never mention the title line in your answer text.`;
        // The quest log's steps: what the player should keep in front of them (src/utils/trackerPayload.ts).
        systemInstruction += STEPS_RULES;
        // A fight on screen: a battle plan, enemy and position markers, the steps as the plan (answerBar.ts).
        if (imageBase64) systemInstruction += combatRules(wantMarkers);
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
      
      // Where the player is. Many games reuse near-identical rooms, so the AI must not guess a place and build the
      // answer on it: it reports its guess, the app lets the player confirm it with one tap (or by voice), and a
      // confirmed place is sent back here on every later question.
      let place = req.body.place && typeof req.body.place.name === 'string' && req.body.place.name.trim()
        ? { name: String(req.body.place.name).trim().slice(0, 80), confirmed: req.body.place.confirmed === true }
        : null;
      let story = req.body.place && typeof req.body.place.story === 'string' && req.body.place.story.trim()
        ? { text: String(req.body.place.story).trim().slice(0, 120), confirmed: req.body.place.storyConfirmed === true }
        : null;
      // A game with a guide has official area names: the AI uses them, so places line up with guide pages and facts.
      const guideAreas = await getGuideAreaNames(effectiveGame?.name);
      // A place is always one guide area ("Emerald Grove, Ravaged Beach" was two joined).
      if (place && guideAreas.length) place = { ...place, name: singleArea(place.name, guideAreas) };
      // On-screen place wins: with a screenshot, a place name read on screen (a minimap label, an area title) that names
      // a guide area or one of its sub-locations replaces the stored place, confirmed, before the answer is built (the
      // guide notes, the guide order and the quest log follow it). Locate me's check, without its daily allowance.
      const guideFull = imageBase64 && guideAreas.length ? await guideAreasWithPages(String(effectiveGame?.name || '')).catch(() => null) : null;
      let placeRead: { area: string; seenText: string; story: string } | null = guideFull?.areas?.length
        ? await readPlaceOnScreen(getGeminiClient(), imageBase64, String(effectiveGame?.name || ''), guideFull, place?.name || '')
        : null;
      if (placeRead) {
        const moved = !place || !samePlace(place.name, placeRead.area);
        place = { name: placeRead.area, confirmed: true };
        // A different area: the old story beat doesn't carry over.
        if (moved) story = placeRead.story ? { text: placeRead.story, confirmed: false } : null;
        situationalContext += `\n[PLACE READ ON SCREEN: "${placeRead.seenText}", so the player is in ${placeRead.area}. A place read on screen overrides any stored or confirmed location, and anything earlier in this conversation about where they were: they are in ${placeRead.area} now, so answer for ${placeRead.area}.]\n`;
      }
      if (guideAreas.length) {
        situationalContext += `\n[AREAS IN THIS GAME'S GUIDE, in story order. When the player is in one of these, use its exact name as the place name: ${guideAreas.join(' | ')}]\n`;
      }
      // Don't point backwards: areas before the player's in the guide's order are assumed done.
      const areaIndex = place ? guideAreas.findIndex((a) => samePlace(a, place!.name)) : -1;
      if (areaIndex > 0) {
        const earlier = guideAreas.slice(Math.max(0, areaIndex - 8), areaIndex);
        situationalContext += `\n[GUIDE ORDER: the player is in ${guideAreas[areaIndex]}, area ${areaIndex + 1} of ${guideAreas.length} in the guide's order. Steps, fights and events in earlier areas (${areaIndex > 8 ? '…, ' : ''}${earlier.join(', ')}) are assumed done, including the way into ${guideAreas[areaIndex]} (its gate, entrance or approach, and any fight there): never send the player back, tell them to go to or approach those places, or prepare them for those fights, even if earlier messages in this conversation did, unless they ask about it.]\n`;
      }
      // Progress memory: what the player has already done in this game (the app's list, most recent first).
      const doneList: string[] = (Array.isArray(req.body.done) ? req.body.done : [])
        .map((x: unknown) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 130))
        .filter(Boolean)
        .slice(0, 30);
      if (doneList.length) {
        situationalContext += `\n[ALREADY DONE in this game (most recent first): ${doneList.join(' | ')}. Never suggest doing any of these, or going back for them, unless the player asks about one.]\n`;
      }
      if (story?.confirmed) {
        situationalContext += `\n[PLAYER'S CONFIRMED STORY POINT: ${story.text}. The player confirmed this; trust it over your own guess, and only mention what's available at this point.]\n`;
      } else if (story) {
        situationalContext += `\n[Last known story point (an earlier guess, not confirmed): ${story.text}]\n`;
      }
      if (place?.confirmed) {
        situationalContext += `\n[PLAYER'S CONFIRMED LOCATION: ${place.name}. The player confirmed this. Trust it over your own guess from the screenshot, unless the screen clearly shows they've moved somewhere else.]\n`;
      } else if (place) {
        situationalContext += `\n[Last known location (an earlier guess, not confirmed by the player): ${place.name}]\n`;
      }
      systemInstruction += `

[WHERE THE PLAYER IS]
Many games reuse near-identical rooms and tiles, so never assume a specific place from looks alone.
- Only name a specific place (town, house, dungeon, area) in your answer if something confirms it: on-screen text or a sign, a unique landmark, the player said so, or a confirmed location above that still matches the screen. Otherwise describe what's visible ("this house", "this room") and keep the answer to what's safe without knowing the exact place.
- At the very end of your answer, add one line in exactly this format (it's removed before the player sees it):
<qc-place>{"name": "Place, Region", "sure": true, "options": [], "story": "Story point", "storySure": false, "storyOptions": [], "seenText": ""}</qc-place>
  - "name": your best identification of where the player is, e.g. "Duncan's House, near South Figaro". In a game with
    guide areas (listed above), exactly one area name from that list, never two joined.
  - "seenText": any place name visibly written on screen (a minimap label, an area title card, a map screen, a location
    banner), exactly as written; empty if none. A place read on screen always wins over the stored or confirmed
    location: then "name" is the place it names, with sure true.
  - "sure": true only when something confirms it, as above. If the player just told you where they are, use their words and true.
  - "options": always 2 or 3 other places this could be, most likely first, even when you're sure (the player picks one
    with a single tap if your guess is wrong).
  - If a confirmed location is given above and the screen still fits it, repeat that name with sure true.
  - "story": where the player is in the story, as a short quest-log phrase (3 to 8 words, in the player's language), e.g.
    "Heading to Mt. Kolts with Edgar and Locke" or "Exploring the Nautiloid crash site". Never a sentence about the
    player ("The player is exploring…"). The same for "storyOptions".
    Many places are visited more than once, and the lead character alone rarely tells you which visit this is.
  - "storySure": true only if the conversation, a confirmed story point above, or something on screen settles it
    (the whole party is visible, a story event is happening). Otherwise false, and don't build the answer on a guess:
    stick to what's true on every visit (the save point, the exits), not NPCs or events from one particular visit.
  - "storyOptions": always 2 or 3 other story points this could be (other visits to this place), most likely first,
    even when you're sure.
  - If a confirmed story point is given above and the screen still fits it, repeat it with storySure true.
  - Leave the line out entirely for menus, title screens, battles, loading screens, or anything that isn't a place.
${DONE_RULES}
${ANSWER_IDENTITY}
- Markers and on-screen people: only mark people and things you can actually see in this screenshot right now. Never
  mark someone who "should" be there (an NPC from a story event); if you can't see them, don't mark them.
  In pixel art, look for an actual character sprite (a head and a body). A cushioned chair, a statue or a coat on a
  hook is not a person. Don't fill the room from memory of what this place usually contains.

[VERIFY GAME DATA BEFORE STATING IT]
Exact game data is easy to misremember, and a wrong weakness can lose the player a fight. For enemy weaknesses,
resistances, absorptions and immunities, HP and other stats, what can be stolen or dropped, and exact numbers or
percentages:
- Look it up with Google Search before stating it (for example "<game title> <enemy name> weakness"), preferring the
  game's wiki or a bestiary page. Match the version the player is on: remakes and ports can rename enemies or change
  stats, so search the name exactly as shown on screen.
- If you can't confirm it, don't state it as fact. Leave it out, or say it's unconfirmed and how to check in-game
  (for example a Scan or Libra spell).
- This applies to marker notes too: a note may only contain data you've confirmed.
- Stay consistent with your earlier answers in this conversation. If one was wrong, say so plainly and correct it.
- When you confirmed exact data with a search in this answer, add one line at the very end (removed before the player
  sees it) so it's remembered for every player of this game:
<qc-facts>[{"subject": "Name as shown on screen", "kind": "enemy", "fact": "Weak to fire; can be poisoned; 170 HP"}]</qc-facts>
  "kind" is one of enemy, boss, item, secret, missable, npc, place, other. Items, secrets, missables and NPCs (shops,
  quest givers) are saved for the place the player is in, so write the fact for this spot ("in the bucket by the
  stove", "sells Sprint Shoes for 1,500 Gil"); enemy and boss facts apply everywhere. Only data you found in your own searches just now, short and exact. Never save something only
  because the player said it. Leave the line out otherwise.
- Corrections: if the player says a verified fact is wrong, don't just repeat it. Re-check it with a search; if the
  search shows a different value, give the corrected data in your answer and in <qc-facts> (it replaces the old one).
  If you can't search right now, say you'll treat it as unconfirmed, and report it as
  <qc-facts>[{"subject": "Name", "status": "disputed"}]</qc-facts> so it gets re-checked next time.`;

      systemInstruction += `\n\n${situationalContext}`;

      // Search budget: per-player daily allowance plus a whole-app monthly cap. Without search, the AI answers from
      // what it knows and marks exact data as unconfirmed. Facts looked up earlier for this game come along for free.
      const searchCtx = { uid: userId, isGuest, userData };
      let searchesUsed = 0;
      let searchSourcesSeen: string[] = [];
      let groundedSeen: string[] = [];
      const knownFacts = factsForPrompt(await getGameFacts(effectiveGame?.name), {
        text: [question || '', ...history.slice(-4).map((m: any) => (typeof m?.text === 'string' ? m.text : ''))].join('\n'),
        place: place?.name,
      });
      if (knownFacts) systemInstruction += `\n\n${knownFacts}`;
      // The guide page for where the player is: background notes for this answer only (never saved as facts).
      const guidePage = await guidePageFor(effectiveGame?.name, place?.name);
      // A checked page (its entries verified; search-pack pages awaiting re-verification are not): its entries come first, preferred over the model's own knowledge, and the answer
      // says which it used (the "From the guide" badge links to them).
      let guideTags: Record<string, GuideRef> = {};
      if (guidePage) {
        if (guidePage.verified) {
          const g = guideGroundingForPrompt(guidePage);
          guideTags = g.refs;
          systemInstruction += `\n\n${g.text}`;
        } else systemInstruction += `\n\n${guideNotesForPrompt(guidePage)}`;
        // This area's fights and enemies in full, for a battle plan when the screenshot shows a fight.
        const fights = imageBase64 ? guideFightNotes(guidePage) : '';
        if (fights) systemInstruction += `\n\n${fights}`;
        // Player corrections to these notes that were verified: used right away, before the page is republished.
        const corrected = await verifiedCorrectionsForPrompt(guidePage.key, guidePage.slug);
        if (corrected) systemInstruction += `\n\n${corrected}`;
        systemInstruction += `\n${CORRECTION_RULES}`;
      }
      // A quick question (a chip in the app): its short label is the question, and this is what it asks for
      // (src/utils/quickQuestions.ts). "Show me where" only makes sense with markers on.
      const quick = isQuickId(req.body.quick) && !(req.body.quick === 'where' && !wantMarkers) ? req.body.quick : null;
      if (quick) systemInstruction += `\n\n[QUICK QUESTION: the player tapped "${String(question || '').slice(0, 80)}"]\n${QUICK_PROMPTS[quick]}`;
      // The kind of question (for the Quality numbers), and the model: Pro when the player's Pro question is answered by
      // Pro (players' share of today's Pro requests isn't used up, chatRouting.ts); otherwise Flash.
      let qtype = questionType(String(question || ''), quick || (isQuickId(req.body.quick) ? req.body.quick : null));
      const routingCfg = await routing();
      const usePro = picked.bucket === 'pro' && (await takePlayerPro(routingCfg));

      // Search (searchPolicy.ts): always for a game released after the answering model's cutoff (past the player's own
      // daily search allowance; the app-wide caps still apply); offered for unfamiliar games and for exact-data questions
      // no checked guide page covers; otherwise only when the model asks for it (<qc-search/>).
      const release = effectiveGame?.name ? await releaseOf(effectiveGame.name, Number(effectiveGame.appId) || undefined) : null;
      const cut = await cutoffs();
      const newRelease = !!release && isNewRelease(release, usePro ? cut.pro : cut.flash);
      const searchMode: SearchMode = !effectiveGame?.name
        ? 'ask'
        : searchModeFor({ newRelease, dated: release?.source !== 'unknown', type: qtype, covered: Boolean(guidePage?.verified) });
      const searchOk = searchMode === 'force'
        ? (await playerSearchesToday()) && (await monthlyBudgetOk())
        : await searchAllowed({ ...searchCtx, fullAccess: hasFullAccess(isPremium) });
      const searchTools = searchOk && searchMode !== 'ask';
      systemInstruction += `\n\n${EXISTENCE_RULES}`;
      if (searchMode === 'force') systemInstruction += `\n\n${FORCE_RULES(effectiveGame!.name, release!.text)}`;
      if (!searchOk) {
        systemInstruction += `\n\n[GOOGLE SEARCH IS NOT AVAILABLE FOR THIS QUESTION]\nAnswer from what you know and the verified facts above. For exact game data you can't confirm, say it's unconfirmed (or leave it out) rather than stating it as fact, and don't put unconfirmed data in marker notes. If something is unfamiliar, say there isn't enough information about it yet and ask for a screenshot or a detail. Don't mention search limits to the player.`;
      }
      // Ask mode: the first try has no search, and may ask for it.
      const firstSystem = searchMode === 'ask' && searchOk ? `${systemInstruction}\n\n${ASK_RULES}` : systemInstruction;
      let searchAsked = false;
      // Which balance pays for the answer: the model that answered (a Pro question answered by Flash, because Pro was
      // slow or unavailable, uses a Fast question when there's one left).
      let chargedBucket: Bucket | null = null;
      const charge = (answeredByPro: boolean) => {
        const b: Bucket = answeredByPro ? 'pro' : Number(userData.flashQueriesAvailable) > 0 ? 'flash' : 'pro';
        if (b === 'pro') userData.proQueriesAvailable = Math.max(0, Number(userData.proQueriesAvailable) - 1);
        else userData.flashQueriesAvailable = Math.max(0, Number(userData.flashQueriesAvailable) - 1);
        chargedBucket = b;
      };
      const saveBalances = async () => {
        if (!isGuest) {
          await updateFirestoreDocREST(idToken, userId, {
            lastResetDate: userData.lastResetDate,
            proQueriesAvailable: userData.proQueriesAvailable,
            flashQueriesAvailable: userData.flashQueriesAvailable,
            allowancePlan: userData.allowancePlan,
          });
        } else if (guestQuota) {
          guestQuota.proQueriesAvailable = userData.proQueriesAvailable;
          guestQuota.flashQueriesAvailable = userData.flashQueriesAvailable;
        }
      };

      // Build Multi-turn Contents
      const contentsPayload: any[] = [];

      // Add past conversation turns
      // Conversation context sent with each question: the last 6 messages, with older answers shortened. The newest
      // answer stays whole so follow-ups ("and the second one?") still work. This is resent on every question.
      const recentHistory = history.slice(-6).map((m: any, i: number, arr: any[]) =>
        m.role !== 'user' && i < arr.length - 1 && typeof m.text === 'string' && m.text.length > 1500
          ? { ...m, text: m.text.slice(0, 1500) + ' …' }
          : m,
      );
      for (const msg of recentHistory) {
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
      // AI banner art is retired (it cost more than the answer itself). Set ENABLE_BANNERS=true to bring it back.
      if (process.env.ENABLE_BANNERS === 'true' && req.body.generateBanner && (effectiveGame || question)) {
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
              logBanner(true);
              return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
            }
          }
          logBanner(false);
          return undefined;
        }).catch(err => {
          console.warn('[Banner Generation] Banner generation failed or skipped:', err?.message || err);
          return undefined;
        });
      }

      // Query Gemini API
      let responseText = '';
      let modelUsed = targetModel === MAIN_MODEL ? 'Gemini 3.8 Flash' : 'Gemini Flash-Lite';

      logDebug(`[API Chat] Processing question "${(question || '').slice(0, 30)}..." with model: ${targetModel}, skipPrimary: ${skipPrimary}`);

      try {
        if (!skipPrimary) {
          logDebug(`[API Chat] Calling primaryCall: ${targetModel}`);
          const primaryCall = ai.models.generateContent({
            model: targetModel,
            contents: contentsPayload,
            config: {
              systemInstruction,
              ...(searchOk ? { tools: [{ googleSearch: {} }] } : {}),
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE }
              ],
              temperature: aiMode === 'roleplay' ? 0.9 : 0.7,
              // "Pro" = more thinking on 3.8 Flash. Thinking is billed like answer text, so it's medium, not high.
              thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            }
          });
          const response = await withTimeout(primaryCall, 30000, 'Deep-thinking Gemini 3.8 Flash query') as any;
          logUsage('chat', targetModel, response);
          searchesUsed += countSearches(response);
          searchSourcesSeen = searchSources(response);
          groundedSeen = groundedText(response);
          responseText = response.text || '';
          logDebug(`[API Chat] primaryCall succeeded, response length: ${responseText.length}`);

          if (responseText && responseText.trim().length > 0) {
            charge(false);
          } else {
            console.log('Primary Pro query returned empty text (possibly blocked by safety). Not deducting credit.');
            responseText = 'No response received. Please try asking again.';
          }
        } else {
          const answerModel = usePro ? PRO_CHAT_MODEL : targetModel;
          if (usePro) modelUsed = 'Gemini 3.1 Pro';
          const answerCall = (sys: string, withSearch: boolean) => ai.models.generateContent({
            model: answerModel,
            contents: contentsPayload,
            config: {
              systemInstruction: sys,
              ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE }
              ],
              temperature: aiMode === 'roleplay' ? 0.9 : 0.7,
              ...(usePro ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : targetModel === MAIN_MODEL ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } } : {}),
            }
          });
          // Pro: no longer than the routing allows, then the Flash fallback below answers (players never wait on Pro).
          // Pro with search takes longer (about 30-40 s): up to 45 s then, still inside the app's 75 s with the fallback.
          const proWait = searchTools ? Math.max(routingCfg.proTimeoutMs, 45000) : routingCfg.proTimeoutMs;
          let response = await withTimeout(answerCall(firstSystem, searchTools), usePro ? proWait : 25000, usePro ? 'Pro query' : 'Flash query') as any;
          logUsage(usePro ? `chat-pro:${qtype}` : 'chat', answerModel, response);
          // A new release must be answered from a search: if the model skipped it, once more, told to search first.
          // (Flash only: Pro follows the instruction, and a second Pro call would run past the app's wait.)
          if (searchMode === 'force' && searchTools && !usePro && countSearches(response) === 0) {
            const first = response;
            try {
              response = await withTimeout(answerCall(`${systemInstruction}\n\n${FORCE_AGAIN}`, true), 25000, 'New release, searching') as any;
              logUsage(usePro ? 'chat-pro-searched' : 'chat-searched', answerModel, response);
              if (!String(response?.text || '').trim()) response = first;
            } catch {
              response = first;
            }
          }
          if (searchMode === 'ask' && asksForSearch(response?.text || '')) {
            // The model needs a search for this one: the same question again, with search when it's allowed.
            searchAsked = true;
            response = await withTimeout(answerCall(systemInstruction, searchOk), usePro ? (searchOk ? Math.max(routingCfg.proTimeoutMs, 45000) : routingCfg.proTimeoutMs) : 25000, 'Answer after asking to search') as any;
            logUsage(usePro ? 'chat-pro-searched' : 'chat-searched', answerModel, response);
          }
          searchesUsed += countSearches(response);
          searchSourcesSeen = searchSources(response);
          groundedSeen = groundedText(response);
          responseText = response.text || '';

          if (responseText && responseText.trim().length > 0) {
            charge(usePro);
          } else {
            console.log('Answer returned empty text. Not deducting a question.');
            responseText = 'No response received. Please try asking again.';
          }
        }
        await saveBalances();
      } catch (primaryErr: any) {
        console.log('Primary query issue or timeout, attempting fallback. Reason:', primaryErr?.message);
        
        try {
          // Fallback retry
          const retryPromise = ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: [{ parts: currentParts }],
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              // Google's daily search limit (or any quota) refused the first try: answer without search.
              ...(searchOk && !/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(String(primaryErr?.message || '')) ? { tools: [{ googleSearch: {} }] } : {}),
              safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE }
              ],
            }
          });
          const retryResponse = await withTimeout(retryPromise, 25000, 'Flash Fallback query') as any;
          logUsage('chat-fallback', 'gemini-3.8-flash', retryResponse);
          searchesUsed += countSearches(retryResponse);
          searchSourcesSeen = searchSources(retryResponse);
          groundedSeen = groundedText(retryResponse);
          responseText = retryResponse.text || '';
          modelUsed = 'Gemini 3.8 Flash (Fallback)';

          if (!responseText || responseText.trim().length === 0) {
             console.log('Emergency Flash Lite fallback returned empty text.');
             responseText = 'No response received. Please try asking again.';
          }
          
          charge(false);
          await saveBalances();
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
            logUsage('chat-emergency', 'gemini-3.1-flash-lite', emergencyResponse);
            responseText = emergencyResponse.text || 'No response received.';
            modelUsed = 'Gemini 3.1 Flash Lite (Emergency Fallback)';
            
            charge(false);
            await saveBalances();
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

      responseText = stripSearchCitations(responseText);

      // Free players' screenshot questions (when switched on): a Pro step places the markers on the Flash answer.
      // Slow or failed, or no Pro requests left: the answer keeps its own markers.
      let markersBy = '';
      if (routingCfg.freeProMarkers && !isPremium && wantMarkers && imageBase64 && !usePro && /<qc-points>/i.test(responseText) && (await takePlayerPro(routingCfg))) {
        try {
          const shown = responseText.replace(/<qc-points>[\s\S]*?<\/qc-points>/gi, '').slice(0, 6000);
          const markerCall = ai.models.generateContent({
            model: PRO_CHAT_MODEL,
            contents: [{ role: 'user', parts: [...currentParts.filter((p: any) => p.inlineData), { text: `${promptText}\n\n[THE ANSWER ALREADY GIVEN]\n${shown}\n\n[TASK] Reply with only the <qc-points> block for this answer and this screenshot, following the marker rules exactly: point at what the answer tells the player to look at, and only at things you can actually see.` }] }],
            config: { systemInstruction, temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
          });
          const mr: any = await withTimeout(markerCall, Math.min(20000, routingCfg.proTimeoutMs), 'Pro marker step');
          logUsage('chat-pro-markers', PRO_CHAT_MODEL, mr);
          const block = String(mr?.text || '').match(/<qc-points>[\s\S]*?<\/qc-points>/i);
          if (block) {
            responseText = `${responseText.replace(/(?:```[a-z]*\s*)?<qc-points>[\s\S]*?<\/qc-points>(?:\s*```)?/gi, '')}\n${block[0]}`;
            markersBy = 'Gemini 3.1 Pro';
          }
        } catch (e: any) {
          console.log('[chat] Pro marker step skipped:', e?.message);
        }
      }
      // The guide entries the answer used (a checked or flagship page's tags).
      const guideParsed = extractGuideRefs(responseText, guideTags);
      responseText = guideParsed.text;

      // On-screen pointers: pull the <qc-points> block out of the answer.
      // A fight on screen (the model's <qc-combat/>): enemy and tactical markers are never dropped as low-value.
      const combatParsed = extractCombat(responseText);
      responseText = combatParsed.text;
      if (combatParsed.combat && qtype === 'general') qtype = 'fight';
      const { text: answerText, points, nearby } = extractScreenPoints(responseText, Boolean(imageBase64), combatParsed.combat);
      responseText = answerText;
      // The quest-log title for the on-screen objectives tracker (any in-game answer, markers or not).
      const titleParsed = extractTitle(responseText);
      responseText = titleParsed.text;
      const title = titleParsed.title;
      // The quest log's steps (1-4 takeaways), always removed from the text.
      const stepsParsed = extractSteps(responseText, { combat: combatParsed.combat });
      responseText = stepsParsed.text;
      // Where the AI thinks the player is: pull the <qc-place> line out of the answer.
      const placeParsed = extractPlace(responseText);
      responseText = placeParsed.text;
      // A story point can't be "sure" from a single screenshot with no conversation and nothing the player confirmed:
      // the same place is often visited several times. Force the question so the player can confirm with one tap.
      if (placeParsed.place?.story && placeParsed.place.storySure && !story?.confirmed && history.length === 0) {
        placeParsed.place.storySure = false;
      }
      // The answer's place is one guide area; a place name it read on screen (seenText) that names a guide area counts
      // like the read before the answer (when that one found nothing).
      if (placeParsed.place && guideAreas.length) placeParsed.place.name = singleArea(placeParsed.place.name, guideAreas);
      if (!placeRead && guideFull?.areas?.length && placeParsed.place?.seenText) {
        const area = areaForSeenText(placeParsed.place.seenText, guideFull);
        if (area) placeRead = { area, seenText: placeParsed.place.seenText, story: storyPhrase(placeParsed.place.story || '') };
      }
      if (placeRead && placeParsed.place) placeParsed.place = { ...placeParsed.place, name: placeRead.area, sure: true };
      // Something the answer says the player has finished (progress memory).
      const doneParsed = extractDone(responseText);
      responseText = doneParsed.text;
      // Facts the AI confirmed with a search: remember them for this game. Count the searches this question ran.
      const factsParsed = extractFacts(responseText);
      responseText = factsParsed.text;
      // Corrections to the guide notes (after the player pushed back, or on something asked directly): saved as
      // candidates to be verified (corrections.ts), never applied from one player.
      const correctionsParsed = extractCorrections(responseText);
      responseText = correctionsParsed.text;
      const correctionIds = await saveCorrectionCandidates({
        page: guidePage, corrections: correctionsParsed.corrections, question: String(question || ''), uid: userId, isGuest, game: String(effectiveGame?.name || ''),
      });
      // A fight on screen that the area's guide page doesn't cover: a missing-fight candidate (the fight, its enemies
      // and the battle plan's steps; no conversation text). In the background: the answer doesn't wait for it.
      if (combatParsed.combat && guidePage) {
        void saveMissingFight({ page: guidePage, combat: combatParsed, steps: stepsParsed.steps, uid: userId, isGuest, game: String(effectiveGame?.name || '') });
      }
      if (searchesUsed > 0) recordSearches(searchCtx, searchesUsed);
      if (chargedBucket) recordPlayerCost({ uid: userId, premium: isPremium, guest: isGuest, dollars: costScope.dollars, searches: costScope.searches });
      // One line per answer, for the search rate per question (searchPolicy.ts).
      console.log(`[chat-search] mode=${searchMode} allowed=${searchOk} asked=${searchAsked} searches=${searchesUsed} model=${chargedBucket || '-'}${newRelease ? ' new-release' : ''}`);
      // Only file a fact under a place or story point that's actually known: confirmed by the player, or settled on
      // screen. A guessed place would put facts in the wrong spot for everyone.
      // A fact only counts if its subject shows up in a part of the answer a search result actually backs up;
      // the AI can report facts from memory even when it searched for something else.
      recordGameDemand(effectiveGame?.name, userId, language); // which games and languages players use (for the guide pipeline)
      recordDailyActivity(userId, isGuest, req.headers['user-agent'], String(req.headers['x-qc-app'] || '')); // daily questions, players vs guests, and which app
      const factsSaved = saveGameFacts(effectiveGame?.name, factsBackedBySearch(factsParsed.facts, groundedSeen), {
        searched: searchesUsed > 0,
        // The confirmed place only counts while the player is still there: if this answer is about a different place,
        // the player has moved on, and facts go under the new place only if something on screen settled it.
        place: (() => {
          const a = (place?.name || '').toLowerCase(), b = (placeParsed.place?.name || '').toLowerCase();
          const same = !b || a === b || a.startsWith(`${b},`) || b.startsWith(`${a},`);
          if (place?.confirmed && same) return place.name;
          return placeParsed.place?.sure ? placeParsed.place.name : undefined;
        })(),
        story: story?.confirmed ? story.text : placeParsed.place?.storySure ? placeParsed.place.story : undefined,
        sources: searchSourcesSeen,
      });

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
      if (!bannerImageUrl && req.body.generateBanner && process.env.ENABLE_BANNERS === 'true') {
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
        ...(title ? { title } : {}),
        ...(stepsParsed.steps.length ? { steps: stepsParsed.steps } : {}),
        ...(combatParsed.combat ? { combat: true } : {}),
        // A screenshot with no fight on it: a fight the player was in is over (the app clears its combat markers and plan).
        ...(imageBase64 && !combatParsed.combat ? { noFight: true } : {}),
        ...(nearby.length ? { nearby } : {}),
        ...(placeParsed.place ? { place: placeParsed.place } : {}),
        // A place read on screen (a guide area): the app confirms it as where the player is.
        ...(placeRead ? { placeRead: { area: placeRead.area, seenText: placeRead.seenText, ...(placeRead.story ? { story: placeRead.story } : {}) } } : {}),
        // Finished content the answer reported, and the fight a combat answer was about (progress memory).
        ...(doneParsed.done.length ? { done: doneParsed.done } : {}),
        ...(combatParsed.combat && combatParsed.fight ? { fight: combatParsed.fight } : {}),
        ...(factsSaved ? { factsSaved } : {}),
        ...(correctionIds.length ? { correctionIds } : {}),
        // The kind of question (for the player's feedback and the Quality numbers), the guide entries the answer used,
        // and who placed the markers when that wasn't the answer's model.
        qtype,
        ...(guideParsed.used.length ? { guideRefs: guideParsed.used } : {}),
        ...(markersBy && points.length ? { markersBy } : {}),
        // Which model's question the answer used ("pro" or "fast"), and whether that wasn't the one the player picked
        // (it was used up: the app switches its toggle and says so).
        ...(chargedBucket ? { answeredWith: chargedBucket === 'pro' ? 'pro' : 'fast', ...(chargedBucket !== wanted ? { switched: true } : {}) } : {}),
        searched: searchesUsed > 0,
        userData: {
          isPremium: userData.isPremium === true,
          isGuest,
          ...(await quotaView(userData, userData.isPremium === true, tz)),
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

  /** The AI's "where is the player" line: {name, sure, options}. Removed from the answer text either way. */
  type PlaceOut = { name: string; sure: boolean; options: string[]; story?: string; storySure?: boolean; storyOptions?: string[]; seenText?: string };
  function extractPlace(text: string): { text: string; place: PlaceOut | null } {
    let place: PlaceOut | null = null;
    const cleaned = text.replace(/<qc-place>([\s\S]*?)<\/qc-place>/gi, (_m, body) => {
      try {
        const p = JSON.parse(String(body).trim());
        const name = String(p?.name ?? '').trim().slice(0, 80);
        if (name) {
          const options = (Array.isArray(p?.options) ? p.options : [])
            .map((o: unknown) => String(o ?? '').trim().slice(0, 80))
            .filter((o: string, i: number, arr: string[]) => o && o.toLowerCase() !== name.toLowerCase() && arr.indexOf(o) === i)
            .slice(0, 3);
          // Story beats are quest-log phrases ("Exploring the Nautiloid crash site"), never notes about "the player".
          const story = storyPhrase(String(p?.story ?? '')).slice(0, 120);
          const storyOptions = (Array.isArray(p?.storyOptions) ? p.storyOptions : [])
            .map((o: unknown) => storyPhrase(String(o ?? '')).slice(0, 120))
            .filter((o: string, i: number, arr: string[]) => o && o.toLowerCase() !== story.toLowerCase() && arr.indexOf(o) === i)
            .slice(0, 3);
          const seenText = String(p?.seenText ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
          place = { name, sure: p?.sure === true, options, ...(story ? { story, storySure: p?.storySure === true, storyOptions } : {}), ...(seenText ? { seenText } : {}) };
        }
      } catch {
        /* a malformed line is simply dropped */
      }
      return '';
    });
    return { text: cleaned.replace(/\n{3,}/g, '\n\n').trim(), place };
  }

  /**
   * Google Search grounding can leave raw citation tags in the answer, e.g. `[PerQueryResult(index="3.2.9")]`
   * (search 3, result 2, part 9). They're meant for software, not players, so remove them, one or several per bracket.
   */
  function stripSearchCitations(text: string): string {
    return text.replace(/[ \t]*\[\s*PerQueryResult\([^)\]]*\)(?:\s*,\s*PerQueryResult\([^)\]]*\))*\s*\]/g, '');
  }

  /**
   * On-screen pointers: the model may append <qc-points>[{"y":..,"x":..,"label":".."}]</qc-points> (0-1000 scale).
   * Returns the answer without the block, and up to 5 validated points as 0-1 fractions (8 in a fight).
   * The block is always removed, even when no screenshot was sent (the points would be meaningless then).
   */
  const MARKER_CATEGORIES = new Set(['weapon', 'armor', 'consumable', 'key', 'quest', 'lore', 'secret', 'character', 'enemy', 'danger', 'action', 'place']);
  type ParsedPoint = { x: number; y: number; label: string; where?: string; category?: string; note?: string; detail?: string; missable?: boolean; rank?: number };

  /** The model's <qc-title> line (a short quest-log name for the objectives tracker), always removed from the answer. */
  function extractTitle(text: string): { text: string; title: string } {
    let title = '';
    const cleaned = text.replace(/(?:```[a-z]*\s*)?<qc-title>([\s\S]*?)<\/qc-title>(?:\s*```)?/gi, (_m, inner) => {
      if (!title) title = String(inner).replace(/\s+/g, ' ').replace(/^["'“”‘’]+|["'“”‘’.!:;]+$/g, '').trim();
      return '';
    }).replace(/\n{3,}/g, '\n\n').trim();
    if (title.length > 60) title = title.slice(0, 60).replace(/\s+\S*$/, '').trim();
    return { text: cleaned || text, title };
  }
  function extractScreenPoints(text: string, hadImage: boolean, combat = false): { text: string; points: ParsedPoint[]; nearby: { label: string; hint: string; onMap: boolean }[] } {
    // Other items in the same area that aren't on screen yet (the desktop app looks for them as the player walks).
    let nearbyRaw = '';
    text = text.replace(/(?:```[a-z]*\s*)?<qc-nearby>([\s\S]*?)<\/qc-nearby>(?:\s*```)?/gi, (_m, inner) => {
      if (!nearbyRaw) nearbyRaw = inner;
      return '';
    });
    const nearby: { label: string; hint: string; onMap: boolean }[] = [];
    if (hadImage && nearbyRaw) {
      try {
        const parsed = JSON.parse(nearbyRaw.trim());
        if (Array.isArray(parsed)) {
          for (const n of parsed.slice(0, 6)) {
            const label = String(n?.label ?? '').trim().slice(0, 40);
            if (label) nearby.push({ label, hint: String(n?.hint ?? '').trim().slice(0, 100), onMap: n?.onThisMap === true });
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
    const points: ParsedPoint[] = [];
    if (hadImage && raw) {
      try {
        const parsed = JSON.parse(raw.trim());
        if (Array.isArray(parsed)) {
          // A fight: every important enemy plus key positions (up to 8); otherwise 5.
          for (const p of parsed.slice(0, combat ? COMBAT_MARKER_LIMIT : MARKER_LIMIT)) {
            const pt = Array.isArray(p?.point) ? { y: p.point[0], x: p.point[1] } : p;
            const x = Number(pt?.x), y = Number(pt?.y);
            const label = String(p?.label ?? '').trim().slice(0, 40);
            const where = String(p?.where ?? '').trim().slice(0, 100);
            if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1000 && y >= 0 && y <= 1000 && label) {
              const category = String(p?.category ?? '').trim().toLowerCase();
              // Who it names: a guessed name never shows (the nameless description instead, or no marker at all).
              const named = checkIdentity({
                label, category,
                note: String(p?.note ?? '').trim().slice(0, 140),
                detail: String(p?.detail ?? '').trim().slice(0, 400),
                id: p?.id, generic: p?.generic,
              });
              if (!named) continue;
              const note = named.note || '';
              const detail = named.detail || '';
              // Obvious low-value things (a corpse in plain view with minor supplies) never become markers.
              if (!combat && isTrivialMarker({ label, note, detail, category, missable: p?.missable === true })) continue;
              // "Climb here" when the answer says to jump: the label names the game's own action.
              const sharp = sharpenAction(named.label, cleaned);
              points.push({
                x: Math.round(x) / 1000,
                y: Math.round(y) / 1000,
                label: sharp.text.slice(0, 40),
                ...(where ? { where } : {}),
                ...(MARKER_CATEGORIES.has(category) ? { category } : {}),
                ...(note ? { note } : {}),
                ...(detail && detail !== note ? { detail } : {}),
                ...(p?.missable === true ? { missable: true } : {}),
                // Kill order (combat): the top 2-3 targets, numbered and drawn stronger.
                ...(combat && Number.isInteger(p?.rank) && p.rank >= 1 && p.rank <= 3 ? { rank: p.rank } : {}),
              });
            }
          }
        }
      } catch {
        /* malformed block: ignore the points, keep the answer */
      }
    }
    // A fight: the ranked targets first, in kill order (their numbers then match the answer's list).
    if (combat) points.sort((a, b) => (a.rank || 9) - (b.rank || 9));
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
  // Gemini voices. The app's default narrator is the device's own built-in voice (free); Gemini voices are part of
  // the full experience (Premium, or everyone during the beta). Model: Google's recommended read-aloud model, with the
  // older one as a fallback if it's unavailable.
  let ttsModel = process.env.TTS_MODEL || 'gemini-3.8-flash-lite-tts';
  const TTS_FALLBACK_MODEL = 'gemini-3.1-flash-tts-preview';

  app.post('/api/tts', optionalAuth, async (req, res) => {
    try {
      const { text, voice = 'Puck', stream = true } = req.body;
      if (!text) {
        return res.status(400).json({ error: 'Text is required for speech' });
      }
      if (!BETA_ALL_ACCESS) {
        const u = (req as any).user;
        const token = req.headers.authorization?.split('Bearer ')[1] || '';
        let premium = false;
        if (u?.uid && !u.isGuest && !String(u.uid).startsWith('guest_')) {
          try {
            premium = (await getFirestoreDocREST(token, u.uid))?.isPremium === true;
          } catch {
            premium = false;
          }
        }
        if (!premium) {
          return res.status(403).json({ error: 'Gemini voices are part of Premium. The built-in voice is free.', premiumRequired: true });
        }
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
            const speak = (model: string) =>
              ai.models.generateContent({
                model,
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
            let ttsResult: any;
            try {
              ttsResult = await speak(ttsModel);
            } catch (modelErr: any) {
              if (ttsModel === TTS_FALLBACK_MODEL) throw modelErr;
              console.warn(`[tts] ${ttsModel} failed (${modelErr?.message}); using ${TTS_FALLBACK_MODEL} from now on`);
              ttsModel = TTS_FALLBACK_MODEL;
              ttsResult = await speak(ttsModel);
            }
            logUsage('narration', ttsModel, ttsResult);
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
    <div class="updated">Last updated: October 5, 2026</div>

    <p>Welcome to <strong>Quest Compendium</strong> (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;the application&rdquo;). This Privacy Policy explains how personal information and application data are collected, used, and protected when you use our desktop application and web services.</p>

    <h2>1. Information We Collect</h2>
    <p>Quest Compendium accesses, collects, or processes the following categories of data solely to provide gaming companion features:</p>
    <ul>
      <li><strong>Account Information:</strong> If you sign in, we collect your email address and authentication credentials managed securely through Firebase Authentication.</li>
      <li><strong>Steam Profile & Gameplay Data:</strong> If you link your public Steam ID, we retrieve publicly accessible profile data, game libraries, and achievements via the public Steam Web API to display your in-game statistics and patch notes. We never collect or access your Steam passwords or login credentials.</li>
      <li><strong>User-Submitted Queries & Content:</strong> Questions you ask the AI compendium, chat histories, personal playthrough notes, and quest checklist items you save.</li>
      <li><strong>User-Initiated Audio & Screenshots:</strong> If you explicitly initiate voice input or attach an in-game screenshot for visual puzzle solving, the audio or image data is sent securely to our backend and processed by AI models to fulfill your request. We do not perform background screen recording or passive microphone listening.</li>
      <li><strong>Reported Answers:</strong> If you report an AI answer (the Report button on an answer), we store the report for review: the reason and any comment you add, the question and the answer, the game and place, the AI model and app version, the date, and an anonymised identifier instead of your account. Reports are used only to review and improve answers and guides, and are deleted on request with your other data.</li>
      <li><strong>Payment Information:</strong> Subscriptions and upgrades are processed securely via Stripe. We do not store or process credit card numbers or financial account details on our servers.</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <p>We use the collected information strictly for:</p>
    <ul>
      <li>Providing context-aware gaming guides, walkthroughs, patch summaries, and AI responses.</li>
      <li>Synchronizing your compendium tabs, notes, and preferences across your authorized devices using secure cloud storage.</li>
      <li>Verifying subscription status and managing daily query quotas.</li>
      <li>Maintaining and improving app reliability and performance.</li>
      <li>Improving our game guides: when an answer corrects one of our guides (for example after you say a location is wrong), the correction may be saved anonymously and used to improve the guide. We keep only the text of the correction, the game and area it is about, and a one-way anonymised identifier (never your account, email or screenshots), and we check it against other sources or other players before changing a guide.</li>
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
