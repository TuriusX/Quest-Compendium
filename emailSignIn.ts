/**
 * Signing in with an email link (Firebase's passwordless sign-in), and the rules that stop throwaway addresses from
 * giving extra free questions.
 *
 * The apps ask our server to send the link (POST /api/email-link/send), so the limits below hold for every screen:
 * at most 3 links per address an hour and 20 per network address a day. The server asks Firebase to send it
 * (Identity Toolkit sendOobCode); Firebase sends the email itself.
 *
 * The link opens /email-signin (the web app). On the web it signs that browser in. With a device code (the desktop
 * app, the Steam Deck, the phone page behind the Deck's QR code) the page first asks "Sign in the device showing this
 * code?", then approves the code through the device sign-in (deviceAuth.ts), and the device signs itself in. So a
 * stranger who types someone else's address on their own device gets nowhere: the owner sees a code they don't have.
 *
 * Free questions follow the person, not the account (applied in server.ts with the helpers here):
 *   - one free pool per real address: name+x@gmail.com and n.a.m.e@gmail.com count as name@gmail.com;
 *   - one free pool per device (the apps send a random id they keep): free accounts on one device share one day;
 *   - an address at a disposable-email domain gets the guest allowance only.
 * Premium is never affected. Only one-way fingerprints of the address and the device id are kept.
 */
import crypto from 'crypto';
import type { Express, Request, RequestHandler, Response } from 'express';
import { isDisposableEmailDomain } from 'disposable-email-domains-js';

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;
const GMAIL = new Set(['gmail.com', 'googlemail.com']);

/** A valid-looking address, trimmed and lower-cased, or null. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

/** The address a free pool belongs to: no "+tag" anywhere, and Gmail without dots (googlemail.com is gmail.com). */
export function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1);
  if (GMAIL.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local || e.slice(0, at)}@${domain}`;
}

/** A disposable (throwaway) address: the maintained public list, subdomains included. */
export function isDisposable(email: string | null | undefined): boolean {
  if (!email) return false;
  let domain = String(email).trim().toLowerCase().split('@').pop() || '';
  while (domain.includes('.')) {
    if (isDisposableEmailDomain(domain)) return true;
    domain = domain.slice(domain.indexOf('.') + 1);
  }
  return false;
}

/** A one-way fingerprint (the address or the device id are never stored as they are). */
export const fingerprint = (kind: 'e' | 'd', value: string) =>
  `${kind}_${crypto.createHash('sha256').update(`qc-free-pool:${kind}:${value}`).digest('hex').slice(0, 32)}`;

/** The free pools a signed-in free player's questions count against (their address, and the device they ask from). */
export function freePoolKeys(email: string | null | undefined, deviceId: unknown): string[] {
  const keys: string[] = [];
  const e = cleanEmail(email);
  if (e) keys.push(fingerprint('e', normalizeEmail(e)));
  const d = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (/^[A-Za-z0-9_-]{8,80}$/.test(d)) keys.push(fingerprint('d', d));
  return keys;
}

/** What's left today in a pool: the day's allowance minus what the pool's accounts used. */
export function poolLeft(pool: { day?: string; pro?: number; flash?: number } | undefined, today: string, allowance: { pro: number; flash: number }) {
  const used = pool && pool.day === today ? pool : { pro: 0, flash: 0 };
  return { pro: Math.max(0, allowance.pro - (Number(used.pro) || 0)), flash: Math.max(0, allowance.flash - (Number(used.flash) || 0)) };
}

/** Fixed-window limiter. Returns true when the action is allowed. */
export function makeLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { n: number; reset: number }>();
  return {
    take(key: string): boolean {
      const t = now();
      const h = hits.get(key);
      if (!h || t >= h.reset) {
        if (hits.size > 50_000) for (const [k, v] of hits) if (t >= v.reset) hits.delete(k);
        hits.set(key, { n: 1, reset: t + windowMs });
        return true;
      }
      h.n += 1;
      return h.n <= max;
    },
  };
}

export interface EmailSignInDeps {
  apiKey: string;
  requireAuth: RequestHandler;
  /** firebase-admin getAuth: the same-account check. */
  getAuth: () => { getUserByEmail(email: string): Promise<{ uid: string }>; createCustomToken(uid: string): Promise<string> };
  /** The caller's network address (guestGuard.clientIp). */
  clientIp: (req: Request) => string;
  /** Sends Firebase's sign-in email (tests replace it). */
  sendLink?: (email: string, continueUrl: string, locale: string) => Promise<{ ok: boolean; error?: string }>;
  now?: () => number;
}

const LOCALES = new Set(['en', 'es', 'pt-BR', 'pt', 'de', 'fr', 'ru', 'ja', 'ko', 'zh', 'zh-CN']);

export function registerEmailSignIn(app: Express, deps: EmailSignInDeps): void {
  const now = deps.now ?? Date.now;
  const perAddress = makeLimiter(3, 60 * 60_000, now);
  const perIp = makeLimiter(20, 24 * 60 * 60_000, now);

  const authBase = process.env.FIREBASE_AUTH_EMULATOR_HOST
    ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`
    : 'https://identitytoolkit.googleapis.com/v1';
  const sendLink = deps.sendLink ?? (async (email: string, continueUrl: string, locale: string) => {
    const r = await fetch(`${authBase}/accounts:sendOobCode?key=${encodeURIComponent(deps.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Firebase-Locale': locale },
      body: JSON.stringify({ requestType: 'EMAIL_SIGNIN', email, continueUrl, canHandleCodeInApp: true }),
    });
    if (r.ok) return { ok: true };
    const body: any = await r.json().catch(() => ({}));
    return { ok: false, error: String(body?.error?.message || r.status) };
  });

  const baseUrl = (req: Request): string => {
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    return `${String(proto).split(',')[0]}://${String(host).split(',')[0]}`;
  };

  // The apps ask for a link: { email, userCode? (a device waiting to be signed in), lang? }.
  app.post('/api/email-link/send', async (req: Request, res: Response) => {
    const email = cleanEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: 'bad_email' });
    const code = typeof req.body?.userCode === 'string' ? req.body.userCode.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    if (code && code.length !== 8) return res.status(400).json({ error: 'bad_code' });
    // Rate limits: the address (as its free pool counts it) and the network address.
    if (!perIp.take(deps.clientIp(req)) || !perAddress.take(normalizeEmail(email))) {
      return res.status(429).json({ error: 'too_many' });
    }
    const lang = String(req.body?.lang || 'en');
    const locale = LOCALES.has(lang) ? lang : 'en';
    const params = new URLSearchParams();
    if (code) params.set('code', `${code.slice(0, 4)}-${code.slice(4)}`);
    if (locale !== 'en') params.set('lang', locale);
    const qs = params.toString();
    const continueUrl = `${baseUrl(req)}/email-signin${qs ? `?${qs}` : ''}`;
    try {
      const r = await sendLink(email, continueUrl, locale);
      if (!r.ok) {
        console.warn('[email-link] send failed:', r.error);
        return res.status(r.error?.includes('QUOTA') || r.error?.includes('TOO_MANY') ? 429 : 502).json({ error: r.error?.includes('QUOTA') || r.error?.includes('TOO_MANY') ? 'too_many' : 'send_failed' });
      }
      res.json({ ok: true, disposable: isDisposable(email) });
    } catch (e: any) {
      console.warn('[email-link] send failed:', e?.message);
      res.status(502).json({ error: 'send_failed' });
    }
  });

  // After an email link signs someone in: if the address already belongs to another account (it shouldn't: the
  // project keeps one account per address, and Firebase links Google and email sign-in), that account is the one they
  // get, through a one-time sign-in pass.
  app.post('/api/email-link/check', deps.requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const email = cleanEmail(u?.email);
    if (!u?.uid || u.isGuest || !email) return res.json({ ok: true });
    try {
      const owner = await deps.getAuth().getUserByEmail(email);
      if (owner.uid === u.uid) return res.json({ ok: true });
      console.warn('[email-link] address already on another account; signing in to that one');
      res.json({ ok: true, customToken: await deps.getAuth().createCustomToken(owner.uid) });
    } catch {
      res.json({ ok: true });
    }
  });
}
