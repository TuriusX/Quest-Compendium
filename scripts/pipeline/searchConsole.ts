/**
 * Google Search Console, weekly: what people search for and land on, used to improve the guides.
 *
 *   npx tsx scripts/pipeline/searchConsole.ts --weekly        pull, summarise, check pages, plan (the pipeline runs it)
 *   options: --dry   change nothing in Firestore and post nothing
 *
 * 1. Pull (last 28 days, ending 3 days ago: Search Console's data lags): queries x pages with impressions, clicks, CTR
 *    and position, from the questcompendium.com property (sc-domain:, else the https:// URL prefix). The job's own
 *    service account reads it (a Restricted user on the property); the token comes from the Cloud Run metadata server
 *    with the read-only Search Console scope, so this only runs on Cloud Run.
 * 2. Summary in Firestore (system/searchConsole): totals, top queries, top pages (with week-on-week click changes), the
 *    plan, and the wish-list games. Shown on /admin/reviews (Search tab).
 * 3. For each guide page with meaningful impressions (MIN_IMPRESSIONS), a check without searches (Flash): does the page
 *    clearly answer its top queries? Missing or vague answers become a targeted repair for that page (repair.ts
 *    --action queries): the entries are rewritten or added with the queries passed to the writer as what players look
 *    for, never keyword text.
 * 4. Pages ranking 5-20 with high impressions (HIGH_IMPRESSIONS) go first, checked the careful way, with a clearer page
 *    title and description suggested (applied through the review gate with the repair).
 * 5. Queries for games without a guide go on the wish list (system/pipeline.searchWishes) with their impressions.
 * 6. A weekly summary in Discord (DISCORD_WEBHOOK_URL): top queries, what was planned or queued, pages that gained clicks.
 * The repairs are queued only when SEARCH_CONSOLE_REPAIRS=on; otherwise the plan is saved with its estimate.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, parseJson, gameKey, guideRelease, releasedAfter, QUICK_MODEL_CUTOFF } from '../guides/common';
import { estimateCost } from '../../usage';

const SITES = ['sc-domain:questcompendium.com', 'https://questcompendium.com/', 'https://www.questcompendium.com/'];
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
/** A page needs this many impressions in 28 days before its queries are checked. */
export const MIN_IMPRESSIONS = num(process.env.SEARCH_CONSOLE_MIN_IMPRESSIONS, 30);
/** "High impressions" for a page ranking 5-20 (queued first, with a clearer title and description). */
export const HIGH_IMPRESSIONS = num(process.env.SEARCH_CONSOLE_HIGH_IMPRESSIONS, 200);
/** Pages checked a week (most impressions first). */
const MAX_PAGES = num(process.env.SEARCH_CONSOLE_MAX_PAGES, 40);
const REPAIRS_ON = process.env.SEARCH_CONSOLE_REPAIRS === 'on';
const dry = arg('dry') === 'true';

/** Estimates (per page) for the plan. */
export const QUERY_EST = { searchesPerPage: 6, carefulPageDollars: 0.016, quickPageDollars: 0.006, checkDollars: 0.003, flashGateDollars: 0.03, proGateDollars: 0.08 };

export type Row = { query: string; page: string; clicks: number; impressions: number; ctr: number; position: number };
export type PageRef = { lang: string; key: string; slug?: string };

/** A questcompendium.com URL as a guide page: /guides/{key}/{slug}/, optionally under a language (/es/guides/…). */
export function pageRefOf(url: string): PageRef | null {
  let p = '';
  try {
    p = new URL(url).pathname;
  } catch {
    return null;
  }
  const m = p.match(/^\/(?:([a-z]{2})\/)?guides\/([a-z0-9-]+)\/(?:([a-z0-9-]+)\/)?(?:index\.html)?$/);
  if (!m) return null;
  if (m[3] === 'achievements') return { lang: m[1] || 'en', key: m[2] };
  return { lang: m[1] || 'en', key: m[2], ...(m[3] ? { slug: m[3] } : {}) };
}

export type PageSummary = {
  key: string; slug: string; impressions: number; clicks: number; ctr: number; position: number;
  queries: { query: string; impressions: number; clicks: number; position: number }[];
};

/**
 * Rows summed per guide page (all languages of a page together: one page to fix), with its queries by impressions.
 * Position is the impression-weighted average.
 */
export function summarise(rows: Row[]) {
  const pages = new Map<string, PageSummary & { posSum: number }>();
  const queries = new Map<string, { query: string; impressions: number; clicks: number; posSum: number }>();
  const offGuide: Row[] = [];
  let impressions = 0, clicks = 0;
  for (const r of rows) {
    impressions += r.impressions;
    clicks += r.clicks;
    const q = queries.get(r.query) || { query: r.query, impressions: 0, clicks: 0, posSum: 0 };
    q.impressions += r.impressions; q.clicks += r.clicks; q.posSum += r.position * r.impressions;
    queries.set(r.query, q);
    const ref = pageRefOf(r.page);
    if (!ref || !ref.slug) { offGuide.push(r); continue; }
    const k = `${ref.key}/${ref.slug}`;
    const p = pages.get(k) || { key: ref.key, slug: ref.slug, impressions: 0, clicks: 0, ctr: 0, position: 0, posSum: 0, queries: [] };
    p.impressions += r.impressions; p.clicks += r.clicks; p.posSum += r.position * r.impressions;
    const pq = p.queries.find((x) => x.query === r.query);
    if (pq) { pq.position = (pq.position * pq.impressions + r.position * r.impressions) / (pq.impressions + r.impressions); pq.impressions += r.impressions; pq.clicks += r.clicks; }
    else p.queries.push({ query: r.query, impressions: r.impressions, clicks: r.clicks, position: r.position });
    pages.set(k, p);
  }
  const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
  const pageList: PageSummary[] = [...pages.values()].map(({ posSum, ...p }) => ({
    ...p, ctr: p.impressions ? round(p.clicks / p.impressions, 4) : 0, position: p.impressions ? round(posSum / p.impressions) : 0,
    queries: p.queries.sort((a, b) => b.impressions - a.impressions).slice(0, 10).map((q) => ({ ...q, position: round(q.position) })),
  })).sort((a, b) => b.impressions - a.impressions);
  const queryList = [...queries.values()].map(({ posSum, ...q }) => ({ ...q, position: q.impressions ? round(posSum / q.impressions) : 0 })).sort((a, b) => b.impressions - a.impressions);
  return { totals: { impressions, clicks, ctr: impressions ? round(clicks / impressions, 4) : 0, rows: rows.length }, pages: pageList, queries: queryList, offGuide };
}

/** Pages that rank 5-20 with high impressions: the ones a clearer answer, title and description can move most. */
export const isStriking = (p: { position: number; impressions: number }) => p.position >= 5 && p.position <= 20 && p.impressions >= HIGH_IMPRESSIONS;

// ---------------------------------------------------------------- Search Console API

async function token(): Promise<string> {
  const r = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(SCOPE)}`, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error(`no token from the metadata server (HTTP ${r.status}): this runs on Cloud Run`);
  return String((await r.json()).access_token || '');
}

async function findSite(tok: string): Promise<string> {
  const r = await fetch(`${API}/sites`, { headers: { Authorization: `Bearer ${tok}` } });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Search Console sites: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  const have = new Map((j.siteEntry || []).map((s: any) => [s.siteUrl, s.permissionLevel]));
  console.log(`Search Console properties this account can read: ${[...have.entries()].map(([u, p]) => `${u} (${p})`).join(', ') || 'none'}`);
  const site = SITES.find((s) => have.has(s));
  if (!site) throw new Error('the account has no access to questcompendium.com in Search Console');
  return site;
}

async function pullRows(tok: string, site: string, start: string, end: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let startRow = 0; startRow < 100_000; startRow += 25_000) {
    const r = await fetch(`${API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['query', 'page'], rowLimit: 25_000, startRow, dataState: 'final' }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Search Console query: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    const rows = (j.rows || []).map((x: any) => ({ query: String(x.keys[0]), page: String(x.keys[1]), clicks: x.clicks || 0, impressions: x.impressions || 0, ctr: x.ctr || 0, position: x.position || 0 }));
    out.push(...rows);
    if (rows.length < 25_000) break;
  }
  return out;
}

// ---------------------------------------------------------------- page checks

const cut = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** The page as the checker sees it: every entry with its id. */
function pageText(p: any): string {
  return [
    `Page: ${p.name}${p.overview ? `. ${cut(p.overview, 300)}` : ''}`,
    ...(p.items || []).map((e: any) => `- ${e.id} item: ${cut(e.name, 60)} | where: ${cut(e.where, 200)}${e.how ? ` | how: ${cut(e.how, 120)}` : ''}${e.missable ? ' [missable]' : ''}`),
    ...(p.secrets || []).map((e: any) => `- ${e.id} secret: ${cut(e.text, 220)}`),
    ...(p.enemies || []).map((e: any) => `- ${e.id} enemy: ${cut(e.name, 60)}${e.weakness ? ` | weak: ${cut(e.weakness, 60)}` : ''}`),
    ...(p.shops || []).map((e: any) => `- ${e.id} shop: ${cut(e.name, 60)} | ${cut(e.sells, 120)}`),
    ...(p.fights || []).map((f: any) => `- ${f.id} fight: ${cut(f.name, 80)}`),
    ...(p.tips || []).map((t: string) => `- tip: ${cut(t, 160)}`),
  ].join('\n').slice(0, 9000);
}

export type QueryFix = { query: string; impressions: number; verdict: 'vague' | 'missing'; entryId?: string; need: string };
export type PlanPage = {
  game: string; key: string; slug: string; name: string; impressions: number; clicks: number; position: number;
  striking: boolean; careful: boolean; fixes: QueryFix[]; seo?: boolean;
};

/** Does the page answer its top queries? Flash, no searches. Vague or missing answers come back with what's needed. */
async function checkPage(game: string, page: any, s: PageSummary): Promise<{ fixes: QueryFix[]; dollars: number }> {
  const qs = s.queries.slice(0, 8);
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `A page of a player's guide for "${game}". People found it on Google with these searches (impressions in 28 days):`,
      ...qs.map((q) => `- "${q.query}" (${q.impressions})`),
      '',
      pageText(page),
      '',
      'For each search, does the page clearly answer what the player wants (the exact spot, the steps, the requirement)?',
      '"answered": an entry answers it clearly. "vague": an entry is about it but too vague to follow (name its id). "missing":',
      'nothing on the page answers it, though it belongs on this page. Searches that are about another place or a different',
      'game count as answered (not this page\'s job). Reply with JSON only:',
      '{"queries": [{"query": "...", "verdict": "answered" | "vague" | "missing", "entryId": "<id if vague>", "need": "<what the answer must say, one sentence>"}]}',
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const j: any = parseJson(String(res?.text || '')) || {};
  const ids = new Set([...(page.items || []), ...(page.secrets || []), ...(page.enemies || []), ...(page.shops || []), ...(page.fights || [])].map((e: any) => String(e.id)));
  const fixes: QueryFix[] = [];
  for (const x of Array.isArray(j.queries) ? j.queries : []) {
    const q = qs.find((y) => y.query === String(x?.query || ''));
    const verdict = x?.verdict === 'vague' || x?.verdict === 'missing' ? x.verdict : null;
    if (!q || !verdict) continue;
    const entryId = verdict === 'vague' && ids.has(String(x?.entryId || '')) ? String(x.entryId) : undefined;
    fixes.push({ query: q.query, impressions: q.impressions, verdict: entryId || verdict === 'missing' ? verdict : 'missing', ...(entryId ? { entryId } : {}), need: cut(x?.need, 300) });
  }
  return { fixes, dollars: estimateCost(MODEL, res) || 0 };
}

/** Queries that aren't about one of our guides' games: the game each names (official Steam name), or nothing. */
async function gamesInQueries(queries: { query: string; impressions: number }[]): Promise<{ dollars: number; games: Map<string, number> }> {
  const games = new Map<string, number>();
  if (!queries.length) return { dollars: 0, games };
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      'For each Google search below, name the video game it is about, using the game\'s official Steam store name, or "" if',
      'it isn\'t about one specific game. Reply with JSON only: {"games": [{"query": "...", "game": "..."}]}',
      ...queries.slice(0, 150).map((q) => `- ${q.query}`),
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const j: any = parseJson(String(res?.text || '')) || {};
  for (const x of Array.isArray(j.games) ? j.games : []) {
    const q = queries.find((y) => y.query === String(x?.query || ''));
    const g = cut(x?.game, 100);
    if (q && g) games.set(g, (games.get(g) || 0) + q.impressions);
  }
  return { dollars: estimateCost(MODEL, res) || 0, games };
}

// ---------------------------------------------------------------- weekly run

async function weekly() {
  const end = new Date(Date.now() - 3 * 86_400_000);
  const start = new Date(end.getTime() - 27 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const tok = await token();
  const site = await findSite(tok);
  const rows = await pullRows(tok, site, iso(start), iso(end));
  const sum = summarise(rows);
  console.log(`Search Console (${site}, ${iso(start)} to ${iso(end)}): ${sum.totals.rows} rows, ${sum.totals.impressions} impressions, ${sum.totals.clicks} clicks; ${sum.pages.length} guide pages.`);
  let dollars = 0;

  const stateRef = db().collection('system').doc('searchConsole');
  const prev: any = (await stateRef.get()).data() || {};
  const prevClicks: Record<string, number> = prev.pageClicks || {};

  // Pages to check: meaningful impressions, the striking ones first, then by impressions.
  const guides = new Map<string, any>();
  const guideOf = async (key: string) => {
    if (!guides.has(key)) guides.set(key, (await db().collection('guides').doc(key).get()).data() || null);
    return guides.get(key);
  };
  const candidates = sum.pages.filter((p) => p.impressions >= MIN_IMPRESSIONS).sort((a, b) => Number(isStriking(b)) - Number(isStriking(a)) || b.impressions - a.impressions).slice(0, MAX_PAGES);
  const plan: PlanPage[] = [];
  // Every page checked this week, for the summary: answered, or what it's missing.
  const checked: { page: string; impressions: number; result: string }[] = [];
  for (const s of candidates) {
    const live = await guideOf(s.key);
    if (!live || live.unpublished) continue;
    const page: any = (await db().collection('guides').doc(s.key).collection('areas').doc(s.slug).get()).data();
    if (!page || page.status !== 'published') continue;
    const game = String(live.game || s.key);
    try {
      const r = await checkPage(game, page, s);
      dollars += r.dollars;
      const striking = isStriking(s);
      checked.push({ page: `${game} / ${page.name}`, impressions: s.impressions, result: r.fixes.length ? r.fixes.map((f) => `"${f.query}" ${f.verdict}`).join('; ') : 'answers its searches' });
      if (!r.fixes.length && !striking) continue;
      const newer = releasedAfter(await guideRelease(game, live), QUICK_MODEL_CUTOFF, !!live?.pipeline?.newRelease);
      plan.push({
        game, key: s.key, slug: s.slug, name: String(page.name || s.slug), impressions: s.impressions, clicks: s.clicks, position: s.position,
        striking, careful: striking || newer || page.verified !== false, fixes: r.fixes, ...(striking ? { seo: true } : {}),
      });
      console.log(`- ${game} / ${page.name}: ${s.impressions} impressions, position ${s.position}${striking ? ' (5-20, high impressions)' : ''}: ${r.fixes.length ? r.fixes.map((f) => `"${f.query}" ${f.verdict}`).join('; ') : 'answers its queries'}`);
    } catch (e: any) {
      console.log(`- ${s.key}/${s.slug}: check failed (${e?.message || e})`);
    }
  }

  // Games people search for without a guide (queries on pages that aren't guide pages, and top queries overall).
  const known = new Set((await db().collection('guides').get()).docs.filter((d) => !d.id.endsWith('--next')).map((d) => d.id));
  const offGuideQueries = new Map<string, number>();
  for (const r of sum.offGuide) offGuideQueries.set(r.query, (offGuideQueries.get(r.query) || 0) + r.impressions);
  const qList = [...offGuideQueries.entries()].map(([query, impressions]) => ({ query, impressions })).sort((a, b) => b.impressions - a.impressions);
  const g = await gamesInQueries(qList).catch(() => ({ dollars: 0, games: new Map<string, number>() }));
  dollars += g.dollars;
  const wishes = [...g.games.entries()].filter(([name]) => !known.has(gameKey(name))).map(([game, impressions]) => ({ game, impressions })).sort((a, b) => b.impressions - a.impressions).slice(0, 50);

  // The plan's estimate.
  const byGuide = new Map<string, PlanPage[]>();
  for (const p of plan) byGuide.set(p.key, [...(byGuide.get(p.key) || []), p]);
  const carefulPages = plan.filter((p) => p.careful).length;
  const estimate = {
    pages: plan.length, guides: byGuide.size, carefulPages, quickPages: plan.length - carefulPages,
    searches: carefulPages * QUERY_EST.searchesPerPage,
    dollars: Math.round((carefulPages * QUERY_EST.carefulPageDollars + (plan.length - carefulPages) * QUERY_EST.quickPageDollars +
      [...byGuide.values()].reduce((n, ps) => n + (ps.some((p) => p.careful) ? QUERY_EST.proGateDollars : QUERY_EST.flashGateDollars), 0)) * 100) / 100,
    checkDollars: Math.round(dollars * 100) / 100,
  };
  console.log(`Plan: ${plan.length} pages in ${byGuide.size} guides (${carefulPages} careful), ≈ ${estimate.searches} searches, ≈ $${estimate.dollars} for the repairs; checks this week ≈ $${estimate.checkDollars}.`);

  // Gained clicks, week on week (28-day windows).
  const pageClicks = Object.fromEntries(sum.pages.map((p) => [`${p.key}/${p.slug}`, p.clicks]));
  const gained = sum.pages.map((p) => ({ key: p.key, slug: p.slug, clicks: p.clicks, gain: p.clicks - (prevClicks[`${p.key}/${p.slug}`] || 0) })).filter((p) => p.gain > 0 && prev.pulledAt).sort((a, b) => b.gain - a.gain).slice(0, 10);

  // Queue the repairs (when switched on): striking pages first, each guide once.
  let queued: string[] = [];
  if (REPAIRS_ON && !dry && plan.length) {
    const ref = db().collection('system').doc('pipeline');
    const st: any = (await ref.get()).data() || {};
    const queue: any[] = Array.isArray(st.carefulQueue) ? st.carefulQueue : [];
    const order = [...byGuide.entries()].sort((a, b) => Number(b[1].some((p) => p.striking)) - Number(a[1].some((p) => p.striking)) || b[1].reduce((n, p) => n + p.impressions, 0) - a[1].reduce((n, p) => n + p.impressions, 0));
    const front: any[] = [], back: any[] = [];
    for (const [key, ps] of order) {
      if (queue.some((q) => q.mode === 'queries' && gameKey(q.game) === key)) continue;
      const item = { game: ps[0].game, mode: 'queries', addedAt: Date.now(), why: `search queries: ${ps.length} page(s) to answer more clearly` };
      (ps.some((p) => p.striking) ? front : back).push(item);
      queued.push(ps[0].game);
    }
    // Striking pages ahead of everything; the rest at the end of the queue.
    queue.unshift(...front);
    queue.push(...back);
    await ref.set({ carefulQueue: queue }, { merge: true });
  }

  if (!dry) {
    await stateRef.set({
      site, range: { start: iso(start), end: iso(end) }, pulledAt: Date.now(), totals: sum.totals,
      topQueries: sum.queries.slice(0, 50), topPages: sum.pages.slice(0, 50).map(({ queries, ...p }) => ({ ...p, topQuery: queries[0]?.query || '' })),
      plan, checked, estimate, repairsOn: REPAIRS_ON, queued, wishes, gained, pageClicks,
    });
    // The wish-list games, and when this ran (the daily pipeline runs it again a week later).
    await db().collection('system').doc('pipeline').set({ searchWishes: wishes, searchConsoleAt: Date.now() }, { merge: true });
  }

  // The weekly summary in Discord.
  const lines = [
    `**Search Console, last 28 days** (${iso(start)} to ${iso(end)}): ${sum.totals.impressions.toLocaleString()} impressions, ${sum.totals.clicks.toLocaleString()} clicks (CTR ${(sum.totals.ctr * 100).toFixed(1)}%)`,
    `Top queries: ${sum.queries.slice(0, 8).map((q) => `"${q.query}" ${q.impressions}`).join(', ') || 'none yet'}`,
    // What got checked (pages with at least MIN_IMPRESSIONS) and what got queued.
    checked.length
      ? `Checked ${checked.length} page(s) (${MIN_IMPRESSIONS}+ impressions): ${checked.slice(0, 10).map((c) => `${c.page} (${c.impressions}): ${c.result}`).join(' | ')}${checked.length > 10 ? ` | +${checked.length - 10} more` : ''}`
      : `Checked: no page had ${MIN_IMPRESSIONS}+ impressions yet.`,
    plan.length
      ? `${REPAIRS_ON ? 'Queued' : 'Planned (repairs off)'}: ${plan.length} page(s) in ${byGuide.size} guide(s), ≈ ${estimate.searches} searches, ≈ $${estimate.dollars}${queued.length ? ` (${queued.join(', ')})` : REPAIRS_ON ? ' (already in the queue)' : ''}`
      : checked.length ? 'Queued: nothing (every checked page answers its searches).' : '',
    gained.length ? `Gained clicks: ${gained.map((p) => `${p.key}/${p.slug} +${p.gain}`).join(', ')}` : '',
    wishes.length ? `Wish list from searches: ${wishes.slice(0, 6).map((w) => `${w.game} (${w.impressions})`).join(', ')}` : '',
  ].filter(Boolean);
  console.log(lines.join('\n'));
  if (process.env.DISCORD_WEBHOOK_URL && !dry) {
    await fetch(process.env.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: lines.join('\n').slice(0, 1900) }) }).catch(() => {});
  }
  console.log(`Done: search console: ${plan.length} page(s) planned, ${queued.length} guide(s) queued, 0 searches used, estimated AI cost ≈ $${dollars.toFixed(2)}.`);
}

if (/searchConsole\.ts$/.test(process.argv[1] || '')) {
  weekly().then(() => setTimeout(() => process.exit(0), 300)).catch((e) => {
    console.error('Search Console failed:', e?.message || e);
    process.exit(1);
  });
}
