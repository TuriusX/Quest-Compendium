/**
 * "Stuck? Ask about this" on the website's guide pages (owner, Oct 29 2026): a small box near the top of every guide
 * front page, chapter/area page and compendium page (scripts/guides/publish.ts askBox, Marketing_Website_Files/assets/ask.js).
 *
 *   Switch: config/siteAsk.enabled (read every 30 seconds; off, the box hides itself and the endpoint refuses).
 *   Answers: with config/siteAsk.fullAnswers (owner, Nov 3 2026), the app's own answer code and instructions (server.ts
 *     chatHandler, Fast): full knowledge first, the guide as reference for exact details and links, never a limit.
 *     Without it, the older way: the app's answer model (MAIN_MODEL, no screenshot), from the page being read (its
 *     page.json) and the rest of the game's guide (its search.json: the entries that match the question, and the two pages
 *     they point to most); no search unless the guide doesn't cover it; then one Google-grounded call, if the day's
 *     searches allow. Each answer links the guide sections it used.
 *   Who may ask: Firebase App Check (reCAPTCHA Enterprise, config/siteAsk.recaptchaKey; enforced on the deployed
 *     server once the key is set). Guide questions have their own daily allowance, never the app's: 2 a device (and 10 a
 *     network) signed out, then "Sign in for more" (signing in right there; the question is then asked); 10 signed in;
 *     50 with Premium (config/siteAsk perDevice, perIp, perSignedIn, perPremium). The site's questions stop at
 *     config/siteAsk.dailyDollars ($1) a day (signed-out and free ones; Premium ones don't count).
 *   Kept (nothing that identifies the person): siteQuestions/{id} { key, slug, kind, lang, q, answer, covered, sources,
 *     dollars, searches, at, day }. Device and network counts are one-way hashes with a salt that changes every day, in
 *     siteAskDays/{day}, deleted after two days.
 *   From the questions (inputs for the guides' nightly improvements, scripts/guides/autoImprove.ts: no approval; every
 *   change checked against sources and logged on /admin/asked with an undo, autoChanges.ts):
 *     - not covered by the guide (and answered with a search): a "missing" item for that page in contributions
 *       (source "site"), checked against sources by the nightly pipeline within its budget; at most
 *       config/siteAsk.fixesPerDay (10) a day, one per similar question a month;
 *     - the same question asked 3 times on a page (60 days): a "Players asked" candidate (playersAsked/{id}), reworded
 *       and answered from sources at night; approved ones show inside that page (publish.ts);
 *     - an answer from other pages, or a question about the page's own subject: a page suggestion (pageSuggestions:
 *       add the fact here, or a fuller opening).
 */
import crypto from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type Express, type Request, type Response } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAppCheck } from 'firebase-admin/app-check';
import type { GoogleGenAI } from '@google/genai';
import { ThinkingLevel } from '@google/genai';
import { requestCost, logUsage } from './usage';
import { playerSearchesToday, monthlyBudgetOk, countSearches, recordPlayerSearches } from './searchGuard';
import { clientIp } from './guestGuard';
import { isLocalServer } from './testTraffic';
import { registerAutoChanges } from './autoChanges';
import { GUIDE_REFERENCE, disputedOn, withoutDisputed, recheckLine, type GuideRef } from './guidesApi';
import { visiblePart, nextPiece } from './answerStream';

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
const col = (name: string) => getFirestore().collection(isLocalServer() || previewScope.getStore() ? `test_${name}` : name);
/**
 * The owner's preview on the deployed server (a header with config/siteAsk.previewKey, which the config endpoint never hands
 * out): the switches as if on, no App Check, and test collections, so it reaches no player, pipeline or number.
 */
const previewScope = new AsyncLocalStorage<boolean>();
export function previewKeyOk(given: unknown, key: unknown): boolean {
  const a = Buffer.from(String(given || '')), b = Buffer.from(String(key || ''));
  return b.length >= 32 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type SiteAskConfig = { fullAnswers?: boolean; homeApp?: boolean; previewKey?: string; enabled: boolean; appCheck: 'enforce' | 'off'; recaptchaKey: string; dailyDollars: number; perDevice: number; perIp: number; perSignedIn: number; perPremium: number; fixesPerDay: number; monthlyChecks: number; autoOff?: { month: string; at: number; checks: number } };
const DEFAULTS: SiteAskConfig = { enabled: false, appCheck: 'enforce', recaptchaKey: '', dailyDollars: 1, perDevice: 2, perIp: 10, perSignedIn: 10, perPremium: 50, fixesPerDay: 10, monthlyChecks: 8000 };
let cfgCache: { at: number; v: SiteAskConfig } | null = null;
export async function siteAskConfig(fresh = false): Promise<SiteAskConfig> {
  if (!fresh && cfgCache && Date.now() - cfgCache.at < 30_000) return cfgCache.v;
  let v = DEFAULTS;
  try { v = { ...DEFAULTS, ...((await getFirestore().collection('config').doc('siteAsk').get()).data() || {}) } as SiteAskConfig; } catch { /* the defaults: off */ }
  // Switched off by the reCAPTCHA safety net this month (guard): off until the month is over.
  if (v.autoOff?.month === new Date().toISOString().slice(0, 7)) v = { ...v, enabled: false };
  if (isLocalServer() && process.env.QC_SITE_ASK_ON === '1') v = { ...v, enabled: true, perIp: Number(process.env.QC_SITE_ASK_PER_IP) || v.perIp, perDevice: Number(process.env.QC_SITE_ASK_PER_DEVICE) || v.perDevice };
  if (isLocalServer() && process.env.QC_SITE_FULL === '1') v = { ...v, fullAnswers: true, homeApp: true };
  cfgCache = { at: Date.now(), v };
  return v;
}
// ---- The reCAPTCHA safety net (owner, Oct 29 2026): Google's first 10,000 checks a month are free, and there's no
// spending cap. Every 10 minutes the server reads this month's checks (Cloud Monitoring,
// recaptchaenterprise.googleapis.com/assessment_count; the server's account reads it with Monitoring Viewer); past
// config/siteAsk.monthlyChecks (8,000) the box switches itself off (config/siteAsk.autoOff) and says so on Discord, and it
// switches back on when the next month starts (UTC, like Google's billing month).
const PROJECT = () => process.env.GOOGLE_CLOUD_PROJECT || 'quest-compendium-1bccf';
async function recaptchaChecksThisMonth(): Promise<number | null> {
  if (isLocalServer()) return null;
  try {
    // The server's own access token, from the Cloud Run metadata server.
    const tok: any = await (await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } })).json();
    const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
    const end = new Date();
    const q = new URLSearchParams({
      filter: 'metric.type="recaptchaenterprise.googleapis.com/assessment_count"',
      'interval.startTime': start.toISOString(), 'interval.endTime': end.toISOString(),
      'aggregation.alignmentPeriod': `${Math.max(60, Math.ceil((end.getTime() - start.getTime()) / 1000))}s`,
      'aggregation.perSeriesAligner': 'ALIGN_SUM', 'aggregation.crossSeriesReducer': 'REDUCE_SUM',
    });
    const r = await fetch(`https://monitoring.googleapis.com/v3/projects/${PROJECT()}/timeSeries?${q}`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (!r.ok) { console.warn(`[site-ask] reCAPTCHA count: ${r.status}`); return null; }
    const j: any = await r.json();
    return (j.timeSeries || []).reduce((n: number, t: any) => n + (t.points || []).reduce((m: number, pt: any) => m + Number(pt.value?.int64Value || 0), 0), 0);
  } catch (e: any) {
    console.warn(`[site-ask] reCAPTCHA count: ${e?.message}`);
    return null;
  }
}
const discord = (content: string) => {
  const hook = process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_SIGNUP_WEBHOOK_URL;
  return hook ? fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }).catch(() => {}) : Promise.resolve();
};
let guardAt = 0;
async function guard(): Promise<void> {
  if (Date.now() - guardAt < 600_000) return;
  guardAt = Date.now();
  const raw: any = (await getFirestore().collection('config').doc('siteAsk').get()).data() || {};
  const month = new Date().toISOString().slice(0, 7), limit = Number(raw.monthlyChecks) || DEFAULTS.monthlyChecks;
  // A new month: back on (the safety net only ever switches off its own month).
  if (raw.autoOff && raw.autoOff.month !== month) {
    await getFirestore().collection('config').doc('siteAsk').set({ autoOff: FieldValue.delete() }, { merge: true });
    await discord(`✅ The guide pages' ask box is back on for ${month} (it was switched off in ${raw.autoOff.month} after ${raw.autoOff.checks} reCAPTCHA checks).`);
    cfgCache = null;
  }
  const n = await recaptchaChecksThisMonth();
  if (n === null) return;
  await getFirestore().collection('config').doc('siteAsk').set({ checks: { month, n, at: Date.now() } }, { merge: true });
  if (n >= limit && raw.autoOff?.month !== month && raw.enabled) {
    await getFirestore().collection('config').doc('siteAsk').set({ autoOff: { month, at: Date.now(), checks: n } }, { merge: true });
    cfgCache = null;
    await discord(`⛔ The guide pages' ask box switched itself off: ${n} reCAPTCHA checks this month (the limit is ${limit}; Google's free 10,000 a month must not be passed). It comes back on when ${month} is over.`);
  }
}

/** App Check is checked on the deployed server once the reCAPTCHA key is set (a local server skips it unless asked to). */
export const appCheckOn = (c: SiteAskConfig) => c.appCheck === 'enforce' && !!c.recaptchaKey && (!isLocalServer() || process.env.QC_SITE_ASK_APPCHECK === '1');

// ---- the guide's own files (page.json, search.json), cached ten minutes ----
const files = new Map<string, { at: number; v: any }>();
async function siteJson(path: string): Promise<any> {
  const hit = files.get(path);
  // Ten minutes for a file, half a minute for one that couldn't be read (a hiccup shouldn't hide a page).
  if (hit && Date.now() - hit.at < (hit.v ? 600_000 : 30_000)) return hit.v;
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
  const lines: string[] = p.rechecking?.length ? [recheckLine(p.rechecking)] : [];
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

/** The area a question names, whole name, the longest name first ("Moonrise Towers Prison" over "Moonrise Towers"). */
export function namedArea<T extends { name: string }>(q: string, areas: T[]): T | undefined {
  const flat = (t: string) => ` ${String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/^the\s+/, '').split(/[^\p{L}\p{N}]+/u).join(' ')} `;
  const text = flat(q);
  return [...areas].filter((a) => flat(a.name).trim().length >= 3).sort((a, b) => b.name.length - a.name.length).find((a) => text.includes(flat(a.name)));
}

/** The context: the page being read, the guide entries that match the question, and the two pages they point to most. */
async function context(key: string, slug: string, kind: string, lang: string, q: string) {
  const refs: Record<string, Ref> = {};
  const base = guideBase(key, lang);
  const pagePath = (s: string, entity: boolean) => (entity ? guideBase(key, 'en') : base) + `${s}/page.json`;
  // Disputed facts aren't reference until they're settled (owner, Nov 10 2026), in any language: translations keep the ids.
  const settled = async (p: any, s: string, entity: boolean) => { if (!p || entity) return p; const d = await disputedOn(key, s); return d.ids.length || d.tips.length ? { ...withoutDisputed(p, d), rechecking: d.names } : p; };
  const self = slug ? await settled((await siteJson(pagePath(slug, kind === 'entity'))) || (lang !== 'en' && kind !== 'entity' ? await siteJson(`${guideBase(key, 'en')}${slug}/page.json`) : null), slug, kind === 'entity') : null;
  const guide = await siteJson(`${base}guide.json`) || await siteJson(`${guideBase(key, 'en')}guide.json`);
  const index: any[] = (await siteJson(`${base}search.json`)) || (await siteJson(`${guideBase(key, 'en')}search.json`)) || [];
  const qw = new Set(words(q));
  const candidates = index.map((x) => {
    const w = words(`${x.l} ${x.c || ''}`);
    let s = 0;
    for (const t of new Set(w)) if (qw.has(t)) s += 1;
    return { x, s: s + (s && x.p ? 0.5 : 0) };
  }).filter((y) => y.s > 0 && !(slug && String(y.x.h).includes(`/${slug}/`))).sort((a, b) => b.s - a.s).slice(0, 25);
  let n = 0;
  const scored = (await Promise.all(candidates.map(async (y) => { const m = String(y.x.h).match(/\/guides\/[^/]+\/([^/#]+)\/#e-(.+)$/); return m && (await disputedOn(key, m[1])).ids.includes(m[2]) ? null : y; }))).filter(Boolean) as typeof candidates;
  const matchLines = scored.map(({ x }) => { const t = `r${++n}`; refs[t] = { label: cut(x.l, 80), href: x.h }; return `- [${t}] ${x.k}: ${cut(x.l, 120)}${x.c ? ` (${cut(x.c, 80)})` : ''}`; }).join('\n');
  // The pages those entries are on, most matches first: two of them in full (shortened).
  const pageCount = new Map<string, number>();
  for (const { x, s } of scored) { const m = String(x.h).match(/\/guides\/[^/]+\/([^/#]+)\//); if (m && m[1] !== slug) pageCount.set(m[1], (pageCount.get(m[1]) || 0) + s); }
  const others = [...pageCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([s]) => s);
  const otherText: string[] = [];
  const otherPages: { slug: string; text: string }[] = [];
  for (const [i, s] of others.entries()) {
    const isArea = (guide?.areas || []).some((a: any) => a.slug === s);
    const p = await settled(await siteJson(pagePath(s, !isArea)), s, !isArea);
    if (p) {
      const text = `[PAGE: ${p.name}]\n${pageLines(p, isArea ? base : guideBase(key, 'en'), `o${i + 1}_`, 1500, refs)}`;
      otherText.push(text);
      otherPages.push({ slug: s, text });
    }
  }
  const outline = (guide?.areas || []).map((a: any) => a.name).slice(0, 80).join(' · ');
  const selfText = self ? `[THE PAGE BEING READ: ${self.name}${self.type ? ` (${self.type})` : ''}]\n${pageLines(self, kind === 'entity' ? guideBase(key, 'en') : base, 'p', 3500, refs)}` : '';
  // The guide's English area names (what the app's guide lookup goes by): the page's own, else an area the question names.
  // Never a guess from loose matches: a place the player didn't mention would steer the answer.
  const enAreas: any[] = (await siteJson(`${guideBase(key, 'en')}guide.json`))?.areas || guide?.areas || [];
  const placeSlug = enAreas.some((a) => a.slug === slug) ? slug : !slug ? namedArea(q, enAreas)?.slug || '' : '';
  const place = placeSlug ? String(enAreas.find((a) => a.slug === placeSlug)?.name || '') : '';
  return { game: String(guide?.game || key), pageName: String(self?.name || guide?.game || key), selfText, matchLines, otherText: otherText.join('\n'), outline, refs, exists: !!(guide || self), place, placeSlug, otherPages };
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
    'Then a last line: <qc-about>yes</qc-about> if the question asks what or who the page itself is about, or asks to explain or expand on the page\'s own subject (not one detail on it), otherwise <qc-about>no</qc-about>.',
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
  const aboutPage = /<qc-about>\s*yes/i.test(r.text);
  const text = r.text.replace(/<qc-guide>[\s\S]*?<\/qc-guide>/gi, '').replace(/<qc-covered>[\s\S]*?<\/qc-covered>/gi, '').replace(/<qc-about>[\s\S]*?<\/qc-about>/gi, '').replace(/[ \t]*\[[a-z]\d+(?:_\d+)?\]/gi, '').replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const seen = new Set<string>();
  const sources = tags.map((t) => ctx.refs[t]).filter((x): x is Ref => !!x && !seen.has(x.href) && !!seen.add(x.href)).slice(0, 3);
  // Answered mostly from other pages: the tags of the page being read start with "p", the rest are elsewhere.
  const own = tags.filter((t) => /^p\d/.test(t)).length, others = tags.filter((t) => !/^p\d/.test(t) && ctx.refs[t]);
  const elsewhere = others.length > 0 && others.length >= 2 * own ? others.map((t) => ctx.refs[t]).filter((x, i, a) => a.findIndex((y) => y.href === x.href) === i).slice(0, 3) : [];
  return { text, covered, sources, searches: searched, aboutPage, elsewhere };
}

// ---- the app's own answers for the website (server.ts chatHandler; owner, Nov 3 2026) ----
export type SiteReference = { withPage: string; withoutPage: string; refs: Record<string, any> };
export type SiteAnswerOpts = { req: Request; question: string; game: string; guideKey?: string; place?: string; language: string; premium: boolean; maySearch: boolean; situation?: string; reference?: SiteReference; imageBase64?: string; stream?: (e: { raw?: string; reset?: boolean; searching?: boolean }) => void };
export type SiteAnswerOut = { text: string; guideRefs?: any[]; searched?: boolean; site?: { answered: boolean; dollars: number; searches: number; missing: { name: string; fact: string }[]; page: { key: string; slug: string; name: string } | null } };
const APP_LANGUAGE: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Brazilian Portuguese', de: 'German', fr: 'French', ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Simplified Chinese' };
export const appLanguage = (lang: string) => APP_LANGUAGE[lang] || 'English';

/** What an attempt the answer gave up on is taken to have cost (a full Fast attempt measured $0.015 on Nov 3 2026). */
export const SITE_ABANDONED_DOLLARS = 0.02;

/** The app's answers are written with markdown; the site's box shows plain text with its line breaks. Nothing is cut. */
export function plainAnswer(text: string): string {
  return String(text || '')
    .replace(/\*\*/g, '').replace(/^#{1,6}\s+/gm, '').replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '').replace(/^(\s*)[*-]\s+/gm, '$1• ')
    .replace(/(^|[\s(])\*([^\s*][^*\n]*?)\*(?=[\s.,;:!?)]|$)/gm, '$1$2').replace(/`([^`\n]+)`/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
}
/** A long answer as a "missing" item: whole sentences, so the nightly check isn't paying to check a whole essay. */
export function missingText(text: string, max = 800): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max), end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'));
  return end > 200 ? head.slice(0, end + 1) : head;
}
/** A guide entry the app's prompt tagged, as a link: the same anchors as the pages (items and secrets e-<id>; steps and fights <id>). */
export function refLink(r: any, key: string, lang: string): Ref | null {
  if (r?.href) return { label: cut(r.label, 80), href: String(r.href) };
  if (!r?.slug) return null;
  const anchor = r.entry ? (r.kind === 'step' || r.kind === 'boss' ? String(r.entry) : `e-${r.entry}`) : '';
  return { label: cut(r.name || r.area, 80), href: `${guideBase(r.key || key, lang)}${r.slug}/${anchor ? `#${anchor}` : ''}` };
}
/** The site's guide lines as reference in the app's words (GUIDE_REFERENCE), with tags extractGuideRefs reads (g1001…). */
export function siteReference(ctx: { selfText: string; matchLines: string; otherPages: { slug: string; text: string }[]; placeSlug: string; refs: Record<string, Ref> }, aboutPage: string): SiteReference {
  const refs: Record<string, any> = {};
  const tags = new Map<string, string>();
  Object.keys(ctx.refs).forEach((t, i) => { tags.set(t, `g${1001 + i}`); refs[`g${1001 + i}`] = ctx.refs[t]; });
  const retag = (s: string) => s.replace(/\[([a-z]\d+(?:_\d+)?)\]/g, (m, t) => (tags.has(t) ? `[${tags.get(t)}]` : m));
  const about = aboutPage ? `Then one more line: <qc-about>yes</qc-about> if the question asks what or who "${aboutPage}" itself is about, or asks to explain its own subject (not one detail of it), otherwise <qc-about>no</qc-about>.` : '';
  const block = (parts: string[]) => {
    const body = parts.filter(Boolean).join('\n\n');
    if (!body) return about;
    return `[MORE FROM THE QUEST COMPENDIUM GUIDE]\n${GUIDE_REFERENCE} Each line starts with its tag.\n${retag(body)}\nIf your answer uses any of these entries, end it with one line listing the tags you used, like <qc-guide>["g1001","g1003"]</qc-guide>. Never mention the tags or this block in the answer text.${about ? `\n${about}` : ''}`;
  };
  const matches = ctx.matchLines && `[MATCHING ENTRIES FROM THE REST OF THE GUIDE]\n${ctx.matchLines}`;
  return {
    // With the app's own notes for the place, that page isn't sent twice.
    withPage: block([matches, ...ctx.otherPages.filter((p) => p.slug !== ctx.placeSlug).map((p) => p.text)]),
    withoutPage: block([ctx.selfText, matches, ...ctx.otherPages.map((p) => p.text)]),
    refs,
  };
}
/** A site link from the guide's search list as the app's guide link (its "From the guide" chip): null when it isn't a page of this guide. */
export function appRefFromSite(r: { label?: string; href?: string }, key: string): GuideRef | null {
  const m = String(r?.href || '').match(/\/guides\/([^/]+)\/([^/#?]+)\/?(?:#(.+))?$/);
  if (!m || m[1] !== key) return null;
  const name = cut(r.label, 80) || m[2];
  const anchor = m[3] || '';
  return { key, slug: m[2], area: name, name, ...(anchor ? { entry: anchor.replace(/^e-/, '') } : {}), ...(anchor && !anchor.startsWith('e-') ? { kind: 'step' as const } : {}) };
}

/**
 * For a Pro answer in the app: the guide lines that match the question and the two pages they're on, from anywhere in the guide, not only the
 * player's area (the same lookup as the website). `placeSlug`: the page the prompt already has, not sent twice. Reads the site's public files.
 */
export async function appGuideLines(key: string, question: string, placeSlug = ''): Promise<{ text: string; refs: Record<string, GuideRef> }> {
  const ctx = await context(key, '', 'area', 'en', question);
  const ref = siteReference({ ...ctx, placeSlug: placeSlug || ctx.placeSlug }, '');
  const refs: Record<string, GuideRef> = {};
  for (const [t, r] of Object.entries(ref.refs)) {
    const a = appRefFromSite(r as any, key);
    if (a) refs[t] = a;
  }
  return { text: placeSlug ? ref.withPage : ref.withoutPage, refs };
}

/** A homepage screenshot: a picture of the right kind and size, by its first bytes as well as its label. It's never saved. */
export const MAX_IMAGE_CHARS = 5_500_000;
export function validImage(v: unknown): string | null {
  const m = typeof v === 'string' && v.length <= MAX_IMAGE_CHARS ? v.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!m) return null;
  const head = Buffer.from(m[2].slice(0, 24), 'base64');
  const png = head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG', jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const webp = head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
  return (m[1] === 'png' && png) || (m[1] === 'jpeg' && jpeg) || (m[1] === 'webp' && webp) ? v as string : null;
}
/** A game named in the homepage's box, as it goes into the instructions: a short name and nothing that could pass for markup. */
export const cleanGameName = (v: unknown) => cut(String(v ?? '').replace(/[<>\[\]{}`"\\]/g, ' '), 80);

/** What the website adds to the app's situation: where the question comes from. It says nothing about how to answer. */
export const homeSituation = (game: string) => `[ASKED ON THE QUEST COMPENDIUM HOMEPAGE: a visitor trying it out, asking about ${game}. They may be anywhere in the game. No app, overlay or quest log is in use here.]`;
export const siteSituation = (pageName: string, game: string) => `[ASKED ON THE QUEST COMPENDIUM WEBSITE: the player is reading the guide${pageName && pageName !== game ? ` page "${pageName}"` : ''} for ${game}, and may not be at that place in the game. No app, overlay or quest log is in use here.]`;

async function fullAnswer(run: (o: SiteAnswerOpts) => Promise<SiteAnswerOut>, req: Request, ctx: Awaited<ReturnType<typeof context>>, key: string, slug: string, lang: string, q: string, premium: boolean, maySearch: boolean, stream?: SiteAnswerOpts['stream'], home?: { imageBase64?: string }) {
  const r = await run({ stream, req, question: q, game: ctx.game, guideKey: key || undefined, place: ctx.place || undefined, language: appLanguage(lang), premium, maySearch, situation: home ? homeSituation(ctx.game) : siteSituation(ctx.pageName, ctx.game), reference: key ? siteReference(ctx, slug ? ctx.pageName : '') : undefined, imageBase64: home?.imageBase64 });
  if (!r.site?.answered) throw new Error(`no answer: ${cut(r.text, 120)}`);
  const seen = new Set<string>();
  const links = (r.guideRefs || []).map((x) => refLink(x, key, lang)).filter((x): x is Ref => !!x && !seen.has(x.href) && !!seen.add(x.href));
  const aboutPage = /<qc-about>\s*yes/i.test(r.text);
  const here = slug ? `/${slug}/` : '';
  return {
    text: plainAnswer(r.text.replace(/<qc-about>[\s\S]*?<\/qc-about>/gi, '')),
    covered: links.length > 0, sources: links.slice(0, 3), searches: r.site.searches, aboutPage,
    // Answered only from other pages: a suggestion for this page, as before.
    elsewhere: here && links.length && links.every((l) => !l.href.includes(here)) ? links.slice(0, 3) : [],
    missing: r.site.missing, missingPage: r.site.page?.slug || '', dollars: r.site.dollars,
  };
}

const gameKeyOf = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

// ---- limits: devices and networks per day (hashed with the day's salt), the site's dollars per day ----
const SALT = () => process.env.SITE_ASK_SALT || process.env.CORRECTION_SALT || 'qc-site-ask';
export const hashOf = (day: string, kind: string, v: string) => crypto.createHmac('sha256', `${SALT()}:${day}`).update(`${kind}:${v}`).digest('hex').slice(0, 16);
type Take = { ok: true; left: number } | { ok: false; why: 'device' | 'ip' | 'site' | 'account' };
/**
 * One guide question, if there's room. Guide questions have their own allowance, never the app's: signed out
 * perDevice a device (and perIp a network), signed in perSignedIn, Premium perPremium (an account counted by a hash of
 * its id with the day's salt). The site's dollars a day cap signed-out and free questions, not Premium ones.
 */
async function take(device: string, ip: string, c: SiteAskConfig, acct: SiteAccount | null): Promise<Take> {
  const day = dayOf();
  const ref = col('siteAskDays').doc(day);
  return getFirestore().runTransaction(async (tx) => {
    const cur: any = (await tx.get(ref)).data() || {};
    if (!acct?.premium && (Number(cur.dollars) || 0) >= c.dailyDollars) return { ok: false, why: 'site' } as Take;
    if (acct) {
      const u = hashOf(day, 'u', acct.uid), un = Number(cur.u?.[u]) || 0, max = acct.premium ? c.perPremium : c.perSignedIn;
      if (un >= max) return { ok: false, why: 'account' } as Take;
      tx.set(ref, { u: { [u]: un + 1 }, asked: FieldValue.increment(1), at: Date.now() }, { merge: true });
      return { ok: true, left: max - un - 1 } as Take;
    }
    const d = hashOf(day, 'd', device), i = hashOf(day, 'i', ip);
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
async function learn(id: string, x: { key: string; slug: string; kind: string; lang: string; q: string; answer: string; covered: boolean; searched: number; aboutPage?: boolean; elsewhere?: Ref[]; missing?: { name: string; fact: string }[]; missingPage?: string }, c: SiteAskConfig) {
  // The page itself could be better: the answer came mostly from other pages (add the fact, or a link, here), or the
  // question asked about the page's own subject (its opening may be too thin). Suggestions for /admin/asked.
  if (x.slug && (x.elsewhere?.length || x.aboutPage)) {
    const kind = x.aboutPage ? 'opening' : 'elsewhere';
    const prev = (await col('pageSuggestions').where('key', '==', x.key).where('slug', '==', x.slug).get()).docs
      .find((d) => d.data().kind === kind && d.data().lang === x.lang && (kind === 'opening' ? d.data().status === 'suggested' : similar(d.data().q, x.q) >= 0.5));
    if (prev) await prev.ref.set({ count: (Number(prev.data().count) || 1) + 1, lastAt: Date.now(), examples: [...new Set([...(prev.data().examples || []), x.q])].slice(-8) }, { merge: true });
    else await col('pageSuggestions').add({
      kind, key: x.key, slug: x.slug, pageKind: x.kind, lang: x.lang, q: cut(x.q, 200), answer: cut(x.answer, 1500),
      // The starting point: the answer, and (added elsewhere) the pages it came from.
      a: kind === 'opening' ? cut(x.answer, 1500) : cut(`${x.answer}${x.elsewhere?.length ? `\n\nMore on: ${x.elsewhere.map((r) => `${r.label} (${r.href})`).join('; ')}` : ''}`, 1500),
      sources: (x.elsewhere || []).map((r) => r.href), count: 1, examples: [cut(x.q, 200)], status: 'suggested', at: Date.now(), lastAt: Date.now(),
    });
  }
  const recent = (await col('siteQuestions').where('key', '==', x.key).where('slug', '==', x.slug).limit(400).get()).docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((d) => d.at > Date.now() - 60 * 86_400_000 && d.lang === x.lang);
  const same = recent.filter((d) => similar(d.q, x.q) >= 0.5);
  // Things a full answer names that the page doesn't have: "missing" items for it, as from the app (missingFacts.ts), within
  // the site's own daily limit; a thing already waiting for the page in the last 30 days isn't queued again.
  if (x.missing?.length && x.missingPage) {
    const dayRef = col('siteAskDays').doc(dayOf());
    let today = Number((await dayRef.get()).data()?.fixes) || 0;
    const nameOf = (s: unknown) => String(s ?? '').toLowerCase().replace(/^missing:\s*/, '').trim();
    const waiting = (await col('contributions').where('key', '==', x.key).where('slug', '==', x.missingPage).get()).docs.map((d) => d.data()).filter((d) => d.kind === 'missing' && Number(d.at) > Date.now() - 30 * 86_400_000).map((d) => nameOf(d.name || d.label));
    for (const m of x.missing) {
      if (today >= c.fixesPerDay) break;
      if (waiting.includes(nameOf(m.name))) continue;
      await col('contributions').add({
        key: x.key, slug: x.missingPage, page: 'area', anchor: '', label: `Missing: ${cut(m.name, 180)}`, name: cut(m.name, 180), kind: 'missing',
        text: cut(m.fact, 2000), lang: x.lang, credit: false, owner: false, uid: 'site', source: 'site', status: 'pending', at: Date.now(),
      });
      await dayRef.set({ fixes: FieldValue.increment(1) }, { merge: true });
      today++;
    }
    await col('siteQuestions').doc(id).set({ queued: true }, { merge: true });
  } else if (!x.covered && x.searched && x.slug) {
    // Not in the guide, and answered from a search: a "missing" item for that page, checked and decided like the rest.
    // Also with full answers when they list nothing themselves: they rarely do (1 of 14 in the Nov 3 2026 test).
    const month = same.filter((d) => d.id !== id && d.queued && d.at > Date.now() - 30 * 86_400_000);
    const day = dayOf();
    const dayRef = col('siteAskDays').doc(day);
    const queuedToday = Number((await dayRef.get()).data()?.fixes) || 0;
    if (!month.length && queuedToday < c.fixesPerDay) {
      await col('contributions').add({
        key: x.key, slug: x.slug, page: x.kind === 'entity' ? 'entity' : 'area', anchor: '', label: cut(x.q, 200), kind: 'missing',
        text: missingText(x.answer), lang: x.lang, credit: false, owner: false, uid: 'site', source: 'site', status: 'pending', at: Date.now(),
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

type SiteAccount = { uid: string; premium: boolean };
export function registerSiteAsk(app: Express, deps: { fullAnswer?: (o: SiteAnswerOpts) => Promise<SiteAnswerOut>; gemini: () => GoogleGenAI; requireAuth: any; firebaseWebConfig: Record<string, string>; siteAccount?: (req: Request) => Promise<SiteAccount | { error: 'auth' } | null> }) {
  // The box asks whether it's on (and for the App Check key) when a page opens.
  app.get('/api/site/ask/config', async (_req: Request, res: Response) => {
    void guard().catch((e) => console.warn('[site-ask] guard', e?.message));
    const c = await siteAskConfig();
    res.set('Cache-Control', 'public, max-age=30');
    res.json(c.enabled ? { on: true, perDevice: c.perDevice, home: !!c.homeApp, ...(process.env.STRIPE_PUBLISHABLE_KEY ? { stripeKey: process.env.STRIPE_PUBLISHABLE_KEY } : {}), ...(appCheckOn(c) ? { appCheck: { key: c.recaptchaKey, firebase: deps.firebaseWebConfig } } : {}) } : { on: false });
  });

  const ask = async (req: Request, res: Response, preview: boolean) => {
    const base = await siteAskConfig();
    const c: SiteAskConfig = preview ? { ...base, enabled: true, fullAnswers: true, homeApp: true, perIp: 1000 } : base;
    if (!c.enabled) return res.status(503).json({ off: true });
    if (appCheckOn(c) && !preview) {
      try { await getAppCheck().verifyToken(String(req.headers['x-firebase-appcheck'] || '')); } catch { return res.status(401).json({ error: 'check' }); }
    }
    const b = req.body || {};
    const key = String(b.key || ''), slug = String(b.slug || ''), kind = ['area', 'entity', 'front'].includes(b.kind) ? String(b.kind) : 'area';
    const lang = LANGS.includes(b.lang) ? String(b.lang) : 'en';
    const q = cut(b.q, 300), device = String(b.device || '');
    // The homepage's app (scripts/guides/homeApp.ts): a guide's game or any game by name, and a screenshot.
    const home = b.surface === 'home';
    if (home && !c.homeApp) return res.status(503).json({ off: true });
    const image = home && b.image ? validImage(b.image) : null;
    if (home && b.image && !image) return res.status(400).json({ error: 'bad image' });
    const noGuide = home && !key ? cleanGameName(b.game) : '';
    if ((noGuide ? noGuide.length < 2 : !/^[a-z0-9-]{2,120}$/.test(key)) || (slug && !/^[a-z0-9-]{1,160}$/.test(slug)) || (q.length < 3 && !image) || !/^[a-f0-9]{16,64}$/.test(device)) return res.status(400).json({ error: 'bad request' });
    void cleanOld().catch(() => {});
    // Signed in: the guide allowance for the account (free or Premium), never the app's.
    const signedIn = deps.siteAccount ? await deps.siteAccount(req) : null;
    if (signedIn && 'error' in signedIn) return res.status(401).json({ error: 'auth' });
    const acct = signedIn as SiteAccount | null;
    const t = await take(device, clientIp(req, HOPS), c, acct);
    // At the limit: how many guide questions a free account (or Premium) gets, so the next step is clear.
    if (t.ok === false) return res.json({ limit: t.why, freePerDay: c.perSignedIn, premiumPerDay: c.perPremium, ...(acct ? { premium: acct.premium, account: true } : {}) });
    const scope = { dollars: 0, searches: 0 };
    // Shown as it's written (answerStream.ts): lines of JSON, ending with the same result as without. Only full answers.
    const streaming = b.stream === true && !!c.fullAnswers && !!deps.fullAnswer;
    const t0 = Date.now();
    let firstText = 0, contextMs = 0, shown = '';
    const line = (o: object) => res.write(`${JSON.stringify(o)}\n`);
    const finish = (status: number, o: object) => {
      if (!streaming) return res.status(status).json(o);
      line({ t: 'done', status, ...o });
      return res.end();
    };
    if (streaming) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.flushHeaders();
    }
    const onStream: SiteAnswerOpts['stream'] = (e) => {
      if (e.searching) line({ t: 'searching' });
      if (e.reset) { if (shown) line({ t: 'reset' }); shown = ''; }
      if (e.raw === undefined) return;
      const now = plainAnswer(visiblePart(e.raw));
      const piece = nextPiece(shown, now);
      if (!piece) return;
      if (!firstText) firstText = Date.now() - t0;
      shown = now;
      line({ t: 'text', ...piece });
    };
    try {
      const out = await requestCost.run(scope, async () => {
        const ctx = noGuide ? { game: noGuide, pageName: noGuide, selfText: '', matchLines: '', otherText: '', outline: '', refs: {}, exists: true, place: '', placeSlug: '', otherPages: [] } : await context(key, slug, kind, lang, q);
        contextMs = Date.now() - t0;
        const full = c.fullAnswers && deps.fullAnswer;
        // The app's answers don't need a match in the guide: only a guide that doesn't exist has nothing to go on.
        if (full ? !ctx.exists : !ctx.selfText && !ctx.matchLines) return null;
        // A search only with room for it: the day's and month's searches, and enough of the site's dollars left.
        const day: any = (await col('siteAskDays').doc(dayOf()).get()).data() || {};
        const mayLookUp = (acct?.premium ? true : (Number(day.dollars) || 0) + 0.05 < c.dailyDollars) && (await playerSearchesToday()) && (await monthlyBudgetOk());
        if (full) {
          const a = await fullAnswer(full, req, ctx, key, slug, lang, q, !!acct?.premium, mayLookUp, streaming ? onStream : undefined, home ? { imageBase64: image || undefined } : undefined);
          scope.dollars = a.dollars;
          return { ctx, a };
        }
        return { ctx, a: (await answer(deps.gemini(), ctx, q, lang, mayLookUp)) as any };
      });
      if (!out) return finish(404, { error: 'no guide' });
      if (out.a.searches) recordPlayerSearches(out.a.searches);
      const dollars = Math.round(scope.dollars * 10000) / 10000;
      // The site's dollars a day count signed-out and free questions; Premium ones are counted apart.
      await col('siteAskDays').doc(dayOf()).set(acct?.premium ? { questions: FieldValue.increment(1), premium: FieldValue.increment(1), premiumDollars: FieldValue.increment(dollars) } : { dollars: FieldValue.increment(dollars), questions: FieldValue.increment(1), ...(acct ? { signedIn: FieldValue.increment(1) } : {}) }, { merge: true });
      const left = t.left;
      const doc = await col('siteQuestions').add({
        // The screenshot itself is never saved or logged: only that there was one.
        ...(home ? { surface: 'home' } : {}), ...(image ? { hadImage: true } : {}), ...(noGuide ? { noGuide: true, game: noGuide } : {}),
        key: key || `noguide:${gameKeyOf(noGuide)}`, slug, kind, lang, q, answer: out.a.text, covered: out.a.covered, signedIn: !!acct, ...(acct?.premium ? { premium: true } : {}), sources: out.a.sources.map((s) => s.href), searches: out.a.searches,
        dollars, model: MODEL(), at: Date.now(), day: dayOf(), ...(isLocalServer() ? { test: true } : {}),
      });
      // What a question teaches needs a guide page to teach, and a question about a screenshot makes no sense without it.
      if (key && !image) void learn(doc.id, { key, slug: slug || out.ctx.placeSlug, kind: slug || !out.ctx.placeSlug ? kind : 'area', lang, q, answer: out.a.text, covered: out.a.covered, searched: out.a.searches, aboutPage: out.a.aboutPage, elsewhere: out.a.elsewhere, missing: out.a.missing, missingPage: out.a.missingPage }, c).catch((e) => console.warn('[site-ask] learn', e?.message));
      console.log(`[site-time] context=${contextMs}ms first=${firstText}ms total=${Date.now() - t0}ms${preview ? ' preview' : ''}`);
      finish(200, { answer: out.a.text, sources: out.a.sources, covered: out.a.covered, searched: out.a.searches > 0, ...(noGuide ? { noGuide: true } : {}), left, ...(acct ? { account: true } : {}), ...(preview ? { timing: { context: contextMs, first: firstText, total: Date.now() - t0, dollars, searches: out.a.searches } } : {}) });
    } catch (e: any) {
      console.error('[site-ask]', e?.message);
      finish(500, { error: 'failed' });
    }
  };
  app.post('/api/site/ask', async (req: Request, res: Response) => {
    const preview = previewKeyOk(req.headers['x-qc-preview'], (await siteAskConfig()).previewKey);
    return previewScope.run(preview, () => ask(req, res, preview));
  });

  // ---- /admin/asked: the log of the guides' nightly improvements, with undo (autoChanges.ts) ----
  registerAutoChanges(app, deps);
}
