/**
 * Fills the fact database (records.ts) from what is live today, and keeps it in step: run after each nightly publish by
 * the pipeline, or by hand. No AI, no searches; only records that changed are written, and records whose page or entry
 * is gone are removed. Nothing reads the store yet (step 1 of the database plan, roadmap 29).
 *
 *   npx tsx scripts/guides/recordsImport.ts [--only KEY] [--dry-run]
 */
import { db, arg } from './common';
import { areaRecords, entityRecords, achievementRecords, gameFactRecord, type GameRecord } from './records';
import { loadOwnerEdits, applyOwnerEdits } from './ownerEditsPublish';
import { loadPageStats, statOf } from './pageStats';

export const RECORDS = () => db().collection('gameRecords');

type Totals = { records: number; byTier: Record<string, number>; byType: Record<string, number>; byStatus: Record<string, number>; missables: number; missablesComplete: number; written: number; removed: number };
const blank = (): Totals => ({ records: 0, byTier: {}, byType: {}, byStatus: {}, missables: 0, missablesComplete: 0, written: 0, removed: 0 });
const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] || 0) + 1; };

/** Every record of every game (or one), as the live site has them now. */
async function collect(only = ''): Promise<Map<string, GameRecord[]>> {
  const out = new Map<string, GameRecord[]>();
  const add = (key: string, rs: GameRecord[]) => { if (rs.length) out.set(key, [...(out.get(key) || []), ...rs]); };
  await loadOwnerEdits(only);
  const stats = await loadPageStats();
  // Pages the nightly improvements merged into another page are left out (they redirect).
  const merged = new Set<string>();
  for (const d of (await db().collection('autoChanges').where('kind', '==', 'merge').where('status', '==', 'live').get().catch(() => null))?.docs || []) {
    const m: any = d.data();
    if (m.key && m.merge?.from) merged.add(`${m.key}/${m.merge.from}`);
  }
  for (const g of (await db().collection('guides').get()).docs) {
    if (g.id.includes('--') || (only && g.id !== only)) continue;
    if ((g.data() as any).unpublished) continue;
    for (const d of (await g.ref.collection('areas').where('status', '==', 'published').get()).docs) {
      if (merged.has(`${g.id}/${d.id}`)) continue;
      const a: any = { slug: d.id, ...d.data() };
      applyOwnerEdits(g.id, d.id, a);
      add(g.id, areaRecords(g.id, a, statOf(stats, g.id, d.id)?.impressions || 0));
    }
    const ach: any = (await g.ref.collection('achievements').doc('main').get()).data();
    if (ach?.list?.length) add(g.id, achievementRecords(g.id, ach));
  }
  for (const c of (await db().collection('guideCompendium').get()).docs) {
    if (only && c.id !== only) continue;
    for (const d of (await c.ref.collection('entities').where('status', '==', 'published').get()).docs) {
      const e: any = { slug: d.id, ...d.data() };
      if (merged.has(`${c.id}/${e.slug}`)) continue;
      applyOwnerEdits(c.id, String(e.slug), e);
      add(c.id, entityRecords(c.id, e, statOf(stats, c.id, String(e.slug))?.impressions || 0));
    }
  }
  for (const g of (await db().collection('gameFacts').get()).docs) {
    if (only && g.id !== only) continue;
    const rs: GameRecord[] = [];
    for (const f of (await g.ref.collection('facts').get()).docs) { const r = gameFactRecord(g.id, f.id, f.data()); if (r) rs.push(r); }
    add(g.id, rs);
  }
  return out;
}

/** Writes the changed records of one game, removes the gone ones, and saves the game's summary. */
async function saveGame(key: string, recs: GameRecord[], dry: boolean, t: Totals, now: number): Promise<void> {
  const g: Totals = blank();
  // The same id twice (an entry id repeated on one page): the later one gets a suffix, so neither is lost.
  const seen = new Map<string, number>();
  for (const r of recs) { const n = seen.get(r.id) || 0; seen.set(r.id, n + 1); if (n) r.id = `${r.id}~${n}`; }
  for (const r of recs) {
    for (const x of [g, t]) {
      x.records++; bump(x.byTier, r.tier); bump(x.byType, r.type); bump(x.byStatus, r.status);
      if (r.missable && r.type === 'item') { x.missables++; if (!r.gaps?.length) x.missablesComplete++; }
    }
  }
  const col = RECORDS().doc(key).collection('records');
  const have = new Map<string, string>();
  for (const d of (await col.select('hash').get()).docs) have.set(d.id, String((d.data() as any).hash || ''));
  const writes = recs.filter((r) => have.get(r.id) !== r.hash);
  const gone = [...have.keys()].filter((id) => !seen.has(id) && !recs.some((r) => r.id === id));
  g.written = writes.length; g.removed = gone.length; t.written += writes.length; t.removed += gone.length;
  if (dry) return;
  for (let i = 0; i < writes.length; i += 400) {
    const b = db().batch();
    for (const r of writes.slice(i, i + 400)) b.set(col.doc(r.id), { ...r, importedAt: now });
    await b.commit();
  }
  for (let i = 0; i < gone.length; i += 400) {
    const b = db().batch();
    for (const id of gone.slice(i, i + 400)) b.delete(col.doc(id));
    await b.commit();
  }
  const { written: _w, removed: _r, ...summary } = g;
  await RECORDS().doc(key).set({ ...summary, importedAt: now }, { merge: false });
}

/** The whole import: returns one line for the logs and the totals. */
export async function importRecords(opts: { only?: string; dry?: boolean } = {}): Promise<{ line: string; totals: Totals }> {
  const now = Date.now();
  const all = await collect(opts.only || '');
  const t = blank();
  for (const [key, recs] of all) await saveGame(key, recs, !!opts.dry, t, now);
  // A game no longer in any source (its guide taken down): its records go too (full runs only).
  if (!opts.only && !opts.dry) {
    for (const d of (await RECORDS().get()).docs) if (!all.has(d.id)) {
      const col = d.ref.collection('records');
      for (;;) { const s = await col.limit(400).get(); if (s.empty) break; const b = db().batch(); s.docs.forEach((x) => b.delete(x.ref)); await b.commit(); }
      await d.ref.delete();
    }
  }
  const pct = (n: number) => `${Math.round((100 * n) / Math.max(1, t.records))}%`;
  const line = `Fact database: ${t.records} records in ${all.size} games: ${t.byTier.A || 0} checked (${pct(t.byTier.A || 0)}), ${t.byTier.B || 0} to recheck from stored evidence, ${t.byTier.C || 0} to verify; missables ${t.missablesComplete} of ${t.missables} complete (where, final step, lockout)${opts.dry ? ' (dry run)' : `; ${t.written} written, ${t.removed} removed`}.`;
  return { line, totals: t };
}

/** Monday's line: the store's totals from the games' summaries (no record reads). */
export async function recordsWeekLine(): Promise<string> {
  const docs = (await RECORDS().get().catch(() => null))?.docs || [];
  if (!docs.length) return '';
  let n = 0, a = 0, b = 0, c = 0, m = 0, mc = 0, at = 0;
  for (const d of docs) {
    const x: any = d.data();
    n += x.records || 0; a += x.byTier?.A || 0; b += x.byTier?.B || 0; c += x.byTier?.C || 0; m += x.missables || 0; mc += x.missablesComplete || 0;
    at = Math.max(at, Number(x.importedAt || 0));
  }
  return `🗃️ Fact database: ${n} records in ${docs.length} games: ${a} checked, ${b} to recheck from stored evidence, ${c} to verify; missables ${mc} of ${m} complete (updated ${new Date(at).toISOString().slice(0, 10)}).`;
}

async function main() {
  const r = await importRecords({ only: arg('only') || '', dry: process.argv.includes('--dry-run') });
  console.log(r.line);
  console.log(`  by type: ${Object.entries(r.totals.byType).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  by status: ${Object.entries(r.totals.byStatus).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  setTimeout(() => process.exit(0), 300);
}
if (/recordsImport\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('recordsImport failed:', e?.message || e); process.exit(1); });
