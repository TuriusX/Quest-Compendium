/** Website text helpers shared by publish.ts (and tested on their own: publish.ts publishes when it's loaded). */
import type { GuideArea } from './common';

/**
 * A game's name for titles: no trademark signs and no edition suffix ("The Witcher 3: Wild Hunt - Complete Edition"
 * becomes "The Witcher 3: Wild Hunt"), so search results show the place first and don't cut the title off.
 */
export function shortGame(game: string): string {
  const EDITION = "(?:the\\s+)?(?:complete|definitive|enhanced|game of the year|goty|anniversary|deluxe|ultimate|legendary|special|royal|director'?s cut|remastered)(?:\\s+edition)?";
  let g = String(game || '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
  g = g.replace(new RegExp(`\\s*\\((?:[^)]*edition|remastered)\\)$`, 'i'), '');
  g = g.replace(new RegExp(`\\s+[-–—]\\s+${EDITION}$`, 'i'), '');
  g = g.replace(new RegExp(`\\s+${EDITION.replace('(?:\\s+edition)?', '\\s+edition')}$`, 'i'), '');
  return g.trim() || String(game || '');
}
/**
 * Quest names an area page's entries mention ("the secondary quest "Man's Best Friend"", ""Lilac and Gooseberries"
 * quest"), for its related-quests line. Only quoted names next to a quest word.
 */
export function relatedQuests(a: GuideArea): string[] {
  const text = [
    ...a.items.flatMap((e) => [e.where, e.how, e.notes]), ...a.secrets.map((e) => e.text), ...a.tips,
    ...(a.sections || []).flatMap((x) => x.entries.map((e) => e.text)), a.overview,
    ...(a.fights || []).map((f) => f.tactics),
  ].filter(Boolean).join('\n');
  const found = new Map<string, string>();
  const re = /\b(?:quests?|questlines?|side quests?|main quests?|contracts?|missions?|treasure hunts?|jobs?)\s*:?\s*["“]([^"”\n]{3,60})["”]|["“]([^"”\n]{3,60})["”]\s+(?:quest|questline|side quest|main quest|contract|mission|treasure hunt)\b/gi;
  for (const m of text.matchAll(re)) {
    const name = String(m[1] || m[2]).trim().replace(/[.,;:]$/, '');
    if (name.split(/\s+/).length > 8) continue;
    const k = name.toLowerCase();
    if (!found.has(k)) found.set(k, name);
  }
  return [...found.values()].slice(0, 8);
}

/** What an achievement is like: the labels its page shows and filters on. */
export type AchFlag = 'missable' | 'collectible' | 'cumulative' | 'difficulty' | 'online' | 'buggy';
export const ACH_FLAGS: AchFlag[] = ['missable', 'collectible', 'cumulative', 'difficulty', 'online', 'buggy'];

/**
 * An achievement's labels: the builder's own (labels), plus what its text makes plain (older guides have no labels):
 * collect or find all / N things; do something many times; a difficulty or no-death run; online or co-op; reported as
 * glitched. Missable comes from the guide.
 */
export function achFlags(a: { desc?: string; how?: string; missable?: boolean; labels?: string[] }): AchFlag[] {
  const desc = String(a.desc || ''), all = `${desc} ${a.how || ''}`;
  const out = new Set<AchFlag>();
  for (const l of a.labels || []) if ((ACH_FLAGS as string[]).includes(l)) out.add(l as AchFlag);
  if (a.missable) out.add('missable');
  if (/\b(collect|find|obtain|gather|discover|read|unlock|acquire)\b[^.]{0,40}\b(all|every|each)\b|\b(all|every)\s+(\d+\s+)?(collectibles?|cards?|pages?|books?|notes?|letters?|maps?|treasures?|relics?|tarot)\b/i.test(desc)) out.add('collectible');
  if (/\b(\d{2,}|[3-9])\s+(times|enemies|kills|creatures|opponents|games|matches|battles|hits|days|quests|contracts|races)\b|\b(kill|defeat|slay|win|complete|craft|earn|deal|travel|open|destroy|loot|sell|buy)\b[^.]{0,25}?\b(\d{2,}|[3-9])\b|\b(in total|cumulative)\b/i.test(desc)) out.add('cumulative');
  if (/\b(difficulty|hard mode|honou?r mode|tactician|nightmare|death ?march|blood and broken bones|without dying|permadeath|ironman)\b/i.test(all)) out.add('difficulty');
  if (/\b(online|multiplayer|co-?op|pvp)\b/i.test(all)) out.add('online');
  if (/\b(glitch(ed|y)?|bugged|buggy|may not unlock|doesn'?t always unlock|known bug)\b/i.test(all)) out.add('buggy');
  return ACH_FLAGS.filter((f) => out.has(f));
}

/**
 * Links with their final URLs: a relative or questcompendium.com link to ".../index.html" becomes the folder URL
 * ("../limgrave/index.html#items" -> "../limgrave/#items", "index.html" -> "./"), which is what the site serves without a
 * redirect and what the canonical tags name.
 */
export function finalLinks(html: string): string {
  return html
    .replace(/href="(https:\/\/questcompendium\.com\/(?:[^"#?]*\/)?)index\.html([#?][^"]*)?"/g, (_m, p, rest = '') => `href="${p}${rest}"`)
    .replace(/href="((?:\/|(?:\.\.?\/)*)(?:[^"#?:/][^"#?:]*\/)?)index\.html([#?][^"]*)?"/g, (_m, p, rest = '') => `href="${p || './'}${rest}"`);
}

/**
 * Netlify _redirects lines for pages that moved: each old page (and its language versions) 301s to the page that
 * replaced it, in the same language when that page is translated, else in English. Old pages that are live again,
 * and moves to a page that isn't on the site, are left out. live: the site's URLs (the sitemap).
 */
export function redirectLines(moved: { key: string; from: string; to: string }[], live: Set<string>, langs: string[], site = 'https://questcompendium.com'): string[] {
  const out = new Map<string, string>();
  const liveUrls = [...live];
  for (const m of moved) {
    // to '' is the guide's front page.
    if (!m.from || m.from === m.to) continue;
    for (const code of langs) {
      const pre = code === 'en' ? '' : `${code}/`;
      // Only languages the guide is published in (an untranslated guide never had a /de/ URL to redirect).
      if (code !== 'en' && !liveUrls.some((u) => u.startsWith(`${site}/${pre}guides/${m.key}/`))) continue;
      const from = `/${pre}guides/${m.key}/${m.from}/`;
      if (live.has(`${site}${from}`) || out.has(from)) continue;
      const same = `/${pre}guides/${m.key}/${m.to ? `${m.to}/` : ''}`;
      const en = `/guides/${m.key}/${m.to ? `${m.to}/` : ''}`;
      const to = live.has(`${site}${same}`) ? same : live.has(`${site}${en}`) ? en : '';
      if (to) out.set(from, to);
    }
  }
  return [...out].map(([from, to]) => `${from} ${to} 301`);
}

/** An entity the guide text can link to (the compendium, scripts/guides/compendium.ts). */
export type LinkEntity = { name: string; slug: string; aliases?: string[] };

/**
 * Guide text cut into plain runs and entity mentions (every mention, longest names first, never overlapping), for links
 * to entity pages. Matching ignores case and apostrophes ("Thieves Landing" finds Thieves' Landing) and needs whole words.
 */
export function entitySegments(text: string, entities: LinkEntity[]): { text: string; slug?: string }[] {
  const s = String(text || '');
  if (!s || !entities.length) return [{ text: s }];
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = (name: string) => esc(name).replace(/['’]/g, "['’]?").replace(/\s+/g, '\\s+');
  const names = entities.flatMap((e) => [e.name, ...(e.aliases || [])].filter((n) => n && n.length >= 3).map((n) => ({ n, slug: e.slug })))
    .sort((a, b) => b.n.length - a.n.length);
  const hits: { start: number; end: number; slug: string }[] = [];
  for (const { n, slug } of names) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern(n)}(?![\\p{L}\\p{N}])`, 'giu');
    for (const m of s.matchAll(re)) {
      const start = m.index!, end = start + m[0].length;
      if (hits.some((h) => start < h.end && h.start < end)) continue;
      hits.push({ start, end, slug });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out: { text: string; slug?: string }[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start > at) out.push({ text: s.slice(at, h.start) });
    out.push({ text: s.slice(h.start, h.end), slug: h.slug });
    at = h.end;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

/**
 * How well a guide search query matches a text (0 = not at all; higher is better). Forgiving the way players type:
 * case, accents and apostrophes don't matter ("thieves landing", "keira metz house"), plurals match singulars, every
 * query word must match a word of the text (as a prefix, or within one typo for words of 4+ letters). Written without
 * outside helpers: the website's search runs this same function (fuzzyScore.toString()).
 */
export function fuzzyScore(query: string, text: string): number {
  const norm = (x: string) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const stem = (w: string) => (w.length > 4 && /ies$/.test(w) ? w.slice(0, -3) + 'y' : w.length > 3 && /(s|es)$/.test(w) && !/ss$/.test(w) ? w.replace(/(es|s)$/, '') : w);
  const near = (a: string, b: string) => {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  };
  const q = norm(query).split(' ').filter(Boolean).map(stem);
  const words = norm(text).split(' ').filter(Boolean).map(stem);
  if (!q.length || !words.length) return 0;
  let score = 0;
  for (const w of q) {
    let best = 0;
    for (const t of words) {
      if (t === w) best = Math.max(best, 3);
      else if (t.startsWith(w) && w.length >= 2) best = Math.max(best, 2);
      else if (w.length >= 4 && near(w, t)) best = Math.max(best, 1);
    }
    if (!best) return 0;
    score += best;
  }
  // A text that is (or starts with) the query ranks first.
  const nq = q.join(' '), nt = words.join(' ');
  return score + (nt === nq ? 4 : nt.startsWith(nq) ? 2 : 0);
}

/**
 * The chapter a text names, as a comparable key: "Chapter 3, the region near Rhodes" -> "chapter 3", "Epilogue Chapter
 * 2" / "Epilogue Part 2" -> "epilogue 2", "Act II" -> "act 2", "Prologue" -> "prologue". null when it names none.
 */
export function chapterKey(text: string): string | null {
  const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  const t = String(text || '').toLowerCase();
  const n = (v: string | undefined) => (v ? (/^\d+$/.test(v) ? String(Number(v)) : roman[v] ? String(roman[v]) : '') : '');
  const ep = t.match(/\b(epilogue|prologue)\b(?:\s*[:,-]?\s*(?:chapter|part|act)?\s*(\d+|[ivx]+)\b)?/);
  if (ep) return `${ep[1]}${n(ep[2]) ? ` ${n(ep[2])}` : ''}`;
  const m = t.match(/\b(chapter|act|part|day|episode|book)\s*(\d+|[ivx]+)\b/);
  return m && n(m[2]) ? `${m[1]} ${n(m[2])}` : null;
}

/**
 * The live page for a held page's chapter (its story note): the page named after the same chapter ("Chapter 3:
 * Clemens Point" for "Chapter 3, ..."), else, for an epilogue or prologue, the guide's page of that kind. When the note
 * says whose chapter it is ("H'aanit Chapter 3"), the page's name must name them too (games with a chapter per
 * character).
 */
export function chapterPage(story: string, pages: { slug: string; name: string }[]): string | undefined {
  const want = chapterKey(story);
  if (!want) return undefined;
  const norm = (x: string) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]s\b/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const at = String(story).toLowerCase().search(/\b(chapter|act|part|day|episode|book|epilogue|prologue)\b/);
  const owner = at > 0 ? norm(String(story).slice(0, at)) : '';
  const keyed = pages.filter((p) => !owner || norm(p.name).includes(owner)).map((p) => ({ slug: p.slug, k: chapterKey(p.name) }));
  const exact = keyed.find((p) => p.k === want);
  if (exact) return exact.slug;
  const kind = want.split(' ')[0];
  return kind === 'epilogue' || kind === 'prologue' ? keyed.find((p) => p.k?.split(' ')[0] === kind)?.slug : undefined;
}

/**
 * The live page that covers most of a held page's named entries (its items, secrets, shops, enemies and fights): the
 * page whose text mentions the most of those names, needing at least `min` of them. For a redirect when nothing else
 * names the place. hint (the held page's name and chapter note) keeps it honest: a page for another chapter number
 * ("Chapter 2" for a Chapter 10 page) is never picked, and when the note says whose chapter it is ("Castti's Chapter
 * 1"), only that character's pages are considered if the guide has any.
 */
export function coveringPage(names: string[], pages: { slug: string; name?: string; text: string }[], min = 3, hint = ''): string | undefined {
  const wanted = [...new Set(names.map((n) => String(n || '').trim()).filter((n) => n.length >= 4))].slice(0, 40);
  if (wanted.length < min) return undefined;
  const norm = (x: string) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]s\b/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const want = chapterKey(hint);
  const at = String(hint).toLowerCase().search(/\b(chapter|act|part|day|episode|book)\b/);
  const owner = at > 0 ? norm(String(hint).slice(0, at)).split(' ').slice(-1)[0] : '';
  let pool = pages.filter((p) => { const k = p.name ? chapterKey(p.name) : null; return !want || !k || k.split(' ')[0] !== want.split(' ')[0] || k === want; });
  if (owner && owner.length >= 3) {
    const own = pool.filter((p) => norm(p.name || '').includes(owner));
    if (own.length) pool = own;
  }
  let best: { slug: string; n: number } | undefined;
  for (const p of pool) {
    const n = wanted.filter((name) => entitySegments(p.text, [{ name, slug: 'x' }]).some((s) => s.slug)).length;
    if (n >= min && (!best || n > best.n)) best = { slug: p.slug, n };
  }
  return best?.slug;
}

/** A sentence explaining what kind of thing an entity is or isn't ("X is an NPC rather than a location"). */
export const KIND_EXPLAIN = /\b(?:is|are|was|serves as)\b[^.!?]*?\b(?:rather than|not|instead of|as opposed to)\s+(?:a|an|the)?\s*(?:physical |geographical |actual |playable )?(?:location|place|region|town|settlement|area|mission hub|landmark|character|npc|person)s?\b/i;
/** Generic travel filler (on a character's page it's never the answer to "where is X"). */
export const TRAVEL_FILLER = /\b(?:fast[- ]travel|use (?:the|your) map|follow the (?:main )?road|ride (?:north|south|east|west)|make your way)\b/i;

/**
 * The rejection check for entity pages, before publishing: sentences explaining what kind of entity it is are removed
 * everywhere, and a person's page loses its "Getting there" (a character is found, not travelled to; their
 * whereToFind says where) and any travel-filler sentence. Returns the cleaned summary fields and what was removed;
 * `left` lists anything that still fails (the page is then held).
 */
export function lintEntity(p: { overview?: string; summary: Record<string, any> }, person: boolean) {
  const removed: string[] = [];
  const sentences = (t: string) => String(t || '').split(/(?<=[.!?])\s+/).filter(Boolean);
  const clean = (t: string, travel: boolean) => sentences(t).filter((s) => {
    const bad = KIND_EXPLAIN.test(s) || (travel && TRAVEL_FILLER.test(s));
    if (bad) removed.push(s);
    return !bad;
  }).join(' ');
  const overview = clean(p.overview || '', person);
  const summary = { ...p.summary };
  for (const f of ['where', 'region']) if (summary[f]) summary[f] = clean(summary[f], person);
  if (Array.isArray(summary.notes)) summary.notes = summary.notes.map((n: string) => clean(n, person)).filter(Boolean);
  if (person && summary.gettingThere) { removed.push(`Getting there: ${summary.gettingThere}`); delete summary.gettingThere; }
  else if (summary.gettingThere) summary.gettingThere = clean(summary.gettingThere, false);
  const all = [overview, summary.where, summary.region, summary.gettingThere, ...(summary.notes || []), ...(summary.whereToFind || []).map((w: any) => w.where)].filter(Boolean).join(' ');
  const left = sentences(all).filter((s) => KIND_EXPLAIN.test(s));
  return { overview, summary, removed, left };
}

/**
 * A compendium type's label for one entity: "Characters" -> "Character", "Companions & Allies" -> "Companion & Ally",
 * "Bosses" -> "Boss", "Locations & Settlements" -> "Location & Settlement", "NPCs" -> "NPC", "People" -> "Person".
 * The last word of each part is made singular; words that are already singular stay.
 */
export function singularLabel(label: string): string {
  const irregular: Record<string, string> = { people: 'person', wolves: 'wolf', knives: 'knife', thieves: 'thief', lives: 'life', fish: 'fish', sheep: 'sheep', series: 'series', species: 'species' };
  const one = (w: string) => {
    const lower = w.toLowerCase();
    let out = w;
    if (irregular[lower]) out = irregular[lower];
    else if (/[^aeiou]ies$/i.test(w)) out = w.slice(0, -3) + 'y';
    else if (/(ss|sh|ch|x|z)es$/i.test(w)) out = w.slice(0, -2);
    else if (/[A-Z]s$/.test(w)) out = w.slice(0, -1); // NPCs
    else if (/[^s]s$/i.test(w) && w.length > 3) out = w.slice(0, -1);
    return w[0] === w[0].toUpperCase() ? out[0].toUpperCase() + out.slice(1) : out;
  };
  return String(label || '').split(/(\s*&\s*|\s+and\s+|,\s*|\s*\/\s*)/).map((part, i) => {
    if (i % 2) return part;
    const words = part.split(' ');
    words[words.length - 1] = one(words[words.length - 1]);
    return words.join(' ');
  }).join('');
}

/** What kind of entity a compendium type is (its label): a person, a boss or enemy, a thing (item, power, class), or a place. */
export function entityKind(type: string): 'person' | 'boss' | 'thing' | 'place' {
  const t = String(type || '').toLowerCase();
  if (/charact|npc|compan|merchant|people|person|vendor|trader|ally|allies|villain|origin|follower|romance|hireling|quest giver|gang member/.test(t)) return 'person';
  if (/boss|enem|monster|creature|foe|dragon|demigod/.test(t)) return 'boss';
  if (/power|spell|abilit|item|weapon|armou?r|class|feat|skill|perk|talent|trinket|talisman|relic|specimen|parasite|rune|ash of war|gear|equipment|lure|recipe/.test(t)) return 'thing';
  return 'place';
}
