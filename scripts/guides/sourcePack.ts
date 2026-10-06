/**
 * Source packs: the facts about one guide area, taken straight from the game's community wiki (no paid searches) and
 * kept as a structured pack with its source URLs, cached in Firestore (sourcePacks/{key}__{slug}) and reused for writing
 * and fact-checking a flagship page.
 *
 *   npx tsx scripts/guides/sourcePack.ts --key baldur-s-gate-3 --page emerald-grove     build (or show) one pack
 *
 * Games without such a wiki get a searched pack instead: one call with Google Search (one research step, capped by
 * the call itself), whose facts and cited sites are cached the same way, so writing and checking need no more searches.
 *
 * Only wikis listed in WIKIS, only pages their robots.txt allows for any user agent (and none that bans AI crawlers),
 * fetched politely (one request a second, an identifying User-Agent). Pages behind a bot check (Cloudflare challenges)
 * are never worked around: such a wiki simply isn't used. Facts are extracted, never copied text; the flagship page is
 * written in our own words and credits the wiki under its licence.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, parseJson, searchesIn, sourcesIn } from './common';
import { recordMonthly } from '../../searchGuard';

/** Community wikis by guide key: where articles live, their licence, and what to call them. */
export const WIKIS: Record<string, { host: string; name: string; article: (title: string) => string; license: string; licenseUrl: string }> = {
  'baldur-s-gate-3': {
    host: 'bg3.wiki', name: 'bg3.wiki', article: (t) => `https://bg3.wiki/wiki/${encodeURIComponent(t.replace(/ /g, '_')).replace(/%2F/g, '/')}`,
    license: 'CC BY-NC-SA 4.0 or CC BY-SA 4.0', licenseUrl: 'https://bg3.wiki/wiki/bg3wiki:Copyrights',
  },
};

const UA = 'QuestCompendiumBot/1.0 (+https://questcompendium.com; guide fact-checking)';
const PAGE_CHARS = 24_000;
const MAX_PAGES = 4;

export type FactPack = {
  summary?: string; region?: string; levels?: string; directions?: string; connected?: string[]; services?: string[];
  order: { what: string; where?: string; src: number }[];
  items: { name: string; where: string; how?: string; missable?: boolean; lockout?: string; src: number }[];
  secrets: { text: string; src: number }[];
  choices: { title: string; when?: string; options: { label: string; outcome: string }[]; src: number }[];
  fights: { name: string; enemies?: string; threats?: string; weaknesses?: string; tactics?: string; rewards?: string; src: number }[];
  npcs: { name: string; role: string; src: number }[];
  quests: string[];
};
export type SourcePack = { key: string; slug: string; wiki: string; license: string; licenseUrl: string; sources: { title: string; url: string }[]; pack: FactPack; dollars: number; at: number };

// ---- robots.txt ----
const robotsCache = new Map<string, { disallow: string[]; aiBan: boolean }>();
async function robotsFor(host: string) {
  if (robotsCache.has(host)) return robotsCache.get(host)!;
  let txt = '';
  try {
    const r = await fetch(`https://${host}/robots.txt`, { headers: { 'User-Agent': UA } });
    txt = r.ok ? await r.text() : '';
  } catch { /* none */ }
  // The rules for every user agent ("*"), and whether the site bans AI crawlers by name.
  const lines = txt.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim());
  const disallow: string[] = [];
  let inStar = false, lastWasAgent = false;
  for (const l of lines) {
    const m = l.match(/^(user-agent|disallow)\s*:\s*(.*)$/i);
    if (!m) continue;
    if (/user-agent/i.test(m[1])) { inStar = lastWasAgent ? inStar || m[2] === '*' : m[2] === '*'; lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (inStar && m[2]) disallow.push(m[2]);
  }
  const aiBan = /user-agent\s*:\s*(claudebot|anthropic-ai|gptbot|google-extended|ccbot)\s*\n(\s*user-agent[^\n]*\n)*\s*disallow\s*:\s*\/\s*$/im.test(txt);
  const out = { disallow, aiBan };
  robotsCache.set(host, out);
  return out;
}
const pathAllowed = (path: string, disallow: string[]) =>
  !disallow.some((rule) => {
    const re = new RegExp('^' + rule.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (rule.endsWith('$') ? '' : ''));
    return re.test(path);
  });

// ---- fetching ----
let lastFetch = 0;
async function fetchArticle(url: string): Promise<{ title: string; url: string; text: string } | null> {
  const u = new URL(url);
  const robots = await robotsFor(u.host);
  if (robots.aiBan || !pathAllowed(u.pathname + u.search, robots.disallow)) return null;
  const wait = lastFetch + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) return null;
  const html = await r.text();
  if (/<title>Just a moment/i.test(html)) return null; // a bot check: not worked around
  const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1]?.replace(/\s*[-–|].*$/, '').trim() || u.pathname;
  const body = html.match(/id="mw-content-text"[\s\S]*?(?=<div[^>]+class="printfooter"|<div id="catlinks")/i)?.[0] || html;
  const text = body
    .replace(/<(script|style|table class="navbox|div class="navbox)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h([1-4])[^>]*>/gi, '\n## ').replace(/<\/h[1-4]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<(p|br|tr|div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\[\s*edit\s*\]/gi, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return { title, url: r.url, text: text.slice(0, PAGE_CHARS) };
}

const PACK_FORMAT = `{"summary": "one sentence", "region": "", "levels": "", "directions": "how to get there from a named place", "connected": ["area"], "services": ["trader or important NPC"],
 "order": [{"what": "what a player meets, in order", "where": "landmark", "src": 1}],
 "items": [{"name": "", "where": "from a findable anchor to the exact spot", "how": "the final step", "missable": true, "lockout": "what locks it out", "src": 1}],
 "secrets": [{"text": "", "src": 1}],
 "choices": [{"title": "", "when": "", "options": [{"label": "", "outcome": "what it leads to"}], "src": 1}],
 "fights": [{"name": "", "enemies": "", "threats": "", "weaknesses": "", "tactics": "", "rewards": "", "src": 1}],
 "npcs": [{"name": "", "role": "", "src": 1}], "quests": ["quest name"]}`;

/** The pack for one area: cached, or built from the wiki (its article, and its quests' articles). */
export async function sourcePack(key: string, slug: string, opts: { rebuild?: boolean } = {}): Promise<SourcePack | null> {
  const ref = db().collection('sourcePacks').doc(`${key}__${slug}`);
  if (!opts.rebuild) {
    const cached = (await ref.get()).data() as SourcePack | undefined;
    if (cached?.pack) return cached;
  }
  const wiki = WIKIS[key];
  const page: any = (await db().collection('guides').doc(key).collection('areas').doc(slug).get()).data();
  if (!page) return null;
  if (!wiki) return searchedPack(key, slug, page, ref);
  // The area's own article (its name, then without a bracketed note), then its quests' articles.
  const base = String(page.name).replace(/\s*\([^)]*\)\s*$/, '');
  // Wikis often drop a leading "The" ("The Mason's Guild" is "Mason's Guild").
  const titles = [...new Set([String(page.name), base, base.replace(/^the\s+/i, ''), ...((page.info?.quests || []) as string[]).slice(0, 4)])];
  const pages: { title: string; url: string; text: string }[] = [];
  for (const t of titles) {
    if (pages.length >= MAX_PAGES) break;
    const a = await fetchArticle(wiki.article(t)).catch(() => null);
    if (a && a.text.length > 400 && !pages.some((p) => p.url === a.url)) pages.push(a);
  }
  if (!pages.length) return null;
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `Extract the facts a guide needs about the area "${page.name}" of the video game "${page.game || key}" from these wiki articles. Facts only, as short notes in your own words (never copy sentences); "src" is the article's number.`,
      'Only what happens in or is found in this area. Leave a field empty rather than guess. Reply with JSON only, in this shape:',
      PACK_FORMAT,
      '',
      ...pages.map((p, i) => `[${i + 1}] ${p.title} (${p.url})\n${p.text}`),
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 12_000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const j: any = parseJson(String(res?.text || ''));
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  const pack: FactPack = {
    summary: j.summary, region: j.region, levels: j.levels, directions: j.directions, connected: arr(j.connected), services: arr(j.services),
    order: arr(j.order), items: arr(j.items), secrets: arr(j.secrets), choices: arr(j.choices), fights: arr(j.fights), npcs: arr(j.npcs), quests: arr(j.quests),
  };
  const out: SourcePack = { key, slug, wiki: wiki.name, license: wiki.license, licenseUrl: wiki.licenseUrl, sources: pages.map((p) => ({ title: p.title, url: p.url })), pack, dollars: 0, at: Date.now() };
  await ref.set(JSON.parse(JSON.stringify(out)));
  return out;
}

/**
 * A pack from Google Search, for games with no wiki we may fetch: research notes from one searched call (it decides how
 * many searches, usually 4-12; asked once more if it ran none), then turned into the pack's JSON without searching. The
 * sites the research cites are the pack's sources.
 */
async function searchedPack(key: string, slug: string, page: any, ref: FirebaseFirestore.DocumentReference): Promise<SourcePack | null> {
  const game = String((await db().collection('guides').doc(key).get()).data()?.game || key);
  let res: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: [
        ...(attempt ? ['You must run Google searches before answering. Do not answer from memory.'] : []),
        `Research one area of the video game "${game}" for a guide: "${page.name}"${page.story ? ` (${page.story})` : ''}.`,
        "Run several searches: the area's page on the game's wiki, its walkthrough, the quests that happen here, and the choices made here. Then write notes, only from what the sources say:",
        '- what a player meets here, in order, and where (landmarks, signposts)',
        '- items and secrets here, where exactly, how to get them, which are missable and why',
        '- the choices made here, each option and what it leads to',
        '- fights here: enemies, threats, weaknesses, tactics, rewards',
        '- the region, level range, how to get here, connected areas, traders and important people, quests',
        'Be concrete. Only what happens in or is found in this area.',
      ].join('\n') }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.2, maxOutputTokens: 8000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    if (searchesIn(res)) break;
  }
  const n = searchesIn(res);
  if (n) recordMonthly(n);
  const cited = sourcesIn(res);
  if (!n || !cited.length) return null; // nothing from memory
  // The notes as the pack's JSON (no searching: only what the notes say).
  const conv: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `Turn these research notes about the area "${page.name}" of "${game}" into JSON, in this shape. Only what the notes say; leave a field empty rather than guess; "src" is always 1.`,
      PACK_FORMAT, '', String(res?.text || ''),
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 10_000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const j: any = parseJson(String(conv?.text || ''));
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  const pack: FactPack = {
    summary: j.summary, region: j.region, levels: j.levels, directions: j.directions, connected: arr(j.connected), services: arr(j.services),
    order: arr(j.order), items: arr(j.items), secrets: arr(j.secrets), choices: arr(j.choices), fights: arr(j.fights), npcs: arr(j.npcs), quests: arr(j.quests),
  };
  const out: SourcePack = { key, slug, wiki: cited.slice(0, 3).join(', '), license: '', licenseUrl: '', sources: cited.slice(0, 6).map((t) => ({ title: t, url: '' })), pack, dollars: 0, at: Date.now() };
  await ref.set(JSON.parse(JSON.stringify({ ...out, searched: n })));
  console.log(`  [searched pack] ${n} searches, sources: ${cited.slice(0, 5).join(', ')}`);
  return out;
}

/** The pack as compact numbered notes for a prompt (sources listed first, facts tagged with their source number). */
export function packNotes(sp: SourcePack): string {
  const p = sp.pack;
  const s = (n: number) => ` [${n}]`;
  return [
    `Sources: ${sp.sources.map((x, i) => `[${i + 1}] ${x.title}`).join('; ')}`,
    p.summary && `Summary: ${p.summary}`, p.region && `Region: ${p.region}`, p.levels && `Levels: ${p.levels}`, p.directions && `Getting there: ${p.directions}`,
    p.connected?.length && `Connects to: ${p.connected.join(', ')}`, p.services?.length && `Services and people: ${p.services.join(', ')}`,
    p.order.length && `In order:\n${p.order.map((o, i) => `${i + 1}. ${o.what}${o.where ? ` (${o.where})` : ''}${s(o.src)}`).join('\n')}`,
    p.items.length && `Items:\n${p.items.map((x) => `- ${x.name}: ${x.where}${x.how ? `; how: ${x.how}` : ''}${x.missable ? `; missable${x.lockout ? `: ${x.lockout}` : ''}` : ''}${s(x.src)}`).join('\n')}`,
    p.secrets.length && `Secrets:\n${p.secrets.map((x) => `- ${x.text}${s(x.src)}`).join('\n')}`,
    p.choices.length && `Choices:\n${p.choices.map((c) => `- ${c.title}${c.when ? ` (${c.when})` : ''}: ${c.options.map((o) => `${o.label} => ${o.outcome}`).join(' ;; ')}${s(c.src)}`).join('\n')}`,
    p.fights.length && `Fights:\n${p.fights.map((f) => `- ${f.name}: ${[f.enemies, f.threats, f.weaknesses && `weak: ${f.weaknesses}`, f.tactics, f.rewards && `rewards: ${f.rewards}`].filter(Boolean).join('; ')}${s(f.src)}`).join('\n')}`,
    p.npcs.length && `People:\n${p.npcs.map((n) => `- ${n.name}: ${n.role}${s(n.src)}`).join('\n')}`,
    p.quests.length && `Quests: ${p.quests.join(', ')}`,
  ].filter(Boolean).join('\n');
}

async function cli() {
  const key = String(arg('key') || ''), slug = String(arg('page') || '');
  if (!key || !slug) { console.log('Usage: npx tsx scripts/guides/sourcePack.ts --key baldur-s-gate-3 --page emerald-grove [--rebuild]'); process.exit(1); }
  const sp = await sourcePack(key, slug, { rebuild: arg('rebuild') === 'true' });
  console.log(sp ? packNotes(sp) : 'No pack (no wiki for this guide, or nothing fetchable).');
  setTimeout(() => process.exit(0), 500);
}
if (/sourcePack\.ts$/.test(process.argv[1] || '')) cli().catch((e) => { console.error('source pack failed:', e?.message || e); process.exit(1); });
