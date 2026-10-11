/**
 * The proposed noindex (read-only): guide pages that miss the answer-grounding bar (failed review, flagged by their
 * guide's review, or unchecked in a guide scoring under 75), with what share of the last 28 days' Search Console
 * impressions they get, by guide, and how many had none. Translated copies count with their page. Runs as a job:
 *
 *   gcloud run jobs execute guide-pipeline --args=tsx,scripts/pipeline/scNoindex.ts
 */
import { db } from '../guides/common';
import { pageRefOf } from './searchConsole';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const SITE = 'sc-domain:questcompendium.com';
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function main() {
  const r0 = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(SCOPE)}`, { headers: { 'Metadata-Flavor': 'Google' } });
  const tok = String((await r0.json()).access_token || '');
  const start = day(28), end = day(1);
  const r = await fetch(`${API}/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['page'], rowLimit: 25_000, dataState: 'all' }),
  });
  const rows: any[] = (await r.json()).rows || [];
  const impr = new Map<string, number>(), clicks = new Map<string, number>();
  let total = 0, totalClicks = 0;
  for (const x of rows) {
    total += x.impressions; totalClicks += x.clicks;
    const ref = pageRefOf(x.keys[0]);
    if (!ref?.slug) continue;
    const k = `${ref.key}/${ref.slug}`;
    impr.set(k, (impr.get(k) || 0) + x.impressions);
    clicks.set(k, (clicks.get(k) || 0) + x.clicks);
  }
  console.log(`Search Console ${start}..${end}: ${total} impressions, ${totalClicks} clicks in all.`);
  const out: any[] = [];
  for (const d of (await db().collection('guides').get()).docs) {
    if (d.id.includes('--')) continue;
    const g: any = d.data();
    const score = Number.isFinite(Number(g.review?.score)) ? Number(g.review.score) : null;
    const flagged = new Set((g.review?.pages || []).map((p: any) => norm(String(p?.name || ''))));
    const pages = (await d.ref.collection('areas').where('status', '==', 'published').get()).docs.map((x) => ({ slug: x.id, ...(x.data() as any) }));
    let n = 0, im = 0, cl = 0, zero = 0, guideImpr = 0;
    for (const p of pages) {
      const pi = impr.get(`${d.id}/${p.slug}`) || 0;
      guideImpr += pi;
      if (p.flagship && p.verified === true) continue;
      const miss = !!p.reverify || (p.verified !== true && flagged.has(norm(String(p.name || '')))) || (p.verified !== true && score !== null && score < 75);
      if (!miss) continue;
      n++; im += pi; cl += clicks.get(`${d.id}/${p.slug}`) || 0;
      if (!pi) zero++;
    }
    if (n) out.push({ key: d.id, score, pages: pages.length, n, im, cl, zero, guideImpr });
  }
  out.sort((a, b) => b.im - a.im);
  const sum = out.reduce((a, x) => ({ n: a.n + x.n, im: a.im + x.im, cl: a.cl + x.cl, zero: a.zero + x.zero }), { n: 0, im: 0, cl: 0, zero: 0 });
  console.log('\nguide\tscore\tpages noindexed/in guide\timpressions on them\tshare of all\tclicks\tof the guide\'s impressions\tpages with no impressions');
  for (const x of out) console.log(`${x.key}\t${x.score ?? '-'}\t${x.n}/${x.pages}\t${x.im}\t${total ? ((100 * x.im) / total).toFixed(1) : 0}%\t${x.cl}\t${x.guideImpr ? Math.round((100 * x.im) / x.guideImpr) : 0}%\t${x.zero}`);
  console.log(`\nIn all: ${sum.n} pages, ${sum.im} of ${total} impressions (${total ? ((100 * sum.im) / total).toFixed(1) : 0}%), ${sum.cl} of ${totalClicks} clicks; ${sum.zero} of the ${sum.n} pages had no impressions.`);
}
main().then(() => process.exit(0), (e) => { console.error(e?.message || e); process.exit(1); });
