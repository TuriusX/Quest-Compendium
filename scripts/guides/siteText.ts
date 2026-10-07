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
  for (const m of moved) {
    if (!m.from || !m.to || m.from === m.to) continue;
    for (const code of langs) {
      const pre = code === 'en' ? '' : `${code}/`;
      const from = `/${pre}guides/${m.key}/${m.from}/`;
      if (live.has(`${site}${from}`) || out.has(from)) continue;
      const same = `/${pre}guides/${m.key}/${m.to}/`;
      const en = `/guides/${m.key}/${m.to}/`;
      const to = live.has(`${site}${same}`) ? same : live.has(`${site}${en}`) ? en : '';
      if (to) out.set(from, to);
    }
  }
  return [...out].map(([from, to]) => `${from} ${to} 301`);
}
