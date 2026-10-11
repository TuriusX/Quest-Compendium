/**
 * Search Console, the newest days (read-only): daily impressions, clicks and position including the "fresh" data the
 * weekly pull leaves out, and by page and kind the last 3 days against the 3 before. Runs as a job like scDrop.ts:
 *
 *   gcloud run jobs execute guide-pipeline --args=tsx,scripts/pipeline/scFresh.ts
 */
import { db } from '../guides/common';
import { pageRefOf } from './searchConsole';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const SITE = 'sc-domain:questcompendium.com';
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

async function token(): Promise<string> {
  const r = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(SCOPE)}`, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error(`no token (HTTP ${r.status}): this runs on Cloud Run`);
  return String((await r.json()).access_token || '');
}
async function pull(tok: string, dims: string[], start: string, end: string) {
  const r = await fetch(`${API}/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: dims, rowLimit: 25_000, dataState: 'all' }),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return (j.rows || []) as { keys: string[]; clicks: number; impressions: number; position: number }[];
}

async function kind(url: string, cache: Map<string, any>) {
  const ref = pageRefOf(url);
  if (!ref?.slug) return ref ? 'guide front page' : 'other';
  const k = `${ref.key}/${ref.slug}`;
  if (!cache.has(k)) {
    const p: any = (await db().collection('guides').doc(ref.key).collection('areas').doc(ref.slug).get()).data();
    const e = p ? null : (await db().collection('guideCompendium').doc(ref.key).collection('entities').doc(ref.slug).get()).data();
    cache.set(k, !p ? (e ? 'entity page' : 'removed / redirected') : p.status !== 'published' ? 'removed / redirected' : p.flagship && p.verified ? 'flagship (checked)' : p.verified ? 'checked page' : 'quick-built page');
  }
  return cache.get(k);
}

async function main() {
  const tok = await token();
  console.log('== Daily, fresh data included (date, impressions, clicks, position) ==');
  const daily = await pull(tok, ['date'], day(16), day(0));
  for (const r of daily) console.log(`${r.keys[0]}\t${r.impressions}\t${r.clicks}\t${r.position.toFixed(1)}`);
  const last = daily.map((r) => r.keys[0]).sort();
  const recent = last.slice(-3), before = last.slice(-6, -3);
  if (recent.length < 3 || before.length < 3) return;
  const a = await pull(tok, ['page'], recent[0], recent[2]);
  const b = await pull(tok, ['page'], before[0], before[2]);
  const cache = new Map<string, any>();
  const by = new Map<string, { now: number; before: number; pn: number; pb: number }>();
  const pages = new Map<string, { now: number; before: number; pn: number; pb: number }>();
  for (const [rows, side] of [[a, 'now'], [b, 'before']] as const) for (const r of rows) {
    const k = await kind(r.keys[0], cache);
    const g = by.get(k) || { now: 0, before: 0, pn: 0, pb: 0 };
    const p = pages.get(r.keys[0]) || { now: 0, before: 0, pn: 0, pb: 0 };
    if (side === 'now') { g.now += r.impressions; g.pn += r.position * r.impressions; p.now += r.impressions; p.pn += r.position * r.impressions; }
    else { g.before += r.impressions; g.pb += r.position * r.impressions; p.before += r.impressions; p.pb += r.position * r.impressions; }
    by.set(k, g); pages.set(r.keys[0], p);
  }
  console.log(`\n== By kind: ${recent[0]}..${recent[2]} against ${before[0]}..${before[2]} (impressions now/before, position now/before) ==`);
  for (const [k, g] of [...by].sort((x, y) => (x[1].now - x[1].before) - (y[1].now - y[1].before))) console.log(`${k}\t${g.now}/${g.before}\t${g.now ? (g.pn / g.now).toFixed(1) : '-'}/${g.before ? (g.pb / g.before).toFixed(1) : '-'}`);
  console.log('\n== Pages that lost the most ==');
  for (const [u, p] of [...pages].sort((x, y) => (x[1].now - x[1].before) - (y[1].now - y[1].before)).slice(0, 30)) console.log(`${u}\t${p.now}/${p.before}\t${p.now ? (p.pn / p.now).toFixed(1) : '-'}/${p.before ? (p.pb / p.before).toFixed(1) : '-'}\t${await kind(u, cache)}`);
}
main().then(() => process.exit(0), (e) => { console.error(e?.message || e); process.exit(1); });
