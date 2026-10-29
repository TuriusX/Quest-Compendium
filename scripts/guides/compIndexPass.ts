/**
 * The compendium index's facts that the guide's own data doesn't give (owner-approved Oct 28 2026, one pass, $1 hard
 * stop, no search): each character's one-line role and whether they're one of the story's main characters, the region
 * each place is in (Sea of Coronado: New Austin, not "Elsewhere"), and, for a guide whose walkthrough has a long run of
 * pages with no chapters (Witcher 3's 42 base-game pages), where the story moves on (Prologue, Velen, Novigrad...).
 * One Flash call per guide, from the guide's own pages (overviews, regions, page order). Saved on
 * guideCompendium/{key}.index (roles, regions, chapters); publish.ts reads it, and works without it (no role line, the
 * page's own region, the walkthrough's own groups).
 *
 *   npx tsx scripts/guides/compIndexPass.ts [--only <guide key>] [--dry] [--redo]   (PIPELINE_STEP_DOLLARS=1 for the stop)
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, ledgerDollars } from './common';

const SITE = 'https://questcompendium.com';
const LIMIT = Number(process.env.PIPELINE_STEP_DOLLARS || 1);
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = (x: string) => String(x || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const objOf = (text: string): any => { const t = String(text || '').replace(/```json|```/g, ''); try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return {}; } };

/** Kinds of compendium section, from the type's id and label (the same test as publish.ts compKind). */
export const PERSON = /character|companion|npc|notable|people|ally|allies|merchant|villain|cast/i;
export const PLACE = /location|place|settlement|camp|hideout|landmark|town|cit(y|ies)|region|dungeon|area/i;
/** A walkthrough group longer than this is split into story chapters. */
const LONG_GROUP = 20;

async function guideJson(key: string): Promise<any> {
  try { const r = await fetch(`${SITE}/guides/${key}/guide.json`, { cache: 'no-store' } as any); return r.ok ? await r.json() : null; } catch { return null; }
}

async function main() {
  const only = arg('only'), dry = process.argv.includes('--dry'), redo = process.argv.includes('--redo');
  const keys = new Set<string>();
  const comps = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  for (const d of (await db().collection('guideCompendium').get()).docs) comps.set(d.id, d);
  for (const d of (await db().collection('guides').get()).docs) if (!d.id.endsWith('--next')) keys.add(d.id);
  for (const key of [...keys].sort()) {
    if (only && key !== only) continue;
    const comp = comps.get(key);
    if (!redo && (comp?.data() as any)?.index?.at) { console.log(`${key}: done before (--redo to do it again)`); continue; }
    const gj = await guideJson(key);
    const areas: { slug: string; name: string; group?: string; story?: string }[] = gj?.areas || [];
    const ents = comp ? (await comp.ref.collection('entities').get()).docs.map((d) => d.data() as any).filter((e) => e.status === 'published') : [];
    const tax: any[] = (comp?.data() as any)?.taxonomy || [];
    const people = ents.filter((e) => PERSON.test(`${e.type} ${e.typeLabel}`));
    // Places: the place sections' pages and their listed examples (gang camps, settlements), each once by name.
    const placeNames = new Map<string, { name: string; text: string }>();
    const areaDocs = new Map<string, any>();
    const needAreas = areas.length && (ents.length || areas.some((a, i) => areas.filter((b) => (b.group || '') === (a.group || '')).length > LONG_GROUP && i >= 0));
    if (needAreas) for (const d of (await db().collection('guides').doc(key).collection('areas').get()).docs) areaDocs.set(String((d.data() as any).slug || d.id), d.data());
    const areaByName = new Map(areas.map((a) => [norm(a.name), areaDocs.get(a.slug)]));
    for (const e of ents.filter((x) => PLACE.test(`${x.type} ${x.typeLabel}`))) placeNames.set(norm(e.name), { name: e.name, text: cut(`${e.summary?.region || ''} ${e.overview || ''}`, 300) });
    for (const t of tax.filter((x) => PLACE.test(`${x.id} ${x.label}`))) for (const x of (t.examples || []) as string[]) {
      if (placeNames.has(norm(x))) continue;
      const a = areaByName.get(norm(x)), e = ents.find((y) => norm(y.name) === norm(x));
      placeNames.set(norm(x), { name: x, text: cut(a ? `${a.info?.region || ''} ${a.overview || a.story || ''}` : e ? `${e.summary?.region || ''} ${e.overview || ''}` : '', 300) });
    }
    // Long walkthrough groups with no chapters of their own.
    const groups = new Map<string, typeof areas>();
    for (const a of areas) groups.set(a.group || '', [...(groups.get(a.group || '') || []), a]);
    const long = [...groups.entries()].filter(([, xs]) => xs.length > LONG_GROUP && !xs.some((a) => /^(chapter|prologue|epilogue|act|part|episode|day)\b/i.test(a.name)));
    if (!people.length && !placeNames.size && !long.length) continue;
    if (ledgerDollars() >= LIMIT - 0.02) { console.log(`Stopped: $${ledgerDollars().toFixed(4)} spent of the $${LIMIT.toFixed(2)} limit.`); break; }

    const game = gj?.game || key;
    const parts: string[] = [];
    if (people.length) parts.push(`CHARACTERS (slug | name | what the guide's page says):\n${people.map((e) => `${e.slug} | ${e.displayName || e.name} | ${cut(e.overview, 450)}`).join('\n')}`);
    if (placeNames.size) parts.push(`PLACES (name | what the guide says):\n${[...placeNames.values()].map((p) => `${p.name} | ${p.text}`).join('\n')}`);
    if (long.length) parts.push(`WALKTHROUGH RUNS (pages in the order the player reaches them; group | slug | page | region):\n${long.map(([g, xs]) => xs.map((a) => `${g || '-'} | ${a.slug} | ${a.name} | ${cut(areaDocs.get(a.slug)?.info?.region, 80)}`).join('\n')).join('\n')}`);
    const prompt =
      `You are organising the index page of a players' guide to ${game}. Use the guide's text below and what you know of the game; no searching. Reply with JSON only.\n\n` +
      (people.length ? `For every CHARACTER: "role", one plain line under 60 characters saying who they are in the story (e.g. "Leader of the Van der Linde gang", "Geralt's adopted daughter", "Mercenary and potential companion"), with no spoilers of deaths or twists; and "main": true only for the story's central characters (the protagonist(s), the main companions or gang members, the main antagonists), usually 5 to 12 of them, false for the rest.\n` : '') +
      (placeNames.size ? `For every PLACE: "region", the game's own name for the large map region it is in (a state, province, country or island group, e.g. "New Austin", "Velen", "Toussaint"), short, the same spelling every time; places in the same region must get exactly the same region text.\n` : '') +
      (long.length ? `For the WALKTHROUGH RUNS: split each group into story chapters, consecutive pages where the story stays in one part of the world (e.g. "Prologue", "Velen", "Novigrad", "Skellige"); a short detour stays in the chapter around it; 3 to 8 chapters per group. Give each chapter's name and its first page's slug.\n` : '') +
      `\nShape: {${people.length ? '"characters":[{"slug":"","role":"","main":false}],' : ''}${placeNames.size ? '"places":[{"name":"","region":""}],' : ''}${long.length ? '"chapters":[{"group":"","name":"","first":""}]' : ''}}\n\n${parts.join('\n\n')}`;
    let j: any = {};
    try {
      const res: any = await gemini().models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: prompt }] }], config: { temperature: 0.2, maxOutputTokens: 8000, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
      j = objOf(res.text);
    } catch (e: any) { console.log(`${key}: no reply (${e?.message})`); continue; }
    // Only what fits: known slugs and names, short lines, chapters whose first page is in the group, in page order.
    const roles: Record<string, { role: string; main: boolean }> = {};
    for (const c of j.characters || []) if (people.some((e) => e.slug === c.slug) && c.role) roles[c.slug] = { role: cut(c.role, 70).replace(/\.$/, ''), main: c.main === true };
    const regions: Record<string, string> = {};
    for (const p of j.places || []) if (placeNames.has(norm(p.name)) && p.region) regions[norm(p.name)] = cut(p.region, 40);
    const chapters: { group: string; name: string; first: string }[] = [];
    for (const [g, xs] of long) {
      const at = (s: string) => xs.findIndex((a) => a.slug === s);
      const cs = (j.chapters || []).filter((c: any) => String(c.group || '') === (g || '-') || String(c.group || '') === g).filter((c: any) => at(c.first) >= 0 && c.name).sort((a: any, b: any) => at(a.first) - at(b.first));
      if (cs.length >= 2) chapters.push(...cs.map((c: any, i: number) => ({ group: g, name: cut(c.name, 40), first: i === 0 ? xs[0].slug : String(c.first) })));
    }
    const index = { roles, regions, chapters, at: Date.now(), model: MODEL };
    console.log(`${key}: ${Object.keys(roles).length}/${people.length} roles (${Object.values(roles).filter((r) => r.main).length} main), ${Object.keys(regions).length}/${placeNames.size} regions, ${chapters.length} chapters · $${ledgerDollars().toFixed(4)} so far`);
    if (dry) { console.log(`  main: ${Object.entries(roles).filter(([, r]) => r.main).map(([s]) => s).join(", ")}
  regions: ${JSON.stringify(regions)}
  chapters: ${chapters.map((c) => `${c.name}@${c.first}`).join(", ")}`); continue; }
    await db().collection('guideCompendium').doc(key).set({ index }, { merge: true });
  }
  console.log(`Spent $${ledgerDollars().toFixed(4)} of the $${LIMIT.toFixed(2)} limit.`);
  process.exit(0);
}
main();
