/**
 * The importance bar for areas already filled (owner, Nov 16 2026, option A): one call per area, no search, reads the
 * area's "Worth getting here" list and keeps only what matters to a player at that point in the game (common gear only
 * with a real reason: a quest needs it, it can be missed, a clear upgrade there; never enemies or sentence fragments).
 * Fewer is better than filler; an empty group is fine.
 *
 * Applied: the area's worth doc keeps the kept entries (ranked again in their order) and lists the dropped ones under
 * `trimmed` with the reason (so a drop can be undone); the records lose their rank at once, so the app stops listing
 * them (the records stay). Without --apply nothing is written: the before and after are printed.
 *
 *   npx tsx scripts/guides/worthReview.ts [--only KEY] [--places slug,slug] [--max-dollars 0.5] [--apply]
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, ledgerDollars } from './common';
import { RECORDS } from './recordsImport';
import { applyWorth, finish, nameKey, type GameRecord, type WorthEntry } from './records';

const LABEL: Record<string, string> = { item: 'ITEM', quest: 'QUEST', npc: 'NPC', tip: 'DO' };
const line = (e: WorthEntry) => `${LABEL[e.type] || e.type} ${e.name}${e.fields?.rarity ? ` (${e.fields.rarity})` : ''}: ${e.fields?.why || e.fields?.rewards || e.fields?.text || ''}`.slice(0, 260);

function prompt(game: string, place: string, act: string, entries: WorthEntry[]): string {
  return [
    `In the video game "${game}"${act ? ` (${act})` : ''}, the area "${place}". This is its "Worth getting here" list for players:`,
    ...entries.map((e, i) => `e${i}. ${line(e)}`),
    '',
    'Keep ONLY what really matters to a player at this point in the game. Fewer is better than filler; dropping a whole group is fine.',
    '- Gear: keep standout gear (uncommon or better, unique, or famous). Basic or common gear (plain weapons and armor any shop sells) only with a real reason: a quest needs it, it can be missed, or it is a clear upgrade at this point in the game.',
    '- People: keep people a player talks to, trades with or recruits and should not miss. Drop enemies, creatures and bosses.',
    '- Drop anything whose name is a sentence fragment rather than a name, and duplicates of another entry.',
    '- Quests and things to do: keep the ones a player should not skip.',
    'Reply with JSON only: {"keep": ["e0", ...], "drop": [{"id": "e3", "why": "one short reason"}, ...]} covering every entry.',
  ].join('\n');
}

async function review(game: string, place: string, act: string, entries: WorthEntry[]): Promise<{ keep: Set<number>; drop: Map<number, string> }> {
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt(game, place, act, entries) }] }],
    config: { temperature: 0, maxOutputTokens: 2000, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const j = JSON.parse(String(res?.text || '{}').replace(/^```(json)?|```$/g, ''));
  const idx = (s: unknown) => Number(String(s).replace(/^e/, ''));
  const drop = new Map<number, string>((j.drop || []).map((d: any) => [idx(d.id), String(d.why || '').slice(0, 160)]));
  // The bar is for common gear: an item rated Uncommon or better stays unless it's a duplicate (the first run, Nov 16,
  // also dropped rare gear as "niche": Infernal Iron, Amulet of Restoration… restored with --restore-gear).
  for (const [i, why] of drop) if (entries[i] && !plainGear(entries[i]) && entries[i].type === 'item' && !/duplicate/i.test(why)) drop.delete(i);
  // Anything the reply leaves out stays (only an explicit drop removes).
  const keep = new Set(entries.map((_, i) => i).filter((i) => !drop.has(i)));
  return { keep, drop };
}

/** Plain gear: rated Common (or nothing) — the only gear the bar applies to. */
// "Rated" is a real rarity or a story role; anything else (Common, "Level 1" scrolls, cantrips, consumables, charms…)
// is held to the bar.
export const RATED = /\b(uncommon|rare|legendary|story|quest|key|collectible|upgrade|unique)\b/i;
const plainGear = (e: WorthEntry) => e.type === 'item' && !RATED.test(String(e.fields?.rarity || ''));
const TIER = ['legendary', 'very rare', 'rare', 'uncommon'];
const tierOf = (e: WorthEntry) => { const t = TIER.indexOf(String(e.fields?.rarity || '').toLowerCase().trim()); return t < 0 ? TIER.length : t; };

/** Ranks again by type in the kept order. */
const rerank = (es: WorthEntry[]) => { const n: Record<string, number> = {}; return es.map((e) => ({ ...e, rank: (n[e.type] = (n[e.type] || 0) + 1) })); };

async function main() {
  const only = String(arg('only') || ''), places = String(arg('places') || '').split(',').filter(Boolean);
  const max = Number(arg('max-dollars', '0.5')) || 0.5, apply = process.argv.includes('--apply');
  const docs = (await db().collectionGroup('worth').get()).docs.filter((d) => d.ref.parent.parent?.parent.id === 'gameRecords')
    .filter((d) => (!only || d.ref.parent.parent!.id === only) && (!places.length || places.includes(d.id)))
    .sort((a, b) => (a.ref.parent.parent!.id === 'baldur-s-gate-3' ? 0 : 1) - (b.ref.parent.parent!.id === 'baldur-s-gate-3' ? 0 : 1));
  if (process.argv.includes('--restore-gear')) return restoreGear(docs, apply);
  console.log(`${docs.length} area(s)${apply ? '' : ' (preview: nothing written)'}; stop at $${max.toFixed(2)}.`);
  let areas = 0, dropped = 0, kept = 0;
  for (const d of docs) {
    if (ledgerDollars() >= max - 0.01) { console.log(`Stopped at the $${max.toFixed(2)} cap.`); break; }
    const key = d.ref.parent.parent!.id, slug = d.id, w: any = d.data();
    const entries: WorthEntry[] = w.entries || [], extra: WorthEntry[] = w.fromAnswers || [];
    const all = [...entries, ...extra];
    if (!all.length) continue;
    const game = String(((await db().collection('guides').doc(key).get()).data() as any)?.game || (await RECORDS().doc(key).get()).data()?.game || key);
    let r;
    try { r = await review(game, String(w.placeName || slug), '', all); } catch (e: any) { console.warn(`${key}/${slug}: ${e?.message}`); continue; }
    areas++;
    const keptAll = all.filter((_, i) => r.keep.has(i));
    const trimmed = all.map((e, i) => (r.drop.has(i) ? { ...e, why: r.drop.get(i) } : null)).filter(Boolean) as (WorthEntry & { why: string })[];
    dropped += trimmed.length; kept += keptAll.length;
    console.log(`\n== ${game} / ${w.placeName || slug}: ${all.length} → ${keptAll.length}`);
    all.forEach((e, i) => console.log(`  ${r.drop.has(i) ? '✗' : '✓'} ${line(e).slice(0, 150)}${r.drop.has(i) ? `  — ${r.drop.get(i)}` : ''}`));
    if (!apply) continue;
    // The worth doc: kept entries ranked again; the dropped ones under `trimmed` (with any trimmed before).
    const keptMain = rerank(entries.filter((e) => keptAll.includes(e)));
    const keptExtra = extra.filter((e) => keptAll.includes(e));
    await d.ref.set(JSON.parse(JSON.stringify({ entries: keptMain, ...(extra.length ? { fromAnswers: keptExtra } : {}), trimmed: [...(w.trimmed || []), ...trimmed], reviewedAt: Date.now(), review: 'v1' })), { merge: true });
    // The records: dropped names lose their rank; kept ones take their new rank.
    const snap = await RECORDS().doc(key).collection('records').where('place', '==', slug).get();
    const recs = snap.docs.map((x) => x.data() as GameRecord);
    const out = new Set(trimmed.map((e) => nameKey(e.name)));
    const unranked = recs.map((x) => {
      if (!x.fields?.rank || !out.has(nameKey(x.name))) return x;
      const { rank: _r, ...fields } = x.fields as any;
      const { hash: _h, ...rest } = x as any;
      return finish({ ...rest, fields });
    });
    const next = applyWorth(unranked.map((x) => ({ ...x })), { entries: rerank([...keptMain, ...keptExtra]) });
    const before = new Map(recs.map((x) => [x.id, x.hash]));
    const b = db().batch();
    for (const x of next.filter((x) => before.get(x.id) !== x.hash).slice(0, 400)) b.set(RECORDS().doc(key).collection('records').doc(x.id), { ...x, importedAt: Date.now() });
    await b.commit();
  }
  console.log(`\n${areas} area(s): kept ${kept}, dropped ${dropped}; $${ledgerDollars().toFixed(4)}.`);
  setTimeout(() => process.exit(0), 300);
}
/**
 * --restore-gear (free, no AI): trimmed gear rated Uncommon or better that wasn't a duplicate goes back in the list,
 * the items ordered by rarity (kept ones first within a rarity), and the records take their ranks again.
 */
async function restoreGear(docs: FirebaseFirestore.QueryDocumentSnapshot[], apply: boolean) {
  let n = 0;
  for (const d of docs) {
    const w: any = d.data();
    const trimmed: (WorthEntry & { why?: string })[] = w.trimmed || [];
    const back = trimmed.filter((e) => e.type === 'item' && !plainGear(e) && !/duplicate/i.test(String(e.why || '')));
    if (!back.length) continue;
    n += back.length;
    const key = d.ref.parent.parent!.id;
    console.log(`${key}/${d.id}: back ${back.map((e) => `${e.name} (${e.fields?.rarity})`).join(', ')}`);
    if (!apply) continue;
    const restored = back.map(({ why: _w, ...e }) => e as WorthEntry);
    const items = [...(w.entries || []).filter((e: WorthEntry) => e.type === 'item'), ...restored].map((e, i) => ({ e, i })).sort((a, b) => tierOf(a.e) - tierOf(b.e) || a.i - b.i).map((x) => x.e);
    const entries = rerank([...items, ...(w.entries || []).filter((e: WorthEntry) => e.type !== 'item')]);
    await d.ref.set(JSON.parse(JSON.stringify({ entries, trimmed: trimmed.filter((e) => !back.includes(e)), restoredAt: Date.now() })), { merge: true });
    const snap = await RECORDS().doc(key).collection('records').where('place', '==', d.id).get();
    const recs = snap.docs.map((x) => x.data() as GameRecord);
    const next = applyWorth(recs.map((x) => ({ ...x })), { entries: rerank([...entries, ...(w.fromAnswers || [])]) });
    const before = new Map(recs.map((x) => [x.id, x.hash]));
    const b = db().batch();
    for (const x of next.filter((x) => before.get(x.id) !== x.hash).slice(0, 400)) b.set(RECORDS().doc(key).collection('records').doc(x.id), { ...x, importedAt: Date.now() });
    await b.commit();
  }
  console.log(`${n} item(s) ${apply ? 'restored' : 'to restore (preview)'}.`);
  setTimeout(() => process.exit(0), 300);
}

main().catch((e) => { console.error('worthReview failed:', e?.message || e); process.exit(1); });
