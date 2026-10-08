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
 * query word must match a word of the text (as a prefix, or within one typo for words of 5+ letters). Written without
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
      else if (w.length >= 5 && near(w, t)) best = Math.max(best, 1);
    }
    if (!best) return 0;
    score += best;
  }
  // A text that is (or starts with) the query ranks first.
  const nq = q.join(' '), nt = words.join(' ');
  return score + (nt === nq ? 4 : nt.startsWith(nq) ? 2 : 0);
}
