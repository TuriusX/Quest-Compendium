/**
 * One-off (owner, Oct 31 2026): until today the rebuild guard counted an item or secret as kept when the new page's text
 * merely mentioned it (rebuildGuard.ts kept), so a rebuild could take a row off the checklist while a walkthrough step
 * still named it. Every page with a saved earlier version since the guard began (areaHistory, Oct 17 2026: rebuilds,
 * re-verification, repairs, walkthroughs) is compared with its live version: an item or secret that left its list but
 * survives only as a mention in the text comes back, marked "not yet confirmed" (as carryOver does), from the latest
 * saved version that had it. Stored data only: no AI, no searches.
 *
 * Not brought back: anything the page's last claim check found contradicted (guidePrototypes), and anything the owner
 * changed by hand in the editor (guideEdits). The live page is saved to its history first (role "replaced", note
 * "before guard sweep"); the site publishes it with the next daily run (system/editor.dirtyAt) and the restored rows
 * are translated (translationsDue).
 *
 *   npx tsx scripts/guides/sweepGuardMentions.ts            what it would restore (nothing written)
 *   npx tsx scripts/guides/sweepGuardMentions.ts --write    restore
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './common';
import { rebuildVerdict, contradictedNames, normName, words, pageText, historyRef } from './rebuildGuard';

const WRITE = process.argv.includes('--write');
const SINCE = Date.parse('2026-10-17T00:00:00Z');
const FIELD = { item: 'items', secret: 'secrets' } as const;
const nameOf = (kind: 'item' | 'secret', e: any) => String(kind === 'item' ? e?.name : e?.name || e?.text || '').trim();

/** The old rule: still "kept" because the text names it (what let these rows go). */
function mentioned(kind: 'item' | 'secret', name: string, text: string): boolean {
  if (kind === 'secret') {
    const w = words(name);
    return !!w.length && w.filter((x) => text.includes(` ${x} `)).length / w.length >= 0.6;
  }
  const n = normName(name);
  return !!n && text.includes(` ${n} `);
}

async function main() {
  const docs = await db().collection('areaHistory').listDocuments();
  let pages = 0, entries = 0, checked = 0, skippedContra = 0, skippedOwner = 0;
  const report: string[] = [];
  const touched = new Map<string, string[]>();
  for (const h of docs) {
    const [key, slug] = h.id.split('__');
    if (!key || !slug) continue;
    const versions = (await h.collection('versions').get()).docs
      .map((d) => d.data() as any)
      .filter((v) => v.role === 'replaced' && Number(v.at) >= SINCE && v.page)
      .sort((a, b) => b.at - a.at);
    if (!versions.length) continue;
    const ref = db().collection('guides').doc(key).collection('areas').doc(slug);
    const now: any = (await ref.get()).data();
    if (!now) continue;
    checked++;
    const text = pageText(now);
    // Contradicted by the page's last claim check; changed by the owner in the editor.
    const protos = await Promise.all([`${key}__${slug}__evidence`, `${key}__${slug}`].map((id) => db().collection('guidePrototypes').doc(id).get()));
    const contra = new Set<string>();
    for (const p of protos) if (p.exists) for (const v of versions) for (const n of contradictedNames(p.data(), v.page)) contra.add(n);
    const edits = (await db().collection('guideEdits').where('key', '==', key).where('slug', '==', slug).get()).docs.map((d) => ` ${normName(`${d.data().before || ''}`)} `);
    // Each lost row once, from the latest saved version that had it.
    const back = new Map<string, { kind: 'item' | 'secret'; name: string; entry: any }>();
    for (const v of versions) {
      for (const l of rebuildVerdict(v.page, now).lost) {
        if (l.kind !== "item" && l.kind !== "secret") continue;
        const kind: "item" | "secret" = l.kind;
        const id = `${kind}|${normName(l.name)}`;
        if (back.has(id) || !mentioned(kind, l.name, text)) continue;
        if (contra.has(normName(l.name))) { skippedContra++; back.set(id, null as any); continue; }
        if (edits.some((b) => normName(l.name).length >= 4 && b.includes(` ${normName(l.name)} `))) { skippedOwner++; back.set(id, null as any); continue; }
        const entry = (v.page[FIELD[kind]] || []).find((e: any) => nameOf(kind, e) === l.name);
        if (entry) back.set(id, { kind, name: l.name, entry });
      }
    }
    const rows = [...back.values()].filter(Boolean);
    if (!rows.length) continue;
    pages++;
    entries += rows.length;
    report.push(`${key}/${slug}: ${rows.map((r) => `${r.kind} "${r.name.slice(0, 60)}"`).join('; ')}`);
    (touched.get(key) || touched.set(key, []).get(key)!).push(slug);
    if (WRITE) {
      await historyRef(key, slug, Date.now()).set(JSON.parse(JSON.stringify({ role: 'replaced', at: Date.now(), page: now, note: 'before guard sweep' })));
      const ids = new Set<string>([...(now.items || []), ...(now.secrets || [])].map((e: any) => String(e?.id || '')));
      const free = (id: unknown, p: string) => { let n = String(id || `${p}${ids.size + 1}`); while (ids.has(n)) n = `${n}r`; ids.add(n); return n; };
      const patch: any = { items: [...(now.items || [])], secrets: [...(now.secrets || [])] };
      for (const r of rows) patch[FIELD[r.kind]].push({ ...r.entry, id: free(r.entry.id, r.kind[0]), unconfirmed: true });
      await ref.set(JSON.parse(JSON.stringify({ ...patch, restoredAt: Date.now() })), { merge: true });
    }
  }
  for (const l of report) console.log(l);
  console.log(`\nChecked ${checked} page(s) with a saved version since Oct 17. ${WRITE ? 'Restored' : 'Would restore'} ${entries} row(s) on ${pages} page(s) (left out: ${skippedContra} contradicted by the last claim check, ${skippedOwner} changed by the owner).`);
  if (WRITE && pages) {
    for (const [key, slugs] of touched) await db().collection('guides').doc(key).set({ translationsDue: { at: Date.now(), pages: FieldValue.arrayUnion(...slugs) } }, { merge: true });
    await db().collection('system').doc('editor').set({ dirtyAt: Date.now() }, { merge: true });
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
