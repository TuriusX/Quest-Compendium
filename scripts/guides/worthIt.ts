/**
 * What's worth it in each area (owner, Nov 15 2026): the guides listed mostly missables, not the gear, spells, quests
 * and people a player actually wants from a place. One searched call per area asks for that, ranked: the standout gear
 * and spells (rarity, uniqueness), the quests that start there (giver, reward), the people worth talking to and why,
 * and key things to do. Only lines a trusted source backs are kept (Google's grounding, as recordsLocate.ts), and the
 * sourced text goes into the area's evidence pack, so the fact check can confirm them later without a new search.
 *
 * Saved in gameRecords/{key}/worth/{slug} { entries, at, dollars }; recordsImport.ts lays it over the records
 * (records.ts applyWorth): a thing the page has gets its rank and why, the rest come in as new records, unconfirmed.
 * Missable stays a flag on whatever has a lockout.
 *
 *   npx tsx scripts/guides/worthIt.ts --only KEY [--act a1] [--places slug,slug] [--max-dollars 1.5] [--redo] [--dry-run]
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, ledgerDollars, searchesIn } from './common';
import { supportedSegments, trustedSites, type Evidence, type EvidencePack } from './claimCheck';
import { RECORDS } from './recordsImport';
import { SPINE } from './spine';
import type { GameRecord, WorthEntry } from './records';

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFKC').replace(/[‘’ʼ`]/g, "'").replace(/[^a-z0-9']+/g, ' ').trim();
const TYPE: Record<string, WorthEntry['type']> = { ITEM: 'item', SPELL: 'item', QUEST: 'quest', NPC: 'npc', DO: 'tip' };

function prompt(game: string, place: string, act: string, have: GameRecord[]): string {
  const known = have.filter((r) => ['item', 'secret', 'npc', 'quest', 'shop'].includes(r.type)).map((r) => cut(r.name, 60));
  return [
    `In the video game "${game}" (${act}), the area "${place}". A player wants to know what is worth getting and doing here, not only what can be missed. Search the game's wikis and guides (at most four searches), then list:`,
    '- ITEM: the best gear found or bought here (weapons, armor, accessories), most valuable first, at most 8. Rarity and what makes it good.',
    '- SPELL: spell scrolls, books or abilities worth having that are found here, at most 3.',
    '- QUEST: every quest that starts here: who gives it, where, and its notable reward.',
    '- NPC: the people here worth talking to, at most 6, and why (a quest, a merchant, a companion, information, a reward).',
    '- DO: at most 4 key things to do here that a player should not skip (not already covered above).',
    '',
    'One line each, in exactly this form (fields separated by " | ", a field left empty if no source says it):',
    'ITEM | name | rarity | why it is worth it (one short sentence) | where exactly in this area | how to get it',
    'SPELL | name | level or rarity | why | where | how',
    'QUEST | name | giver | where it starts | reward',
    'NPC | name | where in the area | why talk to them',
    'DO | the thing to do, short | why',
    '',
    'Only things in this area. Only what the sources say; leave out anything they do not. No headings, no other text.',
    known.length ? `The guide already lists: ${known.join(', ')}. Include those too if they belong in the list (so they get ranked), with the same names.` : '',
  ].join('\n');
}

/** The lines of the answer that a trusted source backs, as entries. */
function parse(text: string, segs: { text: string; sites: string[] }[]): { entries: WorthEntry[]; dropped: number } {
  const entries: WorthEntry[] = [];
  let dropped = 0;
  const rank: Record<string, number> = {};
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^[*\-\s]+/, '').replace(/\*\*/g, '').trim();
    const parts = line.split('|').map((s) => s.trim());
    const kind = parts[0]?.toUpperCase();
    if (!TYPE[kind] || !parts[1]) continue;
    // Backed: a grounded segment overlaps this line (it holds the name, or the line holds the segment).
    const nl = norm(line), nn = norm(parts[1]);
    const sites = [...new Set(segs.filter((s) => { const ns = norm(s.text); return ns.length >= 12 && (nl.includes(ns) || ns.includes(nn)); }).flatMap((s) => trustedSites(s.sites)))];
    if (!sites.length) { dropped++; continue; }
    const r = (rank[kind] = (rank[kind] || 0) + 1);
    const p = parts.map((s) => cut(s, 300));
    const fields: Record<string, string> =
      kind === 'ITEM' || kind === 'SPELL' ? { kind: kind === 'SPELL' ? 'spell' : 'gear', rarity: p[2], why: p[3], where: p[4], how: p[5] } :
      kind === 'QUEST' ? { giver: p[2], startsAt: p[3], rewards: p[4], text: `${p[1]} starts here${p[2] ? `, given by ${p[2]}` : ''}${p[3] ? ` (${p[3]})` : ''}${p[4] ? `; reward: ${p[4]}` : ''}.` } :
      kind === 'NPC' ? { where: p[2], why: p[3], text: `${p[1]}${p[2] ? ` (${p[2]})` : ''}: ${p[3]}` } :
      { why: p[2], text: `${p[1]}${p[2] ? `: ${p[2]}` : ''}` };
    for (const k of Object.keys(fields)) if (!fields[k]) delete fields[k];
    entries.push({ type: TYPE[kind], name: cut(p[1], 90), rank: r, fields, sources: sites.slice(0, 4) });
  }
  return { entries, dropped };
}

async function main() {
  const key = String(arg('only') || '');
  if (!key) throw new Error('--only KEY is required');
  const max = Number(arg('max-dollars', '1.5')) || 1.5;
  const dry = process.argv.includes('--dry-run'), redo = process.argv.includes('--redo');
  const g: any = (await db().collection('guides').doc(key).get()).data() || {};
  const game = String(g.game || key);
  const spine: any = (await SPINE(key).doc('main').get()).data();
  const actId = String(arg('act') || '');
  const acts: any[] = spine?.acts || [];
  const act = acts.find((a) => a.id === actId);
  const only = String(arg('places') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const actOf = new Map<string, string>(); for (const a of acts) for (const s of a.steps) for (const p of s.areas || []) actOf.set(p, a.name);
  const places: string[] = only.length ? only : act ? act.steps.flatMap((s: any) => s.areas || []) : [];
  if (!places.length) throw new Error('give --act (from the story order) or --places');
  const recs = (await RECORDS().doc(key).collection('records').get()).docs.map((d) => d.data() as GameRecord);
  const done = new Set((await RECORDS().doc(key).collection('worth').get()).docs.map((d) => d.id));
  const todo = places.filter((p) => redo || !done.has(p));
  console.log(`${game}: ${todo.length} area(s) to do of ${places.length}.`);
  if (dry) return void setTimeout(() => process.exit(0), 200);
  let n = 0;
  for (let i = 0; i < todo.length; i += 4) {
    if (ledgerDollars() >= max - 0.12) { console.log(`Stopped at the $${max.toFixed(2)} cap.`); break; }
    await Promise.all(todo.slice(i, i + 4).map(async (slug) => {
      const have = recs.filter((r) => r.place === slug);
      const place = have.find((r) => r.type === 'place')?.name || have[0]?.placeName || slug;
      const before = ledgerDollars();
      try {
        const res: any = await gemini().models.generateContent({
          model: MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt(game, place, actOf.get(slug) || '', have) }] }],
          config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 6000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        });
        const segs = supportedSegments(res).map((x) => ({ ...x, sites: x.sites.filter((s) => !/questcompendium/i.test(s)) })).filter((x) => x.sites.length);
        const { entries, dropped } = parse(String(res?.text || ''), segs);
        // The sourced text into the area's evidence pack (the fact check reads it without searching again).
        const ref = db().collection('evidencePacks').doc(`${key}__${slug}`);
        const pack: EvidencePack = ((await ref.get()).data() as EvidencePack | undefined) || { key, slug, game, area: place, evidence: [], sites: [], servicesComplete: false, searches: 0, at: 0 } as any;
        const evidence: Evidence[] = [...(pack.evidence || [])];
        const sites = new Set<string>(pack.sites || []);
        for (const s of segs) { if (evidence.some((e) => e.text === s.text)) continue; evidence.push({ id: `e${evidence.length + 1}`, text: cut(s.text, 400), sources: s.sites.slice(0, 4), topic: 'worth' } as any); s.sites.forEach((x) => sites.add(x)); }
        await ref.set(JSON.parse(JSON.stringify({ ...pack, evidence, sites: [...sites], searches: (pack.searches || 0) + searchesIn(res), at: Date.now() })));
        await RECORDS().doc(key).collection('worth').doc(slug).set(JSON.parse(JSON.stringify({ entries, dropped, at: Date.now(), dollars: Math.round((ledgerDollars() - before) * 10000) / 10000 })));
        const c = (t: string) => entries.filter((e) => e.type === t).length;
        console.log(`${slug}: ${c('item')} gear/spells, ${c('quest')} quests, ${c('npc')} people, ${c('tip')} to do; ${dropped} unsourced line(s) left out.`);
        n++;
      } catch (e: any) { console.warn(`${slug} skipped: ${e?.message}`); }
    }));
  }
  console.log(`Done ${n} area(s); $${ledgerDollars().toFixed(4)}.`);
  setTimeout(() => process.exit(0), 300);
}
if (/worthIt\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('worthIt failed:', e?.message || e); process.exit(1); });
