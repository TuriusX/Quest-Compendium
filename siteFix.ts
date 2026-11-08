/**
 * "Suggest a fix" and "Add a tip" on every guide and compendium page of the website (owner, Nov 7 2026): a small button
 * that opens a short form (one text box, an optional kind: wrong info, missing item, missable, tip). Guests and signed-in
 * players can send one; nothing waits for the owner.
 *
 *   Who may send: Firebase App Check (the ask box's reCAPTCHA Enterprise key, config/siteAsk.recaptchaKey; off when the
 *     ask box's reCAPTCHA safety net has switched it off this month), and daily limits in config/siteFix: perDevice (5)
 *     and perIp (20) signed out, perSignedIn (20), dailyTotal (200) for the whole site. Device, network and account
 *     counts are one-way hashes with the day's salt (siteAsk.ts hashOf), in siteFixDays/{day}, deleted after two days.
 *   Where it goes: contributions/{id} with source "site-fix", status "pending": the corrections pipeline. At night
 *     scripts/guides/contributions.ts checks it against sources (one search and the claim check), and
 *     scripts/guides/autoImprove.ts applies what sources confirm (a wrong statement replaced, or the missing fact, the
 *     missable or the tip added; logged on /admin/asked with an undo) and dismisses what they contradict or still
 *     can't confirm after a second look a month later. Monday's summary counts them (siteFixWeekLine).
 *   Kept: the page, the kind, the text, the language, the day, whether the sender was signed in. Never who it was.
 *
 * Routes:
 *   GET  /api/site/fix/config      { on, appCheck? }  (asked when the form opens, not on every page view)
 *   POST /api/site/fix             { key, slug, kind: 'area' | 'entity', lang, text, category?, device }
 *                                  -> { ok } | { limit: 'device' | 'ip' | 'account' | 'site' } | { off } | { error }
 */
import type { Express, Request, Response } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { siteAskConfig, appCheckOn, hashOf } from './siteAsk';
import { clientIp } from './guestGuard';
import { isLocalServer } from './testTraffic';

export type SiteFixConfig = { enabled: boolean; perDevice: number; perIp: number; perSignedIn: number; dailyTotal: number };
const DEFAULTS: SiteFixConfig = { enabled: true, perDevice: 5, perIp: 20, perSignedIn: 20, dailyTotal: 200 };
const LANGS = ['en', 'es', 'pt', 'de', 'fr', 'ru', 'ja', 'ko', 'zh'];
/** The form's kinds, as the corrections pipeline names them (contributions.kind). */
export const FIX_KINDS: Record<string, string> = { wrong: 'correction', missing: 'missing', missable: 'missable', tip: 'tip' };
const HOPS = Number(process.env.GUEST_PROXY_HOPS || 1);
const dayOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** A local server (tests) writes to test_ collections only, so nothing it sends reaches the pipeline or the numbers. */
const col = (name: string) => getFirestore().collection(isLocalServer() ? `test_${name}` : name);

let cfgCache: { at: number; v: SiteFixConfig } | null = null;
export async function siteFixConfig(): Promise<SiteFixConfig> {
  if (cfgCache && Date.now() - cfgCache.at < 30_000) return cfgCache.v;
  let v = DEFAULTS;
  try { v = { ...DEFAULTS, ...((await getFirestore().collection('config').doc('siteFix').get()).data() || {}) } as SiteFixConfig; } catch { /* the defaults */ }
  cfgCache = { at: Date.now(), v };
  return v;
}

/**
 * Text that isn't worth checking: links, a key held down, mostly symbols, the same words over and over. (Unlike
 * corrections.ts looksLikeSpam, a sentence without spaces is fine: Japanese and Chinese are written that way.)
 */
export function fixLooksLikeSpam(text: string): boolean {
  const t = String(text || '').trim();
  if (t.length < 8) return true;
  if (/https?:\/\/|www\.|\.(com|net|ru|xyz|io)\b|discord\.gg|t\.me\//i.test(t)) return true;
  if (/(.)\1{7,}/u.test(t)) return true;
  if ((t.match(/\p{L}/gu) || []).length < t.length * 0.4) return true;
  const words = t.toLowerCase().split(/\s+/);
  return words.length >= 6 && new Set(words).size <= words.length / 3;
}

/** The page a fix is for, if it's a published guide page or compendium page (its name, for the pipeline's check). */
async function pageOf(key: string, slug: string, kind: string): Promise<{ page: 'area' | 'entity'; name: string } | null> {
  const area = async () => {
    const a: any = (await getFirestore().collection('guides').doc(key).collection('areas').doc(slug).get()).data();
    return a?.status === 'published' ? { page: 'area' as const, name: String(a.name || slug) } : null;
  };
  const entity = async () => {
    const e: any = (await getFirestore().collection('guideCompendium').doc(key).collection('entities').doc(slug).get()).data();
    return e?.status === 'published' ? { page: 'entity' as const, name: String(e.displayName || e.name || slug) } : null;
  };
  return kind === 'entity' ? (await entity()) || (await area()) : (await area()) || (await entity());
}

type Take = { ok: true } | { ok: false; why: 'device' | 'ip' | 'account' | 'site' | 'same' };
/** One fix, if there's room today; the same text from the same device twice in a day counts once. */
async function take(day: string, c: SiteFixConfig, device: string, ip: string, uid: string | null, text: string): Promise<Take> {
  const ref = col('siteFixDays').doc(day);
  return getFirestore().runTransaction(async (tx) => {
    const cur: any = (await tx.get(ref)).data() || {};
    if ((Number(cur.total) || 0) >= c.dailyTotal) return { ok: false, why: 'site' } as Take;
    const t = hashOf(day, 't', `${device}:${cut(text, 300).toLowerCase()}`);
    if (cur.t?.[t]) return { ok: false, why: 'same' } as Take;
    const set: any = { total: FieldValue.increment(1), t: { [t]: 1 }, at: Date.now() };
    if (uid) {
      const u = hashOf(day, 'u', uid), un = Number(cur.u?.[u]) || 0;
      if (un >= c.perSignedIn) return { ok: false, why: 'account' } as Take;
      set.u = { [u]: un + 1 };
    } else {
      const d = hashOf(day, 'd', device), i = hashOf(day, 'i', ip);
      const dn = Number(cur.d?.[d]) || 0, inn = Number(cur.i?.[i]) || 0;
      if (dn >= c.perDevice) return { ok: false, why: 'device' } as Take;
      if (inn >= c.perIp) return { ok: false, why: 'ip' } as Take;
      set.d = { [d]: dn + 1 };
      set.i = { [i]: inn + 1 };
    }
    tx.set(ref, set, { merge: true });
    return { ok: true } as Take;
  });
}
let cleaned = '';
async function cleanOld() {
  const day = dayOf();
  if (cleaned === day) return;
  cleaned = day;
  for (const doc of (await col('siteFixDays').where('__name__', '<', dayOf(Date.now() - 2 * 86_400_000)).get()).docs) await doc.ref.delete();
}

/** On when config/siteFix.enabled, and not while the ask box's reCAPTCHA safety net has App Check off this month. */
async function state() {
  const [c, ask] = await Promise.all([siteFixConfig(), siteAskConfig()]);
  const capped = ask.autoOff?.month === new Date().toISOString().slice(0, 7);
  return { c, ask, on: c.enabled && !capped };
}

export function registerSiteFix(app: Express, deps: { firebaseWebConfig: Record<string, string> }) {
  app.get('/api/site/fix/config', async (_req: Request, res: Response) => {
    const { ask, on } = await state();
    res.set('Cache-Control', 'public, max-age=30');
    res.json(on ? { on: true, ...(appCheckOn(ask) ? { appCheck: { key: ask.recaptchaKey, firebase: deps.firebaseWebConfig } } : {}) } : { on: false });
  });

  app.post('/api/site/fix', async (req: Request, res: Response) => {
    const { c, ask, on } = await state();
    if (!on) return res.status(503).json({ off: true });
    if (appCheckOn(ask)) {
      try { await getAppCheck().verifyToken(String(req.headers['x-firebase-appcheck'] || '')); } catch { return res.status(401).json({ error: 'check' }); }
    }
    const b = req.body || {};
    const key = String(b.key || ''), slug = String(b.slug || ''), device = String(b.device || '');
    const lang = LANGS.includes(b.lang) ? String(b.lang) : 'en';
    const category = FIX_KINDS[String(b.category || '')] ? String(b.category) : '';
    const text = String(b.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (!/^[a-z0-9-]{2,120}$/.test(key) || !/^[a-z0-9-]{1,160}$/.test(slug) || !/^[a-f0-9]{16,64}$/.test(device)) return res.status(400).json({ error: 'bad request' });
    if (text.length < 10) return res.status(400).json({ error: 'short' });
    // Obvious spam gets a normal reply (nothing worth retrying) and goes nowhere.
    if (fixLooksLikeSpam(text)) return res.json({ ok: true });
    // Signed in: counted by account (never stored). A token that doesn't check out counts as signed out.
    let uid: string | null = null;
    const h = String(req.headers.authorization || '');
    if (h.startsWith('Bearer ') && !h.startsWith('Bearer guest_')) {
      try { uid = String((await getAuth().verifyIdToken(h.slice(7))).uid); } catch { uid = null; }
    }
    try {
      const page = await pageOf(key, slug, String(b.kind || 'area'));
      if (!page) return res.status(404).json({ error: 'no page' });
      void cleanOld().catch(() => {});
      const day = dayOf();
      const t = await take(day, c, device, clientIp(req, HOPS), uid, text);
      if (t.ok === false) return t.why === 'same' ? res.json({ ok: true }) : res.json({ limit: t.why });
      await col('contributions').add({
        key, slug, page: page.page, label: cut(page.name, 200), kind: category ? FIX_KINDS[category] : 'detail', ...(category ? { category } : {}),
        text, lang, credit: false, owner: false, uid: 'site', source: 'site-fix', signedIn: !!uid, status: 'pending', at: Date.now(), day,
      });
      res.json({ ok: true });
    } catch (e: any) {
      console.error('[site-fix]', e?.message);
      res.status(500).json({ error: 'failed' });
    }
  });
}
