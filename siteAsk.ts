/**
 * "Stuck? Ask about this" on the website's guide pages (owner, Oct 29 2026): a small box near the top of every guide
 * front page, chapter/area page and compendium page (scripts/guides/publish.ts askBox, Marketing_Website_Files/assets/ask.js).
 *
 *   Switch: config/siteAsk.enabled (read every 30 seconds; off, the box hides itself and the endpoint refuses).
 *   Answers: the app's answer model (MAIN_MODEL, no screenshot), from the page being read (its page.json) and the rest of
 *     the game's guide (its search.json: the entries that match the question, and the two pages they point to most).
 *     No search unless the guide doesn't cover it; then one Google-grounded call, if the day's searches allow. Each
 *     answer links the guide sections it used.
 *   Who may ask: Firebase App Check (reCAPTCHA Enterprise, config/siteAsk.recaptchaKey; enforced on the deployed
 *     server once the key is set); 3 questions a device a day and 10 a network, no account; then "Sign in for more"
 *     (the web app, with the question filled in), where the normal free / Premium limits apply. The site's free
 *     questions stop at config/siteAsk.dailyDollars ($1) a day: then "sign in or get the app".
 *   Kept (nothing that identifies the person): siteQuestions/{id} { key, slug, kind, lang, q, answer, covered, sources,
 *     dollars, searches, at, day }. Device and network counts are one-way hashes with a salt that changes every day, in
 *     siteAskDays/{day}, deleted after two days.
 *   From the questions:
 *     - not covered by the guide (and answered with a search): a "missing" item for that page in contributions
 *       (source "site"), checked against sources by the nightly pipeline within its budget and decided by the owner, like
 *       the editor's "Send to pipeline"; at most config/siteAsk.fixesPerDay (10) a day, one per similar question a month;
 *     - the same question asked 3 times on a page (60 days): a "Players asked" suggestion (playersAsked/{id}) on
 *       /admin/asked (approve, edit, reject). Approved ones show inside that page (publish.ts).
 */
import crypto from 'crypto';
import { type Express, type Request, type Response } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAppCheck } from 'firebase-admin/app-check';
import type { GoogleGenAI } from '@google/genai';
import { ThinkingLevel } from '@google/genai';
import { requestCost, logUsage } from './usage';
import { playerSearchesToday, monthlyBudgetOk, countSearches, recordPlayerSearches } from './searchGuard';
import { clientIp } from './guestGuard';
import { isAdmin } from './reviewQueue';
import { markSiteDirty } from './ownerEditor';
import { isLocalServer } from './testTraffic';
import { ADMIN_THEME_HEAD, ADMIN_THEME_BUTTON } from './adminTheme';

const SITE = () => (process.env.QC_SITE_URL || 'https://questcompendium.com').replace(/\/$/, '');
const MODEL = () => process.env.MAIN_MODEL || 'gemini-3.8-flash';
const LANGS = ['en', 'es', 'pt', 'de', 'fr', 'ru', 'ja', 'ko', 'zh'];
const LANG_NAME: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese (Brazil)', de: 'German', fr: 'French', ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Simplified Chinese' };
const HOPS = Number(process.env.GUEST_PROXY_HOPS || 1);
const dayOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/**
 * A local server (tests) keeps to its own collections (test_siteQuestions, test_contributions…), so nothing it does
 * reaches the pipeline, the review queues or the numbers; QC_SITE_ASK_ON=1 turns the box on for it alone.
 */
const col = (name: string) => getFirestore().collection(isLocalServer() ? `test_${name}` : name);

export type SiteAskConfig = { enabled: boolean; appCheck: 'enforce' | 'off'; recaptchaKey: string; dailyDollars: number; perDevice: number; perIp: number; fixesPerDay: number };
const DEFAULTS: SiteAskConfig = { enabled: false, appCheck: 'enforce', recaptchaKey: '', dailyDollars: 1, perDevice: 3, perIp: 10, fixesPerDay: 10 };
let cfgCache: { at: number; v: SiteAskConfig } | null = null;
export async function siteAskConfig(fresh = false): Promise<SiteAskConfig> {
  if (!fresh && cfgCache && Date.now() - cfgCache.at < 30_000) return cfgCache.v;
  let v = DEFAULTS;
  try { v = { ...DEFAULTS, ...((await getFirestore().collection('config').doc('siteAsk').get()).data() || {}) } as SiteAskConfig; } catch { /* the defaults: off */ }
  if (isLocalServer() && process.env.QC_SITE_ASK_ON === '1') v = { ...v, enabled: true, perIp: Number(process.env.QC_SITE_ASK_PER_IP) || v.perIp };
  cfgCache = { at: Date.now(), v };
  return v;
}
/** App Check is checked on the deployed server once the reCAPTCHA key is set (a local server skips it unless asked to). */
const appCheckOn = (c: SiteAskConfig) => c.appCheck === 'enforce' && !!c.recaptchaKey && (!isLocalServer() || process.env.QC_SITE_ASK_APPCHECK === '1');

// ---- the guide's own files (page.json, search.json), cached ten minutes ----
const files = new Map<string, { at: number; v: any }>();
async function siteJson(path: string): Promise<any> {
  const hit = files.get(path);
  if (hit && Date.now() - hit.at < 600_000) return hit.v;
  let v: any = null;
  try { const r = await fetch(`${SITE()}${path}`); if (r.ok) v = await r.json(); } catch { /* none */ }
  files.set(path, { at: Date.now(), v });
  if (files.size > 400) files.delete(files.keys().next().value as string);
  return v;
}
const guideBase = (key: string, lang: string) => `/${lang === 'en' ? '' : `${lang}/`}guides/${key}/`;

const STOP = new Set('the a an and or of to in on at for is are was be it this that with how do does i my me can where what when which who why get find there here from by as into out up not no any all about after before should would could will you your game'.split(' '));
export const words = (s: string) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w));
/** How alike two questions are: shared words over all words (0 to 1). */
export function similar(a: string, b: string): number {
  const x = new Set(words(a)), y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / (x.size + y.size - n);
}

type Ref = { label: string; href: string };
/** A page.json as short tagged lines; each tag stands for that line's spot on the page. */
function pageLines(p: any, base: string, prefix: string, budget: number, refs: Record<string, Ref>): string {
  if (!p) return '';
  const href = `${base}${p.slug}/`;
  let n = 0;
  const tag = (label: string, anchor = '') => { const t = `${prefix}${++n}`; refs[t] = { label: cut(label || p.name, 80), href: anchor ? `${href}#${anchor}` : href }; return `[${t}]`; };
  const lines: string[] = [];
  if (p.overview) lines.push(`${tag(p.name)} ${cut(p.overview, 500)}`);
  for (const s of p.walkthrough || []) lines.push(`${tag(s.title || p.name, s.id)} Step: ${cut([s.title, s.text].filter(Boolean).join(': '), 400)}`);
  for (const e of p.items || []) lines.push(`${tag(e.name, e.id ? `e-${e.id}` : '')} Item: ${cut([e.name, e.where && `where: ${e.where}`, e.how && `how: ${e.how}`, e.missable && `missable${e.lockout ? `: ${e.lockout}` : ''}`, e.unconfirmed && 'not yet confirmed'].filter(Boolean).join('; '), 300)}`);
  for (const e of p.secrets || []) lines.push(`${tag(String(e.text || e.name || '').split(/[.:;]/)[0], e.id ? `e-${e.id}` : '')} Secret: ${cut(e.text || e.name, 300)}`);
  for (const x of p.sections || []) for (const e of x.entries || []) lines.push(`${tag(String(e.text || '').split(/[.:;]/)[0], e.id ? `e-${e.id}` : '')} ${x.title}: ${cut(e.text, 300)}`);
  for (const f of p.fights || []) lines.push(`${tag(f.name, f.id || '')} Key fight: ${cut([f.name, f.weaknesses && `weak to ${f.weaknesses}`, f.tactics].filter(Boolean).join('; '), 300)}`);
  for (const c of p.choices || []) lines.push(`${tag(c.choice || c.title || p.name)} Choice: ${cut(JSON.stringify(c), 300)}`);
  const qd = p.quest;
  if (qd) {
    lines.push(`${tag(p.name)} Mission: ${cut([qd.giver && `given by ${qd.giver}`, qd.chapter, qd.where && `starts: ${qd.where}`].filter(Boolean).join('; '), 300)}`);
    for (const m of qd.missables || []) lines.push(`${tag(p.name)} Missable: ${cut(m, 250)}`);
    for (const c of qd.choices || []) lines.push(`${tag(p.name)} Choice: ${cut(`${c.choice} → ${c.outcome}`, 300)}`);
    for (const part of qd.parts || []) for (const st of part.steps || []) lines.push(`${tag(`${part.name}`, st.id || part.id || '')} ${cut(part.name, 60)} step: ${cut(st.text, 250)}`);
    if (qd.walkthrough?.slug) lines.push(`Walkthrough: the "${cut(qd.walkthrough.name, 80)}" page covers it step by step.`);
  }
  for (const s of [...(p.story || []), ...(p.gameplay || [])]) lines.push(`${tag(`${p.name}: ${s.heading}`)} ${s.heading}: ${cut(s.text, 500)}`);
  for (const e of p.enemies || []) lines.push(`Enemy: ${cut([e.name, e.weakness && `weak to ${e.weakness}`].filter(Boolean).join(', '), 160)}`);
  for (const t of p.tips || []) lines.push(`Tip: ${cut(t, 200)}`);
  if (p.info?.region) lines.push(`Region: ${cut(p.info.region, 120)}`);
  let body = '';
  for (const l of lines) { if (body.length + l.length + 3 > budget) break; body += `- ${l}\n`; }
  for (const t of Object.keys(refs)) if (t.startsWith(prefix) && !body.includes(`[${t}]`)) delete refs[t];
  return body;
}

/** The context: the page being read, the guide entries that match the question, and the two pages they point to most. */
async function context(key: string, slug: string, kind: string, lang: string, q: string) {
  const refs: Record<string, Ref> = {};
  const base = guideBase(key, lang);
  const pagePath = (s: string, entity: boolean) => (entity ? guideBase(key, 'en') : base) + `${s}/page.json`;
  const self = slug ? (await siteJson(pagePath(slug, kind === 'entity'))) || (lang !== 'en' && kind !== 'entity' ? await siteJson(`${guideBase(key, 'en')}${slug}/page.json`) : null) : null;
  const guide = await siteJson(`${base}guide.json`) || await siteJson(`${guideBase(key, 'en')}guide.json`);
  const index: any[] = (await siteJson(`${base}search.json`)) || (await siteJson(`${guideBase(key, 'en')}search.json`)) || [];
  const qw = new Set(words(q));
  const scored = index.map((x) => {
    const w = words(`${x.l} ${x.c || ''}`);
    let s = 0;
    for (const t of new Set(w)) if (qw.has(t)) s += 1;
    return { x, s: s + (s && x.p ? 0.5 : 0) };
  }).filter((y) => y.s > 0 && !(slug && String(y.x.h).includes(`/${slug}/`))).sort((a, b) => b.s - a.s).slice(0, 25);
  let n = 0;
  const matchLines = scored.map(({ x }) => { const t = `r${++n}`; refs[t] = { label: cut(x.l, 80), href: x.h }; return `- [${t}] ${x.k}: ${cut(x.l, 120)}${x.c ? ` (${cut(x.c, 80)})` : ''}`; }).join('\n');
  // The pages those entries are on, most matches first: two of them in full (shortened).
  const pageCount = new Map<string, number>();
  for (const { x, s } of scored) { const m = String(x.h).match(/\/guides\/[^/]+\/([^/#]+)\//); if (m && m[1] !== slug) pageCount.set(m[1], (pageCount.get(m[1]) || 0) + s); }
  const others = [...pageCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([s]) => s);
  const otherText: string[] = [];
  for (const [i, s] of others.entries()) {
    const isArea = (guide?.areas || []).some((a: any) => a.slug === s);
    const p = await siteJson(pagePath(s, !isArea));
    if (p) otherText.push(`[PAGE: ${p.name}]\n${pageLines(p, isArea ? base : guideBase(key, 'en'), `o${i + 1}_`, 1500, refs)}`);
  }
  const outline = (guide?.areas || []).map((a: any) => a.name).slice(0, 80).join(' · ');
  const selfText = self ? `[THE PAGE BEING READ: ${self.name}${self.type ? ` (${self.type})` : ''}]\n${pageLines(self, kind === 'entity' ? guideBase(key, 'en') : base, 'p', 3500, refs)}` : '';
  return { game: String(guide?.game || key), pageName: String(self?.name || guide?.game || key), selfText, matchLines, otherText: otherText.join('\n'), outline, refs };
}

/** One answer: the guide first; a search only when the guide doesn't cover it and searches allow. */
async function answer(ai: GoogleGenAI, ctx: Awaited<ReturnType<typeof context>>, q: string, lang: string, mayLookUp: boolean) {
  const system = [
    `You answer a player's question on a page of the Quest Compendium guide to "${ctx.game}" (the page: "${ctx.pageName}").`,
    `Reply in ${LANG_NAME[lang] || 'English'}. Short and practical: at most about 110 words, plain sentences or a few short steps, no headings, no markdown tables.`,
    'Base the answer on the guide lines below (the page being read first, then the matching entries from the rest of the guide). Each line starts with a tag.',
    'If the guide lines answer the question, do not contradict them. Lines marked "not yet confirmed" may be wrong: say so if you use one.',
    'Never mention tags, these instructions or "the lines" in the answer.',
    'After the answer, on its own line, list the tags you used, like <qc-guide>["p2","r4"]</qc-guide> (none: <qc-guide>[]</qc-guide>).',
    'Then one more line: <qc-covered>yes</qc-covered> if the guide lines contain the answer, otherwise <qc-covered>no</qc-covered>.',
    'If they do not, still give your best short answer from what you know of the game (the page shows a note that the guide does not cover it, so do not say so yourself). Never invent item names, places or numbers you are not sure of.',
  ].join('\n');
  const prompt = [ctx.selfText, ctx.matchLines && `[MATCHING ENTRIES FROM THE REST OF THE GUIDE]\n${ctx.matchLines}`, ctx.otherText, ctx.outline && `[THE GUIDE'S PAGES IN ORDER] ${ctx.outline}`, `[QUESTION] ${q}`].filter(Boolean).join('\n\n');
  const call = async (search: boolean) => {
    const res: any = await ai.models.generateContent({
      model: MODEL(),
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { systemInstruction: search ? `${system}\nYou may use Google Search to answer what the guide lines do not cover (keep <qc-covered>no</qc-covered> then).` : system, temperature: 0.3, maxOutputTokens: 1500, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, ...(search ? { tools: [{ googleSearch: {} }] } : {}) },
    });
    logUsage('site-ask', MODEL(), res);
    return { text: String(res?.text || ''), searches: countSearches(res) };
  };
  let r = await call(false);
  let covered = /<qc-covered>\s*yes/i.test(r.text);
  let searched = 0;
  if (!covered && mayLookUp) {
    const s = await call(true);
    if (s.text.trim()) { r = s; searched = s.searches; }
    covered = false;
  }
  const tags = [...String(r.text.match(/<qc-guide>([\s\S]*?)<\/qc-guide>/i)?.[1] || '').matchAll(/[a-z]\d+(?:_\d+)?/gi)].map((m) => m[0]);
  const text = r.text.replace(/<qc-guide>[\s\S]*?<\/qc-guide>/gi, '').replace(/<qc-covered>[\s\S]*?<\/qc-covered>/gi, '').replace(/[ \t]*\[[a-z]\d+(?:_\d+)?\]/gi, '').replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const seen = new Set<string>();
  const sources = tags.map((t) => ctx.refs[t]).filter((x): x is Ref => !!x && !seen.has(x.href) && !!seen.add(x.href)).slice(0, 3);
  return { text, covered, sources, searches: searched };
}

// ---- limits: devices and networks per day (hashed with the day's salt), the site's dollars per day ----
const SALT = () => process.env.SITE_ASK_SALT || process.env.CORRECTION_SALT || 'qc-site-ask';
const hashOf = (day: string, kind: string, v: string) => crypto.createHmac('sha256', `${SALT()}:${day}`).update(`${kind}:${v}`).digest('hex').slice(0, 16);
type Take = { ok: true; left: number } | { ok: false; why: 'device' | 'ip' | 'site' };
async function take(device: string, ip: string, c: SiteAskConfig): Promise<Take> {
  const day = dayOf();
  const ref = col('siteAskDays').doc(day);
  const d = hashOf(day, 'd', device), i = hashOf(day, 'i', ip);
  return getFirestore().runTransaction(async (tx) => {
    const cur: any = (await tx.get(ref)).data() || {};
    if ((Number(cur.dollars) || 0) >= c.dailyDollars) return { ok: false, why: 'site' } as Take;
    const dn = Number(cur.d?.[d]) || 0, inn = Number(cur.i?.[i]) || 0;
    if (dn >= c.perDevice) return { ok: false, why: 'device' } as Take;
    if (inn >= c.perIp) return { ok: false, why: 'ip' } as Take;
    tx.set(ref, { d: { [d]: dn + 1 }, i: { [i]: inn + 1 }, asked: FieldValue.increment(1), at: Date.now() }, { merge: true });
    return { ok: true, left: c.perDevice - dn - 1 } as Take;
  });
}
let cleaned = '';
/** Yesterday's-but-one counts go (only the dollars, questions and limits of the last two days are kept). */
async function cleanOld() {
  const day = dayOf();
  if (cleaned === day) return;
  cleaned = day;
  const old = await col('siteAskDays').where('__name__', '<', dayOf(Date.now() - 2 * 86_400_000)).get();
  for (const doc of old.docs) await doc.ref.delete();
}

// ---- what the questions teach: fixes for the pipeline, "Players asked" suggestions ----
async function learn(id: string, x: { key: string; slug: string; kind: string; lang: string; q: string; answer: string; covered: boolean; searched: number }, c: SiteAskConfig) {
  const recent = (await col('siteQuestions').where('key', '==', x.key).where('slug', '==', x.slug).limit(400).get()).docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((d) => d.at > Date.now() - 60 * 86_400_000 && d.lang === x.lang);
  const same = recent.filter((d) => similar(d.q, x.q) >= 0.5);
  // Not in the guide, and answered from a search: a "missing" item for that page, checked and decided like the rest.
  if (!x.covered && x.searched && x.slug) {
    const month = same.filter((d) => d.id !== id && d.queued && d.at > Date.now() - 30 * 86_400_000);
    const day = dayOf();
    const dayRef = col('siteAskDays').doc(day);
    const queuedToday = Number((await dayRef.get()).data()?.fixes) || 0;
    if (!month.length && queuedToday < c.fixesPerDay) {
      await col('contributions').add({
        key: x.key, slug: x.slug, page: x.kind === 'entity' ? 'entity' : 'area', anchor: '', label: cut(x.q, 200), kind: 'missing',
        text: cut(x.answer, 2000), lang: x.lang, credit: false, owner: false, uid: 'site', source: 'site', status: 'pending', at: Date.now(),
      });
      await dayRef.set({ fixes: FieldValue.increment(1) }, { merge: true });
      await col('siteQuestions').doc(id).set({ queued: true }, { merge: true });
    }
  }
  // Asked three times on this page: a "Players asked" suggestion (or one more ask on the one there is).
  if (same.length >= 3) {
    const sugg = (await col('playersAsked').where('key', '==', x.key).where('slug', '==', x.slug).get()).docs.find((d) => d.data().lang === x.lang && similar(d.data().q, x.q) >= 0.5);
    if (sugg) await sugg.ref.set({ count: same.length, lastAt: Date.now(), examples: [...new Set([...(sugg.data().examples || []), x.q])].slice(-8) }, { merge: true });
    else await col('playersAsked').add({ key: x.key, slug: x.slug, kind: x.kind, lang: x.lang, q: cut(x.q, 200), a: cut(x.answer, 1200), covered: x.covered, count: same.length, examples: same.map((d) => cut(d.q, 200)).slice(-8), status: 'suggested', at: Date.now(), lastAt: Date.now() });
  }
}

export function registerSiteAsk(app: Express, deps: { gemini: () => GoogleGenAI; requireAuth: any; firebaseWebConfig: Record<string, string> }) {
  // The box asks whether it's on (and for the App Check key) when a page opens.
  app.get('/api/site/ask/config', async (_req: Request, res: Response) => {
    const c = await siteAskConfig();
    res.set('Cache-Control', 'public, max-age=30');
    res.json(c.enabled ? { on: true, perDevice: c.perDevice, ...(appCheckOn(c) ? { appCheck: { key: c.recaptchaKey, firebase: deps.firebaseWebConfig } } : {}) } : { on: false });
  });

  app.post('/api/site/ask', async (req: Request, res: Response) => {
    const c = await siteAskConfig();
    if (!c.enabled) return res.status(503).json({ off: true });
    if (appCheckOn(c)) {
      try { await getAppCheck().verifyToken(String(req.headers['x-firebase-appcheck'] || '')); } catch { return res.status(401).json({ error: 'check' }); }
    }
    const b = req.body || {};
    const key = String(b.key || ''), slug = String(b.slug || ''), kind = ['area', 'entity', 'front'].includes(b.kind) ? String(b.kind) : 'area';
    const lang = LANGS.includes(b.lang) ? String(b.lang) : 'en';
    const q = cut(b.q, 300), device = String(b.device || '');
    if (!/^[a-z0-9-]{2,120}$/.test(key) || (slug && !/^[a-z0-9-]{1,160}$/.test(slug)) || q.length < 3 || !/^[a-f0-9]{16,64}$/.test(device)) return res.status(400).json({ error: 'bad request' });
    void cleanOld().catch(() => {});
    const t = await take(device, clientIp(req, HOPS), c);
    if (t.ok === false) return res.json({ limit: t.why });
    const scope = { dollars: 0, searches: 0 };
    try {
      const out = await requestCost.run(scope, async () => {
        const ctx = await context(key, slug, kind, lang, q);
        if (!ctx.selfText && !ctx.matchLines) return null;
        // A search only with room for it: the day's and month's searches, and enough of the site's dollars left.
        const day: any = (await col('siteAskDays').doc(dayOf()).get()).data() || {};
        const mayLookUp = (Number(day.dollars) || 0) + 0.05 < c.dailyDollars && (await playerSearchesToday()) && (await monthlyBudgetOk());
        return { ctx, a: await answer(deps.gemini(), ctx, q, lang, mayLookUp) };
      });
      if (!out) return res.status(404).json({ error: 'no guide' });
      if (out.a.searches) recordPlayerSearches(out.a.searches);
      const dollars = Math.round(scope.dollars * 10000) / 10000;
      await col('siteAskDays').doc(dayOf()).set({ dollars: FieldValue.increment(dollars), questions: FieldValue.increment(1) }, { merge: true });
      const doc = await col('siteQuestions').add({
        key, slug, kind, lang, q, answer: out.a.text, covered: out.a.covered, sources: out.a.sources.map((s) => s.href), searches: out.a.searches,
        dollars, model: MODEL(), at: Date.now(), day: dayOf(), ...(isLocalServer() ? { test: true } : {}),
      });
      void learn(doc.id, { key, slug, kind, lang, q, answer: out.a.text, covered: out.a.covered, searched: out.a.searches }, c).catch((e) => console.warn('[site-ask] learn', e?.message));
      res.json({ answer: out.a.text, sources: out.a.sources, covered: out.a.covered, searched: out.a.searches > 0, left: t.left });
    } catch (e: any) {
      console.error('[site-ask]', e?.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  // ---- /admin/asked: "Players asked" suggestions (approve, edit, reject) ----
  const requireAdmin = (req: any, res: Response, next: () => void) => (isAdmin(req.user) ? next() : res.status(403).json({ error: 'Not an admin.' }));
  app.get('/api/admin/asked', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const status = ['suggested', 'approved', 'rejected'].includes(String(req.query.status)) ? String(req.query.status) : 'suggested';
    const docs = (await col('playersAsked').where('status', '==', status).get()).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    res.json({ items: docs.sort((a, b) => (b.count || 0) - (a.count || 0) || (b.lastAt || 0) - (a.lastAt || 0)).slice(0, 200) });
  });
  app.post('/api/admin/asked/:id', deps.requireAuth, requireAdmin, async (req: any, res: Response) => {
    const ref = col('playersAsked').doc(String(req.params.id));
    const cur = (await ref.get()).data();
    if (!cur) return res.status(404).json({ error: 'not found' });
    const action = String(req.body?.action || '');
    const q = req.body?.q !== undefined ? cut(req.body.q, 200) : cur.q, a = req.body?.a !== undefined ? cut(req.body.a, 1200) : cur.a;
    if (!['approve', 'reject', 'update', 'reopen'].includes(action) || !q || !a) return res.status(400).json({ error: 'bad request' });
    const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'reopen' ? 'suggested' : cur.status;
    await ref.set({ q, a, status, decided: { by: String(req.user?.email || ''), at: Date.now() } }, { merge: true });
    // On the site from the next publish (approved, or an approved one changed or taken back).
    if (status === 'approved' || cur.status === 'approved') await markSiteDirty();
    res.json({ ok: true, status });
  });
  app.get('/admin/asked', (_req: Request, res: Response) => res.type('html').send(adminPage(deps.firebaseWebConfig)));
}

function adminPage(firebaseConfig: Record<string, string>): string {
  const cfg = JSON.stringify(firebaseConfig).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head>${ADMIN_THEME_HEAD}<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Players asked</title>
<style>
  :root { color-scheme: dark; --bg: #07070a; --card: #111118; --line: #24242e; --text: #e4e4e7; --dim: #a1a1aa; --accent: #a87ffb; --ok: #4ade80; --bad: #f87171; }
  * { box-sizing: border-box; } body { margin: 0; font: 14px/1.5 Inter, system-ui, sans-serif; background: var(--bg); color: var(--text); }
  header { position: sticky; top: 0; background: rgba(7,7,10,.92); border-bottom: 1px solid var(--line); padding: 12px 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  h1 { font-size: 16px; margin: 0; flex: 1; } main { max-width: 900px; margin: 0 auto; padding: 16px; }
  button { font: inherit; color: var(--text); background: #1b1b24; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
  button:hover { border-color: var(--accent); } button.primary { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }
  .tab.on { border-color: var(--accent); background: #2a2140; color: #fff; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin: 0 0 12px; }
  .dim { color: var(--dim); } a { color: var(--accent); } label { display: block; font-size: 12px; color: var(--dim); margin-top: 8px; }
  input, textarea { width: 100%; font: inherit; color: var(--text); background: #0c0c12; border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
  textarea { min-height: 90px; } .actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; } ul { margin: 6px 0; padding-left: 18px; }
</style></head><body>
<header><h1>Players asked</h1><button class="tab on" data-s="suggested">Suggested</button><button class="tab" data-s="approved">Approved</button><button class="tab" data-s="rejected">Rejected</button><span id="who" class="dim"></span>${ADMIN_THEME_BUTTON}</header>
<main><p class="dim">Questions asked three or more times on the same guide page (the "Stuck? Ask about this" box). Approved entries show inside that page, under "Players asked", from the next site publish. Edit the question and answer first if needed.</p><div id="gateMsg" class="dim"></div><div id="list"></div></main>
<script type="module">
  let fb;
  try { fb = { ...(await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js")), ...(await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js")) }; }
  catch (e) { document.getElementById('gateMsg').textContent = 'Sign-in could not load: allow www.gstatic.com for this page.'; throw e; }
  const { initializeApp, getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } = fb;
  const auth = getAuth(initializeApp(${cfg}));
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let status = 'suggested';
  async function api(path, body) {
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + await auth.currentUser.getIdToken(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    return r.json();
  }
  async function load() {
    $('list').innerHTML = '<p class="dim">Loading…</p>';
    try {
      const { items } = await api('/api/admin/asked?status=' + status);
      $('list').innerHTML = items.length ? items.map((x) => '<div class="card" data-id="' + esc(x.id) + '"><div><b>' + esc(x.key) + (x.slug ? ' / ' + esc(x.slug) : '') + '</b> <span class="dim">· asked ' + esc(x.count) + ' times · ' + esc(x.lang) + (x.covered ? '' : ' · the guide did not cover it') + '</span> <a target="_blank" rel="noopener" href="https://questcompendium.com/' + (x.lang && x.lang !== 'en' && x.kind !== 'entity' ? esc(x.lang) + '/' : '') + 'guides/' + esc(x.key) + '/' + (x.slug ? esc(x.slug) + '/' : '') + '">open the page</a></div>'
        + '<label>Question</label><input data-f="q" value="' + esc(x.q) + '"><label>Answer</label><textarea data-f="a">' + esc(x.a) + '</textarea>'
        + '<details><summary class="dim">How players asked it</summary><ul>' + (x.examples || []).map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul></details>'
        + '<div class="actions">' + (status === 'suggested' ? '<button class="primary" data-a="approve">Approve</button><button data-a="reject">Reject</button>' : status === 'approved' ? '<button class="primary" data-a="update">Save changes</button><button data-a="reject">Take off the site</button>' : '<button data-a="reopen">Back to suggested</button>') + '</div></div>').join('') : '<p class="dim">Nothing here.</p>';
    } catch (e) { $('list').innerHTML = '<p class="dim">' + esc(e.message) + '</p>'; }
  }
  $('list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const card = b.closest('.card');
    b.disabled = true;
    try { await api('/api/admin/asked/' + card.dataset.id, { action: b.dataset.a, q: card.querySelector('[data-f=q]').value, a: card.querySelector('[data-f=a]').value }); card.remove(); }
    catch (err) { alert(err.message); b.disabled = false; }
  });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t)); status = t.dataset.s; load(); }));
  onAuthStateChanged(auth, (u) => { if (u) { $('who').textContent = u.email; $('gateMsg').textContent = ''; load(); } else { $('gateMsg').innerHTML = '<button class="primary" id="in">Sign in with Google</button>'; $('in').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()); } });
</script></body></html>`;
}
