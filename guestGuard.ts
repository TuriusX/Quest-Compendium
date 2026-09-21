/**
 * Guest abuse guard for /api/chat and /api/tts.
 *
 * Problem: a "guest" is just a string the client makes up (`guest_<random>`), and the server keeps a 5 Pro + 5 Fast
 * quota per string in memory. Anyone can send a fresh string per request and get unlimited free Gemini calls.
 * /api/tts also accepts callers with no login at all and has no per-user limit.
 *
 * This module adds limits that a client cannot dodge by changing its ID:
 *   - guest ID format check (rejects junk / oversized strings that would bloat memory)
 *   - per-IP daily cap, per-IP burst limit, and a GLOBAL daily cost ceiling for guest chat
 *   - the same three for TTS from guests or anonymous callers, weighted by text length
 *   - a cap on distinct guest IDs per IP per day, and a rate limit on guest /api/user/status calls
 *     (the server creates a memory entry per guest ID it sees; without this a script could exhaust memory and crash it)
 * Signed-in users are never affected (their tokens are verified with Firebase and skipped).
 *
 * Existing per-guest quotas in server.ts stay as they are; this sits in front of them.
 * State is in memory (same as the existing guest quotas): it resets on restart and is per Cloud Run instance.
 * For a hard, restart-proof ceiling set Cloud Run --max-instances=1 (fine at this scale) or move counters to Firestore.
 *
 * Tunable via environment variables (defaults in DEFAULTS below):
 *   GUEST_CHAT_PER_IP_DAILY, GUEST_CHAT_GLOBAL_DAILY, GUEST_CHAT_PER_IP_PER_MIN,
 *   GUEST_TTS_PER_IP_DAILY,  GUEST_TTS_GLOBAL_DAILY,  GUEST_TTS_PER_IP_PER_MIN,
 *   GUEST_IDS_PER_IP_DAILY, GUEST_STATUS_PER_IP_PER_MIN, GUEST_PROXY_HOPS, GUEST_MAX_TRACKED_IPS
 */
import type { Express, NextFunction, Request, Response } from 'express';

export interface GuestGuardLimits {
  chatPerIpDaily: number;
  chatGlobalDaily: number;
  chatPerIpPerMin: number;
  ttsPerIpDaily: number;
  ttsGlobalDaily: number;
  ttsPerIpPerMin: number;
  /** How many reverse-proxy hops append to X-Forwarded-For (Cloud Run's front end = 1). */
  proxyHops: number;
  maxTrackedIps: number;
  /** Distinct guest IDs one IP may use per day (bounds the server's per-ID memory). */
  guestIdsPerIpDaily: number;
  /** /api/user/status calls per IP per minute for guests. */
  statusPerIpPerMin: number;
}

export const DEFAULTS: GuestGuardLimits = {
  chatPerIpDaily: 20,
  chatGlobalDaily: 500,
  chatPerIpPerMin: 8,
  ttsPerIpDaily: 40,
  ttsGlobalDaily: 500,
  ttsPerIpPerMin: 20,
  proxyHops: 1,
  maxTrackedIps: 50_000,
  guestIdsPerIpDaily: 20,
  statusPerIpPerMin: 60,
};

export interface GuestGuardDeps {
  /** True if the token is a valid Firebase ID token (used so signed-in users skip the TTS guard). */
  verifyIdToken: (token: string) => Promise<boolean>;
  /** Override limits (tests). Environment variables are read first, then these override. */
  limits?: Partial<GuestGuardLimits>;
  env?: Record<string, string | undefined>;
  now?: () => number;
}

const GUEST_ID = /^guest_[A-Za-z0-9_-]{1,80}$/;
const TTS_CHARS_PER_UNIT = 3500; // matches the server's TTS chunk size: one Gemini call per chunk

function envNum(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadLimits(env: Record<string, string | undefined>, overrides: Partial<GuestGuardLimits> = {}): GuestGuardLimits {
  const l: GuestGuardLimits = {
    chatPerIpDaily: envNum(env.GUEST_CHAT_PER_IP_DAILY, DEFAULTS.chatPerIpDaily),
    chatGlobalDaily: envNum(env.GUEST_CHAT_GLOBAL_DAILY, DEFAULTS.chatGlobalDaily),
    chatPerIpPerMin: envNum(env.GUEST_CHAT_PER_IP_PER_MIN, DEFAULTS.chatPerIpPerMin),
    ttsPerIpDaily: envNum(env.GUEST_TTS_PER_IP_DAILY, DEFAULTS.ttsPerIpDaily),
    ttsGlobalDaily: envNum(env.GUEST_TTS_GLOBAL_DAILY, DEFAULTS.ttsGlobalDaily),
    ttsPerIpPerMin: envNum(env.GUEST_TTS_PER_IP_PER_MIN, DEFAULTS.ttsPerIpPerMin),
    proxyHops: envNum(env.GUEST_PROXY_HOPS, DEFAULTS.proxyHops),
    maxTrackedIps: envNum(env.GUEST_MAX_TRACKED_IPS, DEFAULTS.maxTrackedIps),
    guestIdsPerIpDaily: envNum(env.GUEST_IDS_PER_IP_DAILY, DEFAULTS.guestIdsPerIpDaily),
    statusPerIpPerMin: envNum(env.GUEST_STATUS_PER_IP_PER_MIN, DEFAULTS.statusPerIpPerMin),
  };
  return { ...l, ...overrides };
}

/**
 * The caller's IP. X-Forwarded-For is "client-supplied..., real client as seen by the first trusted proxy".
 * Anything a client sends ends up on the LEFT, so we count from the RIGHT: with N trusted proxy hops the real
 * client is the Nth entry from the end. (Taking the leftmost entry lets anyone forge a new "IP" per request.)
 */
export function clientIp(req: Request, hops: number): string {
  const raw = req.headers['x-forwarded-for'];
  const parts = (Array.isArray(raw) ? raw.join(',') : raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 0 && hops > 0) return parts[Math.max(0, parts.length - hops)];
  return req.socket.remoteAddress || 'unknown';
}

interface Counter { day: string; n: number }
interface Window { n: number; reset: number }

export function registerGuestGuard(app: Express, deps: GuestGuardDeps): { limits: GuestGuardLimits } {
  const now = deps.now ?? Date.now;
  const limits = loadLimits(deps.env ?? process.env, deps.limits);
  const today = () => new Date(now()).toISOString().slice(0, 10); // UTC, same as the server's quota day

  const chat = { perIp: new Map<string, Counter>(), global: { day: today(), n: 0 } as Counter, burst: new Map<string, Window>() };
  const tts = { perIp: new Map<string, Counter>(), global: { day: today(), n: 0 } as Counter, burst: new Map<string, Window>() };
  type Bucket = typeof chat;
  const sessions = new Map<string, { day: string; ids: Set<string> }>();
  const statusBurst = new Map<string, Window>();

  function purge() {
    const d = today();
    const t = now();
    for (const b of [chat, tts]) {
      for (const [k, v] of b.perIp) if (v.day !== d) b.perIp.delete(k);
      for (const [k, v] of b.burst) if (t >= v.reset) b.burst.delete(k);
    }
    for (const [k, v] of sessions) if (v.day !== d) sessions.delete(k);
    for (const [k, v] of statusBurst) if (t >= v.reset) statusBurst.delete(k);
  }
  setInterval(purge, 60_000).unref();

  /** Returns null if allowed (and records `units`), otherwise the reason it was refused. */
  function take(b: Bucket, ip: string, units: number, perIpDaily: number, globalDaily: number, perMin: number):
    'burst' | 'global' | 'ip' | 'busy' | null {
    const d = today();
    const t = now();

    if (b.global.day !== d) b.global = { day: d, n: 0 };
    let c = b.perIp.get(ip);
    if (c && c.day !== d) c = undefined;
    if (!c && b.perIp.size >= limits.maxTrackedIps) {
      purge(); // yesterday's entries must not count against today's cap
      if (b.perIp.size >= limits.maxTrackedIps) return 'busy';
    }

    let w = b.burst.get(ip);
    if (!w || t >= w.reset) w = { n: 0, reset: t + 60_000 };
    if (w.n + 1 > perMin) return 'burst';
    if (b.global.n + units > globalDaily) return 'global';
    if ((c?.n ?? 0) + units > perIpDaily) return 'ip';

    w.n += 1;
    b.burst.set(ip, w);
    b.global.n += units;
    b.perIp.set(ip, { day: d, n: (c?.n ?? 0) + units });
    return null;
  }

  /** Register a guest ID for this IP today. Repeats are free; a NEW id beyond the per-IP cap is refused. */
  function touchSession(ip: string, id: string): 'ok' | 'ids' | 'busy' {
    const d = today();
    let sess = sessions.get(ip);
    if (sess && sess.day !== d) sess = undefined;
    if (sess?.ids.has(id)) return 'ok';
    if (!sess && sessions.size >= limits.maxTrackedIps) {
      purge();
      if (sessions.size >= limits.maxTrackedIps) return 'busy';
    }
    if ((sess?.ids.size ?? 0) >= limits.guestIdsPerIpDaily) return 'ids';
    if (!sess) {
      sess = { day: d, ids: new Set() };
      sessions.set(ip, sess);
    }
    sess.ids.add(id);
    return 'ok';
  }

  const bearer = (req: Request): string | null => {
    const h = req.headers.authorization;
    return h && h.startsWith('Bearer ') ? h.slice('Bearer '.length) : null;
  };

  // ---- /api/chat: guests only (signed-in users pass straight through) ----------------------------------------
  app.use('/api/chat', (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') return next();
    const token = bearer(req);
    if (!token || !token.startsWith('guest_')) return next(); // real users, or no token (requireAuth will reject)

    if (!GUEST_ID.test(token)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid guest session' });
    }
    const ip = clientIp(req, limits.proxyHops);
    const session = touchSession(ip, token);
    const refused = session !== 'ok' ? (session === 'busy' ? 'busy' : 'ip') : take(chat, ip, 1, limits.chatPerIpDaily, limits.chatGlobalDaily, limits.chatPerIpPerMin);
    if (!refused) return next();

    const text =
      refused === 'burst' ? 'You are sending requests too quickly. Please wait a minute and try again.'
      : refused === 'global' || refused === 'busy'
        ? 'Guest access is at capacity for today. Sign in with Google for your daily free queries, or try again tomorrow.'
        : "You've reached today's guest limit for your network. Sign in with Google for your daily free queries, or try again tomorrow.";
    // Same shape the existing clients already understand ({ text, modelUsed: 'Limit Reached' } opens the sign-in/paywall).
    return res.status(429).json({ text, modelUsed: 'Limit Reached' });
  });

  // ---- /api/user/status: guests only. Each new guest ID makes the server allocate a quota entry. ----------
  app.use('/api/user/status', (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();
    const token = bearer(req);
    if (!token || !token.startsWith('guest_')) return next();
    if (!GUEST_ID.test(token)) return res.status(401).json({ error: 'Unauthorized: Invalid guest session' });

    const ip = clientIp(req, limits.proxyHops);
    if (touchSession(ip, token) !== 'ok') {
      return res.status(429).json({ error: 'Too many guest sessions from your network today. Sign in with Google to continue.' });
    }
    const t = now();
    let w = statusBurst.get(ip);
    if (!w || t >= w.reset) w = { n: 0, reset: t + 60_000 };
    if (w.n + 1 > limits.statusPerIpPerMin) return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    w.n += 1;
    statusBurst.set(ip, w);
    return next();
  });

  // ---- /api/tts: guests AND anonymous callers; signed-in users pass -------------------------------------------
  app.use('/api/tts', async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') return next();
    try {
      const token = bearer(req);
      // A token only earns a bypass if Firebase verifies it. Junk or guest tokens are treated as anonymous.
      if (token && !token.startsWith('guest_') && (await deps.verifyIdToken(token))) return next();
    } catch {
      /* treat as anonymous */
    }
    const len = typeof req.body?.text === 'string' ? req.body.text.length : 0;
    const units = Math.max(1, Math.ceil(len / TTS_CHARS_PER_UNIT)); // long texts cost several Gemini calls
    const refused = take(tts, clientIp(req, limits.proxyHops), units, limits.ttsPerIpDaily, limits.ttsGlobalDaily, limits.ttsPerIpPerMin);
    if (!refused) return next();
    // Same shape the existing TTS route uses when Gemini is rate-limited; the client falls back to local speech.
    return res.status(429).json({ error: 'TTS Rate limit exceeded. Using local fallback.' });
  });

  return { limits };
}
