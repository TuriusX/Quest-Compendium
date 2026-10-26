/**
 * One-off (owner, Oct 22 2026): the October re-verification fund's rebuilds dropped named entries (bobbleheads, skill
 * books, missables...) the old pages had. Each live rebuilt page gets them back from the version saved just before its
 * rebuild (areaHistory, role "replaced"), marked "not yet confirmed" (rebuildGuard.ts carryOver); the new walkthrough
 * and checked content stay. The page as it is now is saved to its history first (role "replaced", note "before
 * restore"). No AI.
 *
 *   npx tsx scripts/guides/restoreReverified.ts            what it would restore (nothing written)
 *   npx tsx scripts/guides/restoreReverified.ts --write    restore
 */
import { db } from './common';
import { carryOver, historyRef } from './rebuildGuard';

const WRITE = process.argv.includes('--write');
const LISTS = ['items', 'secrets', 'shops', 'fights', 'choices', 'sections'];

async function main() {
  const core: any = (await db().collection('system').doc('core').get()).data() || {};
  const log: any[] = (core.boost?.log || []).filter((x: any) => /^live/.test(String(x.status)));
  let pages = 0, entries = 0;
  const report: string[] = [];
  for (const x of log) {
    const ref = db().collection('guides').doc(x.key).collection('areas').doc(x.ref);
    const now: any = (await ref.get()).data();
    const vs = (await db().collection('areaHistory').doc(`${x.key}__${x.ref}`).collection('versions').get()).docs
      .map((d) => ({ at: Number(d.id), ...(d.data() as any) }))
      .filter((v) => v.role === 'replaced' && v.note !== 'before restore' && v.at <= Number(x.at) + 10 * 60_000 && v.at >= Number(x.at) - 4 * 3600_000)
      .sort((a, b) => Math.abs(a.at - Number(x.at)) - Math.abs(b.at - Number(x.at)));
    const before = vs[0]?.page;
    if (!now || !before) { report.push(`${x.key}/${x.ref}: no saved version from before its rebuild (skipped)`); continue; }
    const { fields, carried } = carryOver(before, Object.fromEntries(LISTS.map((k) => [k, now[k] || []])));
    if (!carried.length) continue;
    pages++;
    entries += carried.length;
    report.push(`${x.key}/${x.ref}: ${carried.length} back (${carried.map((c) => `${c.kind} "${c.name.slice(0, 60)}"`).join('; ')})`);
    if (WRITE) {
      await historyRef(x.key, x.ref, Date.now()).set(JSON.parse(JSON.stringify({ role: 'replaced', at: Date.now(), page: now, note: 'before restore' })));
      const patch: any = {};
      for (const k of LISTS) if (fields[k] !== undefined && JSON.stringify(fields[k]) !== JSON.stringify(now[k] || [])) patch[k] = fields[k];
      await ref.set(JSON.parse(JSON.stringify({ ...patch, restoredAt: Date.now() })), { merge: true });
    }
  }
  for (const l of report) console.log(l);
  console.log(`\n${WRITE ? 'Restored' : 'Would restore'} ${entries} entr${entries === 1 ? 'y' : 'ies'} on ${pages} of ${log.length} live re-verified page(s).`);
  if (WRITE) await db().collection('system').doc('editor').set({ dirtyAt: Date.now() }, { merge: true });
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
