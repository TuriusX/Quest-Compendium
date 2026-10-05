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
