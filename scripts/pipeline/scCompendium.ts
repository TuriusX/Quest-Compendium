/**
 * Demand for compendium pages: each live entity page's Search Console impressions and clicks (last 90 days,
 * translated copies count with their page), the impressions of searches naming the entity that led to any page of its
 * guide (most entity pages are new; players searched for them on the walkthrough pages), and how often the app's
 * answers were about it (in-app questions: the facts the answers recorded about it, gameFacts/{key}/facts, with how
 * many times each was confirmed, plus rated answers and reports naming it). Saved on the page
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
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['page', 'query'], rowLimit: 25_000, dataState: 'all' }),
  });
  const impr = new Map<string, number>(), clicks = new Map<string, number>();
  const queries = new Map<string, { q: string; n: number }[]>(); // per guide: the searches that led to its pages
  for (const x of (await r.json()).rows || []) {
    const ref = pageRefOf(x.keys[0]);
    if (!ref) continue;
    queries.set(ref.key, [...(queries.get(ref.key) || []), { q: ` ${norm(x.keys[1])} `, n: x.impressions }]);
    if (!ref.slug) continue;
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
    const rows: { name: string; impressions: number; clicks: number; named: number; asked: number }[] = [];
    const batch = db().batch();
    const facts = (await db().collection('gameFacts').doc(c.id).collection('facts').limit(5000).get()).docs.map((d) => d.data() as any);
    const ents = (await c.ref.collection('entities').where('status', '==', 'published').get()).docs;
    // The names a search or question may use: the full name, the part before a comma ("Fia, Deathbed Companion"), and
    // a person's first name when it is 4+ letters and no other entity of the guide shares it.
    const first = (n: string) => norm(n).split(' ')[0];
    const firsts = new Map<string, number>();
    for (const d of ents) firsts.set(first(String(d.data().name)), (firsts.get(first(String(d.data().name))) || 0) + 1);
    for (const d of ents) {
      const e: any = d.data();
      const full = norm(String(e.name || ''));
      const forms = [...new Set([full, norm(String(e.name).split(',')[0]), ...(first(e.name).length >= 4 && firsts.get(first(e.name)) === 1 && /person|character|companion|npc|merchant|boss/i.test(`${e.type} ${e.typeLabel}`) ? [first(e.name)] : [])])].filter((f) => f.length >= 4).map((f) => ` ${f} `);
      const hit = (t: string) => forms.some((f) => t.includes(f));
      const named = (queries.get(c.id) || []).filter((x) => hit(x.q)).reduce((a, x) => a + x.n, 0);
      const a = asked.filter((x) => hit(x.q) && (!x.game || x.game.includes(game.split(' ').slice(0, 2).join(' ')))).length
        + facts.filter((f) => hit(` ${norm(String(f.subject || ''))} `)).reduce((t, f) => t + Math.max(1, Number(f.confirmations) || 1), 0);
      const row = { name: String(e.name), impressions: impr.get(`${c.id}/${d.id}`) || 0, clicks: clicks.get(`${c.id}/${d.id}`) || 0, named, asked: a };
      rows.push(row);
      batch.set(d.ref, { demand: { impressions: row.impressions, clicks: row.clicks, named, asked: a, score: Math.max(row.impressions, named) + ASKED_WEIGHT * a, from: start, to: end, at: Date.now() } }, { merge: true });
    }
    if (!rows.length) continue;
    await batch.commit();
    const score = (x: (typeof rows)[number]) => Math.max(x.impressions, x.named) + ASKED_WEIGHT * x.asked;
    rows.sort((x, y) => score(y) - score(x));
    console.log(`scCompendium: ${c.id} (${rows.length} live): ${rows.slice(0, 14).map((x) => `${x.name} ${score(x)} (page ${x.impressions}, named ${x.named}, asked ${x.asked})`).join('; ')}`);
  }
  // The blueprints' planned entity pages (not built yet): searches naming them on the guide's pages, and in-app
  // questions, for the new-pages order (rollout.ts). Saved as guideBlueprints/{key}.planDemand.{section}.{name}.
  for (const d of (await db().collection('guideBlueprints').where('status', '==', 'approved').get()).docs) {
    const b: any = d.data();
    const game = norm(String((await db().collection('guides').doc(d.id).get()).data()?.game || d.id));
    const facts = (await db().collection('gameFacts').doc(d.id).collection('facts').limit(5000).get()).docs.map((x) => ` ${norm(String((x.data() as any).subject || ''))} `);
    const out: Record<string, Record<string, number>> = {};
    for (const s of b.sections || []) {
      const plan: string[] = b.progress?.[s.id]?.plan || [];
      if (s.unit !== 'entity' || !plan.length) continue;
      out[s.id] = {};
      for (const name of plan) {
        const forms = [...new Set([norm(name), norm(name.split(',')[0])])].filter((f) => f.length >= 4).map((f) => ` ${f} `);
        const hit = (t: string) => forms.some((f) => t.includes(f));
        const named = (queries.get(d.id) || []).filter((x) => hit(x.q)).reduce((a, x) => a + x.n, 0);
        const a = asked.filter((x) => hit(x.q) && (!x.game || x.game.includes(game.split(' ').slice(0, 2).join(' ')))).length + facts.filter(hit).length;
        out[s.id][name] = named + ASKED_WEIGHT * a;
      }
    }
    if (!Object.keys(out).length) continue;
    await d.ref.update({ planDemand: out, planDemandAt: Date.now() });
    const top = Object.entries(out).flatMap(([sec, xs]) => Object.entries(xs).map(([n, v]) => `${n} ${v} (${sec})`)).sort((x, y) => Number(y.split(' (')[0].split(' ').pop()) - Number(x.split(' (')[0].split(' ').pop())).slice(0, 10);
    console.log(`scCompendium: ${d.id} planned pages by demand: ${top.join('; ')}`);
  }
}
main().then(() => process.exit(0), (e) => { console.error('scCompendium failed:', e?.message || e); process.exit(1); });
