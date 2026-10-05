/**
 * Search queries answered: the targeted repair from the weekly Search Console check (scripts/pipeline/searchConsole.ts,
 * its plan in system/searchConsole). For each planned page of a guide, the entries that answer a top search vaguely are
 * rewritten and missing answers are added, with the searches passed to the writer as what players are looking for.
 * The answer itself gets better: never search phrases or keyword lists in the text. Pages ranking 5-20 with high
 * impressions also get a clearer page title and description (seoTitle / seoDescription, used by publish.ts).
 *
 * Used by repair.ts --action queries (staged copy, then the review gate). Searched for checked pages, pages of games
 * past the quick model's cutoff and the 5-20 pages (only a reply that searched and names its sources is used); quick
 * otherwise.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, searchesIn, sourcesIn, stageKey, MISSABLE_STANDARD, parseItem } from './common';
import { estimateCost } from '../../usage';
import { recordMonthly } from '../../searchGuard';
import type { PlanPage } from '../pipeline/searchConsole';

const SEARCHES_PER_PAGE = 6;
const cut = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const prompt = (game: string, page: any, plan: PlanPage, grounded: boolean) => {
  const entry = (id: string) => [...(page.items || []), ...(page.secrets || [])].find((e: any) => String(e.id) === id);
  return [
    `A page of a player's guide for "${game}": "${page.name}". Players find it on Google with these searches, and the page`,
    `doesn't answer them clearly yet. Improve the answers themselves: exact spots, steps and requirements a player can`,
    `follow. Never put search phrases, keyword lists or SEO wording into the text.`,
    grounded ? 'Search guides and wikis for this game first; write only what the sources say.' : 'Only write what you are sure of.',
    `For locations: ${MISSABLE_STANDARD}`,
    '',
    'What players look for:',
    ...plan.fixes.map((f) => {
      const e = f.entryId ? entry(f.entryId) : null;
      return `- "${f.query}" (${f.impressions} impressions): ${f.need}${e ? ` The entry that should answer it, ${f.entryId}: ${e.name ? `item ${cut(e.name, 60)} | where: ${cut(e.where, 200)}${e.how ? ` | how: ${cut(e.how, 120)}` : ''}` : `secret: ${cut(e.text, 220)}`}` : ' Nothing on the page answers it yet.'}`;
    }),
    '',
    'Reply with lines only, one per change:',
    'ITEM: id (an existing item\'s id, or "new") | item name | where | how | missable because (empty if it can\'t be missed)',
    'SECRET: id (an existing secret\'s id, or "new") | the whole secret in one clear line, naming what it is first',
    ...(plan.seo ? [
      `TITLE: a clear page title for search results, under 60 characters, naming the area and the game (now: "${page.name} – ${game} Guide")`,
      'DESCRIPTION: a plain description of what the page helps with, under 155 characters, no keyword lists',
    ] : []),
    'Leave out anything you can\'t answer with confidence.',
  ].join('\n');
};

type Change = { kind: 'item' | 'secret'; id: string; fields: string[] };

/** The repair's lines: items and secrets to rewrite or add, and the title and description. */
export function parseQueryFixLines(text: string, ids: Set<string>): { changes: Change[]; title?: string; description?: string } {
  const changes: Change[] = [];
  let title: string | undefined, description: string | undefined;
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*[-*]?\s*(ITEM|SECRET|TITLE|DESCRIPTION):\s*(.+)$/i);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    const body = m[2].replace(/\[S\d+\]/g, '').replace(/\*\*/g, '').trim();
    if (kind === 'TITLE') { title = cut(body.replace(/^["']|["']$/g, ''), 70); continue; }
    if (kind === 'DESCRIPTION') { description = cut(body.replace(/^["']|["']$/g, ''), 160); continue; }
    const f = body.split('|').map((x) => x.trim());
    const id = f[0];
    if (id !== 'new' && !ids.has(id)) continue;
    changes.push({ kind: kind === 'ITEM' ? 'item' : 'secret', id, fields: f.slice(1) });
  }
  return { changes, title, description };
}

/** The page with the changes applied: items and secrets rewritten or added (marked), title and description set. */
export function applyQueryFixes(page: any, parsed: ReturnType<typeof parseQueryFixLines>, sources: string[]) {
  const mark = { updatedFrom: 'search queries', ...(sources.length ? { sources: sources.slice(0, 5) } : {}) };
  let items = [...(page.items || [])];
  let secrets = [...(page.secrets || [])];
  let n = 0;
  const freshId = (prefix: string) => {
    const used = new Set([...items, ...secrets].map((e: any) => String(e.id)));
    let id = '';
    do id = `${prefix}${++n}`; while (used.has(id));
    return id;
  };
  for (const c of parsed.changes) {
    if (c.kind === 'item') {
      if (!c.fields[0] || !c.fields[1]) continue;
      const e = parseItem([c.fields[0], c.fields[1], c.fields[2] || '', c.fields[3] || ''], c.id);
      if (c.id === 'new') items.push({ ...e, id: freshId('q'), ...mark });
      else items = items.map((x: any) => (String(x.id) === c.id ? { ...x, where: e.where, ...(e.how ? { how: e.how } : {}), ...(e.lockout ? { lockout: e.lockout, missable: true } : {}), ...mark } : x));
    } else {
      const text = cut(c.fields.join(' | '), 600);
      if (text.length < 15) continue;
      if (c.id === 'new') secrets.push({ id: freshId('qs'), text, ...mark });
      else secrets = secrets.map((x: any) => (String(x.id) === c.id ? { ...x, text, ...mark } : x));
    }
  }
  return { items, secrets, ...(parsed.title ? { seoTitle: parsed.title } : {}), ...(parsed.description ? { seoDescription: parsed.description } : {}) };
}

/** The planned pages of this guide, rewritten in its staged copy (guides/{key}--next), up to the search cap. */
export async function writeQueryFixes(key: string, game: string, maxSearches: number) {
  const sc: any = (await db().collection('system').doc('searchConsole').get()).data() || {};
  const plan: PlanPage[] = (sc.plan || []).filter((p: PlanPage) => p.key === key);
  // This week's plan (a page done last week is planned again only if it still doesn't answer its searches).
  const week = Number(sc.pulledAt || 0);
  const stage = db().collection('guides').doc(stageKey(key)).collection('areas');
  let searches = 0, dollars = 0, found = 0, careful = 0, left = 0, written = 0;
  for (const p of plan) {
    const page: any = (await stage.doc(p.slug).get()).data();
    if (!page || page.queriesChecked === week) continue;
    if (p.careful && searches + SEARCHES_PER_PAGE > maxSearches) { left++; continue; }
    const ids = new Set([...(page.items || []), ...(page.secrets || [])].map((e: any) => String(e.id)));
    let parsed: ReturnType<typeof parseQueryFixLines> | null = null, sources: string[] = [], checked = false;
    for (let attempt = 0; attempt < (p.careful ? 2 : 1) && !checked; attempt++) {
      const res: any = await gemini().models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: (attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : '') + prompt(game, page, p, p.careful) }] }],
        config: { ...(p.careful ? { tools: [{ googleSearch: {} }] } : {}), temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
      const n = p.careful ? searchesIn(res) : 0;
      if (n) recordMonthly(n);
      searches += n;
      dollars += estimateCost(MODEL, res) || 0;
      if (p.careful && !n) continue;
      sources = p.careful ? sourcesIn(res) : [];
      checked = true;
      if (!p.careful || sources.length) parsed = parseQueryFixLines(String(res?.text || ''), ids);
    }
    written++;
    if (p.careful) careful++;
    const changes = parsed ? parsed.changes.length + (parsed.title ? 1 : 0) + (parsed.description ? 1 : 0) : 0;
    found += changes;
    console.log(`  ${p.careful ? 'searched' : 'quick'} ${p.name}: ${changes} change(s) for ${p.fixes.map((f) => `"${f.query}"`).join(', ') || 'title and description'}${checked ? '' : ' (no searches ran; asked again next run)'}`);
    if (checked) await stage.doc(p.slug).set({ ...(parsed && changes ? applyQueryFixes(page, parsed, sources) : {}), queriesChecked: week }, { merge: true });
  }
  console.log(`Search queries: ${found} change(s) on ${written}/${plan.length} pages${left ? ` (${left} left at the search cap)` : ''}.`);
  return { searches, dollars, written, found, left, tier: (careful ? 'pro' : 'flash') as 'flash' | 'pro' };
}
