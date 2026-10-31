/**
 * Place names on a chapter's walkthrough steps (owner, Oct 31 2026), for guides whose areas are chapters (Red Dead
 * Redemption 2: "Chapter 2: Horseshoe Overlook"). A place the player visits in several chapters (Valentine) is then not
 * ambiguous: the quest log matches what Locate me sees to the step by its places (questLogView.ts matchDoing), and a
 * place in one chapter only suggests that chapter (areaFromDoing).
 *
 * One searched call per chapter names each step's places from sources; a name is kept only when it is one of the guide's
 * own places (its areas, held place pages included, and its compendium locations) or is written in the step itself.
 * Nothing else on the page changes; a step keeps any places it had. Paid from the November work (novemberWork.ts).
 *
 *   npx tsx scripts/guides/stepPlaces.ts --key red-dead-redemption-2 --slug chapter-2-horseshoe-overlook [--dry]
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, searchesIn, sourcesIn } from './common';

const norm = (s: string) => String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The guide's own place names: its areas (live and held) and its compendium locations. */
async function gazetteer(key: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const add = (n: unknown) => {
    const s = String(n || '').trim();
    // A chapter is a part of the story, not a place.
    if (s && !/^(chapter|epilogue|act|part)\b/i.test(s)) names.set(norm(s), s);
  };
  for (const d of (await db().collection('guides').doc(key).collection('areas').get()).docs) add((d.data() as any).name);
  for (const d of (await db().collection('guideCompendium').doc(key).collection('entities').where('type', '==', 'locations').get()).docs) add((d.data() as any).name);
  return names;
}

/** Each step's places, from sources, checked against the guide's own place names. */
export async function stepPlaces(key: string, slug: string, dry = false): Promise<{ status: string; detail: string }> {
  const ref = db().collection('guides').doc(key).collection('areas').doc(slug);
  const area: any = (await ref.get()).data();
  const steps: any[] = (area?.walkthrough || []).filter((s: any) => s?.id && s?.title);
  if (!steps.length) return { status: 'skipped', detail: 'no walkthrough steps' };
  const info: any = (await db().collection('guides').doc(key).get()).data() || {};
  const game = String(info.game || key);
  const places = await gazetteer(key);
  const prompt =
    `For the video game "${game}", part of the story "${area.name}". Below are the steps of its walkthrough. Search the ` +
    `game's wiki and walkthroughs, then name for each step the in-game places where it happens, as the game's map names ` +
    `them (towns, camps, regions, landmarks, buildings): the most specific first, at most 3. Only places the sources ` +
    `support; leave a step empty rather than guess.\n\n` +
    steps.map((s) => `${s.id} | ${s.title} | ${String(s.text || '').replace(/\s+/g, ' ').slice(0, 500)}`).join('\n') +
    `\n\nReply with one line per step, nothing else: <step id> | <place>; <place>`;
  let res: any = null;
  for (let attempt = 0; attempt < 2 && !(res && searchesIn(res)); attempt++) {
    res = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: (attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : '') + prompt }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
  }
  if (!res || !searchesIn(res) || !sourcesIn(res).length) return { status: 'not done', detail: 'the reply ran no searches or named no sources' };
  const found = new Map<string, string[]>();
  for (const line of String(res.text || '').split('\n')) {
    const m = line.match(/^\s*([\w-]+)\s*\|\s*(.*)$/);
    const st = m && steps.find((s) => s.id === m[1]);
    if (!st) continue;
    const own = ` ${norm(`${st.title} ${st.text || ''}`)} `;
    const keep: string[] = [];
    for (const raw of m![2].split(/[;,]/)) {
      const n = norm(raw);
      if (!n) continue;
      // The guide's own name for it, else the step's own words.
      const name = places.get(n) || (own.includes(` ${n} `) ? raw.trim() : '');
      if (name && !keep.includes(name)) keep.push(name);
    }
    if (keep.length) found.set(st.id, keep.slice(0, 3));
  }
  const changed = steps.filter((s) => (found.get(s.id) || []).some((p) => !(s.places || []).includes(p)));
  const detail = steps.map((s) => `${s.id}: ${(found.get(s.id) || []).join('; ') || '-'}`).join(' | ');
  if (!changed.length) return { status: 'unchanged', detail };
  if (!dry) {
    const walkthrough = (area.walkthrough || []).map((s: any) => (found.has(s?.id) ? { ...s, places: [...new Set([...(s.places || []), ...found.get(s.id)!])].slice(0, 4) } : s));
    await ref.set({ walkthrough, placesAt: Date.now() }, { merge: true });
    // Published with the next nightly run (as the owner's site changes are).
    await db().collection('system').doc('editor').set({ dirtyAt: Date.now() }, { merge: true });
  }
  return { status: dry ? 'dry run' : 'done', detail };
}

async function main() {
  const key = String(arg('key') || 'red-dead-redemption-2');
  const r = await stepPlaces(key, String(arg('slug')), arg('dry') === 'true');
  console.log(`${key}/${arg('slug')}: ${r.status} (${r.detail})`);
  setTimeout(() => process.exit(0), 300);
}
if (/stepPlaces\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('stepPlaces failed:', e?.message || e); process.exit(1); });
