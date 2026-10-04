/**
 * Guide builder: researches a game online and writes guide pages area by area. No playing needed.
 *
 *   npx tsx scripts/guides/build.ts --game "Final Fantasy VI" --part "the opening chapter" --areas 10 --max-searches 150
 *   options: --auto-publish   publish pages that pass the checks straight away (instead of saving them as drafts)
 *            --redo           rebuild areas that already exist
 *            --area "Name | when in the story"   build just this one page (no area list step), e.g.
 *                             --area "Kefka's Tower: Final Battle | the summit gauntlet against Kefka"
 *            --layout area|regions|linear|chapters|calendar|roguelike|metroidvania   the guide's outline by game type
 *                             (see LAYOUTS in common.ts). Normally left out: a new guide (or a --restructure) picks one
 *                             automatically, and later runs reuse the game's saved layout.
 *            --stage          build into guides/{key}--next instead of the live guide. Nothing there is published:
 *                             review.ts --key {key}--next --gate promotes it to the live guide only if it passes review.
 *                             A staged build that stopped at the search cap continues on the next run.
 *            --copy-live      with --stage: a new staged build starts as a copy of the live guide (to fix pages, add
 *                             pages or upgrade quick pages); without it, the staged build starts empty (a rebuild)
 *            --note "..."     what a review found wrong with the previous version, passed to the writer to avoid
 *                             (fix.ts uses it with --area to rewrite one page)
 *            --group NAME     put this run's pages in a named section, e.g. an expansion: --group "Hearts of Stone"
 *                             (the website and apps show a heading per section; see set-groups.ts for existing pages)
 *            --upgrade        check a game's existing quick pages the careful way, one by one (no new area list).
 *                             A page that passes is replaced by the checked version and its details go into the
 *                             knowledge base; one that doesn't pass keeps its quick page (confirmed details are still
 *                             saved) and is marked upgradeTried, so later --upgrade runs skip it. Stops at the search
 *                             cap; run again to continue with the pages not yet attempted.
 *            --retry-failed   with --upgrade: also try again the pages an earlier upgrade couldn't confirm
 *            --restructure    rebuild the game's guide with a new layout: the new pages replace the old list, and
 *                             old pages not in it are held back (never deleted)
 *            --quick          fast and cheap: written from the AI's own knowledge with no searches. Pages are marked
 *                             unchecked in the data, add nothing to the knowledge base, and never replace a checked
 *                             page; a normal (checked) run later upgrades them. With --auto-publish, a quick guide is
 *                             only published once it has at least 5 pages (QUICK_MIN_PAGES): fewer means the AI barely
 *                             knows the game, so its pages stay drafts and it needs a careful build (the pipeline
 *                             queues one when it sees "Not published: thin quick guide"). A game released after the
 *                             quick model's knowledge cutoff (QUICK_MODEL_CUTOFF) is never built quick: the run stops
 *                             with "Not built: released ..., after the quick model's knowledge cutoff".
 *
 * For each area: research with Google Search (a step that runs no searches is retried once, then fails, so nothing
 * comes from the model's memory) -> keep only details that at least two different websites back, judged from Google's
 * own grounding data rather than anything the model says about its sources; a detail with just one real source gets a
 * separate fact-check (which must also search) and is kept only if confirmed -> save the page (draft, published or
 * held back) -> save the checked details to the game knowledge base under that area's name. Each run logs its
 * searches and an estimated AI cost. A search cap stops the run before it
 * spends more than you allow; it's separate from players' search budget.
 */
import {
  db, gemini, MODEL, gameKey, arg, editionOf, editionNote, searchesIn, visitName, cleanAreaName, resolveArea, normalizeVisits, isLayout,
  LAYOUTS, LAYOUT_CHOICES, QUICK_MODEL_CUTOFF, guideRelease, releasedAfter, stageKey, MISSABLE_STANDARD, parseItem,
  type GuideArea, type GuideEntry, type GuideSection, type GuideFight, type Layout,
} from './common';
import { stageCopy } from './promote';
import { getGameFacts, saveGameFacts, recordMonthly } from '../../searchGuard';
import { estimateCost } from '../../usage';
import { ThinkingLevel } from '@google/genai';

const game = arg('game');
const part = arg('part', 'the beginning of the game');
const maxAreas = Math.max(1, Math.min(40, Number(arg('areas', '10'))));
const maxSearches = Math.max(10, Number(arg('max-searches', '150')));
// A staged build is never published directly: it's promoted only after it passes review (review.ts --gate).
const autoPublish = arg('auto-publish') === 'true' && arg('stage') !== 'true';
const redo = arg('redo') === 'true';
const quick = arg('quick') === 'true';
const layoutArg = arg('layout');
const restructure = arg('restructure') === 'true';
const upgrade = arg('upgrade') === 'true';
/** --group "Hearts of Stone": the section this run's pages belong to (an expansion or DLC), shown as a heading. */
const groupArg = (() => {
  const g = arg('group');
  return g && g !== 'true' ? g.trim().slice(0, 40) : undefined;
})();
const retryFailed = arg('retry-failed') === 'true';
/** --stage: build into guides/{key}--next instead of the live guide; nothing is published until it passes review. */
const stage = arg('stage') === 'true';
/** --copy-live (with --stage): a new staged build starts as a copy of the live guide (to fix, extend or upgrade it). */
const copyLive = arg('copy-live') === 'true';
/** --note "...": what a review found wrong with the previous version of these pages, for the writer to avoid. */
const note = (() => {
  const n = arg('note');
  return n && n !== 'true' ? ` A review of the previous version found this problem: ${n.trim().slice(0, 600)} Make sure this version doesn't have it.` : '';
})();
/** The guide's structure for this run (set in main from --layout, the saved layout, or an automatic pick). */
let layout: Layout = 'area';
const placeBased = () => layout === 'area' || layout === 'regions';
/** --area "Name | when in the story": build exactly this page, skipping the area list (and its search). */
const oneArea = ((): { name: string; story: string; group?: string }[] | null => {
  const v = arg('area');
  if (!v || v === 'true') return null;
  const [name, story] = v.split('|').map((x) => x.trim());
  // No "when" given: only use --part if it was passed (its default, "the beginning of the game", would mislead research).
  return name ? [{ name: name.slice(0, 100), story: (story || (process.argv.includes('--part') ? part : '') || '').slice(0, 120) }] : null;
})();
if (!game) {
  console.log('Usage: npx tsx scripts/guides/build.ts --game "Game title" [--part "the opening chapter"] [--areas 10] [--max-searches 150] [--auto-publish] [--redo] [--quick] [--area "Name | when"]');
  process.exit(1);
}

const ai = gemini();
let searches = 0;
let dollars = 0; // estimated AI cost of this run (tokens; searches are free up to 5,000 a month)
let unpriced = 0; // calls on a model without a known rate
// The area list is simple work: the cheaper Flash-Lite model does it (falling back to the main model if it won't search).
const LITE_MODEL = process.env.GUIDE_LITE_MODEL || process.env.FREE_MODEL || 'gemini-3.1-flash-lite';
const budgetLeft = () => maxSearches - searches;

/**
 * A research call with Google Search. Searching is optional for the model, so it can quietly answer from memory:
 * when a step must be backed by searches, a reply that ran none is retried once with a firmer instruction, and if it
 * still ran none, the step fails (nothing from memory gets through).
 */
async function grounded(prompt: string, label: string, requireSearch = true, model = MODEL): Promise<{ text: string; response: any }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (budgetLeft() <= 0) throw new Error('search cap reached');
    const res: any = await ai.models.generateContent({
      model,
      contents: [{
        role: 'user',
        parts: [{ text: (attempt ? 'You must run Google searches before answering. Do not answer from memory.\n\n' : '') + prompt }],
      }],
      // Low thinking: the searching does the work here, and thinking tokens are billed like output.
      config: { tools: [{ googleSearch: {} }], temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const n = searchesIn(res);
    searches += n;
    recordMonthly(n); // guide runs count toward the app's monthly search total too
    const cost = estimateCost(model, res);
    if (cost === null) unpriced++;
    else dollars += cost;
    console.log(`  [${label}] ${n} searches${cost !== null ? `, ≈ $${cost.toFixed(4)}` : ''} (run total ${searches}/${maxSearches} searches, ≈ $${dollars.toFixed(3)})`);
    if (n > 0 || !requireSearch) return { text: res?.text || '', response: res };
  }
  throw new Error(`no-search: ${label} ran no searches`);
}

/**
 * Which websites actually back each line of a reply, from Google's own grounding data (the pages the search really
 * returned and the parts of the answer each one supports), not from anything the model writes about its sources.
 */
function realSourcesByLine(text: string, response: any): Set<string>[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  let pos = 0;
  for (const l of lines) {
    starts.push(pos);
    pos += l.length + 1;
  }
  const lineAt = (idx: number) => {
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= idx) k++;
    return k;
  };
  const gm = response?.candidates?.[0]?.groundingMetadata || {};
  const chunks: any[] = gm.groundingChunks || [];
  const site = (i: number) => {
    const w = chunks[i]?.web || {};
    const t = String(w.title || w.domain || '').toLowerCase().trim();
    return t;
  };
  const out = lines.map(() => new Set<string>());
  for (const sup of gm.groundingSupports || []) {
    const seg = String(sup?.segment?.text || '').trim();
    if (!seg) continue;
    const at = text.indexOf(seg);
    if (at < 0) continue;
    const first = lineAt(at);
    const last = lineAt(at + seg.length - 1);
    for (const ci of sup.groundingChunkIndices || []) {
      const s = site(ci);
      if (!s) continue;
      for (let k = first; k <= last; k++) out[k].add(s);
    }
  }
  return out;
}

const BASE_RULES =
  'Search the web for this; don\'t answer from memory. Write everything in your own words, never copying sentences ' +
  'from websites. Only include details you found in your searches. Use the names the game itself uses.';
/** For a remake or remaster: which version this is, and that details must be confirmed for it (set in main). */
let EDITION = '';
const RULES = () => BASE_RULES + EDITION + note;
/** Works out (once per guide) whether the game is a remake or remaster, and returns the prompt note for it. */
async function editionPrompt(guideRef: FirebaseFirestore.DocumentReference): Promise<string> {
  const e = await editionOf(game!, guideRef);
  if (e.remake) console.log(`  edition: the ${e.year ? `${e.year} ` : ''}${e.kind} of ${e.original || 'an earlier game'}${e.originalYear ? ` (${e.originalYear})` : ''}`);
  return editionNote(e, game!);
}

/**
 * The area list, shared by normal and quick runs. Revisits count as their own areas: a place the player comes back to
 * in a clearly different state (another world, era or chapter) gets its own page, "Narshe (World of Ruin)".
 */
const UNIT: Partial<Record<Layout, string>> = {
  area: 'An area is a place with its own map: a town, dungeon, castle, cave, building, or field region worth its own guide page. ' +
    'A single room is never its own page: it belongs on the page of the building or area it\'s in. ',
  regions: 'An area is a region, city, settlement or major location (a dungeon, fortress or landmark) worth its own guide page. ' +
    'Never make a page for a return visit, a story phase, New Game+, or a single building, camp, shop or room inside a ' +
    'region: those belong on the region\'s page. Never make pages for procedurally generated or generic places ' +
    '("Abandoned Mine"). ',
};

/** Every page of a guide is the same kind of unit (the guide review's most common failure was mixing them). */
const ONE_KIND = 'Every page must be the same kind of unit: never mix in pages for characters, bosses, topics (weapons, upgrades, ' +
  'collectibles), the whole game, or a generic label instead of the game\'s own name. ';
const reuseNames = (existing: { name: string }[]) =>
  existing.length ? `The guide already has these pages; reuse a name exactly for the same page:\n${existing.map((e) => `- ${e.name}`).join('\n')}\n` : '';
const lineFormat = (third: string) =>
  `Reply with one line per page, exactly: AREA: page name | a few words on what happens | ${third}. ` +
  'Every line starts with the word AREA: itself, never a chapter, month or other label.';

/** The page list, by game type (the guide's layout; see LAYOUTS in common.ts). */
const outlinePrompt = (extra: string, existing: { name: string; story: string }[]) => {
  const head = `List the guide pages for ${part} of the video game "${game}", up to ${maxAreas} pages. `;
  switch (layout) {
    case 'linear':
      return head + 'The game is linear and split into chapters, missions or levels: make one page per chapter (or mission or level), ' +
        'in order, using the game\'s own numbering and names, like "Chapter 1: New Arrivals" or "Mission 03: Fallen Angel". ' +
        'Don\'t add pages for places, and don\'t split a chapter into several pages unless the game itself does. ' + ONE_KIND +
        reuseNames(existing) + `${extra} ` + lineFormat('empty');
    case 'chapters':
      return head + 'Each page is one character\'s story chapter, named like "Olberic, Chapter 1", in a sensible play order. ' +
        'Only chapter pages: no separate pages for towns or regions (a town\'s shops and items go on the chapter where the ' +
        'character first visits it). ' + ONE_KIND + reuseNames(existing) + `${extra} ` + lineFormat('the character\'s name');
    case 'calendar':
      return head + 'Pages are stretches of the in-game calendar, usually one month or the period up to a deadline, named like ' +
        '"April" or "May: Kamoshida\'s Palace", in calendar order; a dungeon is covered on the calendar page where it\'s done. ' +
        'After all the calendar pages, add at most three reference pages for systems that run all game (social links or ' +
        'confidants, for example), named by topic. ' + reuseNames(existing) + `${extra} ` + lineFormat('Calendar for a calendar page, or Reference for a reference page');
    case 'roguelike':
      return head + 'The game is run-based. Make one page for the hub, then one page per region of a run, in the order a run ' +
        'goes through them, named as the game names them. Never split a region into first and later runs; endings and ' +
        'post-game content go on the relevant region\'s page. ' + ONE_KIND + reuseNames(existing) + `${extra} ` + lineFormat('empty');
    case 'metroidvania':
      return head + 'The game is one interconnected map. Make one page per map region, named as the game\'s map names it, in a ' +
        'sensible first-time route. Never make a page for a return visit, a single room or a boss: an item that needs a later ' +
        'ability stays on its region\'s page, with the ability noted. ' + ONE_KIND + reuseNames(existing) + `${extra} ` + lineFormat('empty');
    default:
      return placeOutline(extra, existing);
  }
};

const placeOutline = (extra: string, existing: { name: string; story: string }[]) =>
  `List the areas a player visits in ${part} of the video game "${game}", in story order, up to ${maxAreas} areas. ` +
  UNIT[layout] + ONE_KIND +
  (layout === 'regions'
    ? 'Leave the third field empty. '
    : 'If the player comes back to a place later in a clearly different state (a different world or era, with new items, ' +
      'people or events), list that visit as its own area and name the world or era in the third field (for example ' +
      '"World of Ruin"). Leave the third field empty for a first visit (including a place that only exists in a later ' +
      'world) and for a return in the same state. ') +
  (existing.length
    ? 'The guide already has pages for these visits (name: when). If an area in your list is the same visit as one of ' +
      'them, write exactly that name and leave the third field empty; a later visit to one of these places is a revisit:\n' +
      existing.map((e) => `- ${e.name}: ${e.story}`).join('\n') + '\n'
    : '') +
  `${extra} Reply with one line per area, exactly: AREA: name as the game calls it | a few words on when in the story ` +
  'this visit happens | world, era or chapter of a revisit, or empty';

function parseOutline(text: string): { name: string; story: string; group?: string }[] {
  const seen = new Set<string>();
  return text
    .split('\n')
    .map((l) => l.match(/^\s*[-*]?\s*AREA:\s*(.+?)\s*\|\s*([^|]*?)\s*(?:\|\s*(.*?)\s*)?$/i))
    .filter(Boolean)
    // Place-based guides: clean the place name, then the full visit name the same way. Chapter and calendar guides:
    // the third field is the page's group (a character, "Calendar", "Reference"), and page names keep their colon
    // ("May: Kamoshida's Palace").
    .map((m) =>
      placeBased()
        ? { name: cleanAreaName(visitName(cleanAreaName(m![1]), m![3]), 100), story: m![2].trim().slice(0, 120) }
        : { name: m![1].trim().replace(/\s+/g, ' ').slice(0, 100), story: m![2].trim().slice(0, 120), group: (m![3] || '').trim().replace(/^(empty|none|n\/a|-)$/i, '').slice(0, 40) || undefined },
    )
    .filter((a) => a.name && !seen.has(a.name.toLowerCase()) && seen.add(a.name.toLowerCase()))
    .slice(0, maxAreas)
    // Calendar guides: the reference pages come after the calendar, so they never interrupt it.
    .sort((a, b) => (layout === 'calendar' ? Number(a.group === 'Reference') - Number(b.group === 'Reference') : 0));
}

/** Tells the research step which visit a revisit page is about. */
const visitNote = (name: string) => {
  if (!placeBased()) return '';
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? ` This page is only about the visit during ${m[1]}: cover what's there then, not on earlier visits.` : '';
};

async function outline(existing: { name: string; story: string }[]): Promise<{ name: string; story: string; group?: string }[]> {
  const ask = (model: string) => grounded(outlinePrompt(RULES(), existing), 'outline', true, model);
  let text = '';
  try {
    text = (await ask(LITE_MODEL)).text;
  } catch (e: any) {
    if (String(e?.message).includes('search cap')) throw e;
    console.log(`  (the cheaper model couldn't do the area list: ${String(e?.message).slice(0, 80)}; using the main model)`);
  }
  if (!/AREA:/i.test(text)) text = (await ask(MODEL)).text;
  return parseOutline(text);
}

type Parsed = {
  overview: GuideEntry | null; items: GuideEntry[]; secrets: GuideEntry[]; enemies: GuideEntry[]; shops: GuideEntry[]; tips: GuideEntry[];
  /** Structure-specific details: DEADLINE, MISSABLE, ACTIVITY, LINK lines. */
  extra: Record<string, GuideEntry[]>;
  /** FIGHT lines: the area's key fights (bosses and set-piece battles). */
  fights: GuideFight[];
};

/** What a page is about, in words the writing prompt can use. */
const pageKind = () =>
  ({
    chapters: 'guide page (a character\'s story chapter)',
    calendar: 'guide page (a stretch of the calendar, or a reference topic)',
    linear: 'chapter (or mission or level)',
    roguelike: 'guide page (the hub, or a region of a run)',
    metroidvania: 'map region',
  } as Partial<Record<Layout, string>>)[layout] || 'area';

/** The detail lines a page can have. Calendar and chapter guides add the lines that matter for how they're played. */
const detailFormats = () =>
  'OVERVIEW: 2 to 3 sentences on what happens here and what to do\n' +
  (layout === 'calendar'
    ? 'DEADLINE: a deadline in this period and what must be done by then\n' +
      'MISSABLE: an event, choice, item or social link step that can be missed in this period, in one line: where (from a findable anchor to the exact spot), the exact step that gets it, and what locks it out\n' +
      'LINK: social link or confidant name | how to start or advance it now\n' +
      'ACTIVITY: a worthwhile thing to do on free days or evenings in this period\n'
    : layout === 'chapters' || layout === 'linear'
      ? 'MISSABLE: an event, choice or item in this chapter that can be missed, in one line: where (from a findable anchor to the exact spot), the exact step that gets it, and what locks it out\n'
      : '') +
  'ITEM: item name | exactly where: from a findable anchor (a waypoint, a named NPC, a major landmark, or the map coordinates if the game shows them) to the exact container or object | how: the exact final step, the action or check needed (empty if you just pick it up) | missable because: what locks it out (empty if it can\'t be missed)\n' +
  `(${MISSABLE_STANDARD})\n` +
  'SECRET: hidden thing and how to find it\n' +
  'ENEMY: enemy name | weakness (empty if it has none or the game has no weaknesses) | what can be stolen, or a notable drop (only if the game has stealing or drops worth noting; otherwise empty) | short note\n' +
  'SHOP: shop or NPC name | what they sell or offer\n' +
  'FIGHT: name of a boss or major set-piece battle here | the enemies | their notable abilities and threats | weaknesses and resistances | the tactics and positions that win it | the rewards (one line per key fight; never ordinary enemies; leave out if there are none)\n' +
  'TIP: short practical tip';

/** Structure-specific sections for the page, from the extra detail lines. */
function sectionsFrom(extra: Record<string, GuideEntry[]>, keep: (e: GuideEntry) => boolean): GuideSection[] {
  const make = (key: string, title: string, check: boolean): GuideSection | null => {
    const entries = (extra[key] || []).filter(keep).map((e) => ({ id: e.id, text: e.name ? `${e.name}: ${e.text || ''}`.replace(/: $/, '') : e.text || '' })).filter((e) => e.text);
    return entries.length ? { title, check, entries } : null;
  };
  return [make('DEADLINE', 'Deadlines', false), make('MISSABLE', 'Don\'t miss', true), make('LINK', 'Social links', true), make('ACTIVITY', 'Worth doing', false)].filter(Boolean) as GuideSection[];
}

/** Research an area. The reply is one detail per line, so Google's grounding data can be matched to each detail. */
async function research(area: { name: string; story: string; group?: string }): Promise<Parsed> {
  const { text, response } = await grounded(
    `Research the ${pageKind()} "${area.name}" in the video game "${game}"${area.story ? ` (${area.story})` : ''}.${visitNote(area.name)} ${RULES()}\n` +
      'Reply with one detail per line, using exactly these formats (leave out anything you didn\'t find):\n' +
      detailFormats(),
    `research ${area.name}`,
  );
  return parseDetails(text, realSourcesByLine(text, response));
}

/** Read the one-detail-per-line reply. `real` = the websites backing each line (empty lists in quick mode). */
function parseDetails(text: string, real: Set<string>[]): Parsed {
  const out: Parsed = { overview: null, items: [], secrets: [], enemies: [], shops: [], tips: [], extra: {}, fights: [] };
  let n = 0;
  text.split('\n').forEach((line, k) => {
    const m = line.match(/^\s*[-*]?\s*(OVERVIEW|ITEM|SECRET|ENEMY|SHOP|TIP|DEADLINE|MISSABLE|LINK|ACTIVITY|FIGHT):\s*(.+)$/i);
    if (!m) return;
    const f = m[2].split('|').map((x) => x.trim());
    const sources = [...(real[k] || [])];
    const id = `x${n++}`;
    switch (m[1].toUpperCase()) {
      case 'OVERVIEW': out.overview = { id, text: m[2].trim(), sources }; break;
      case 'ITEM': out.items.push(parseItem(f, id, sources)); break;
      case 'SECRET': out.secrets.push({ id, text: m[2].trim(), sources }); break;
      case 'ENEMY': out.enemies.push({ id, name: f[0], weakness: f[1] || '', steal: f[2] || '', notes: f[3] || '', sources }); break;
      case 'SHOP': out.shops.push({ id, name: f[0], sells: f[1] || '', sources }); break;
      case 'TIP': out.tips.push({ id, text: m[2].trim(), sources }); break;
      case 'FIGHT': {
        const v = (i: number) => (f[i] && !/^(none|n\/a|-|unknown)$/i.test(f[i]) ? f[i].slice(0, 400) : undefined);
        if (f[0]) out.fights.push({ id: `f${n}`, name: f[0].slice(0, 100), enemies: v(1), threats: v(2), weaknesses: v(3), tactics: v(4), rewards: v(5), sources });
        break;
      }
      case 'LINK': (out.extra.LINK ||= []).push({ id, name: f[0], text: f.slice(1).join(' | '), sources }); break;
      default: (out.extra[m[1].toUpperCase()] ||= []).push({ id, text: m[2].trim(), sources });
    }
  });
  return out;
}

type Claim = { id: string; text: string };

function claimsFor(areaName: string, d: Parsed): Claim[] {
  const out: Claim[] = [];
  for (const it of d.items) out.push({ id: it.id, text: `In ${areaName}, the item ${it.name} can be found ${it.where}.${it.how ? ` To get it: ${it.how}.` : ''}${it.missable ? ` It can be missed${it.lockout ? `: ${it.lockout}` : ''}.` : ''}` });
  for (const s of d.secrets) out.push({ id: s.id, text: `In ${areaName}: ${s.text}` });
  for (const e of d.enemies)
    out.push({ id: e.id, text: `The enemy ${e.name} appears in ${areaName}.${e.weakness ? ` It is weak to ${e.weakness}.` : ''}${e.steal ? ` It can be stolen from: ${e.steal}.` : ''}` });
  for (const h of d.shops) out.push({ id: h.id, text: `In ${areaName}, ${h.name} sells or offers: ${h.sells}.` });
  for (const t of d.tips) out.push({ id: t.id, text: `${areaName} tip: ${t.text}` });
  if (d.overview) out.push({ id: d.overview.id, text: d.overview.text || '' });
  return out.filter((c) => c.id && c.text);
}

/** A separate check that must itself search; only claims it marks supported survive. */
async function factCheck(areaName: string, claims: Claim[]): Promise<Set<string>> {
  if (!claims.length) return new Set();
  const { text } = await grounded(
    `Fact-check these statements about "${areaName}" in the video game "${game}". Search to verify each one; don't ` +
      'rely on memory. Reply with one line per statement, exactly: ID: SUPPORTED, ID: UNSUPPORTED or ID: UNSURE. ' +
      'Use SUPPORTED only if a source you found confirms it.\n' + claims.map((c) => `${c.id}: ${c.text}`).join('\n'),
    `fact-check ${areaName}`,
  );
  const ok = new Set<string>();
  for (const l of text.split('\n')) {
    const m = l.match(/(x\d+)\s*:\s*SUPPORTED\b/i);
    if (m) ok.add(m[1]);
  }
  return ok;
}

/** Two-source rule on real search data: at least two different websites back this detail. */
const twoSources = (e: GuideEntry) => (e.sources || []).length >= 2;

// ---- guide structure ----

/** The layout for this run: --layout if given, else the game's saved layout, else an automatic pick. */
async function pickLayout(info: any): Promise<Layout> {
  if (isLayout(layoutArg)) return layoutArg;
  // --restructure starts over, so it picks again rather than keeping the outline being replaced.
  if (isLayout(info.layout) && !restructure) return info.layout;
  try {
    // The main model, not Flash-Lite: the cheaper one mistook chaptered linear games for multi-character ones.
    const answer = await plain(
      `How should a player's guide for the video game "${game}" be organized? Reply with one word:\n` + LAYOUT_CHOICES,
      'structure',
      MODEL,
    );
    const word = (answer.toLowerCase().match(new RegExp(`\\b(${LAYOUTS.join('|')})\\b`)) || [])[1];
    if (isLayout(word)) {
      console.log(`  structure: ${word}`);
      return word;
    }
  } catch {
    /* fall back below */
  }
  return 'area';
}

/** Why an old page was held back by --restructure. A later part that lists the page again rebuilds it. */
const RETIRED = 'replaced by the new guide structure';
const retired = (doc: any) => doc.exists && doc.data()?.status === 'held' && doc.data()?.heldReason === RETIRED;

/** Save the page list and layout; after --restructure, hold back old pages that aren't in the new list. */
async function finishGuide(guideRef: any, order: { slug: string }[], previous: { slug: string; name: string }[]) {
  const had = (await guideRef.get()).data();
  await guideRef.set({ game, title: `${game} guide`, areas: order, layout, ...(stage ? { stagingFor: gameKey(game!) } : {}), updatedAt: Date.now(), ...(had?.createdAt ? {} : { createdAt: Date.now() }) }, { merge: true });
  if (!restructure) return;
  const keep = new Set(order.map((o) => o.slug));
  let retired = 0;
  for (const p of previous) {
    if (keep.has(p.slug)) continue;
    const ref = guideRef.collection('areas').doc(p.slug);
    const doc = await ref.get();
    if (doc.exists && doc.data()?.status !== 'held') {
      await ref.update({ status: 'held', heldReason: RETIRED, updatedAt: Date.now() });
      retired++;
    }
  }
  console.log(`Restructured to "${layout}": ${retired} old page(s) held back (not deleted).`);
}

// ---- quick mode: from the AI's own knowledge, no searches ----
// Minutes and pennies per game. Pages are marked unchecked in the data, never feed the game knowledge base (so live
// answers only ever use checked facts), and never replace a checked page. A normal run later checks and upgrades them.
async function plain(prompt: string, label: string, model: string): Promise<string> {
  const res: any = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const cost = estimateCost(model, res);
  if (cost === null) unpriced++;
  else dollars += cost;
  console.log(`  [${label}]${cost !== null ? ` ≈ $${cost.toFixed(4)}` : ''} (run total ≈ $${dollars.toFixed(3)})`);
  return res?.text || '';
}

async function quickOutline(existing: { name: string; story: string }[]): Promise<{ name: string; story: string; group?: string }[]> {
  const prompt = outlinePrompt(`Only list what you're confident about.${EDITION}${note}`, existing);
  let list: { name: string; story: string; group?: string }[] = [];
  try {
    list = parseOutline(await plain(prompt, 'outline', LITE_MODEL));
  } catch (e: any) {
    console.log(`  (the cheaper model couldn't do the area list: ${String(e?.message).slice(0, 80)}; using the main model)`);
  }
  return list.length ? list : parseOutline(await plain(prompt, 'outline', MODEL));
}

async function quickArea(area: { name: string; story: string; group?: string }): Promise<Parsed> {
  const text = await plain(
    `Write guide notes for the ${pageKind()} "${area.name}" in the video game "${game}"${area.story ? ` (${area.story})` : ''}, from what you know.${visitNote(area.name)}${note} ` +
      "Only include details you're confident about; leave out anything you're unsure of. Write in your own words." +
      `${EDITION} Reply with one detail per line, using exactly these formats:\n` +
      detailFormats(),
    `write ${area.name}`,
    MODEL,
  );
  return parseDetails(text, []);
}

/** A quick guide with fewer published pages than this isn't published (the AI barely knows the game). */
const QUICK_MIN_PAGES = 5;

/** The guide this run writes to: the live guide, or with --stage its staged build (created on first use). */
async function openGuide(): Promise<{ key: string; guideRef: FirebaseFirestore.DocumentReference; info: any }> {
  const live = gameKey(game!);
  if (!stage) {
    const guideRef = db().collection('guides').doc(live);
    return { key: live, guideRef, info: (await guideRef.get()).data() || {} };
  }
  const key = stageKey(live);
  const guideRef = db().collection('guides').doc(key);
  if (!(await guideRef.get()).exists) {
    if (copyLive) await stageCopy(live);
    else {
      const liveInfo: any = (await db().collection('guides').doc(live).get()).data() || {};
      await guideRef.set({ game, title: `${game} guide`, stagingFor: live, ...(liveInfo.edition ? { edition: liveInfo.edition } : {}), createdAt: Date.now() });
    }
    console.log(`Staged build ${key}${copyLive ? ' (starting from a copy of the live guide)' : ''}: nothing is published until it passes review.`);
  }
  return { key, guideRef, info: (await guideRef.get()).data() || {} };
}

/**
 * Quick builds write from the build model's own knowledge, which stops at QUICK_MODEL_CUTOFF: a game released later
 * would be guesswork (the guide review found invented content in exactly those), so it's refused and needs a careful build.
 */
async function quickAllowed(): Promise<boolean> {
  const live: any = (await db().collection('guides').doc(gameKey(game!)).get()).data() || {};
  const rel = await guideRelease(game!, live);
  if (!releasedAfter(rel, QUICK_MODEL_CUTOFF, !!live.pipeline?.newRelease)) return true;
  console.log(`Not built: released ${rel.text}, after the quick model's knowledge cutoff (${QUICK_MODEL_CUTOFF}); it needs a careful build.`);
  console.log('Done: 0 quick page(s), nothing built, estimated AI cost ≈ $0.00.');
  return false;
}

async function mainQuick() {
  console.log(`Quick guide (from the AI's knowledge, no searches): ${game} (${part}), up to ${maxAreas} areas${autoPublish ? ', publishing' : ', as drafts'}`);
  if (!(await quickAllowed())) return setTimeout(() => process.exit(0), 500);
  const { guideRef, info } = await openGuide();
  layout = await pickLayout(info);
  EDITION = await editionPrompt(guideRef);
  const previous: { slug: string; name: string; story: string; group?: string }[] = [...(info.areas || [])];
  // --restructure starts a fresh page list in the new layout; old pages not in it are held back at the end.
  const order: { slug: string; name: string; story: string; group?: string }[] = restructure ? [] : [...previous];
  const aliases: Record<string, string> = restructure ? {} : info.aliases || {};
  // The AI sees the existing pages (so it reuses their names); a suffix on a place with no earlier visit is dropped.
  const listed = oneArea || (await quickOutline(order));
  const areas = (placeBased() ? normalizeVisits(listed, order, aliases) : listed).map((a) => (groupArg ? { ...a, group: groupArg } : a));
  if (!areas.length) throw new Error('could not work out the list of areas');
  console.log(`Areas: ${areas.map((a) => a.name).join(' | ')}`);
  let built = 0, held = 0, skipped = 0;
  const builtSlugs: string[] = []; // this run's pages: drafts until the guide has enough pages to publish
  for (const found of areas) {
    // Same page as an existing one under a slightly different name (or a merged/renamed page): use that page.
    const { slug: s, name } = resolveArea(found.name, order, aliases);
    const area = { ...found, name };
    if (!order.some((o) => o.slug === s)) order.push({ slug: s, name: area.name, story: area.story, ...(area.group ? { group: area.group } : {}) });
    const ref = guideRef.collection('areas').doc(s);
    const existing = await ref.get();
    if (existing.exists && (existing.data()?.verified !== false || !(redo || restructure || retired(existing)))) {
      skipped++;
      console.log(`- ${area.name}: already has a page${existing.data()?.verified !== false ? ' (checked pages are never replaced by quick ones)' : ' (use --redo to rewrite)'}`);
      continue;
    }
    console.log(`- ${area.name}`);
    try {
      const d = await quickArea(area);
      const sections = sectionsFrom(d.extra, () => true);
      const kept = d.items.length + d.secrets.length + d.enemies.length + d.shops.length + sections.reduce((n, x) => n + x.entries.length, 0);
      const heldReason = kept < 3 ? 'too few details' : '';
      const page: GuideArea = {
        name: area.name,
        slug: s,
        order: order.findIndex((o) => o.slug === s),
        story: area.story,
        overview: d.overview?.text || '',
        items: d.items, secrets: d.secrets, enemies: d.enemies, shops: d.shops,
        tips: d.tips.map((t) => t.text!).slice(0, 6),
        ...(sections.length ? { sections } : {}),
        ...(d.fights.length ? { fights: d.fights.slice(0, 6).map(({ sources: _s, ...x }) => x) } : {}),
        ...(area.group ? { group: area.group } : {}),
        sources: [],
        // Drafts at first even with --auto-publish: published at the end, only if the guide gets enough pages.
        status: heldReason ? 'held' : 'draft',
        verified: false,
        checks: { claims: 0, supported: 0, rejected: 0, singleSource: 0 },
        ...(heldReason ? { heldReason } : {}),
        updatedAt: Date.now(),
      };
      await ref.set(page);
      if (heldReason) held++;
      else {
        built++;
        builtSlugs.push(s);
      }
      console.log(`  ${page.status}: ${kept} details${heldReason ? ` (${heldReason})` : ''}`);
    } catch (e: any) {
      console.warn(`  failed: ${e?.message}`);
    }
  }
  // Publish this run's pages only if the guide then has at least QUICK_MIN_PAGES published pages.
  let published = false;
  if (autoPublish && builtSlugs.length) {
    const already = (await guideRef.collection('areas').where('status', '==', 'published').get()).size;
    if (already + builtSlugs.length >= QUICK_MIN_PAGES) {
      for (const slug of builtSlugs) await guideRef.collection('areas').doc(slug).set({ status: 'published', updatedAt: Date.now() }, { merge: true });
      published = true;
    } else {
      console.log(`Not published: thin quick guide (${already + builtSlugs.length} page(s), fewer than ${QUICK_MIN_PAGES}); its pages stay drafts until a careful build.`);
    }
  }
  await finishGuide(guideRef, order, previous);
  console.log(`Done: ${built} quick page(s) ${published ? 'published' : 'saved as drafts'}, ${held} held back, ${skipped} skipped, estimated AI cost ≈ $${dollars.toFixed(2)}${unpriced ? ` (plus ${unpriced} call(s) on a model without a known rate)` : ''}. No searches used, nothing added to the knowledge base.`);
  console.log('Next: npx tsx scripts/guides/publish.ts   (then upload Marketing_Website_Files to Netlify)');
  setTimeout(() => process.exit(0), 3000);
}

async function main() {
  if (quick) return mainQuick();
  console.log(`Building guide: ${game} (${part}), up to ${maxAreas} areas, search cap ${maxSearches}${autoPublish ? ', auto-publish' : ', as drafts'}`);
  const { guideRef, info } = await openGuide();
  await getGameFacts(game); // load what the knowledge base already knows, so new facts add confirmations
  layout = await pickLayout(info);
  EDITION = await editionPrompt(guideRef);
  const previous: { slug: string; name: string; story: string; group?: string }[] = [...(info.areas || [])];
  const order: { slug: string; name: string; story: string; group?: string }[] = restructure ? [] : [...previous];
  const aliases: Record<string, string> = restructure ? {} : info.aliases || {};
  // The AI sees the existing pages (so it reuses their names); a suffix on a place with no earlier visit is dropped.
  // --upgrade: no area list step; the game's published quick pages, in guide order.
  let areas: { name: string; story: string; group?: string }[];
  if (upgrade) {
    areas = [];
    let tried = 0;
    for (const o of order) {
      const d = (await guideRef.collection('areas').doc(o.slug).get()).data();
      if (!d || d.verified !== false || !(d.status === 'published' || (stage && d.status === 'draft'))) continue;
      // Pages an earlier upgrade couldn't confirm are skipped unless --retry-failed.
      if (d.upgradeTried && !retryFailed) {
        tried++;
        continue;
      }
      areas.push({ name: d.name || o.name, story: d.story || o.story || '', ...(d.group || o.group ? { group: d.group || o.group } : {}) });
    }
    const triedNote = tried ? ` ${tried} page(s) an earlier upgrade couldn't confirm were skipped (use --retry-failed to try them again).` : '';
    if (!areas.length) {
      console.log(`Nothing to upgrade: no published quick pages left to try for this game.${triedNote}`);
      setTimeout(() => process.exit(0), 1000);
      return;
    }
    console.log(`Upgrading ${areas.length} quick page(s) to checked pages (search cap ${maxSearches}).${triedNote}`);
  } else {
    const listed = oneArea || (await outline(order));
    areas = placeBased() ? normalizeVisits(listed, order, aliases) : listed;
    if (groupArg) areas = areas.map((a) => ({ ...a, group: groupArg }));
  }
  if (!areas.length) throw new Error('could not work out the list of areas');
  console.log(`Areas: ${areas.map((a) => a.name).join(' | ')}`);
  let built = 0, held = 0;

  for (const found of areas) {
    // Same page as an existing one under a slightly different name (or a merged/renamed page): use that page. A revisit
    // ("Narshe (World of Ruin)") has its own name, so it gets its own page instead of being skipped as already built.
    const { slug: s, name } = resolveArea(found.name, order, aliases);
    const area = { ...found, name };
    if (!order.some((o) => o.slug === s)) order.push({ slug: s, name: area.name, story: area.story, ...(area.group ? { group: area.group } : {}) });
    const ref = guideRef.collection('areas').doc(s);
    const before = await ref.get();
    if (!(redo || restructure || upgrade) && before.exists && !retired(before)) {
      console.log(`- ${area.name}: already built (use --redo to rebuild)`);
      continue;
    }
    if (budgetLeft() < 8) {
      console.log(`Stopping: search cap nearly reached (${searches}/${maxSearches}). Run again later to continue.`);
      break;
    }
    console.log(`- ${area.name}`);
    try {
      const data = await research(area);
      // Details two different real websites already back are verified: no second search needed. Only details with
      // exactly one real source go to the fact-check, and pass only if it confirms them. Details with none are dropped.
      const all = [...data.items, ...data.secrets, ...data.enemies, ...data.shops];
      const oneSource = (e: GuideEntry) => (e.sources || []).length === 1;
      const toCheck = claimsFor(area.name, {
        overview: null,
        items: data.items.filter(oneSource), secrets: data.secrets.filter(oneSource),
        enemies: data.enemies.filter(oneSource), shops: data.shops.filter(oneSource), tips: [], extra: {}, fights: [],
      });
      const supported = toCheck.length ? await factCheck(area.name, toCheck) : new Set<string>();
      const keep = (e: GuideEntry) => twoSources(e) || (oneSource(e) && supported.has(e.id));
      const items = data.items.filter(keep), secrets = data.secrets.filter(keep), enemies = data.enemies.filter(keep), shops = data.shops.filter(keep);
      // Overview and tips are general advice: one real source is enough.
      const tips = data.tips.filter((t) => (t.sources || []).length >= 1).map((t) => t.text!).slice(0, 6);
      const overviewOk = data.overview && (data.overview.sources || []).length >= 1;
      const sections = sectionsFrom(data.extra, (e) => (e.sources || []).length >= 1);
      const kept = items.length + secrets.length + enemies.length + shops.length + sections.reduce((n, x) => n + x.entries.length, 0);
      const singleSource = all.filter((e) => oneSource(e) && !supported.has(e.id)).length;
      const unsourced = all.filter((e) => !(e.sources || []).length).length;
      const claims = toCheck;
      const rejected = toCheck.length - supported.size;
      const heldReason = kept < 3 ? 'too few confirmed details' : all.length && (rejected + unsourced) / all.length > 0.5 ? 'too many details had no real sources or failed the fact-check' : '';
      const usedSources = [...new Set([...items, ...secrets, ...enemies, ...shops].flatMap((e) => e.sources || []))];
      const page: GuideArea = {
        name: area.name,
        slug: s,
        order: order.findIndex((o) => o.slug === s),
        story: area.story,
        overview: overviewOk ? String(data.overview!.text || '') : '',
        items, secrets, enemies, shops, tips,
        ...(sections.length ? { sections } : {}),
        // Key fights a real source backs (they're advice as much as facts, so one source is enough, like tips).
        ...(data.fights.some((x) => (x.sources || []).length >= 1) ? { fights: data.fights.filter((x) => (x.sources || []).length >= 1).slice(0, 6) } : {}),
        ...(area.group ? { group: area.group } : {}),
        sources: usedSources.slice(0, 8),
        status: heldReason ? 'held' : (autoPublish || upgrade) && !stage ? 'published' : 'draft',
        verified: true,
        checks: { claims: claims.length, supported: supported.size, rejected, singleSource },
        ...(heldReason ? { heldReason } : {}),
        updatedAt: Date.now(),
      };
      // Upgrading: a page that doesn't pass keeps its quick version on the site (nothing disappears).
      if (upgrade && heldReason) {
        held++;
        await ref.update({ upgradeTried: new Date().toISOString() });
        console.log(`  kept the quick page: ${kept} details confirmed, not enough for a checked page (${heldReason})`);
      } else {
        await ref.set(page);
        if (heldReason) held++;
        else built++;
        console.log(`  ${page.status}: ${kept} details kept, ${unsourced} dropped (no real source), ${toCheck.length} fact-checked (${rejected} failed)${heldReason ? ` (${heldReason})` : ''}`);
      }
      // Only details that passed the checks go into the game knowledge base, filed under this area (when upgrading,
      // confirmed details are saved even if the page itself stays quick).
      if (!heldReason || upgrade) {
        const facts = [
          ...items.map((e) => ({ subject: e.name!, kind: e.missable ? 'missable' : 'item', fact: e.where! })),
          ...secrets.map((e) => ({ subject: (e.text || '').split(/[.:]/)[0].slice(0, 60), kind: 'secret', fact: e.text! })),
          ...enemies.map((e) => ({ subject: e.name!, kind: 'enemy', fact: [e.weakness && `Weak to ${e.weakness}`, e.steal && `Steal: ${e.steal}`, e.notes].filter(Boolean).join('; ') })),
          ...shops.map((e) => ({ subject: e.name!, kind: 'npc', fact: `Sells: ${e.sells}` })),
        ].filter((f) => f.subject && f.fact);
        // Two details with the same name in one area (two Phoenix Downs) would overwrite each other in the knowledge
        // base, which files facts by name and place: give repeats a short "where" so each is kept.
        const seen = new Map<string, number>();
        for (const f of facts) seen.set(f.subject.toLowerCase(), (seen.get(f.subject.toLowerCase()) || 0) + 1);
        for (const f of facts) {
          if ((seen.get(f.subject.toLowerCase()) || 0) > 1) f.subject = `${f.subject} (${f.fact.split(/[,.;]/)[0].trim().slice(0, 30)})`.slice(0, 60);
        }
        if (facts.length) saveGameFacts(game, facts, { searched: true, place: area.name, story: area.story, sources: usedSources.slice(0, 3) });
      }
    } catch (e: any) {
      if (String(e?.message).includes('search cap')) {
        console.log('Stopping: search cap reached. Run again later to continue.');
        break;
      }
      if (String(e?.message).startsWith('no-search')) {
        // The model wouldn't search: nothing from memory is allowed through, so the page is held back (when upgrading,
        // the quick page simply stays as it is).
        if (upgrade) {
          held++;
          await ref.update({ upgradeTried: new Date().toISOString() });
          console.log('  kept the quick page: the check ran no searches');
          continue;
        }
        await ref.set({ name: area.name, slug: s, order: order.findIndex((o) => o.slug === s), story: area.story, overview: '', items: [], secrets: [], enemies: [], shops: [], tips: [], sources: [], status: 'held', heldReason: 'research ran no searches', checks: { claims: 0, supported: 0, rejected: 0, singleSource: 0 }, updatedAt: Date.now() });
        held++;
        console.log('  held: the research ran no searches, so nothing could be verified');
        continue;
      }
      console.warn(`  failed: ${e?.message}`);
    }
  }
  await finishGuide(guideRef, order, previous);
  if (upgrade) {
    console.log(`Done: ${built} page(s) upgraded to checked, ${held} kept as quick pages, ${searches} searches used, estimated AI cost ≈ $${dollars.toFixed(2)}${unpriced ? ` (plus ${unpriced} call(s) on a model without a known rate)` : ''}. Searches are free up to 5,000 a month, then $14 per 1,000.`);
    console.log('Next: npx tsx scripts/guides/publish.ts   (then upload Marketing_Website_Files to Netlify)');
    setTimeout(() => process.exit(0), 4000);
    return;
  }
  console.log(`Done: ${built} page(s) ${autoPublish ? 'published' : 'saved as drafts'}, ${held} held back, ${searches} searches used, estimated AI cost ≈ $${dollars.toFixed(2)}${unpriced ? ` (plus ${unpriced} call(s) on a model without a known rate)` : ''}. Searches are free up to 5,000 a month, then $14 per 1,000.`);
  console.log('Next: npx tsx scripts/guides/publish.ts --drafts   (builds the pages into Marketing_Website_Files so you can look them over)');
  setTimeout(() => process.exit(0), 4000); // let the last database writes finish
}

main().catch((e) => {
  console.error('Guide build failed:', e?.message || e);
  process.exit(1);
});
