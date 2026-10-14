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

export type GuideDemand = { impressions: number; clicks: number; questions: number; players: number };
/** A player's question counts as this many search impressions when ranking guides by demand. */
export const QUESTION_WEIGHT = 10;
export const demandScore = (g: Partial<GuideDemand> | undefined) => Number(g?.impressions || 0) + QUESTION_WEIGHT * Number(g?.questions || 0);

/** Pull the last 30 days (Search Console needs the job's account) and save system/demand. Returns it. */
export async function guideDemand(): Promise<{ from: string; to: string; rows: number; guides: Record<string, GuideDemand> }> {
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
  const res = { from: ymd(start), to: ymd(end), rows: rows.length, guides: out };
  await db().collection('system').doc('demand').set({ at: Date.now(), ...res });
  return res;
}

/**
 * The core programme's order by demand: guides already complete stay first (in their order), the rest by demand score,
 * highest first; deferred guides (system/core.deferred) are left out of the order. Pure, for the monthly re-rank.
 */
export function rankByDemand(guides: string[], done: Set<string>, deferred: Set<string>, demand: Record<string, Partial<GuideDemand>>): string[] {
  const keep = guides.filter((k) => !deferred.has(k));
  return [...keep.filter((k) => done.has(k)), ...keep.filter((k) => !done.has(k)).sort((a, b) => demandScore(demand[b]) - demandScore(demand[a]))];
}

if (/demandReport\.ts$/.test(process.argv[1] || '')) {
  guideDemand().then((r) => {
    for (const [k, g] of Object.entries(r.guides).slice(0, 60)) console.log(`${k}: ${g.impressions} impressions, ${g.clicks} clicks, ${g.questions} questions (${g.players} players)`);
    console.log(`\n${r.rows} Search Console rows, ${r.from} to ${r.to}; saved to system/demand.`);
    process.exit(0);
  }).catch((e) => { console.error('demand report failed:', e?.message || e); process.exit(1); });
}
