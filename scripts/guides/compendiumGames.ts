/**
 * Compendium pages for more games in one go (owner, Nov 19 2026: get the site improved today). For each guide: its
 * compendium plan (coreTaxonomy: the game's entity types and important entities, searched) when it has none, then the
 * most important entities' pages (entityV2, the evidence method with the review; a held page isn't shown), people,
 * locations and bosses first, by rank. Pages already built are skipped.
 *
 *   npx tsx scripts/guides/compendiumGames.ts --keys fallout-4,cyberpunk-2077 [--per-game 15] [--max-dollars 25] [--dry]
 */
import { db, arg, ledgerDollars } from './common';

const ENTITY_WORST = 0.35;
const TIER_ORDER: Record<string, number> = { people: 0, locations: 1, bosses: 2, other: 3, collectibles: 4 };

async function main() {
  const keys = String(arg('keys') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const per = Number(arg('per-game', '15')) || 15;
  const max = Number(arg('max-dollars', '10')) || 10;
  const dry = arg('dry') === 'true';
  const { coreTaxonomy, buildEntity } = await import('./compendium');
  let built = 0, live = 0;
  outer: for (const key of keys) {
    const cref = db().collection('guideCompendium').doc(key);
    let c: any = (await cref.get()).data() || {};
    if (!c.taxonomy?.length || !c.entities?.length) {
      if (dry) { console.log(`${key}: no compendium plan yet (would make one, about $0.05)`); continue; }
      if (ledgerDollars() + 0.2 > max) break;
      await coreTaxonomy(key);
      c = (await cref.get()).data() || {};
    }
    const tierOf = new Map<string, string>((c.taxonomy || []).map((t: any) => [t.id, t.tier || 'other']));
    const have = new Set((await cref.collection('entities').select().get()).docs.map((d) => d.id));
    // An entity whose address a guide page already has is left out (same URL: /guides/{key}/{slug}/), as demandEntities does.
    const areaSlugs = new Set((await db().collection('guides').doc(key).collection('areas').select().get()).docs.map((d) => d.id));
    const todo = ((c.entities || []) as any[])
      .filter((e) => e?.name && e.slug && !have.has(e.slug) && !areaSlugs.has(e.slug))
      .sort((a, b) => (TIER_ORDER[tierOf.get(a.type) || 'other'] ?? 3) - (TIER_ORDER[tierOf.get(b.type) || 'other'] ?? 3) || (Number(a.rank) || 99) - (Number(b.rank) || 99))
      .slice(0, per);
    console.log(`${key}: ${(c.entities || []).length} planned, ${have.size} built; next ${todo.length}: ${todo.slice(0, 8).map((e) => e.name).join(', ')}`);
    if (dry) continue;
    for (const e of todo) {
      if (ledgerDollars() + ENTITY_WORST > max) { console.log(`stopped at $${ledgerDollars().toFixed(2)} (the next page could pass $${max})`); break outer; }
      try {
        const r = await buildEntity(key, e.name, { type: e.type });
        built++;
        if (r.status === 'published') live++;
        console.log(`  ${e.name}: ${r.status}${r.score !== undefined ? ` ${r.score}` : ''}, $${Number(r.dollars || 0).toFixed(3)}`);
      } catch (err: any) {
        console.log(`  ${e.name}: error ${String(err?.message || err).slice(0, 120)}`);
        if (/search day limit/i.test(String(err?.message))) break outer;
      }
    }
  }
  console.log(`\nCompendium: ${built} page(s) built, ${live} live; $${ledgerDollars().toFixed(3)} spent.`);
  setTimeout(() => process.exit(0), 300);
}

if (/compendiumGames\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('compendiumGames failed:', e?.message || e); process.exit(1); });
