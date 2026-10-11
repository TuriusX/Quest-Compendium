/**
 * Search Console, removed and redirected URLs (read-only): the URLs with impressions in the last 28 days whose page is
 * no longer live (unpublished or removed: they 301 to a replacement or the guide's front page), most impressions first,
 * each with where it goes now and what URL Inspection says (indexed or not, Google's canonical). Runs as a job:
 *
 *   gcloud run jobs execute guide-pipeline --args=tsx,scripts/pipeline/scRemoved.ts
 */
import { db } from '../guides/common';
import { pageRefOf } from './searchConsole';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const SITE = 'sc-domain:questcompendium.com';
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const r0 = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(SCOPE)}`, { headers: { 'Metadata-Flavor': 'Google' } });
  const tok = String((await r0.json()).access_token || '');
  const auth = { Authorization: `Bearer ${tok}` };
  const r = await fetch(`${API}/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: day(30), endDate: day(0), dimensions: ['page'], rowLimit: 25_000, dataState: 'all' }),
  });
  const rows: any[] = (await r.json()).rows || [];
  const removed: { url: string; impressions: number; position: number }[] = [];
  for (const x of rows) {
    const ref = pageRefOf(x.keys[0]);
    if (!ref?.slug) continue;
    const p: any = (await db().collection('guides').doc(ref.key).collection('areas').doc(ref.slug).get()).data();
    if (p?.status === 'published') continue;
    if (!p && (await db().collection('guideCompendium').doc(ref.key).collection('entities').doc(ref.slug).get()).exists) continue;
    removed.push({ url: x.keys[0], impressions: x.impressions, position: x.position });
  }
  removed.sort((a, b) => b.impressions - a.impressions);
  const total = removed.reduce((n, x) => n + x.impressions, 0);
  console.log(`Removed or redirected URLs with impressions (30 days): ${removed.length}, ${total} impressions.`);
  const tally = new Map<string, number>();
  for (const x of removed.slice(0, 80)) {
    let now = '';
    try {
      const h = await fetch(x.url, { redirect: 'manual' });
      now = h.status >= 300 && h.status < 400 ? `${h.status} -> ${h.headers.get('location')}` : `HTTP ${h.status}`;
    } catch { now = 'unreachable'; }
    const i = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionUrl: x.url, siteUrl: SITE }) });
    const s: any = ((await i.json().catch(() => ({}))) as any).inspectionResult?.indexStatusResult || {};
    const state = i.ok ? String(s.coverageState || '-') : `HTTP ${i.status}`;
    tally.set(state, (tally.get(state) || 0) + 1);
    console.log(`${x.url}\t${x.impressions}\t${x.position.toFixed(1)}\t${now}\t${state}\tcrawled ${s.lastCrawlTime || 'never'}\tgoogle canonical ${s.googleCanonical || '-'}`);
  }
  console.log(`\nIndex states (top ${Math.min(80, removed.length)}): ${[...tally].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('; ')}`);
}
main().then(() => process.exit(0), (e) => { console.error(e?.message || e); process.exit(1); });
