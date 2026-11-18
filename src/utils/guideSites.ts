/**
 * The Guides tab's browser (docs/proposals/guide-browser.md): what the address bar makes of what's typed, the sites
 * suggested for a game, and the default favourites (the same six sites as the Steam Deck plugin's guide browser).
 * Worked out here, with no AI and no cost.
 */

export type Site = { name: string; url: string };

/** The Deck plugin's DEFAULT_SITES, as favourites. */
export const DEFAULT_FAVOURITES: Site[] = [
  { name: 'GameFAQs', url: 'https://gamefaqs.gamespot.com/' },
  { name: 'Neoseeker', url: 'https://www.neoseeker.com/' },
  { name: 'Fandom', url: 'https://www.fandom.com/' },
  { name: 'IGN', url: 'https://www.ign.com/wikis' },
  { name: 'Reddit', url: 'https://www.reddit.com/' },
  { name: 'YouTube', url: 'https://www.youtube.com/' },
];

const q = (s: string) => encodeURIComponent(s.trim());

/** Sites for this game: [key, url]. The key names the site for the app's labels (brand names stay as they are). */
export function suggestedSites(game: string, steamAppId?: number): { key: 'steam' | 'fandom' | 'gamefaqs' | 'youtube' | 'map' | 'reddit'; url: string }[] {
  const g = (game || '').trim();
  if (!g) return [];
  return [
    ...(steamAppId && steamAppId > 0 ? [{ key: 'steam' as const, url: `https://steamcommunity.com/app/${steamAppId}/guides/` }] : []),
    { key: 'fandom' as const, url: `https://www.fandom.com/?s=${q(g)}` },
    { key: 'gamefaqs' as const, url: `https://gamefaqs.gamespot.com/search?game=${q(g)}` },
    { key: 'youtube' as const, url: `https://www.youtube.com/results?search_query=${q(`${g} walkthrough`)}` },
    { key: 'map' as const, url: `https://www.google.com/search?q=${q(`${g} interactive map`)}` },
    { key: 'reddit' as const, url: `https://www.reddit.com/search/?q=${q(g)}` },
  ];
}

/**
 * What the address bar opens for what was typed: an address as it is (https:// added), anything else a Google search.
 * A search gets the game's name added when it isn't in the words already, since this is a guides browser.
 */
export function addressToUrl(input: string, game?: string): string {
  const s = (input || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s)) return `https://${s}`;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return `http://${s}`;
  const g = (game || '').trim();
  const words = g && !s.toLowerCase().includes(g.toLowerCase()) ? `${g} ${s}` : s;
  return `https://www.google.com/search?q=${q(words)}`;
}

/** The site's name for a tab with no title yet: "gamefaqs.gamespot.com" -> "gamefaqs.gamespot.com" (no www.). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The same page, ignoring a trailing slash and the fragment: is this page a favourite? */
export const samePage = (a: string, b: string): boolean => {
  const norm = (u: string) => (u || '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
  return !!a && norm(a) === norm(b);
};
