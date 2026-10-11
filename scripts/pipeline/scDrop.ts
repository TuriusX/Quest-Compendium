/**
 * Search Console drop analysis (read-only): the last 7 and 28 days against the periods before, by page and by query
 * (impressions, clicks, position), the daily trend, which kinds of pages lost the most (redirected, quick-built,
 * checked, flagship, entity, other), and URL Inspection of the losers and a sample of each kind (indexed or not, and
 * why: "Crawled – currently not indexed", "Discovered – currently not indexed", redirects). Prints a report; changes
 * nothing. The token comes from the Cloud Run metadata server, so it runs as a job:
 *
 *   gcloud run jobs execute guide-pipeline --args=tsx,scripts/pipeline/scDrop.ts
 */
import { db } from '../guides/common';
import { pageRefOf } from './searchConsole';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const SITES = ['sc-domain:questcompendium.com', 'https://questcompendium.com/', 'https://www.questcompendium.com/'];
const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const INSPECT_MAX = Number(process.env.SC_DROP_INSPECT || 400);

async function token(): Promise<string> {
  const r = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(SCOPE)}`, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error(`no token from the metadata server (HTTP ${r.status}): this runs on Cloud Run`);
  return String((await r.json()).access_token || '');
}
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

type Agg = { impressions: number; clicks: number; posSum: number };
async function pull(tok: string, site: string, dims: string[], start: string, end: string): Promise<{ keys: string[]; clicks: number; impressions: number; position: number }[]> {
  const out: any[] = [];
  for (let startRow = 0; startRow < 100_000; startRow += 25_000) {
    const r = await fetch(`${API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: start, endDate: end, dimensions: dims, rowLimit: 25_000, startRow, dataState: 'final' }),
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error(`searchAnalytics ${dims.join(',')} ${start}..${end}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    out.push(...(j.rows || []));
    if ((j.rows || []).length < 25_000) break;
  }
  return out;
}
const agg = (rows: { keys: string[]; clicks: number; impressions: number; position: number }[]) => {
  const m = new Map<string, Agg>();
  for (const r of rows) {
    const k = r.keys[0];
    const a = m.get(k) || { impressions: 0, clicks: 0, posSum: 0 };
    a.impressions += r.impressions; a.clicks += r.clicks; a.posSum += r.position * r.impressions;
    m.set(k, a);
  }
  return m;
};
const pos = (a?: Agg) => (a && a.impressions ? a.posSum / a.impressions : null);
const f1 = (n: number | null) => (n == null ? '-' : n.toFixed(1));

/** What kind of page a URL is (from Firestore): guide page by its build, guide front, entity page, other. */
async function kindOf(url: string, cache: Map<string, any>): Promise<string> {
  let path = '';
  try { path = new URL(url).pathname; } catch { return 'other'; }
  if (/^\/(?:[a-z]{2}\/)?guides\/[^/]+\/[^/]+\/?$/.test(path) && !pageRefOf(url)?.slug) return 'other';
  const ref = pageRefOf(url);
  if (!ref) return /^\/(?:[a-z]{2}\/)?$/.test(path) ? 'homepage' : path.startsWith('/guides') || /^\/[a-z]{2}\/guides/.test(path) ? 'guide list' : 'other';
  if (!ref.slug) return 'guide front page';
  const gk = `g:${ref.key}`;
  if (!cache.has(gk)) cache.set(gk, (await db().collection('guides').doc(ref.key).get()).data() || null);
  const g = cache.get(gk);
  if (!g) return 'removed guide';
  const pk = `p:${ref.key}/${ref.slug}`;
  if (!cache.has(pk)) cache.set(pk, (await db().collection('guides').doc(ref.key).collection('areas').doc(ref.slug).get()).data() || null);
  const p = cache.get(pk);
  if (!p) {
    const ek = `e:${ref.key}/${ref.slug}`;
    if (!cache.has(ek)) cache.set(ek, (await db().collection('guideCompendium').doc(ref.key).collection('entities').doc(ref.slug).get()).data() || null);
    return cache.get(ek) ? 'entity page' : 'removed page';
  }
  if (p.status !== 'published') return 'unpublished page';
  if (p.flagship && p.verified === true) return 'flagship (checked)';
  if (p.flagship) return 'flagship (not checked)';
  if (p.verified === true) return 'checked page';
  return 'quick-built page';
}

/** Where a URL goes now: 'live', 'redirect -> x', or the HTTP status. */
async function liveState(url: string): Promise<string> {
  try {
    const r = await fetch(url, { redirect: 'manual' });
    if (r.status >= 300 && r.status < 400) return `redirect ${r.status}`;
    return r.status === 200 ? 'live' : `HTTP ${r.status}`;
  } catch {
    return 'unreachable';
  }
}

async function main() {
  const tok = await token();
  const auth = { Authorization: `Bearer ${tok}` };
  const sites: any = await (await fetch(`${API}/sites`, { headers: auth })).json();
  const have = new Set<string>((sites.siteEntry || []).map((s: any) => s.siteUrl));
  const site = SITES.find((s) => have.has(s));
  if (!site) throw new Error('no access to questcompendium.com in Search Console');
  const END = 3; // Search Console's data lags about 3 days
  const P = {
    last7: [day(END + 6), day(END)], prev7: [day(END + 13), day(END + 7)],
    last28: [day(END + 27), day(END)], prev28: [day(END + 55), day(END + 28)],
  } as const;
  console.log(`Property ${site}. Periods: last 7 ${P.last7.join('..')}, previous 7 ${P.prev7.join('..')}, last 28 ${P.last28.join('..')}, previous 28 ${P.prev28.join('..')}`);

  // Daily trend (90 days): impressions, clicks, position.
  const daily = await pull(tok, site, ['date'], day(END + 89), day(END));
  console.log('\n== Daily (date, impressions, clicks, position) ==');
  for (const r of daily) console.log(`${r.keys[0]}\t${r.impressions}\t${r.clicks}\t${r.position.toFixed(1)}`);

  const totals = async (dims: string[]) => {
    const res: Record<string, Map<string, Agg>> = {};
    for (const [k, [s, e]] of Object.entries(P)) res[k] = agg(await pull(tok, site, dims, s, e));
    return res;
  };
  const sum = (m: Map<string, Agg>) => { let i = 0, c = 0, p = 0; for (const a of m.values()) { i += a.impressions; c += a.clicks; p += a.posSum; } return { i, c, pos: i ? p / i : 0 }; };
  const byPage = await totals(['page']);
  const byQuery = await totals(['query']);
  console.log('\n== Totals (impressions, clicks, average position) ==');
  for (const k of Object.keys(P)) { const t = sum(byPage[k]); console.log(`${k}\t${t.i}\t${t.c}\t${t.pos.toFixed(1)}\tpages ${byPage[k].size}`); }

  // Pages: change in impressions (28 vs previous 28), most lost first; each with its kind and where it goes now.
  const cache = new Map<string, any>();
  const pages = [...new Set([...byPage.last28.keys(), ...byPage.prev28.keys()])];
  const rows: { url: string; kind: string; now: number; before: number; d: number; posNow: number | null; posBefore: number | null; clicksNow: number; clicksBefore: number; i7: number; i7p: number }[] = [];
  for (const url of pages) {
    const a = byPage.last28.get(url), b = byPage.prev28.get(url);
    rows.push({
      url, kind: await kindOf(url, cache), now: a?.impressions || 0, before: b?.impressions || 0, d: (a?.impressions || 0) - (b?.impressions || 0),
      posNow: pos(a), posBefore: pos(b), clicksNow: a?.clicks || 0, clicksBefore: b?.clicks || 0,
      i7: byPage.last7.get(url)?.impressions || 0, i7p: byPage.prev7.get(url)?.impressions || 0,
    });
  }
  rows.sort((x, y) => x.d - y.d);
  const losers = rows.filter((r) => r.d < 0).slice(0, 60);
  const states = new Map<string, string>();
  for (const r of losers) states.set(r.url, await liveState(r.url));
  console.log('\n== Pages that lost the most (28 days vs previous 28): impressions now/before, position now/before, clicks now/before, 7-day now/before, kind, now ==');
  for (const r of losers) console.log(`${r.url}\t${r.now}/${r.before}\t${f1(r.posNow)}/${f1(r.posBefore)}\t${r.clicksNow}/${r.clicksBefore}\t${r.i7}/${r.i7p}\t${r.kind}\t${states.get(r.url)}`);
  console.log('\n== Pages that gained the most ==');
  for (const r of rows.filter((r) => r.d > 0).slice(-25).reverse()) console.log(`${r.url}\t${r.now}/${r.before}\t${f1(r.posNow)}/${f1(r.posBefore)}\t${r.kind}`);

  // By kind: impressions and weighted position, now vs before.
  console.log('\n== By kind of page (28 days): pages, impressions now/before, change, position now/before ==');
  const kinds = new Map<string, { n: number; now: number; before: number; pn: number; pb: number }>();
  for (const r of rows) {
    const k = kinds.get(r.kind) || { n: 0, now: 0, before: 0, pn: 0, pb: 0 };
    k.n++; k.now += r.now; k.before += r.before; k.pn += (r.posNow || 0) * r.now; k.pb += (r.posBefore || 0) * r.before;
    kinds.set(r.kind, k);
  }
  for (const [k, v] of [...kinds].sort((a, b) => (a[1].now - a[1].before) - (b[1].now - b[1].before))) console.log(`${k}\t${v.n}\t${v.now}/${v.before}\t${v.now - v.before}\t${v.now ? (v.pn / v.now).toFixed(1) : '-'}/${v.before ? (v.pb / v.before).toFixed(1) : '-'}`);

  // Queries.
  const qs = [...new Set([...byQuery.last28.keys(), ...byQuery.prev28.keys()])].map((q) => {
    const a = byQuery.last28.get(q), b = byQuery.prev28.get(q);
    return { q, now: a?.impressions || 0, before: b?.impressions || 0, pn: pos(a), pb: pos(b), cn: a?.clicks || 0, cb: b?.clicks || 0 };
  }).sort((x, y) => (x.now - x.before) - (y.now - y.before));
  console.log('\n== Queries that lost the most (28 days): impressions now/before, position now/before, clicks now/before ==');
  for (const r of qs.slice(0, 40)) console.log(`${r.q}\t${r.now}/${r.before}\t${f1(r.pn)}/${f1(r.pb)}\t${r.cn}/${r.cb}`);
  console.log('\n== New queries (none before) with the most impressions ==');
  for (const r of qs.filter((x) => !x.before).sort((a, b) => b.now - a.now).slice(0, 20)) console.log(`${r.q}\t${r.now}\t${f1(r.pn)}`);

  // URL Inspection: every loser, then a sample of each kind from the sitemap.
  const sm = (await (await fetch('https://questcompendium.com/sitemap.xml')).text()).match(/<loc>[^<]+/g)?.map((x) => x.slice(5)) || [];
  const smEn = sm.filter((u) => !/questcompendium\.com\/[a-z]{2}\//.test(u));
  const sample: { url: string; group: string }[] = losers.map((r) => ({ url: r.url, group: `loser: ${r.kind}` }));
  const perKind = new Map<string, number>();
  for (let i = 0; i < smEn.length && sample.length < INSPECT_MAX; i += Math.max(1, Math.floor(smEn.length / (INSPECT_MAX - losers.length)))) {
    const u = smEn[i];
    if (sample.some((s) => s.url === u)) continue;
    const k = await kindOf(u, cache);
    if ((perKind.get(k) || 0) >= 80) continue;
    perKind.set(k, (perKind.get(k) || 0) + 1);
    sample.push({ url: u, group: `sitemap: ${k}` });
  }
  const tally = new Map<string, Map<string, number>>();
  console.log(`\n== URL Inspection (${sample.length} URLs) ==`);
  for (const s of sample) {
    const r = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionUrl: s.url, siteUrl: site }),
    });
    const j: any = await r.json().catch(() => ({}));
    const x = j.inspectionResult?.indexStatusResult || {};
    const state = r.ok ? String(x.coverageState || '-') : `HTTP ${r.status}`;
    const t = tally.get(s.group) || new Map<string, number>();
    t.set(state, (t.get(state) || 0) + 1);
    tally.set(s.group, t);
    if (s.group.startsWith('loser')) console.log(`[inspect] ${s.url} | ${state} | crawled ${x.lastCrawlTime || 'never'} | google canonical ${x.googleCanonical || '-'}`);
  }
  console.log('\n== Index coverage by group ==');
  for (const [g, t] of [...tally].sort()) console.log(`${g}: ${[...t].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('; ')}`);
  console.log(`\nSitemap: ${sm.length} URLs (${smEn.length} English).`);
}
main().then(() => process.exit(0), (e) => { console.error(e?.message || e); process.exit(1); });
