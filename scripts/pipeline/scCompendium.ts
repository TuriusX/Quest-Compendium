/**
 * Demand for compendium pages: each live entity page's Search Console impressions and clicks (last 90 days,
 * translated copies count with their page) and how many questions players asked in the app name it. Saved on the page
 * (entities/{slug}.demand) for the benchmark sample and the rebuild order; prints each guide's top pages. Runs as a job:
 *
 *   gcloud run jobs execute guide-pipeline --args=tsx,scripts/pipeline/scCompendium.ts --wait
 */
import { db } from '../guides/common';
import { pageRefOf } from './searchConsole';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const SITE = 'sc-domain:questcompendium.com';
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** An in-app question counts as 20 impressions when ranking. */
export const ASKED_WEIGHT = 20;

async function main() {
  const r0 = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(SCOPE)}`, { headers: { 'Metadata-Flavor': 'Google' } });
  const tok = String((await r0.json()).access_token || '');
  const start = day(90), end = day(1);
  const r = await fetch(`${API}/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['page'], rowLimit: 25_000, dataState: 'all' }),
  });
  const impr = new Map<string, number>(), clicks = new Map<string, number>();
  for (const x of (await r.json()).rows || []) {
    const ref = pageRefOf(x.keys[0]);
    if (!ref?.slug) continue;
    const k = `${ref.key}/${ref.slug}`;
    impr.set(k, (impr.get(k) || 0) + x.impressions);
    clicks.set(k, (clicks.get(k) || 0) + x.clicks);
  }
  // Questions asked in the app (rated answers and reports), with their game.
  const asked: { q: string; game: string }[] = [];
  for (const [col, at] of [['answerFeedback', 'at'], ['answerReports', 'createdAt']] as const) {
    for (const d of (await db().collection(col).orderBy(at, 'desc').limit(5000).get()).docs) {
      const x: any = d.data();
      if (x.question) asked.push({ q: ` ${norm(String(x.question))} `, game: norm(String(x.game || '')) });
    }
  }
  console.log(`scCompendium: Search Console ${start}..${end}; ${asked.length} in-app question(s).`);
  for (const c of (await db().collection('guideCompendium').get()).docs) {
    const game = norm(String((await db().collection('guides').doc(c.id).get()).data()?.game || c.id));
    const rows: { name: string; impressions: number; clicks: number; asked: number }[] = [];
    const batch = db().batch();
    for (const d of (await c.ref.collection('entities').where('status', '==', 'published').get()).docs) {
      const e: any = d.data();
      const n = ` ${norm(String(e.name || ''))} `;
      const a = asked.filter((x) => x.q.includes(n) && (!x.game || x.game.includes(game.split(' ').slice(0, 2).join(' ')))).length;
      const row = { name: String(e.name), impressions: impr.get(`${c.id}/${d.id}`) || 0, clicks: clicks.get(`${c.id}/${d.id}`) || 0, asked: a };
      rows.push(row);
      batch.set(d.ref, { demand: { impressions: row.impressions, clicks: row.clicks, asked: a, score: row.impressions + ASKED_WEIGHT * a, from: start, to: end, at: Date.now() } }, { merge: true });
    }
    if (!rows.length) continue;
    await batch.commit();
    rows.sort((x, y) => y.impressions + ASKED_WEIGHT * y.asked - (x.impressions + ASKED_WEIGHT * x.asked));
    console.log(`scCompendium: ${c.id} (${rows.length} live): ${rows.slice(0, 12).map((x) => `${x.name} ${x.impressions}/${x.clicks}c${x.asked ? `/${x.asked}q` : ''}`).join('; ')}`);
  }
}
main().then(() => process.exit(0), (e) => { console.error('scCompendium failed:', e?.message || e); process.exit(1); });
