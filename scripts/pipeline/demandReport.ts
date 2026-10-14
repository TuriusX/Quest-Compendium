/**
 * Demand per guide, for ordering the core programme: Search Console impressions and clicks over the last 30 days
 * (ending 3 days ago; its data lags), every page of the guide counted (walkthrough, compendium, achievements, all
 * languages), and the questions players asked in the app about the game (gameStats/{game}; counted since the app
 * started keeping them, which for now is close to the same 30 days). Read only, except its own result:
 * system/demand { at, from, to, guides: { [key]: { impressions, clicks, questions, players } } }.
 *
 * Search Console needs the job's own account (Cloud Run):
 *   gcloud run jobs execute guide-pipeline --region us-east1 --args=tsx,scripts/pipeline/demandReport.ts
 */
import { db, gameKey } from '../guides/common';
import { token, findSite, pullRows } from './searchConsole';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const end = new Date(Date.now() - 3 * 86_400_000);
  const start = new Date(end.getTime() - 29 * 86_400_000);
  const tok = await token();
  const site = await findSite(tok);
  const rows = await pullRows(tok, site, ymd(start), ymd(end));
  const guides = new Map<string, { impressions: number; clicks: number; questions: number; players: number }>();
  const get = (k: string) => guides.get(k) || { impressions: 0, clicks: 0, questions: 0, players: 0 };
  for (const r of rows) {
    let path = '';
    try { path = new URL(r.page).pathname; } catch { continue; }
    const m = path.match(/^\/(?:[a-z]{2}\/)?guides\/([a-z0-9-]+)\//);
    if (!m) continue;
    const g = get(m[1]);
    g.impressions += r.impressions;
    g.clicks += r.clicks;
    guides.set(m[1], g);
  }
  // Players' questions: gameStats is keyed by the game's name; matched to guides by the guide's game name.
  const stats = new Map((await db().collection('gameStats').get()).docs.map((d) => [d.id, d.data() as any]));
  for (const d of (await db().collection('guides').get()).docs) {
    if (d.id.endsWith('--next')) continue;
    const name = String((d.data() as any).game || d.id);
    const keys = new Set([gameKey(name), gameKey(name.replace(/\s*[-:–]\s*(complete|definitive|goty|game of the year|special|remastered|ultimate)[^]*$/i, '')), d.id]);
    let q = 0, p = 0;
    for (const k of keys) { const s = stats.get(k); if (s) { q += Number(s.questions || 0); p += (s.players || []).length; } }
    if (q || guides.has(d.id)) { const g = get(d.id); g.questions = q; g.players = p; guides.set(d.id, g); }
  }
  const out = Object.fromEntries([...guides.entries()].sort((a, b) => b[1].impressions - a[1].impressions));
  await db().collection('system').doc('demand').set({ at: Date.now(), from: ymd(start), to: ymd(end), rows: rows.length, guides: out });
  for (const [k, g] of Object.entries(out).slice(0, 60)) console.log(`${k}: ${g.impressions} impressions, ${g.clicks} clicks, ${g.questions} questions (${g.players} players)`);
  console.log(`\n${rows.length} Search Console rows, ${ymd(start)} to ${ymd(end)}; saved to system/demand.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('demand report failed:', e?.message || e); process.exit(1); });
