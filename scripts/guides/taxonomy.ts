/**
 * One compendium type per kind of thing. Types pile up from several places: the core taxonomy keeps every older type
 * whose id differs (compendium.ts coreTaxonomy), and each blueprint entity section adds a type with its own id
 * (blueprintBuild.ts). That gave Baldur's Gate 3 both "Companions & Allies" and "Companions & Origin Paths", and RDR2
 * both "Gang Hideouts" and "Gang Hideouts and Camps", with the same entity listed under two of them.
 *
 * When a taxonomy is saved, types whose labels overlap are merged into the first (the newest plan's comes first): their
 * labels share a whole part ("Companions" in "Companions & Allies") once split on "&", "and" and commas and put in the
 * singular, and their tiers agree (or one of them is "other", the default a blueprint section gets). The merged ids are
 * kept as typeAliases (old id → kept id), so a page or a blueprint section that still names an old id finds its type,
 * and every entity has one type.
 *
 *   npx tsx scripts/guides/taxonomy.ts --key baldur-s-gate-3            what a save would merge (reads only)
 *   npx tsx scripts/guides/taxonomy.ts --key baldur-s-gate-3 --apply    merge a stored taxonomy now (no AI; Firestore only)
 */
import { db, arg } from './common';

export type TaxType = { id: string; label: string; description?: string; tier?: string; examples?: string[]; [k: string]: unknown };

const singular = (w: string) => (/sses$/.test(w) ? w.slice(0, -2) : /ies$/.test(w) ? `${w.slice(0, -3)}y` : /[^s]s$/.test(w) ? w.slice(0, -1) : w);

/** A label's parts, normalised: "Notable NPCs & Merchants" → ["notable npc", "merchant"]. */
export function labelParts(label: string): string[] {
  return String(label || '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .split(/\s*(?:&|\+|\/|,|;|\band\b)\s*/)
    .map((seg) => seg.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map(singular).join(' '))
    .filter(Boolean);
}

const tiersAgree = (a?: string, b?: string) => !a || !b || a === b || a === 'other' || b === 'other';

/** Whether two types are the same kind of thing (see the header). */
export function sameKind(a: TaxType, b: TaxType): boolean {
  if (a.id === b.id) return true;
  if (!tiersAgree(a.tier, b.tier)) return false;
  const pa = labelParts(a.label);
  const pb = new Set(labelParts(b.label));
  return pa.some((p) => pb.has(p));
}

/** An id through the aliases (following chains: an alias of an alias), or the id itself. */
export function resolveType(id: string, aliases: Record<string, string> = {}): string {
  let t = id;
  for (let i = 0; i < 10 && aliases[t] && aliases[t] !== t; i++) t = aliases[t];
  return t;
}

/**
 * The taxonomy with overlapping types merged (in list order, the first of each group kept), the alias map (old aliases
 * kept, pointed at the surviving type), and the entity list retyped and listed once each (by slug, first kept).
 */
export function mergeTaxonomy<E extends { slug?: string; type?: string }>(types: TaxType[], entities: E[] = [], oldAliases: Record<string, string> = {}) {
  const kept: TaxType[] = [];
  const aliases: Record<string, string> = {};
  for (const t of types) {
    if (!t?.id) continue;
    const into = kept.find((k) => sameKind(k, t));
    if (!into) { kept.push({ ...t, examples: [...(t.examples || [])] }); continue; }
    if (into.id !== t.id) aliases[t.id] = into.id;
    // The kept type takes the merged one's examples and, when it has only the default tier, its tier.
    into.examples = [...new Set([...(into.examples || []), ...(t.examples || [])])].slice(0, 12);
    if ((!into.tier || into.tier === 'other') && t.tier && t.tier !== 'other') into.tier = t.tier;
    if (!into.description && t.description) into.description = t.description;
  }
  const ids = new Set(kept.map((t) => t.id));
  // Older aliases still point somewhere that exists (through this save's merges); an id that is a type again isn't an alias.
  for (const [from, to] of Object.entries(oldAliases || {})) if (!ids.has(from) && !aliases[from]) aliases[from] = to;
  for (const from of Object.keys(aliases)) {
    const to = resolveType(aliases[from], aliases);
    if (ids.has(to) && to !== from) aliases[from] = to;
    else delete aliases[from];
  }
  const seen = new Set<string>();
  const out = entities
    .filter((e) => !e?.slug || (!seen.has(e.slug) && !!seen.add(e.slug)))
    .map((e) => (e?.type && aliases[e.type] ? { ...e, type: aliases[e.type] } : e));
  return { taxonomy: kept, typeAliases: aliases, entities: out };
}

/** Entity pages whose stored type was merged away: retyped to the kept type (and its label). Returns how many. */
export async function retypeEntityDocs(key: string, taxonomy: TaxType[], aliases: Record<string, string>): Promise<number> {
  const old = Object.keys(aliases);
  if (!old.length) return 0;
  const label = new Map(taxonomy.map((t) => [t.id, t.label]));
  let n = 0;
  for (let i = 0; i < old.length; i += 10) {
    const snap = await db().collection('guideCompendium').doc(key).collection('entities').where('type', 'in', old.slice(i, i + 10)).get();
    for (const d of snap.docs) {
      const to = aliases[String(d.data().type)];
      await d.ref.set({ type: to, typeLabel: label.get(to) || to }, { merge: true });
      n++;
    }
  }
  return n;
}

if (/taxonomy\.ts$/.test(process.argv[1] || '')) {
  (async () => {
    const key = arg('key');
    if (!key || key === 'true') { console.log('Usage: npx tsx scripts/guides/taxonomy.ts --key <guide key> [--apply]   (reads only without --apply)'); process.exit(1); }
    const comp: any = (await db().collection('guideCompendium').doc(key).get()).data() || {};
    const types: TaxType[] = comp.taxonomy || [];
    const r = mergeTaxonomy(types, comp.entities || [], comp.typeAliases || {});
    console.log(`${key}: ${types.length} types → ${r.taxonomy.length}`);
    for (const t of r.taxonomy) {
      const merged = Object.entries(r.typeAliases).filter(([, to]) => to === t.id).map(([from]) => `${types.find((x) => x.id === from)?.label || from} (${from})`);
      console.log(`  ${t.label} (${t.id}, ${t.tier || 'no tier'})${merged.length ? `  ←  ${merged.join(', ')}` : ''}`);
    }
    // Entity pages typed with a merged id (a save retypes them).
    const docs = (await db().collection('guideCompendium').doc(key).collection('entities').get()).docs.map((d) => d.data() as any);
    const moved = docs.filter((e) => r.typeAliases[e.type]);
    console.log(`  entity pages to retype: ${moved.length}${moved.length ? `: ${moved.slice(0, 15).map((e) => `${e.name} (${e.type} → ${r.typeAliases[e.type]})`).join(', ')}${moved.length > 15 ? ', …' : ''}` : ''}`);
    const dupes = (comp.entities || []).length - r.entities.length;
    console.log(`  entity list: ${(comp.entities || []).length} → ${r.entities.length}${dupes ? ` (${dupes} listed twice)` : ''}`);
    if (arg('apply') === 'true' && Object.keys(r.typeAliases).length) {
      await db().collection('guideCompendium').doc(key).set({ taxonomy: r.taxonomy, typeAliases: r.typeAliases, entities: r.entities }, { merge: true });
      console.log(`  applied; ${await retypeEntityDocs(key, r.taxonomy, r.typeAliases)} entity page(s) retyped. Republish the website.`);
    }
    process.exit(0);
  })().catch((e) => { console.error(e?.message || e); process.exit(1); });
}
