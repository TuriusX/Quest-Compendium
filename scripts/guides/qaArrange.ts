/**
 * Compendium pages' answers to players' questions, worked into the page (no search, nothing new written): each
 * sentence of each answer goes, word for word, into the section it belongs to (a "Story and background" part, or the
 * notes), is dropped when the page already says it, or, when it fits no section, stays under a short "Also asked"
 * with its question. The answers were claim-checked like the rest of the page, so moving them adds no unchecked text.
 * The questions and answers stay stored (qa) for the research and the benchmark; the site shows alsoAsked.
 *
 *   npx tsx scripts/guides/qaArrange.ts [--only <guide key>] [--dry]   the live pages, rearranged in place
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, usageScope } from './common';

type QA = { q: string; a: string };
type Story = { heading: string; text: string };
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const sentencesOf = (t: string) => String(t || '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const objOf = (text: string): any => { const t = String(text || '').replace(/```json|```/g, ''); try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return {}; } };

export type Arranged = { story: Story[]; gameplay: Story[]; notes: string[]; alsoAsked: QA[]; moved: number; dropped: number; kept: number };
/** Headings a new "Story and background" part may take, by kind of entity. */
const STORY_HEADS: Record<string, string[]> = {
  person: ['Who they are', 'History with the main character', 'Role in the story', 'Possible fates'],
  boss: ['Who or what it is', 'Role in the story'], place: ['History', 'Story events here'], thing: ['Lore'],
};
/** The "Gameplay" section's parts. */
export const GAMEPLAY_HEADS = ['Recruitment', 'Romance', 'Choices and consequences', 'How to reach it', 'Quest steps', 'Rewards', 'Combat', 'Missables'];
/** A moved sentence stands on its own: no leading "Alternatively," / "However,". */
const standalone = (t: string) => t.replace(/^(Alternatively|However|Additionally|Also|Moreover|Instead|Otherwise|Furthermore|In addition|Likewise),\s*/i, '').replace(/^./, (c) => c.toUpperCase());

/** Where each answer sentence goes: a story part, the notes, nowhere (already on the page), or "Also asked". */
export async function arrangeQA(game: string, name: string, page: { overview: string; story?: Story[]; gameplay?: Story[]; qa?: QA[]; summary: any }, otherText: string, kind = 'person'): Promise<Arranged> {
  const story = (page.story || []).map((s) => ({ ...s }));
  const gameplay = (page.gameplay || []).map((s) => ({ ...s }));
  const storyHeads = STORY_HEADS[kind] || STORY_HEADS.person;
  const notes = [...(page.summary?.notes || [])];
  const qa = page.qa || [];
  const sents = qa.flatMap((x, qi) => sentencesOf(x.a).map((t, si) => ({ id: `A${qi + 1}.${si + 1}`, qi, t })));
  if (!sents.length) return { story, gameplay, notes, alsoAsked: [], moved: 0, dropped: 0, kept: 0 };
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `A compendium page about "${name}" in the video game "${game}". Its sections:`,
      `OVERVIEW: ${page.overview}`,
      ...story.map((s, i) => `S${i + 1} (${s.heading}): ${s.text}`),
      ...gameplay.map((s) => `G (${s.heading}): ${s.text}`),
      `N (notes): ${notes.join(' ') || '(none)'}`,
      `REST OF THE PAGE: ${otherText || '(none)'}`,
      '',
      'Sentences from the page\'s answers to players\' questions. For each, say where it goes:',
      '"dup": the page already says this (anywhere above), even in other words',
      ...story.map((s, i) => `"S${i + 1}": it belongs in the story part "${s.heading}" and adds something new to it`),
      `"NS:<heading>": story or background with no part yet; heading one of: ${storyHeads.join(' | ')}`,
      `"G:<heading>": how it plays (recruiting, romance, choices and their consequences, getting there, quest steps, rewards, combat, missables); heading one of: ${GAMEPLAY_HEADS.join(' | ')}`,
      '"N": a small extra fact that fits none of those (a note)',
      '"X": only if it fits nowhere above',
      ...sents.map((s) => `${s.id} [question: ${qa[s.qi].q}]: ${s.t}`),
      'Reply with JSON only: {"A1.1": "dup", "A1.2": "S2", ...} (every sentence).',
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0, seed: 7, maxOutputTokens: 3000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const where = objOf(String(res?.text || ''));
  let moved = 0, dropped = 0, kept = 0;
  const also = new Map<number, string[]>();
  for (const s of sents) {
    const raw = String(where[s.id] || 'X').trim();
    const w = raw.toUpperCase();
    const si = /^S(\d+)$/.exec(w);
    const t = standalone(s.t);
    const add = (parts: Story[], heading: string) => { const p = parts.find((x) => x.heading.toLowerCase() === heading.toLowerCase()); if (p) p.text = `${p.text.trim()} ${t}`.trim(); else parts.push({ heading, text: t }); moved++; };
    if (w === 'DUP') { dropped++; continue; }
    if (si && story[Number(si[1]) - 1]) { const p = story[Number(si[1]) - 1]; p.text = `${p.text.trim()} ${t}`.trim(); moved++; continue; }
    if (w.startsWith('NS:')) { const h = storyHeads.find((x) => x.toLowerCase() === raw.slice(3).trim().toLowerCase()); if (h) { add(story, h); continue; } }
    if (w.startsWith('G:')) { const h = GAMEPLAY_HEADS.find((x) => x.toLowerCase() === raw.slice(2).trim().toLowerCase()); if (h) { add(gameplay, h); continue; } }
    if (w === 'N') { notes.push(cut(t, 400)); moved++; continue; }
    also.set(s.qi, [...(also.get(s.qi) || []), s.t]); kept++;
  }
  const alsoAsked = [...also].map(([qi, ts]) => ({ q: qa[qi].q, a: ts.join(' ') }));
  // Story parts in their usual order; gameplay parts in the list's order.
  const rank = (h: string) => { const i = storyHeads.indexOf(/^History with /i.test(h) && kind === 'person' ? 'History with the main character' : h); return i < 0 ? 99 : i; };
  story.sort((a, b) => rank(a.heading) - rank(b.heading));
  gameplay.sort((a, b) => GAMEPLAY_HEADS.indexOf(a.heading) - GAMEPLAY_HEADS.indexOf(b.heading));
  return { story, gameplay, notes, alsoAsked, moved, dropped, kept };
}

/** The rest of an entity page's text (for "already on the page"): where to find, missions, shops, places, collectibles. */
export function restOfPage(e: any): string {
  const s = e.summary || {};
  return [
    ...(s.whereToFind || []).map((w: any) => `${w.when || ''} ${w.where}`), s.region, s.where, s.gettingThere,
    ...(s.quests || []).map((x: any) => `${x.name} (${x.kind || ''} ${x.chapter || ''})`), ...(s.shops || []).map((x: any) => `${x.name}: ${x.what || ''}`),
    ...(s.places || []).map((x: any) => `${x.name}: ${x.what || ''}`), ...(s.collectibles || []).map((x: any) => `${x.name}: ${x.where || ''}`), ...(s.services || []),
  ].filter(Boolean).join('; ');
}

async function main() {
  const only = arg('only') && arg('only') !== 'true' ? String(arg('only')) : '';
  const dry = arg('dry') === 'true';
  const scope = { dollars: 0, searches: 0 };
  await usageScope.run(scope, async () => {
    for (const g of (await db().collection('guideCompendium').get()).docs) {
      if (only && g.id !== only) continue;
      const game = String((await db().collection('guides').doc(g.id).get()).data()?.game || g.id);
      for (const d of (await g.ref.collection('entities').where('status', '==', 'published').get()).docs) {
        const e: any = d.data();
        if (!(e.qa || []).length || (e.qaArrangedAt && arg('again') !== 'true')) continue;
        const { entityKind } = await import('./siteText');
        const r = await arrangeQA(game, e.name, e, restOfPage(e), entityKind(e.typeLabel || e.type));
        console.log(`${g.id} / ${e.name}: ${r.moved} sentence(s) worked into the page, ${r.dropped} already there, ${r.kept} kept under "Also asked" (${r.alsoAsked.length} question(s)); story parts ${r.story.map((x) => x.heading).join(', ') || '-'}; gameplay ${r.gameplay.map((x) => x.heading).join(', ') || '-'}`);
        if (!dry) await d.ref.set({ story: r.story, gameplay: r.gameplay, summary: { notes: r.notes }, alsoAsked: r.alsoAsked, qaArrangedAt: Date.now() }, { merge: true });
      }
    }
  });
  console.log(`qaArrange: $${scope.dollars.toFixed(3)}, ${scope.searches} searches.`);
  setTimeout(() => process.exit(0), 300);
}
if (/qaArrange\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('qaArrange failed:', e?.message || e); process.exit(1); });
