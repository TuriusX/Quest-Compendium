/**
 * Suggested pictures (roadmap 14, owner-approved 18 Oct 2026): official and wiki pictures for the most-searched guide
 * pages, put in /admin/images as "Suggested". Nothing goes live without the owner's approval; never AI-made pictures.
 *
 *   npx tsx scripts/guides/suggestImages.ts --lookup [--games a,b]   each top game's press kit page and wiki (one
 *                                                                    searched call per game, ≈ $0.016), saved in
 *                                                                    guideImageSources/{key}
 *   npx tsx scripts/guides/suggestImages.ts --games a,b --cap 1.00   suggest for these games, stopping before the cap
 *   (nightly: suggestNightly() from scripts/pipeline/run.ts, once system/imageSuggest.nightly is on)
 *
 * Targets: the game's pages among the top 100 by impressions (system/searchConsolePages, else the list in
 * system/imageSuggest.topPages), and for official pictures also its characters (compendium pages). Sources, cheapest and
 * surest first:
 *   1. The game's wiki: the main picture of the wiki page with the page's name (labelled by its name), checked by
 *      Flash-Lite against our guide's description (maps, logos and concept art are turned down). ≈ $0.0004 a picture.
 *   2. IGDB: every screenshot and artwork of the game (the API; IGDB_CLIENT_ID / IGDB_CLIENT_SECRET, which only the job
 *      has). Flash looks at each with the target list: one target or none, a confidence, what it saw. ≈ $0.004.
 *   3. The publisher's press kit page (found by --lookup): its pictures, looked at the same way.
 * Filters: high or medium confidence only, one picture to one target, at most 2 per target, nothing for a page that
 * already has a picture waiting, suggested or approved, never a picture met before (any state, "Not this" included).
 * A page every source was checked for, with nothing found, goes on "Needs your capture" (system/imageSuggest.pages).
 */
import crypto from 'crypto';
import sharp from 'sharp';
import { ThinkingLevel } from '@google/genai';
import { getFirestore } from 'firebase-admin/firestore';
import { db, gemini, MODEL, arg, searchesIn, ledgerDollars, usageScope } from './common';
import { addImage, targetsFor, pageImpressionList, type ImageTarget } from '../../guideImages';

const LITE = process.env.GUIDE_LITE_MODEL || 'gemini-3.1-flash-lite';
const UA = 'QuestCompendium-ImageSuggester/1.0 (+https://questcompendium.com)';
// What one look costs at most (the run stops before one that would pass its cap).
const COST = { look: 0.006, check: 0.0008, lookup: 0.02 };
const STATE = () => db().collection('system').doc('imageSuggest');
const SOURCES = () => db().collection('guideImageSources');

type Target = ImageTarget & { desc: string; top: boolean };
type Run = { cap: number; maxSuggest: number; spent0: number; suggested: number; checked: number; stopped: string; log: string[] };

const spent = (r: Run) => ledgerDollars() - r.spent0;
const canSpend = (r: Run, cost: number) => {
  if (spent(r) + cost > r.cap) { r.stopped ||= `the $${r.cap.toFixed(2)} cap`; return false; }
  if (r.suggested >= r.maxSuggest) { r.stopped ||= `${r.maxSuggest} suggestions`; return false; }
  return true;
};
const firstSentence = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0].slice(0, 220);
const tidy = (s: unknown, n = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** The JSON object in a reply (common.ts parseJson prefers a list, and these replies are objects holding lists). */
const parseObj = (text: string): any => {
  const t = String(text || '').replace(/```json|```/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  try { return a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : null; } catch { return null; }
};

// ---- Targets ------------------------------------------------------------------------------------------------------

/** One line from our guide that says what a page shows (an area's region and first sentence, a compendium page's). */
async function descOf(key: string, t: ImageTarget): Promise<string> {
  if (t.kind === 'area' || t.kind === 'step' || t.kind === 'entry') {
    const a: any = (await db().collection('guides').doc(key).collection('areas').doc(t.slug).get()).data() || {};
    return tidy([a.info?.region, firstSentence(a.overview)].filter(Boolean).join('. '));
  }
  const e: any = (await db().collection('guideCompendium').doc(key).collection('entities').doc(t.slug).get()).data() || {};
  return tidy(firstSentence(typeof e.description === 'string' ? e.description : e.summary || ''));
}

/** The game's top-100 pages (in impressions order) and, for official pictures, its characters, each with a guide line. */
async function targetsOf(key: string): Promise<{ top: Target[]; all: Target[] }> {
  const pages = (await pageImpressionList()).slice(0, 100).filter((p) => p.key === key);
  const list = await targetsFor(key);
  const desc = (t: ImageTarget) => descOf(key, t);
  const top: Target[] = [];
  for (const p of pages) {
    const t = list.find((x) => (x.kind === 'area' || x.kind === 'entity') && x.slug === p.slug);
    if (t) top.push({ ...t, desc: await desc(t), top: true });
  }
  const people = list.filter((t) => t.kind === 'entity' && /character|person|npc|boss|companion/i.test(t.label) && !top.some((x) => x.slug === t.slug)).slice(0, 50);
  const all = [...top];
  for (const t of people) all.push({ ...t, desc: await desc(t), top: false });
  return { top, all };
}

// ---- What's already there ----------------------------------------------------------------------------------------

async function existing(key: string) {
  const snap = await db().collection('guideImages').where('game', '==', key).get();
  const refs = new Set<string>();
  const perTarget = new Map<string, number>();
  for (const d of snap.docs) {
    const x: any = d.data();
    if (x.sourceRef) refs.add(String(x.sourceRef));
    if (x.sourceUrl) refs.add(String(x.sourceUrl));
    if (['waiting', 'suggested', 'approved'].includes(x.status) && x.target) {
      const k = `${x.target.kind}:${x.target.slug}:${x.target.id || ''}`;
      perTarget.set(k, (perTarget.get(k) || 0) + 1);
    }
  }
  const tk = (t: ImageTarget) => `${t.kind}:${t.slug}:${t.id || ''}`;
  return { refs, room: (t: ImageTarget) => (perTarget.get(tk(t)) || 0) < 2, took: (t: ImageTarget) => perTarget.set(tk(t), (perTarget.get(tk(t)) || 0) + 1), has: (t: ImageTarget) => (perTarget.get(tk(t)) || 0) > 0 };
}

// ---- Pictures -----------------------------------------------------------------------------------------------------

async function download(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!r.ok || !/^image\//i.test(String(r.headers.get('content-type') || ''))) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 25 * 1024 * 1024 ? null : buf;
  } catch {
    return null;
  }
}
/** A picture big enough for a guide page (at least 640 wide), as a 1024-wide JPEG for the AI to look at. */
async function forLook(buf: Buffer): Promise<{ jpeg: string; w: number; h: number } | null> {
  try {
    const m = await sharp(buf).metadata();
    if (!m.width || !m.height || m.width < 640 || m.pages && m.pages > 1) return null;
    const jpeg = (await sharp(buf).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()).toString('base64');
    return { jpeg, w: m.width, h: m.height };
  } catch {
    return null;
  }
}

/** Flash looks at an official picture with the target list: one target or none, how sure, what it saw. */
async function look(game: string, jpeg: string, targets: Target[]): Promise<{ t: Target; confidence: string; seen: string; alt?: Target } | null> {
  const lines = targets.map((t, i) => `${i + 1}. ${t.name} (${t.label.toLowerCase()})${t.desc ? `: ${t.desc}` : ''}`).join('\n');
  const prompt =
    `This is an official picture from the video game "${game}". Which ONE of these guide pages does it clearly show?\n${lines}\n\n` +
    'Rules: answer null unless something visible identifies it (a landmark\'s distinctive look, a character\'s face and outfit, ' +
    'a place\'s known layout). A close-up of a person is never a place. A character only when they are alone and fill most ' +
    'of the picture (a portrait or a clear close-up), never an action or group scene. Never a screenshot with the game\'s ' +
    'interface on it (quest text, a minimap, health bars). Never guess from mood or colours alone.\n' +
    'Reply with JSON only: {"n": number or null, "confidence": "high" | "medium" | "low", "seen": "what in the picture shows it, one sentence", "alt": number or null}';
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpeg } }, { text: prompt }] }],
    config: { temperature: 0.1, maxOutputTokens: 400, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const j: any = parseObj(res.text || '');
  const n = Number(j?.n);
  if (!n || !targets[n - 1]) return null;
  const confidence = String(j.confidence || '').toLowerCase();
  if (confidence !== 'high' && confidence !== 'medium') return null;
  const alt = Number(j.alt) && targets[Number(j.alt) - 1] && Number(j.alt) !== n ? targets[Number(j.alt) - 1] : undefined;
  return { t: targets[n - 1], confidence, seen: tidy(j.seen, 220), alt };
}

/** Flash-Lite checks a wiki page's picture: an in-game view of that place or person, not a map, logo or concept art. */
async function check(game: string, jpeg: string, t: Target, wikiTitle: string): Promise<{ ok: boolean; what: string }> {
  const prompt =
    `This picture is the main image of the wiki page "${wikiTitle}" for the video game "${game}". Our guide describes ` +
    `"${t.name}" (${t.label.toLowerCase()}) as: ${t.desc || 'no description'}.\n` +
    'Is it an in-game view of that place or character (a screenshot or official render), and not a map, logo, icon, ' +
    'item card, concept sketch, collage or real-world photo? Reply with JSON only: {"ok": true | false, "what": "what it shows, one short sentence"}';
  const res: any = await gemini().models.generateContent({
    model: LITE,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpeg } }, { text: prompt }] }],
    config: { temperature: 0, maxOutputTokens: 120, responseMimeType: 'application/json' },
  });
  const j: any = parseObj(res.text || '');
  const what = tidy(j?.what, 160);
  // Its own words win over its yes: a description that says concept art, a sketch, a map or a logo is a no.
  const notInGame = /\b(concept art|concept|sketch|drawing|painting|illustration|map|logo|icon|collage|cover art|box art)\b/i.test(what);
  return { ok: j?.ok === true && !notInGame, what };
}

// ---- Sources ------------------------------------------------------------------------------------------------------

/** The main picture of a wiki page (Fandom's MediaWiki API: the page image, following redirects). */
async function wikiImage(domain: string, title: string): Promise<{ url: string; page: string; title: string } | null> {
  const api = (q: string) => fetch(`https://${domain}/api.php?format=json&formatversion=2&${q}`, { headers: { 'User-Agent': UA } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const pick = (j: any) => {
    const p = j?.query?.pages?.[0];
    return p && !p.missing && p.original?.source ? { url: String(p.original.source), page: `https://${domain}/wiki/${encodeURIComponent(String(p.title).replace(/ /g, '_'))}`, title: String(p.title) } : null;
  };
  const direct = pick(await api(`action=query&prop=pageimages&piprop=original&redirects=1&titles=${encodeURIComponent(title)}`));
  if (direct) return direct;
  // Not under that exact name: the wiki's best search hit, only if its title is the same name (case and punctuation aside).
  const s = await api(`action=query&list=search&srlimit=1&srsearch=${encodeURIComponent(title)}`);
  const hit = s?.query?.search?.[0]?.title;
  const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, '') === b.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return hit && same(hit, title) ? pick(await api(`action=query&prop=pageimages&piprop=original&titles=${encodeURIComponent(hit)}`)) : null;
}

/** Every picture on a wiki page, biggest first: the page's other pictures when its main one was turned down. */
async function wikiPageImages(domain: string, title: string): Promise<{ url: string; name: string }[]> {
  const q = `action=query&format=json&formatversion=2&redirects=1&generator=images&gimlimit=50&prop=imageinfo&iiprop=url|size|mime&titles=${encodeURIComponent(title)}`;
  const j: any = await fetch(`https://${domain}/api.php?${q}`, { headers: { 'User-Agent': UA } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const skip = /(logo|icon|map|sigil|emblem|signature|symbol|portrait_icon|button|banner|flag|\.svg)/i;
  return (j?.query?.pages || [])
    .map((p: any) => ({ name: String(p.title || ''), i: p.imageinfo?.[0] }))
    .filter((x: any) => x.i?.url && /image\/(jpeg|png|webp)/.test(String(x.i.mime)) && x.i.width >= 640 && x.i.height >= 360 && !skip.test(x.name))
    .sort((a: any, b: any) => b.i.width * b.i.height - a.i.width * a.i.height)
    .map((x: any) => ({ url: String(x.i.url), name: x.name }));
}

let igdbTok = '';
async function igdbImages(gameId: number): Promise<{ id: string; type: 'screenshot' | 'artwork' }[]> {
  const cid = process.env.IGDB_CLIENT_ID || String(((await db().collection('config').doc('igdb').get()).data() as any)?.clientId || '');
  const secret = process.env.IGDB_CLIENT_SECRET || '';
  if (!cid || !secret || !gameId) return [];
  if (!igdbTok) {
    const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cid, client_secret: secret, grant_type: 'client_credentials' }) });
    if (!r.ok) throw new Error(`Twitch token request failed (${r.status})`);
    igdbTok = String((await r.json()).access_token || '');
  }
  const q = async (endpoint: string, extra = '') => {
    const r = await fetch(`https://api.igdb.com/v4/${endpoint}`, { method: 'POST', headers: { 'Client-ID': cid, Authorization: `Bearer ${igdbTok}` }, body: `fields image_id,width,height${extra}; where game = ${gameId}; limit 100;` });
    return r.ok ? ((await r.json()) as any[]) : [];
  };
  const shots = (await q('screenshots')).map((x) => ({ id: String(x.image_id), type: 'screenshot' as const }));
  // Logos and badges (transparent or animated artworks) aren't pictures of the game.
  const arts = (await q('artworks', ',alpha_channel,animated')).filter((x) => !x.alpha_channel && !x.animated).map((x) => ({ id: String(x.image_id), type: 'artwork' as const }));
  return [...shots, ...arts].filter((x) => /^[a-z0-9]+$/i.test(x.id));
}

/** Picture links on a press page (img src, links to image files), largest-looking first, at most 60. */
async function pressImages(url: string): Promise<string[]> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!r.ok) return [];
    const html = await r.text();
    const out = new Set<string>();
    for (const m of html.matchAll(/(?:src|href|data-src|data-original|content)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)) {
      try { out.add(new URL(m[1].replace(/&amp;/g, '&'), r.url).toString()); } catch { /* not a link */ }
    }
    const bad = /(logo|icon|favicon|sprite|avatar|badge|button|thumb(?:nail)?s?\/|rating|esrb|pegi|flag)/i;
    return [...out].filter((u) => !bad.test(u)).slice(0, 60);
  } catch {
    return [];
  }
}

// ---- One game -----------------------------------------------------------------------------------------------------

async function suggestFor(key: string, r: Run): Promise<void> {
  const info: any = (await db().collection('guides').doc(key).get()).data() || {};
  const game = String(info.game || key);
  const src: any = (await SOURCES().doc(key).get()).data() || {};
  const { top, all } = await targetsOf(key);
  if (!top.length) { r.log.push(`${game}: no top-100 pages`); return; }
  const have = await existing(key);
  const results: Record<string, { wiki?: string; igdb?: string; press?: string }> = {};
  const mark = (t: Target, source: 'wiki' | 'igdb' | 'press', v: string) => {
    if (!t.top) return;
    const k = `${key}/${t.slug}`;
    results[k] = { ...(results[k] || {}), [source]: results[k]?.[source] === 'found' ? 'found' : v };
  };
  const suggest = async (t: Target, buf: Buffer, ext: string, fields: Record<string, any>) => {
    const target: ImageTarget = { kind: t.kind, slug: t.slug, name: t.name, label: t.label, ...(t.id ? { id: t.id } : {}), ...(t.area ? { area: t.area } : {}) };
    await addImage({ game: key, target, buf, ext, by: 'suggester', status: 'suggested', ...fields } as any);
    have.took(t);
    r.suggested++;
  };
  let finished = true;

  // 1. The wiki: labelled by name, checked cheaply.
  const wiki = src.wiki?.domain ? String(src.wiki.domain) : '';
  for (const t of top) {
    if (!wiki) { mark(t, 'wiki', 'no wiki'); continue; }
    if (have.has(t)) { mark(t, 'wiki', 'has a picture'); continue; }
    const w = await wikiImage(wiki, t.name);
    if (!w || have.refs.has(w.url)) { mark(t, 'wiki', w ? 'seen before' : 'none'); continue; }
    const buf = await download(w.url);
    const img = buf && (await forLook(buf));
    if (!buf || !img) { mark(t, 'wiki', 'too small'); continue; }
    if (!canSpend(r, COST.check)) { finished = false; break; }
    r.checked++;
    have.refs.add(w.url);
    const c = await check(game, img.jpeg, t, w.title);
    if (!c.ok) { mark(t, 'wiki', 'turned down'); r.log.push(`wiki ✗ ${t.name}: ${c.what}`); continue; }
    await suggest(t, buf, (w.url.match(/\.(png|jpe?g|webp)/i)?.[1] || 'jpg').replace('jpeg', 'jpg'), {
      source: 'wiki', sourceUrl: w.url, sourceRef: w.url, sourceName: `Wiki (${wiki})`, confidence: 'high',
      why: `The wiki page "${w.title}" uses this as its main picture. ${c.what.replace(/^(?:this|it) is /i, 'It is ').replace(/^(?:an?|the) /, (m) => m[0].toUpperCase() + m.slice(1))}`,
      credit: `Image: ${src.wiki?.name || wiki}, CC BY-SA`, terms: 'Fandom wikis: CC BY-SA, credit the wiki',
    });
    mark(t, 'wiki', 'found');
    r.log.push(`wiki ✓ ${t.name}`);
  }

  // 2. IGDB and 3. the press kit: unlabelled, so Flash looks at each against the whole target list.
  const official = async (source: 'igdb' | 'press', pics: { url: string; ref: string; name: string }[], credit: string | null, terms: string) => {
    // Official pictures only for targets with no picture yet (any state): one good one is enough to review.
    const open = () => all.filter((t) => !have.has(t));
    for (const p of pics) {
      if (have.refs.has(p.ref)) continue;
      const targets = open();
      if (!targets.length) break;
      if (!canSpend(r, COST.look)) return false;
      const buf = await download(p.url);
      const img = buf && (await forLook(buf));
      have.refs.add(p.ref);
      if (!buf || !img) continue;
      r.checked++;
      const m = await look(game, img.jpeg, targets);
      if (!m) continue;
      await suggest(m.t, buf, 'jpg', {
        source, sourceUrl: p.url, sourceRef: p.ref, sourceName: p.name, confidence: m.confidence, why: m.seen,
        altGuess: m.alt ? `${m.alt.name} (${m.alt.label.toLowerCase()})` : undefined, credit, terms,
      });
      mark(m.t, source, 'found');
      r.log.push(`${source} ✓ ${m.t.name} (${m.confidence})`);
    }
    return true;
  };
  if (finished) {
    const ig = await igdbImages(Number(info.igdb?.id) || 0).catch((e) => { r.log.push(`IGDB: ${e?.message}`); return null; });
    if (ig === null || (!ig.length && !process.env.IGDB_CLIENT_SECRET)) { r.log.push(`${game}: IGDB not reachable here`); finished = false; }
    else {
      const ok = await official('igdb', ig.map((x) => ({ url: `https://images.igdb.com/igdb/image/upload/t_1080p/${x.id}.jpg`, ref: x.id, name: `IGDB ${x.type}` })), null, 'IGDB: credit IGDB.com on the site');
      if (!ok) finished = false;
      for (const t of top) mark(t, 'igdb', 'none');
    }
  }
  if (finished) {
    const kits: any[] = Array.isArray(src.press) ? src.press : [];
    for (const k of kits) {
      const pics = (await pressImages(String(k.url))).map((u) => ({ url: u, ref: u, name: `Press kit (${new URL(String(k.url)).hostname})` }));
      if (!(await official('press', pics, tidy(k.credit, 160) || null, tidy(k.terms, 600) || 'Press kit: editorial use'))) { finished = false; break; }
    }
    for (const t of top) mark(t, 'press', kits.length ? 'none' : 'no press kit');
  }

  // What was checked for each top page; a page done in every source with nothing found goes on "Needs your capture".
  const state: any = (await STATE().get()).data() || {};
  const pages = { ...(state.pages || {}) };
  for (const [k, v] of Object.entries(results)) pages[k] = { ...v, at: Date.now(), all: finished };
  await STATE().set({ pages }, { merge: true });
  const filled = top.filter((t) => results[`${key}/${t.slug}`] && Object.values(results[`${key}/${t.slug}`]).includes('found')).length;
  r.log.push(`${game}: ${filled} of ${top.length} top pages got a suggestion${finished ? '' : ' (stopped early)'}`);
}

// ---- Press kit and wiki lookup ------------------------------------------------------------------------------------

async function lookup(keys: string[], cap: number): Promise<void> {
  const r: Run = { cap, maxSuggest: 1e9, spent0: ledgerDollars(), suggested: 0, checked: 0, stopped: '', log: [] };
  for (const key of keys) {
    if (!canSpend(r, COST.lookup)) break;
    const game = String((await db().collection('guides').doc(key).get()).get('game') || key);
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text:
        `For the video game "${game}", find: (1) the publisher's or developer's official press kit or media page for this game with downloadable screenshots ` +
        '(an official site of the publisher or developer, reachable without signing in; not a fan site or a store), and (2) the main fan wiki for this game on fandom.com. ' +
        'Reply with JSON only: {"press": [{"url": "", "publisher": "", "credit": "the credit line the page asks for, else © publisher", "terms": "what the page says about using its images, if anything"}], ' +
        '"wiki": {"domain": "e.g. witcher.fandom.com", "name": "e.g. The Witcher Wiki"}}. Use empty lists or nulls for what you can\'t find. Run at most three searches.' }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 1500, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    searchesIn(res);
    const j: any = parseObj(res.text || '') || {};
    if (process.env.SUGGEST_DEBUG) console.log('raw:', String(res.text || '').slice(0, 1500));
    // Only what answers: a press page that loads and has pictures, a wiki whose API answers.
    const press = [];
    for (const p of (Array.isArray(j.press) ? j.press : []).slice(0, 3)) {
      const url = String(p?.url || '');
      if (!/^https:\/\//.test(url) || /fandom|fextralife|wiki|steampowered|reddit/i.test(url)) continue;
      const pics = await pressImages(url);
      if (pics.length >= 3) press.push({ url, publisher: tidy(p.publisher, 80), credit: tidy(p.credit, 160), terms: tidy(p.terms, 600), pictures: pics.length });
    }
    const domain = String(j.wiki?.domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
    const wikiOk = /^[a-z0-9-]+\.fandom\.com$/.test(domain) && !!(await fetch(`https://${domain}/api.php?action=query&meta=siteinfo&format=json`, { headers: { 'User-Agent': UA } }).then((x) => x.ok).catch(() => false));
    await SOURCES().doc(key).set({ press, wiki: wikiOk ? { domain, name: tidy(j.wiki?.name, 80) || domain } : null, lookedUpAt: Date.now() }, { merge: true });
    console.log(`${game}: press ${press.map((p) => `${p.url} (${p.pictures} pictures)`).join(', ') || 'none'} · wiki ${wikiOk ? domain : 'none'}`);
  }
  console.log(`Lookup: $${spent(r).toFixed(3)}${r.stopped ? `, stopped at ${r.stopped}` : ''}`);
}

// ---- Runs ---------------------------------------------------------------------------------------------------------

export async function suggestGames(keys: string[], cap: number, maxSuggest = 1e9): Promise<Run> {
  const r: Run = { cap, maxSuggest, spent0: ledgerDollars(), suggested: 0, checked: 0, stopped: '', log: [] };
  for (const key of keys) {
    if (r.stopped) break;
    await suggestFor(key, r);
  }
  return r;
}

// ---- The picture budget (owner-approved): $0.50 a night and $5 a month, shared by the nightly run and Find another ----

const money = (d: number) => (d < 0.01 ? 'under $0.01' : `$${d.toFixed(2)}`);
const nightId = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
async function budget(): Promise<{ nightLeft: number; monthLeft: number; add: (d: number) => Promise<void> }> {
  const st: any = (await STATE().get()).data() || {};
  const month = new Date().toISOString().slice(0, 7), night = nightId();
  const monthUsed = st.month?.id === month ? Number(st.month.dollars) || 0 : 0;
  const nightUsed = st.night?.id === night ? Number(st.night.dollars) || 0 : 0;
  return {
    nightLeft: Math.max(0, 0.5 - nightUsed),
    monthLeft: Math.max(0, 5 - monthUsed),
    add: async (d: number) => { await STATE().set({ month: { id: month, dollars: monthUsed + d }, night: { id: night, dollars: nightUsed + d } }, { merge: true }); },
  };
}

/**
 * Find another (/admin/images): the next best picture for one page after the owner turned one down. Its wiki page's
 * other pictures (Flash-Lite checks each against the guide), then the press kit's (Flash looks at each for this page
 * only). At most $0.10 a click, counted in the night's $0.50 and the month's $5. Nothing found: the page goes on
 * "Needs your capture". IGDB isn't looked at again: every IGDB picture of the game was already looked at for every page.
 */
export async function findAnother(key: string, target: ImageTarget): Promise<{ id: string | null; tried: number; spent: number; message: string }> {
  const b = await budget();
  const cap = Math.min(0.1, b.nightLeft, b.monthLeft);
  if (cap < 0.005) return { id: null, tried: 0, spent: 0, message: b.monthLeft < 0.005 ? "This month's $5 for pictures is used up." : "Tonight's $0.50 for pictures is used up. Try again tomorrow." };
  const scope = { dollars: 0, searches: 0 };
  let tried = 0;
  const id = await usageScope.run(scope, async () => {
    const info: any = (await db().collection('guides').doc(key).get()).data() || {};
    const game = String(info.game || key);
    const src: any = (await SOURCES().doc(key).get()).data() || {};
    const have = await existing(key);
    const t: Target = { ...target, desc: await descOf(key, target), top: true };
    const stored: ImageTarget = { kind: target.kind, slug: target.slug, name: target.name, label: target.label, ...(target.id ? { id: target.id } : {}), ...(target.area ? { area: target.area } : {}) };
    const fits = (cost: number) => scope.dollars + cost <= cap;
    // The wiki page's other pictures, checked like its main one.
    const wiki = src.wiki?.domain ? String(src.wiki.domain) : '';
    if (wiki) {
      for (const w of (await wikiPageImages(wiki, target.name)).filter((x) => !have.refs.has(x.url)).slice(0, 8)) {
        if (!fits(COST.check)) return null;
        const buf = await download(w.url);
        const img = buf && (await forLook(buf));
        have.refs.add(w.url);
        if (!buf || !img) continue;
        tried++;
        const c = await check(game, img.jpeg, t, target.name);
        if (!c.ok) continue;
        return addImage({
          game: key, target: stored, buf, ext: (w.url.match(/\.(png|jpe?g|webp)/i)?.[1] || 'jpg').replace('jpeg', 'jpg'), by: 'suggester', status: 'suggested',
          source: 'wiki', sourceUrl: w.url, sourceRef: w.url, sourceName: `Wiki (${wiki})`, confidence: 'high',
          why: `Another picture from the wiki page "${target.name}". ${c.what}`,
          credit: `Image: ${src.wiki?.name || wiki}, CC BY-SA`, terms: 'Fandom wikis: CC BY-SA, credit the wiki',
        } as any);
      }
    }
    // The press kit's pictures, looked at for this page alone.
    for (const k of Array.isArray(src.press) ? src.press : []) {
      for (const u of (await pressImages(String(k.url))).filter((x) => !have.refs.has(x)).slice(0, 12)) {
        if (!fits(COST.look)) return null;
        const buf = await download(u);
        const img = buf && (await forLook(buf));
        have.refs.add(u);
        if (!buf || !img) continue;
        tried++;
        const m = await look(game, img.jpeg, [t]);
        if (!m) continue;
        return addImage({
          game: key, target: stored, buf, ext: 'jpg', by: 'suggester', status: 'suggested', source: 'press', sourceUrl: u, sourceRef: u,
          sourceName: `Press kit (${new URL(String(k.url)).hostname})`, confidence: m.confidence, why: m.seen, credit: tidy(k.credit, 160) || null, terms: tidy(k.terms, 600) || 'Press kit: editorial use',
        } as any);
      }
    }
    return null;
  });
  await b.add(scope.dollars);
  if (id) return { id, tried, spent: scope.dollars, message: `Found another picture (${tried} looked at, ${money(scope.dollars)}).` };
  const ranOut = !(scope.dollars + COST.check <= cap) && tried > 0;
  if (!ranOut && (target.kind === 'area' || target.kind === 'entity')) {
    const st: any = (await STATE().get()).data() || {};
    const k = `${key}/${target.slug}`;
    await STATE().set({ pages: { ...(st.pages || {}), [k]: { ...(st.pages?.[k] || {}), at: Date.now(), all: true, findAnother: 'none' } } }, { merge: true });
  }
  return {
    id: null, tried, spent: scope.dollars,
    message: ranOut ? `Nothing yet after ${tried} pictures (${money(scope.dollars)}, this click's limit). Try Find another again.` : 'No other picture found — needs your capture.',
  };
}

/**
 * The nightly run (owner-approved limits): at most 15 suggestions or $0.50 a night, $5 a month, and none while 30 or
 * more suggestions wait. Games in the order of their top-100 impressions; a game is done once every source was checked.
 */
export async function suggestNightly(): Promise<string | null> {
  const st: any = (await STATE().get()).data() || {};
  if (!st.nightly) return null;
  const b = await budget();
  const waiting = (await db().collection('guideImages').where('status', '==', 'suggested').count().get()).data().count;
  if (waiting >= 30) return `🖼️ Suggested pictures: paused, ${waiting} wait for review.`;
  const cap = Math.min(b.nightLeft, b.monthLeft);
  if (cap <= 0.01) return `🖼️ Suggested pictures: ${b.monthLeft <= 0.01 ? "this month's $5 is used" : "tonight's $0.50 is used (Find another)"}.`;
  const pages = (await pageImpressionList()).slice(0, 100);
  const done = st.pages || {};
  const order: string[] = [];
  for (const p of pages) if (!done[`${p.key}/${p.slug}`]?.all && !order.includes(p.key)) order.push(p.key);
  if (!order.length) return null;
  const r = await suggestGames(order, cap, Math.min(15, 30 - waiting));
  await b.add(spent(r));
  await STATE().set({ last: { at: Date.now(), suggested: r.suggested, checked: r.checked, dollars: spent(r) } }, { merge: true });
  return `🖼️ Suggested pictures: ${r.suggested} from ${r.checked} checked ($${spent(r).toFixed(2)}${r.stopped ? `, stopped at ${r.stopped}` : ''}).`;
}

async function main() {
  const games = String(arg('games') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const cap = Number(arg('cap') || 0);
  if (!cap) throw new Error('Give a spending cap: --cap 1.00');
  if (process.argv.includes('--lookup')) {
    const keys = games.length ? games : [...new Set((await pageImpressionList()).slice(0, 100).map((p) => p.key))];
    await lookup(keys, cap);
    return;
  }
  if (!games.length) throw new Error('Give the games: --games key1,key2');
  const r = await suggestGames(games, cap);
  for (const l of r.log) console.log(l);
  console.log(`Suggested ${r.suggested} picture(s) from ${r.checked} checked; $${spent(r).toFixed(3)} of $${cap.toFixed(2)}${r.stopped ? `; stopped at ${r.stopped}` : ''}.`);
  await STATE().set({ last: { at: Date.now(), suggested: r.suggested, checked: r.checked, dollars: spent(r), games } }, { merge: true });
}
if (/suggestImages\.ts$/.test(process.argv[1] || '')) main().then(() => setTimeout(() => process.exit(0), 300), (e) => { console.error('suggestImages failed:', String(e?.message || e).replace(/client_secret=[^&\s]+/g, 'client_secret=…')); process.exit(1); });
