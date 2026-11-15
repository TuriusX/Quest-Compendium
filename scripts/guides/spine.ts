/**
 * A game's story order (the spine; owner, Nov 15 2026, plan "One database for the app and the site"). The main story in
 * acts, each a list of beats (what the player does, with the areas it covers) and points of no return (what the player
 * does that locks things out for good). Every missable fact is then linked to the point of no return that loses it,
 * and every fact gets the beat it becomes reachable at (the first beat that covers its area), so the app can warn
 * before the next point of no return and the site can show each act in order.
 *
 * Built with Flash from what the database already holds, no searches:
 *   1. the spine: the guide's areas in outline order, each with its place summary, walkthrough step names and the
 *      lockout wording of its missables, plus the game's points of no return (records of type noreturn);
 *   2. the links, one call per act: each missable of that act's areas against the points of no return (its own act's
 *      and every later one), from its lockout wording. A missable with no lockout wording, or wording that names no
 *      event, is "unknown" and shows as being checked.
 *
 * Saved in gameRecords/{key}/spine/main { acts, at, dollars } and gameRecords/{key}/spine/links { links: { recordId:
 * { lost, sig } } }. A link stays while the record's lockout wording is unchanged (sig); --relink redoes them.
 *
 *   npx tsx scripts/guides/spine.ts --only KEY [--max-dollars 1] [--relink] [--dry-run]
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, ledgerDollars } from './common';
import { RECORDS } from './recordsImport';
import { contentSig, type GameRecord } from './records';

export type SpineStep = { id: string; kind: 'beat' | 'lock'; name: string; text: string; areas?: string[] };
export type SpineAct = { id: string; name: string; steps: SpineStep[] };
export type Spine = { acts: SpineAct[]; at: number; dollars: number; unplaced?: string[] };
export type SpineLink = { lost: string; if?: string; sig: string };

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const f = (r: GameRecord, k: string) => { const v = r.fields?.[k]; return Array.isArray(v) ? v.join('; ') : String(v || ''); };
const json = (t: string): any => { try { const s = String(t || ''); return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); } catch { return null; } };
export const SPINE = (key: string) => RECORDS().doc(key).collection('spine');
/** The missable facts the spine links: items and secrets marked missable, and anything with lockout wording. */
export const isMissable = (r: GameRecord) => r.status !== 'disputed' && (((r.type === 'item' || r.type === 'secret' || r.type === 'checklist') && (!!(r as any).missable || !!f(r, 'lockout'))) || (r.type === 'achievement' && !!(r as any).missable));
const lockSig = (r: GameRecord) => contentSig({ ...r, fields: { lockout: f(r, 'lockout'), where: f(r, 'where') } } as any);

async function call(prompt: string, maxOut = 12000, thinking: ThinkingLevel = ThinkingLevel.LOW): Promise<any> {
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: maxOut, thinkingConfig: { thinkingLevel: thinking } },
  });
  return json(String(res?.text || ''));
}

/** Step 1: the acts, beats and points of no return. */
async function buildSpine(game: string, areas: { slug: string; name: string }[], recs: GameRecord[]): Promise<SpineAct[]> {
  const byPlace = new Map<string, GameRecord[]>();
  for (const r of recs) if (r.place) byPlace.set(r.place, [...(byPlace.get(r.place) || []), r]);
  const areaLines = areas.map((a, i) => {
    const rs = byPlace.get(a.slug) || [];
    const place = rs.find((r) => r.type === 'place');
    const steps = rs.filter((r) => r.type === 'step').sort((x, y) => (x.order ?? 0) - (y.order ?? 0)).map((r) => cut(r.name, 60));
    const locks = [...new Set(rs.filter(isMissable).map((r) => cut(f(r, 'lockout'), 90)).filter(Boolean))].slice(0, 8);
    return `${i + 1}. [${a.slug}] ${a.name}${place?.short ? `: ${cut(place.short, 160)}` : ''}${steps.length ? `\n   steps: ${steps.join(' / ')}` : ''}${locks.length ? `\n   what loses its missables: ${locks.join(' | ')}` : ''}`;
  }).join('\n');
  const noreturn = recs.filter((r) => r.type === 'noreturn' && r.status !== 'disputed').map((r) => `- ${cut(r.name, 100)}: ${cut(f(r, 'lost') || f(r, 'lockout') || r.short, 220)}`).join('\n');
  const prompt = [
    `You are laying out the main story of the video game "${game}" in order, for a completionist guide. Below are the guide's areas in the guide's order, each with its walkthrough steps and what loses the missable items found there, and then the game's known points of no return.`,
    '',
    'Return JSON: {"acts":[{"name":"Act 1","steps":[{"kind":"beat","name":"...","text":"...","areas":["slug",...]},{"kind":"lock","name":"...","text":"..."}]}]}',
    '',
    'Rules:',
    "- acts: the game's own big divisions (acts, chapters, discs, parts), in story order, named the way the game or its players name them. Fold a short prologue into the first act unless the game treats it as its own part.",
    '- beat: a main story milestone, said as what the player does ("Escape the Nautiloid", "Find a healer"), 3 to 10 per act, in the order a typical first playthrough meets them. text: one short sentence. areas: the slugs (from the brackets) of the areas this beat takes the player through.',
    '- Every area slug appears in exactly one beat. An optional area goes with the beat it is usually done during. Keep the slugs exactly as given.',
    '- lock: a point of no return, placed between the beats where it happens: something the player does after which things are gone for good. Name it as that event ("Entering the Helm", "The first goblin leader dies", "Leaving Act 1"); text: what it locks out, in general, one sentence.',
    '- Make a lock for each known point of no return below that belongs to the main story. Also make one for every event that the "what loses its missables" wording names for two or more items: a quest or questline resolving, a settlement or camp turning hostile, a group of characters or merchants leaving, an area sealing or being destroyed. Merge wordings of the same event into one lock, named as the event. Aim for 4 to 12 locks per act.',
    '- A condition that a player only meets by their own choice against one character (killing, shoving or silencing someone, failing a check, a dialogue choice) is not a lock.',
    '- Every act ends with a lock for leaving it, unless the player can freely go back.',
    "- Only events the material below names. Don't invent quests, places or events.",
    '',
    'AREAS:',
    areaLines,
    '',
    'KNOWN POINTS OF NO RETURN:',
    noreturn || '(none listed)',
  ].join('\n');
  const j = await call(prompt, 16000);
  const acts: SpineAct[] = [];
  for (const [ai, a] of (Array.isArray(j?.acts) ? j.acts : []).entries()) {
    const id = `a${ai + 1}`;
    const steps: SpineStep[] = [];
    let b = 0, l = 0;
    for (const s of Array.isArray(a?.steps) ? a.steps : []) {
      if (!s?.name) continue;
      const kind = s.kind === 'lock' ? 'lock' : 'beat';
      steps.push({ id: kind === 'lock' ? `${id}l${++l}` : `${id}b${++b}`, kind, name: cut(s.name, 90), text: cut(s.text, 240), ...(kind === 'beat' ? { areas: (Array.isArray(s.areas) ? s.areas : []).map(String) } : {}) });
    }
    if (steps.length) acts.push({ id, name: cut(a.name, 40) || `Part ${ai + 1}`, steps });
  }
  return acts;
}

/** Step 2: each missable of one act against the points of no return from that act on. */
async function linkAct(game: string, act: SpineAct, later: SpineStep[], recs: GameRecord[]): Promise<Record<string, { lost: string; if?: string }>> {
  const locks = [...act.steps.filter((s) => s.kind === 'lock'), ...later];
  if (!recs.length || !locks.length) return {};
  const out: Record<string, { lost: string; if?: string }> = {};
  const batches: GameRecord[][] = [];
  for (let i = 0; i < recs.length; i += 30) batches.push(recs.slice(i, i + 30));
  await Promise.all(batches.map(async (batch) => {
    const prompt = [
      `In the video game "${game}", ${act.name}: below are points of no return (id: event: what it locks out) and missable items (id: name, where it is, and what loses it).`,
      'For each item, decide what loses it:',
      '- "lost": the ONE point of no return whose event the "loses it" wording describes (also when the wording names a consequence of that event, such as a merchant leaving once a questline ends). If the wording only says when, the first point of no return after which it is gone.',
      '- "if": when the wording also (or only) names a condition the player causes against one character or object (killing, shoving or silencing someone, destroying something, a dialogue choice, a failed check), that condition in a few words, e.g. "if Grat is killed", "if Gekh is shoved into the abyss". Otherwise leave it out.',
      '- "lost" is "unknown" only when the item has no wording, or the wording names nothing but such a condition.',
      '- An ACHIEVEMENT (marked so) has no "loses it" wording: from how it is earned, pick the point of no return after which it can no longer be earned in this playthrough; "unknown" if none of them ends it (only a choice or a condition does).',
      'Return JSON: {"links":{"item id":{"lost":"lock id or unknown","if":"condition"}, ...}} with every item id.',
      '',
      'POINTS OF NO RETURN:',
      ...locks.map((s) => `${s.id}: ${s.name}: ${s.text}`),
      '',
      'ITEMS:',
      ...batch.map((r) => r.type === 'achievement'
        ? `${r.id}: ACHIEVEMENT ${cut(r.name, 70)} | earned: ${cut(f(r, 'how') || r.short, 220)}`
        : `${r.id}: ${cut(r.name, 70)} | where: ${cut(f(r, 'where'), 120)} | loses it: ${cut(f(r, 'lockout'), 200) || '(no wording)'}`),
    ].join('\n');
    const j = await call(prompt, 12000);
    const ids = new Set(locks.map((s) => s.id));
    for (const r of batch) {
      const v = j?.links?.[r.id] || {};
      const lost = String((typeof v === 'string' ? v : v.lost) || 'unknown');
      const cond = typeof v === 'object' ? cut(v.if, 160) : '';
      out[r.id] = { lost: ids.has(lost) ? lost : 'unknown', ...(cond ? { if: cond } : {}) };
    }
  }));
  return out;
}

/** The beat a place's facts become reachable at: the first beat that covers the place. */
export function beatOfPlace(spine: Spine): Map<string, SpineStep> {
  const m = new Map<string, SpineStep>();
  for (const a of spine.acts) for (const s of a.steps) for (const p of s.areas || []) if (!m.has(p)) m.set(p, s);
  return m;
}

async function main() {
  const key = String(arg('only') || '');
  if (!key) throw new Error('--only KEY is required');
  const max = Number(arg('max-dollars', '1')) || 1;
  const dry = process.argv.includes('--dry-run'), relink = process.argv.includes('--relink');
  const g: any = (await db().collection('guides').doc(key).get()).data() || {};
  const game = String(g.game || key);
  const published = new Map((await db().collection('guides').doc(key).collection('areas').where('status', '==', 'published').get()).docs.map((d) => [d.id, d.data() as any]));
  const outline: { slug: string; name: string }[] = (Array.isArray(g.areas) ? g.areas : []).map((x: any) => ({ slug: String(x.slug || x), name: String(x.name || published.get(x.slug || x)?.name || x.slug || x) })).filter((x: any) => published.has(x.slug));
  const recs = (await RECORDS().doc(key).collection('records').get()).docs.map((d) => d.data() as GameRecord);
  const miss = recs.filter((r) => r.place && isMissable(r));
  console.log(`${game}: ${outline.length} areas in order, ${recs.length} records, ${miss.length} missables, ${recs.filter((r) => r.type === 'noreturn').length} points of no return.`);
  if (dry) return void setTimeout(() => process.exit(0), 200);

  let spine: Spine | null = (await SPINE(key).doc('main').get()).data() as Spine | undefined || null;
  if (!spine || process.argv.includes('--rebuild')) {
    const acts = await buildSpine(game, outline, recs);
    if (!acts.length) throw new Error('no acts came back');
    const placed = new Set(acts.flatMap((a) => a.steps.flatMap((s) => s.areas || [])));
    const known = new Set(outline.map((o) => o.slug));
    for (const a of acts) for (const s of a.steps) if (s.areas) s.areas = s.areas.filter((x) => known.has(x));
    spine = { acts, at: Date.now(), dollars: Math.round(ledgerDollars() * 10000) / 10000, unplaced: outline.map((o) => o.slug).filter((s) => !placed.has(s)) };
    await SPINE(key).doc('main').set(spine);
    console.log(`Spine: ${acts.length} act(s), ${acts.reduce((n, a) => n + a.steps.filter((s) => s.kind === 'beat').length, 0)} beats, ${acts.reduce((n, a) => n + a.steps.filter((s) => s.kind === 'lock').length, 0)} points of no return; ${spine.unplaced?.length || 0} area(s) not placed.`);
  }

  const have: Record<string, SpineLink> = relink ? {} : (((await SPINE(key).doc('links').get()).data() as any)?.links || {});
  const beat = beatOfPlace(spine);
  const actOf = new Map<string, number>();
  spine.acts.forEach((a, i) => a.steps.forEach((s) => (s.areas || []).forEach((p) => actOf.set(p, i))));
  const links: Record<string, SpineLink> = {};
  for (const [i, act] of spine.acts.entries()) {
    if (ledgerDollars() >= max - 0.05) { console.log(`Stopped at the $${max.toFixed(2)} cap.`); break; }
    const mine = miss.filter((r) => actOf.get(r.place!) === i);
    const todo = mine.filter((r) => have[r.id]?.sig !== lockSig(r));
    for (const r of mine) if (have[r.id]?.sig === lockSig(r)) links[r.id] = have[r.id];
    const later = spine.acts.slice(i + 1).flatMap((a) => a.steps.filter((s) => s.kind === 'lock'));
    const got = await linkAct(game, act, later, todo);
    for (const r of todo) links[r.id] = { lost: got[r.id]?.lost || 'unknown', ...(got[r.id]?.if ? { if: got[r.id].if } : {}), sig: lockSig(r) };
    const n = mine.length, known = mine.filter((r) => links[r.id] && links[r.id].lost !== 'unknown').length;
    const cond = mine.filter((r) => links[r.id]?.lost === 'unknown' && links[r.id]?.if).length;
    console.log(`${act.name}: ${n} missable(s): ${known} linked to a point of no return, ${cond} lost only by a condition, ${n - known - cond} unknown.`);
    await SPINE(key).doc('links').set({ links: { ...have, ...links }, at: Date.now() });
  }
  await SPINE(key).doc('links').set({ links, at: Date.now() });
  const noArea = miss.filter((r) => !beat.has(r.place!)).length;
  console.log(`Linked ${Object.keys(links).length} missable(s)${noArea ? `; ${noArea} in areas the spine didn't place` : ''}; $${ledgerDollars().toFixed(4)}.`);
  setTimeout(() => process.exit(0), 300);
}
if (/spine\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('spine failed:', e?.message || e); process.exit(1); });
