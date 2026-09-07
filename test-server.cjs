var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_crypto = __toESM(require("crypto"), 1);
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_genai = require("@google/genai");
var import_dotenv = __toESM(require("dotenv"), 1);
var import_xml2js = __toESM(require("xml2js"), 1);
var import_app = require("firebase-admin/app");
var import_auth = require("firebase-admin/auth");
var import_cors = __toESM(require("cors"), 1);
var import_stripe = __toESM(require("stripe"), 1);
async function getFirestoreDocREST(idToken, uid) {
  const projectId = "gen-lang-client-0366642934";
  const databaseId = "ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f";
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users/${uid}`;
  const response = await fetch(url, { headers: { "Authorization": `Bearer ${idToken}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore read error: ${await response.text()}`);
  const data = await response.json();
  const parsed = {};
  if (data.fields) {
    for (const [k, v] of Object.entries(data.fields)) {
      parsed[k] = v.stringValue ?? v.booleanValue ?? v.integerValue;
      if (parsed[k] !== void 0 && v.integerValue !== void 0) {
        parsed[k] = parseInt(v.integerValue, 10);
      }
    }
  }
  return parsed;
}
async function updateFirestoreDocREST(idToken, uid, fields) {
  const projectId = "gen-lang-client-0366642934";
  const databaseId = "ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f";
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join("&");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users/${uid}?${mask}`;
  const firestoreFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "boolean") firestoreFields[k] = { booleanValue: v };
    else if (typeof v === "number") firestoreFields[k] = { integerValue: v };
    else if (typeof v === "string") firestoreFields[k] = { stringValue: v };
  }
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Authorization": `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: firestoreFields })
  });
  if (!response.ok) throw new Error(`Firestore write error: ${await response.text()}`);
}
import_dotenv.default.config();
var stripeClient = null;
function getStripe() {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY environment variable is required for checkout.");
    }
    stripeClient = new import_stripe.default(key, { apiVersion: "2025-03-31.basil" });
  }
  return stripeClient;
}
(0, import_app.initializeApp)({
  projectId: "gen-lang-client-0366642934"
});
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    return new import_genai.GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  throw new Error("A Gemini API key is required. Please add it in the settings menu.");
}
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use((0, import_cors.default)());
  app.post("/api/webhook", import_express.default.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!endpointSecret) {
      return res.status(400).send("Webhook secret not configured.");
    }
    let event;
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("Webhook signature verification failed.", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.client_reference_id;
      if (userId) {
        try {
          console.log("Stripe webhook received checkout for", userId);
          console.log(`Successfully upgraded user ${userId} to Premium!`);
        } catch (dbErr) {
          console.error("Failed to update user in Firestore:", dbErr);
        }
      }
    }
    res.json({ received: true });
  });
  app.use(import_express.default.json({ limit: "25mb" }));
  app.use(import_express.default.urlencoded({ extended: true, limit: "25mb" }));
  const requireAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
    }
    const token = authHeader.split("Bearer ")[1];
    try {
      const decodedToken = await (0, import_auth.getAuth)().verifyIdToken(token);
      req.user = decodedToken;
      next();
    } catch (error) {
      console.error("Error verifying auth token:", error);
      res.status(401).json({ error: "Unauthorized: Invalid token" });
    }
  };
  const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split("Bearer ")[1];
      try {
        const decodedToken = await (0, import_auth.getAuth)().verifyIdToken(token);
        req.user = decodedToken;
      } catch (error) {
      }
    }
    next();
  };
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
  });
  function verifySeal(userData) {
    if (!userData.securitySeal) return false;
    const secret = process.env.STRIPE_WEBHOOK_SECRET || "default_secret";
    const payload = `${userData.proQueriesAvailable}-${userData.flashQueriesAvailable}-${userData.lastResetDate}`;
    const expectedSeal = import_crypto.default.createHmac("sha256", secret).update(payload).digest("hex");
    return userData.securitySeal === expectedSeal;
  }
  function generateSeal(userData) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET || "default_secret";
    const payload = `${userData.proQueriesAvailable}-${userData.flashQueriesAvailable}-${userData.lastResetDate}`;
    return import_crypto.default.createHmac("sha256", secret).update(payload).digest("hex");
  }
  function syncUserLimits(userData, today, isStripePremium) {
    const isPremium = isStripePremium;
    if (userData.lastResetDate === today && userData.securitySeal && !verifySeal(userData)) {
      console.warn("SECURITY ALERT: Tampering detected for user. Resetting quotas.");
      userData.proQueriesAvailable = 0;
      userData.flashQueriesAvailable = 0;
      userData.securitySeal = generateSeal(userData);
      return userData;
    }
    if (userData.lastResetDate !== today) {
      if (isPremium) {
        let currentAvailable = userData.proQueriesAvailable !== void 0 ? userData.proQueriesAvailable : Math.max(0, 40 - (userData.proQueriesToday || 0));
        userData.proQueriesAvailable = Math.min(100, currentAvailable + 40);
        userData.flashQueriesAvailable = 1e3;
      } else {
        userData.proQueriesAvailable = 5;
        userData.flashQueriesAvailable = 5;
      }
      userData.lastResetDate = today;
      userData.proQueriesToday = 0;
      userData.flashQueriesToday = 0;
    } else {
      if (userData.proQueriesAvailable === void 0) {
        userData.proQueriesAvailable = Math.max(0, (isPremium ? 40 : 5) - (userData.proQueriesToday || 0));
      }
      if (userData.flashQueriesAvailable === void 0) {
        userData.flashQueriesAvailable = Math.max(0, (isPremium ? 1e3 : 5) - (userData.flashQueriesToday || 0));
      }
      if (isPremium && userData.proQueriesAvailable < 40 && (userData.proQueriesToday || 0) < 40 && !userData._upgradedToday) {
        userData.proQueriesAvailable = Math.max(userData.proQueriesAvailable, 40 - (userData.proQueriesToday || 0));
        userData.flashQueriesAvailable = 1e3;
        userData._upgradedToday = true;
      }
    }
    return userData;
  }
  app.get("/api/user/status", requireAuth, async (req, res) => {
    try {
      const idToken = req.headers.authorization.split("Bearer ")[1];
      const userId = req.user.uid;
      let userData = await getFirestoreDocREST(idToken, userId) || { isPremium: false };
      const userEmail = req.user?.email;
      let isStripePremium = false;
      if (userEmail) {
        try {
          const stripe = getStripe();
          const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
          if (customers.data.length > 0) {
            const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: "active", limit: 1 });
            isStripePremium = subs.data.length > 0;
          }
        } catch (e) {
        }
      }
      const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      userData = syncUserLimits(userData, today, isStripePremium);
      userData.isPremium = isStripePremium;
      res.json(userData);
    } catch (err) {
      console.error("Status fetch error:", err);
      res.status(500).json({ error: "Failed to fetch user status" });
    }
  });
  app.post("/api/checkout", requireAuth, async (req, res) => {
    try {
      const stripe = getStripe();
      const userId = req.user.uid;
      const priceId = process.env.STRIPE_PRICE_ID;
      if (!priceId) {
        return res.status(500).json({ error: "STRIPE_PRICE_ID environment variable is missing." });
      }
      const protocol = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.headers["x-forwarded-host"] || req.get("host");
      const baseUrl = `${protocol}://${host}`;
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        client_reference_id: userId,
        line_items: [
          {
            price: priceId,
            quantity: 1
          }
        ],
        success_url: `${baseUrl}/?upgrade=success`,
        cancel_url: `${baseUrl}/?upgrade=canceled`
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error("Stripe checkout error:", err);
      res.status(500).json({ error: err.message || "Failed to create checkout session" });
    }
  });
  app.get("/api/steam/search", requireAuth, async (req, res) => {
    const query = (req.query.q || "").trim();
    if (!query) {
      return res.json({ games: [] });
    }
    try {
      const response = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
      });
      if (response.ok) {
        const data = await response.json();
        const items = data.items || [];
        const games = items.map((item) => ({
          appId: item.id,
          name: item.name,
          headerImage: item.tiny_image || `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/header.jpg`,
          price: item.price ? (item.price.final / 100).toFixed(2) : "Free"
        }));
        return res.json({ games });
      }
    } catch (err) {
      console.error("Steam search error:", err);
    }
    res.json({ games: [] });
  });
  app.get("/api/steam/news/:appId", async (req, res) => {
    const appId = req.params.appId;
    try {
      const response = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${appId}&count=5&maxlength=600&format=json`);
      if (response.ok) {
        const data = await response.json();
        const newsItems = data?.appnews?.newsitems || [];
        const formatted = newsItems.map((n) => ({
          title: n.title,
          date: new Date(n.date * 1e3).toLocaleDateString(),
          contents: n.contents.replace(/<[^>]*>?/gm, "").trim(),
          url: n.url
        }));
        return res.json({ news: formatted });
      }
    } catch (err) {
      console.error("Steam news fetch error:", err);
    }
    res.json({ news: [] });
  });
  app.get("/api/auth/steam", (req, res) => {
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const baseUrl = `${protocol}://${host}`;
    const returnTo = `${baseUrl}/api/auth/steam/return`;
    const params = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": returnTo,
      "openid.realm": baseUrl,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select"
    });
    res.redirect(`https://steamcommunity.com/openid/login?${params.toString()}`);
  });
  app.get("/api/auth/steam/return", async (req, res) => {
    const renderPopupClosingScript = (steamId, error) => `
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
      const params = new URLSearchParams(req.query);
      params.set("openid.mode", "check_authentication");
      const response = await fetch("https://steamcommunity.com/openid/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      const text = await response.text();
      if (text.includes("is_valid:true")) {
        const claimedId = req.query["openid.claimed_id"];
        const steamIdMatch = claimedId.match(/\/id\/(\d+)$/);
        if (steamIdMatch) {
          return res.send(renderPopupClosingScript(steamIdMatch[1]));
        }
      }
      return res.send(renderPopupClosingScript(void 0, "steam_login_failed"));
    } catch (err) {
      console.error("Steam OpenID error:", err);
      return res.send(renderPopupClosingScript(void 0, "steam_login_error"));
    }
  });
  app.get("/api/steam/profile", async (req, res) => {
    const { steamId } = req.query;
    if (!steamId || typeof steamId !== "string") {
      return res.status(400).json({ error: "steamId query parameter is required" });
    }
    let url = "";
    if (/^\d{17}$/.test(steamId)) {
      url = `https://steamcommunity.com/profiles/${steamId}/?xml=1`;
    } else {
      url = `https://steamcommunity.com/id/${steamId}/?xml=1`;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(404).json({ error: "Steam profile not found" });
      }
      let xmlData = await response.text();
      xmlData = xmlData.replace(/&(?!(?:apos|quot|amp|lt|gt|#\d+);)/g, "&amp;");
      xmlData = xmlData.replace(/<(?![a-zA-Z/!?])/g, "&lt;");
      xmlData = xmlData.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
      const result = await new import_xml2js.default.Parser({ explicitArray: false }).parseStringPromise(xmlData);
      const profile = result.profile;
      if (!profile) {
        return res.status(404).json({ error: "Invalid profile data" });
      }
      return res.json({
        steamName: profile.steamID,
        avatarFull: profile.avatarFull,
        avatarMedium: profile.avatarMedium,
        avatarIcon: profile.avatarIcon
      });
    } catch (err) {
      console.error("Failed to fetch Steam profile:", err);
      return res.status(500).json({ error: "Failed to parse Steam profile" });
    }
  });
  app.get("/api/steam/achievements/:appId", async (req, res) => {
    const { appId } = req.params;
    const { steamId } = req.query;
    if (!steamId || typeof steamId !== "string") {
      return res.status(400).json({ error: "steamId query parameter is required" });
    }
    let url = "";
    if (/^\d{17}$/.test(steamId)) {
      url = `https://steamcommunity.com/profiles/${steamId}/stats/${appId}/?xml=1`;
    } else {
      url = `https://steamcommunity.com/id/${steamId}/stats/${appId}/?xml=1`;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(500).json({ error: "Failed to fetch Steam profile XML" });
      }
      let xmlData = await response.text();
      xmlData = xmlData.replace(/&(?!(?:apos|quot|amp|lt|gt|#\d+);)/g, "&amp;");
      xmlData = xmlData.replace(/<(?![a-zA-Z/!?])/g, "&lt;");
      xmlData = xmlData.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
      const parser = new import_xml2js.default.Parser({ explicitArray: false });
      const result = await parser.parseStringPromise(xmlData);
      if (result?.playerstats?.error) {
        return res.status(404).json({ error: result.playerstats.error });
      }
      const rawAchievements = result?.playerstats?.achievements?.achievement;
      if (!rawAchievements) {
        return res.json({ achievements: [] });
      }
      const achievementsList = Array.isArray(rawAchievements) ? rawAchievements : [rawAchievements];
      let globalStatsMap = /* @__PURE__ */ new Map();
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
        console.error("Failed to fetch global achievement percentages", err);
      }
      const formatted = achievementsList.map((ach) => {
        const unlocked = ach["$"]?.closed === "1";
        const rarity = globalStatsMap.get(ach.apiname.toLowerCase()) || 0;
        let tier = "bronze";
        if (rarity > 0) {
          if (rarity < 10) tier = "gold";
          else if (rarity < 30) tier = "silver";
        }
        return {
          apiname: ach.apiname,
          name: ach.name,
          description: ach.description,
          unlocked,
          unlockDate: unlocked && ach.unlockTimestamp ? new Date(parseInt(ach.unlockTimestamp) * 1e3).toLocaleDateString() : void 0,
          icon: unlocked ? ach.iconClosed : ach.iconOpen,
          rarity: Number(rarity.toFixed(1)),
          tier
        };
      });
      return res.json({ achievements: formatted });
    } catch (err) {
      console.error("Steam achievements fetch error:", err);
      return res.status(500).json({ error: "Failed to parse Steam XML" });
    }
  });
  app.post("/api/chat", requireAuth, async (req, res) => {
    try {
      const idToken = req.headers.authorization.split("Bearer ")[1];
      const userId = req.user.uid;
      let userData = await getFirestoreDocREST(idToken, userId) || { isPremium: false };
      const userEmail = req.user?.email;
      let isStripePremium = false;
      if (userEmail) {
        try {
          const stripe = getStripe();
          const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
          if (customers.data.length > 0) {
            const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: "active", limit: 1 });
            isStripePremium = subs.data.length > 0;
          }
        } catch (e) {
          isStripePremium = userData.isPremium === true;
        }
      } else {
        isStripePremium = userData.isPremium === true;
      }
      const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      userData = syncUserLimits(userData, today, isStripePremium);
      const isPremium = isStripePremium;
      let targetModel = "gemini-3.1-pro-preview";
      let skipPrimary = false;
      if (userData.proQueriesAvailable <= 0) {
        if (userData.flashQueriesAvailable <= 0) {
          return res.status(429).json({
            text: isPremium ? "Daily limit reached. Please try again tomorrow." : "Daily limit reached. Upgrade to Premium for 40 Pro queries & unlimited Flash queries per day!",
            modelUsed: "Limit Reached"
          });
        }
        targetModel = "gemini-3.8-flash";
        skipPrimary = true;
      }
      const {
        question,
        history = [],
        imageBase64,
        aiMode = "standard",
        isGameRunningLocally = false,
        activeGame,
        achievements,
        news,
        language = "English"
      } = req.body;
      if (!question && !imageBase64) {
        return res.status(400).json({ error: "Question or image is required" });
      }
      const ai = getGeminiClient();
      let systemInstruction = "";
      const isGameDetected = isGameRunningLocally && !!activeGame;
      if (aiMode === "roleplay" && isGameDetected) {
        systemInstruction = `You are a dynamic, in-universe gaming companion. Your persona must seamlessly adapt to match the genre and world of the active game (${activeGame.name}).

CRITICAL RULE: NEVER refer to yourself as a "book", a "compendium", "tome", "pages", or an "AI assistant". You are a living entity, character, or construct within the game's universe. Fully commit to the roleplay.

Stay in character 100% of the time, while ensuring all puzzle solutions, mechanical guidance, and gameplay advice remain perfectly accurate, clear, and actionable.`;
      } else {
        systemInstruction = `You are a helpful and expert gaming guide.
Your purpose is to give thorough, highly accurate, puzzle-solving, build-optimizing, and progression-guiding advice for video games.
Provide clear, direct answers without adopting any specific character, persona, or AI identity.`;
        if (aiMode === "minmax") {
          systemInstruction += `

[MODE: MIN/MAX 100% COMPLETION]
Guide the player toward optimal efficiency, 100% trophy/achievement completion, and top-tier build configurations. Do not use fluff or excessive roleplay. Use clear bullet points, stat breakpoints, missable item warnings, and optimized progression routes.`;
        }
      }
      systemInstruction += `

CRITICAL TRUTHFUL VISION GROUNDING:
When analyzing screenshots, screen captures, or images:
1. TRUTHFUL VISUAL GROUNDING: Always examine the actual image pixels truthfully.
   - If the screenshot shows the Windows desktop, taskbar, web browser, Discord, desktop wallpaper, file manager, or non-game software (or if the screen is black, blank, or low detail), clearly and honestly state what is actually on screen (e.g., "You are currently on your Windows desktop / browser with no game running").
   - NEVER invent or hallucinate fictional gameplay encounters, wild Pok\xE9mon battles, enemies, or combat scenes that are not visibly present in the image.
2. ACCURATE GAME IDENTIFICATION: If the system context confirms an active game is running, you should acknowledge it if asked (e.g. "You are playing [Game Name]"). However, NEVER hallucinate visual details about the screenshot if they aren't visibly there. If the screenshot is black, blank, or menus, state that the game is running but describe only what is actually visible.
3. MISSING IMAGE HANDLING: If the user asks "What is on my screen?", "What game is this?", or refers to an image, BUT no image was actually provided in the prompt, YOU MUST state: "I don't see any image attached. Please click the screenshot button to attach your screen." Do not hallucinate or guess based on selected game context.
4. CONTEXT INTEGRITY: Never force an assumed game onto a screenshot that clearly shows something else.`;
      systemInstruction += `

[USER LANGUAGE PREFERENCE]
You must respond entirely in ${language}. Do not use English unless the user's language preference is English or they specifically request it.`;
      let situationalContext = "";
      if (activeGame && isGameRunningLocally) {
        situationalContext += `
[CONFIRMED ACTIVE GAME RUNNING LOCALLY: ${activeGame.name} (AppID: ${activeGame.appId || "Custom"})]
`;
        if (activeGame.genre) situationalContext += `[Genre: ${activeGame.genre}]
`;
        if (activeGame.developer) situationalContext += `[Developer: ${activeGame.developer}]
`;
      } else if (activeGame) {
        situationalContext += `
[Selected Compendium Reference: ${activeGame.name} (Note: No game is currently running locally on the user's PC)]
`;
      } else {
        situationalContext += `
[System Status: No active video game is running locally on the player's system]
`;
      }
      if (achievements && achievements.length > 0) {
        const unlocked = achievements.filter((a) => a.unlocked).map((a) => a.name);
        const locked = achievements.filter((a) => !a.unlocked).map((a) => a.name);
        situationalContext += `
[Player Achievements Status: Unlocked (${unlocked.length}): ${unlocked.slice(0, 15).join(", ")} | Locked (${locked.length}): ${locked.slice(0, 15).join(", ")}]
`;
      }
      if (news && news.length > 0) {
        situationalContext += `
[Recent Game Patch Notes / News: ${news.slice(0, 3).map((n) => n.title || n).join("; ")}]
`;
      }
      systemInstruction += `

${situationalContext}`;
      const contentsPayload = [];
      for (const msg of history.slice(-10)) {
        if (msg.role === "user") {
          const parts = [{ text: msg.text }];
          if (msg.imageUrl && msg.imageUrl.startsWith("data:image")) {
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
          if (contentsPayload.length > 0 && contentsPayload[contentsPayload.length - 1].role === "user") {
            contentsPayload[contentsPayload.length - 1].parts.push(...parts);
          } else {
            contentsPayload.push({ role: "user", parts });
          }
        } else if (msg.role === "assistant") {
          if (contentsPayload.length > 0 && contentsPayload[contentsPayload.length - 1].role === "model") {
            contentsPayload[contentsPayload.length - 1].parts.push({ text: msg.text });
          } else {
            contentsPayload.push({
              role: "model",
              parts: [{ text: msg.text }]
            });
          }
        }
      }
      const currentRole = "user";
      const currentParts = [];
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
              mimeType: "image/png",
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
              mimeType: "audio/webm",
              data: audioBase64.replace(/^data:audio\/[a-zA-Z0-9+-]+;base64,/, "")
              // fallback
            }
          });
        }
      }
      const defaultPrompt = imageBase64 ? isGameRunningLocally && activeGame ? `Analyze this screen capture of ${activeGame.name} in detail and tell me what I should do next or what strategies apply.` : `Analyze this screen capture: accurately identify what is currently displayed on screen (whether a game, desktop, browser, or application) and provide truthful observations or next steps.` : "Analyze this observation and provide insightful gaming guidance.";
      const promptText = question || defaultPrompt;
      currentParts.push({ text: promptText });
      if (contentsPayload.length > 0 && contentsPayload[contentsPayload.length - 1].role === "user") {
        contentsPayload[contentsPayload.length - 1].parts.push(...currentParts);
      } else {
        contentsPayload.push({ role: "user", parts: currentParts });
      }
      let responseText = "";
      let modelUsed = targetModel === "gemini-3.1-pro-preview" ? "Gemini 3.1 Pro Preview" : "Gemini 3.8 Flash (Fallback)";
      try {
        if (!skipPrimary) {
          const primaryCall = ai.models.generateContent({
            model: targetModel,
            contents: contentsPayload,
            config: {
              systemInstruction,
              temperature: aiMode === "roleplay" ? 0.9 : 0.7,
              safetySettings: [
                { category: import_genai.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: import_genai.HarmBlockThreshold.BLOCK_NONE },
                { category: import_genai.HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: import_genai.HarmBlockThreshold.BLOCK_NONE },
                { category: import_genai.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: import_genai.HarmBlockThreshold.BLOCK_NONE },
                { category: import_genai.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: import_genai.HarmBlockThreshold.BLOCK_NONE }
              ]
            }
          });
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("90s timeout exceeded")), 9e4);
          });
          const response = await Promise.race([primaryCall, timeoutPromise]);
          responseText = response.text || "No response received. Please try asking again.";
          userData.proQueriesAvailable = Math.max(0, userData.proQueriesAvailable - 1);
          userData.proQueriesToday = (userData.proQueriesToday || 0) + 1;
        } else {
          const fallbackCall = ai.models.generateContent({
            model: targetModel,
            contents: contentsPayload,
            config: {
              systemInstruction,
              temperature: aiMode === "roleplay" ? 0.9 : 0.7
            }
          });
          const response = await fallbackCall;
          responseText = response.text || "No response received. Please try asking again.";
          userData.flashQueriesAvailable = Math.max(0, userData.flashQueriesAvailable - 1);
          userData.flashQueriesToday = (userData.flashQueriesToday || 0) + 1;
        }
        await updateFirestoreDocREST(idToken, userId, {
          lastResetDate: userData.lastResetDate,
          proQueriesAvailable: userData.proQueriesAvailable,
          flashQueriesAvailable: userData.flashQueriesAvailable,
          proQueriesToday: userData.proQueriesToday,
          flashQueriesToday: userData.flashQueriesToday,
          _upgradedToday: userData._upgradedToday ?? false
        });
      } catch (primaryErr) {
        console.log("Primary query issue or timeout, attempting fallback. Reason:", primaryErr?.message);
        try {
          const retryResponse = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: [{ parts: currentParts }],
            config: {
              systemInstruction
            }
          });
          responseText = retryResponse.text || "No response received.";
          modelUsed = "Gemini 3.8 Flash (Fallback)";
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
        } catch (fallbackErr) {
          console.log("Gemini 3.8 Flash fallback failed, attempting emergency fallback to Flash Lite. Reason:", fallbackErr?.message);
          try {
            const emergencyResponse = await ai.models.generateContent({
              model: "gemini-3.1-flash-lite",
              contents: [{ parts: currentParts }],
              config: {
                systemInstruction
              }
            });
            responseText = emergencyResponse.text || "No response received.";
            modelUsed = "Gemini 3.1 Flash Lite (Emergency Fallback)";
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
          } catch (emergencyErr) {
            console.log("Emergency fallback to Flash Lite also failed:", emergencyErr?.message);
            if (primaryErr?.message?.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED") || primaryErr?.message?.includes("API_KEY_INVALID") || primaryErr?.message?.includes("UNAUTHENTICATED")) {
              responseText = "Error: Invalid Gemini API Key or the Generative Language API is not enabled in your Google Cloud Project. Please verify your API Key in the settings.";
            } else {
              responseText = "The Compendium is currently overwhelmed by magical interference (high demand). Please try again in a moment.";
            }
            modelUsed = "Offline / Unavailable";
          }
        }
      }
      return res.json({
        text: responseText,
        modelUsed
      });
    } catch (err) {
      console.error("API /api/chat error:", err);
      return res.status(500).json({
        error: err?.message || "Failed to generate response."
      });
    }
  });
  function pcmToWav(pcmBuffer, sampleRate = 24e3, numChannels = 1) {
    const header = Buffer.alloc(44);
    const dataSize = pcmBuffer.length;
    const fileSize = dataSize + 36;
    const byteRate = sampleRate * numChannels * 2;
    const blockAlign = numChannels * 2;
    header.write("RIFF", 0);
    header.writeUInt32LE(fileSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcmBuffer]);
  }
  const TTS_VOICE_MAP = {
    "puck": "Puck",
    "charon": "Charon",
    "fenrir": "Fenrir",
    "kore": "Kore",
    "aoede": "Aoede",
    // Fallbacks for legacy/old keys
    "zephyr": "Puck",
    "achernar": "Charon",
    "orus": "Fenrir",
    "autonoe": "Kore",
    "leda": "Aoede",
    "nova": "Puck",
    "onyx": "Charon",
    "fable": "Aoede",
    "echo": "Fenrir",
    "shimmer": "Kore",
    "sage": "Kore",
    "ash": "Charon",
    "coral": "Aoede",
    "alloy": "Puck"
  };
  const ttsServerCache = /* @__PURE__ */ new Map();
  app.post("/api/tts", optionalAuth, async (req, res) => {
    try {
      const { text, voice = "Puck", stream = true } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Text is required for speech" });
      }
      let cleanText = text.replace(/\[\^?\d+\]/g, "").replace(/```[\s\S]*?```/g, "").replace(/`([^`]+)`/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/\|([^\n|]+)\|([^\n|]+)\|([^\n|]*)\|?/g, (match, c1, c2, c3) => {
        const col1 = c1.trim();
        const col2 = c2.trim();
        const col3 = c3 ? c3.trim() : "";
        if (col1.includes("---") || col2.includes("---")) return "";
        return `${col1}: ${col2}${col3 ? ` (${col3})` : ""}. `;
      }).replace(/\|/g, " ").replace(/#{1,6}\s*([^\n]+)/g, "$1. ").replace(/\n\s*[-*•]\s*/g, ". ").replace(/[*_~>]/g, "").replace(/\s+/g, " ").trim();
      const normalizedVoiceKey = (voice || "puck").toLowerCase();
      const targetVoice = TTS_VOICE_MAP[normalizedVoiceKey] || "Puck";
      const cacheKey = `${targetVoice}::${cleanText.slice(0, 1e3)}`;
      if (ttsServerCache.has(cacheKey)) {
        const cached = ttsServerCache.get(cacheKey);
        if (stream) {
          res.setHeader("Content-Type", "application/x-ndjson");
          res.setHeader("Cache-Control", "no-cache");
          res.write(JSON.stringify({
            chunkIndex: 0,
            totalChunks: 1,
            audioBase64: cached.audioBase64,
            mimeType: cached.mimeType,
            voice: cached.voice,
            cached: true
          }) + "\n");
          return res.end();
        }
        return res.json({ ...cached, cached: true });
      }
      try {
        const ai = getGeminiClient();
        const chunks = [];
        if (cleanText.length <= 4e3) {
          chunks.push(cleanText);
        } else {
          const sentences = cleanText.match(/[^.!?\n]+[.!?\n]+(\s|$)|[^.!?\n]+$/g) || [cleanText];
          let currentChunk = "";
          let targetLen = 3500;
          for (const sentence of sentences) {
            const s = sentence.trim();
            if (!s) continue;
            if ((currentChunk + " " + s).trim().length <= targetLen || !currentChunk) {
              currentChunk = currentChunk ? `${currentChunk} ${s}` : s;
            } else {
              chunks.push(currentChunk);
              currentChunk = s;
            }
          }
          if (currentChunk) chunks.push(currentChunk);
        }
        const synthesizeChunk = async (chunkText) => {
          if (!chunkText.trim()) return { pcm: null };
          try {
            const ttsResult = await ai.models.generateContent({
              model: "gemini-3.1-flash-tts-preview",
              contents: chunkText,
              config: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: targetVoice }
                  }
                }
              }
            });
            const inlinePart = ttsResult.candidates?.[0]?.content?.parts?.[0];
            const b64Data = inlinePart?.inlineData?.data;
            return { pcm: b64Data ? Buffer.from(b64Data, "base64") : null };
          } catch (err) {
            if (err?.message?.includes("429") || err?.message?.includes("RESOURCE_EXHAUSTED") || err?.message?.includes("quota")) {
              return { pcm: null, error: "QUOTA_EXCEEDED" };
            }
            console.warn("Chunk TTS generation error:", err?.message);
            return { pcm: null };
          }
        };
        if (stream && chunks.length > 0) {
          const allPcmBuffers = [];
          const firstResult = await synthesizeChunk(chunks[0]);
          if (firstResult.error === "QUOTA_EXCEEDED") {
            return res.status(429).json({ error: "TTS Rate limit exceeded (100 requests/day). Using local fallback." });
          }
          res.setHeader("Content-Type", "application/x-ndjson");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          if (firstResult.pcm) {
            allPcmBuffers.push(firstResult.pcm);
            const firstWav = pcmToWav(firstResult.pcm, 24e3, 1);
            res.write(JSON.stringify({
              chunkIndex: 0,
              totalChunks: chunks.length,
              audioBase64: firstWav.toString("base64"),
              mimeType: "audio/wav",
              voice: targetVoice
            }) + "\n");
          }
          if (chunks.length > 1) {
            const remainingPromises = chunks.slice(1).map(async (chunk, idx) => {
              const res2 = await synthesizeChunk(chunk);
              return { index: idx + 1, pcm: res2.pcm };
            });
            const remainingResults = await Promise.all(remainingPromises);
            for (const item of remainingResults) {
              if (item.pcm) {
                allPcmBuffers.push(item.pcm);
                const wavBuf = pcmToWav(item.pcm, 24e3, 1);
                res.write(JSON.stringify({
                  chunkIndex: item.index,
                  totalChunks: chunks.length,
                  audioBase64: wavBuf.toString("base64"),
                  mimeType: "audio/wav",
                  voice: targetVoice
                }) + "\n");
              }
            }
          }
          if (allPcmBuffers.length > 0) {
            const combined = Buffer.concat(allPcmBuffers);
            const fullWav = pcmToWav(combined, 24e3, 1);
            if (ttsServerCache.size > 100) ttsServerCache.clear();
            ttsServerCache.set(cacheKey, {
              audioBase64: fullWav.toString("base64"),
              mimeType: "audio/wav",
              voice: targetVoice
            });
          }
          return res.end();
        }
        const pcmResults = await Promise.all(chunks.map((chunk) => synthesizeChunk(chunk)));
        if (pcmResults.some((r) => r.error === "QUOTA_EXCEEDED")) {
          return res.status(429).json({ error: "TTS Rate limit exceeded (100 requests/day). Using local fallback." });
        }
        const validPcms = pcmResults.map((r) => r.pcm).filter((b) => b !== null);
        if (validPcms.length > 0) {
          const combinedPcm = Buffer.concat(validPcms);
          const wavBuffer = pcmToWav(combinedPcm, 24e3, 1);
          const resultPayload = {
            audioBase64: wavBuffer.toString("base64"),
            mimeType: "audio/wav",
            voice: targetVoice,
            engine: "gemini-3.1-flash-tts-preview"
          };
          if (ttsServerCache.size > 100) ttsServerCache.clear();
          ttsServerCache.set(cacheKey, resultPayload);
          return res.json(resultPayload);
        }
      } catch (geminiTtsErr) {
        console.warn("Gemini Studio TTS encounter:", geminiTtsErr?.message);
      }
      const openAiKey = process.env.OPENAI_API_KEY;
      if (openAiKey) {
        const openaiVoice = voice || "nova";
        const response = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openAiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "tts-1",
            input: cleanText.slice(0, 4e3),
            voice: openaiVoice,
            response_format: "mp3"
          })
        });
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const base64Audio = Buffer.from(arrayBuffer).toString("base64");
          return res.json({
            audioBase64: base64Audio,
            mimeType: "audio/mp3",
            voice: openaiVoice,
            engine: "openai"
          });
        }
      }
      return res.status(500).json({ error: "TTS audio synthesis is unavailable at this time." });
    } catch (err) {
      console.error("API /api/tts error:", err);
      res.status(500).json({ error: err?.message || "TTS generation error" });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[DEPLOYMENT] Quest Compendium Server v1.1.0 running on http://localhost:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
