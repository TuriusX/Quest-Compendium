/**
 * IGDB image URLs for a guide's game (guides/{key}.igdb, from scripts/pipeline/igdb.ts), sized for each spot. Images
 * load from IGDB's image server; a size is only offered when the original is at least that wide, so nothing is
 * upscaled. A guide IGDB has no art for falls back to its Steam art (callers keep that path).
 */
export type IgdbImg = { id: string; w: number; h: number };
export type IgdbInfo = { id?: number; name?: string; url?: string; released?: string | null; platforms?: string[]; genres?: string[]; cover?: IgdbImg | null; art?: IgdbImg | null; screenshots?: IgdbImg[]; missing?: boolean;
  /** Time to beat from players' submissions (whole hours; 0 = none given) and how many submissions there are. */
  ttb?: { main: number; extras: number; complete: number; count: number } };

/** The time-to-beat rules: at least this many players' submissions by default (config/igdb.ttbMinCount overrides it). */
export const TTB_MIN_DEFAULT = 10;
export type TtbShown = { main: number; extras: number; complete: number; count: number };
/**
 * What a guide shows of IGDB's time to beat (whole hours; 0 = left out), or null for nothing. Players' averages can be
 * thrown off by a few wild entries (Baldur's Gate 3: 5,650 h completionist next to 132 h main + extras) or barely differ,
 * so a longer category is left out when it's
 *   - shorter than the category before it, or more than 5 times it,
 *   - within 10% of it (Baldur's Gate 3: 132 h main + extras after 128 h main story says nothing new),
 *   - over 1,000 h;
 * and nothing shows below `min` submissions or for a guide hidden in config/igdb.ttbHide.
 */
export function ttbShown(t: { main?: number; extras?: number; complete?: number; count?: number } | null | undefined, min = TTB_MIN_DEFAULT, hidden = false): TtbShown | null {
  if (!t || hidden || (Number(t.count) || 0) < min) return null;
  const h = (v: unknown) => (Number(v) >= 1 && Number(v) <= 1000 ? Math.round(Number(v)) : 0);
  const out = { main: h(t.main), extras: h(t.extras), complete: h(t.complete), count: Number(t.count) || 0 };
  const fits = (longer: number, shorter: number) => !shorter || (longer > shorter * 1.1 && longer <= shorter * 5);
  if (out.extras && !fits(out.extras, out.main)) out.extras = 0;
  if (out.complete && !fits(out.complete, out.extras || out.main)) out.complete = 0;
  return out.main || out.extras || out.complete ? out : null;
}

export const igdbUrl = (id: string, size: string, ext: 'webp' | 'jpg' = 'webp') => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.${ext}`;

/** IGDB's landscape sizes, by width. */
const WIDE: [string, number][] = [['screenshot_med', 569], ['screenshot_big', 889], ['720p', 1280], ['1080p', 1920]];

/** The landscape picture: the key art, else the widest screenshot. */
export const landscapeOf = (g?: IgdbInfo | null): IgdbImg | null => (g && !g.missing ? g.art || (g.screenshots || [])[0] || null : null);

/** src and srcset for a landscape spot up to maxW pixels wide (the largest size the original allows). */
export function wideSet(img: IgdbImg, maxW: number): { src: string; srcset: string } {
  const fit = WIDE.filter(([, w]) => w <= Math.max(img.w || 0, WIDE[0][1]) && w <= maxW);
  const sizes = fit.length ? fit : [WIDE[0]];
  return { src: igdbUrl(img.id, sizes[sizes.length - 1][0]), srcset: sizes.map(([s, w]) => `${igdbUrl(img.id, s)} ${w}w`).join(', ') };
}

/** The cover (portrait): 264 px wide, 528 for sharp screens. */
export const coverSet = (img: IgdbImg) => ({ src: igdbUrl(img.id, 'cover_big'), srcset: `${igdbUrl(img.id, 'cover_big')} 264w, ${igdbUrl(img.id, 'cover_big_2x')} 528w` });

/** The social share image (Open Graph): the landscape picture at up to 1920 px, as JPEG (some apps can't show WebP). */
export function ogImageOf(g?: IgdbInfo | null): string {
  const img = landscapeOf(g);
  if (!img) return '';
  const fit = WIDE.filter(([, w]) => w <= Math.max(img.w || 0, 1280));
  return igdbUrl(img.id, (fit[fit.length - 1] || WIDE[2])[0], 'jpg');
}

/**
 * IGDB's platform names for a front page: short names, PC first, then current consoles, then older ones, then mobile;
 * discontinued streaming services (Google Stadia and the like) left out.
 */
const PLATFORMS: [RegExp, string, number][] = [
  [/^PC \(Microsoft Windows\)$|^PC$/, 'PC', 0], [/^Mac$/, 'Mac', 1], [/^Linux$/, 'Linux', 2],
  [/^PlayStation 5$/, 'PS5', 10], [/^Xbox Series X\|S$/, 'Xbox Series X|S', 11], [/^Nintendo Switch 2$/, 'Switch 2', 12], [/^Nintendo Switch$/, 'Switch', 13],
  [/^PlayStation 4$/, 'PS4', 20], [/^Xbox One$/, 'Xbox One', 21], [/^Wii U$/, 'Wii U', 22], [/^(New )?Nintendo 3DS$/, '3DS', 23], [/^PlayStation Vita$/, 'PS Vita', 24],
  [/^PlayStation 3$/, 'PS3', 30], [/^Xbox 360$/, 'Xbox 360', 31], [/^Wii$/, 'Wii', 32], [/^Nintendo DS$/, 'DS', 33], [/^PlayStation Portable$/, 'PSP', 34],
  [/^PlayStation 2$/, 'PS2', 40], [/^Xbox$/, 'Xbox', 41], [/^Nintendo GameCube$/, 'GameCube', 42], [/^Game Boy Advance$/, 'Game Boy Advance', 43],
  [/^PlayStation$/, 'PS1', 50], [/^Nintendo 64$/, 'N64', 51], [/^Dreamcast$/, 'Dreamcast', 52], [/^Sega Saturn$/, 'Saturn', 53],
  [/^Super Nintendo Entertainment System$|^Super Famicom$/, 'SNES', 54], [/^Nintendo Entertainment System$|^Family Computer$/, 'NES', 55], [/^Game Boy Color$/, 'Game Boy Color', 56], [/^Game Boy$/, 'Game Boy', 57],
  [/^iOS$/, 'iOS', 60], [/^Android$/, 'Android', 61],
];
const DISCONTINUED = /^(Google Stadia|OnLive|Amazon Luna|Xbox Cloud Gaming|PlayStation Now|Ouya)$/i;
export function platformList(names: string[] = []): string[] {
  const out = new Map<string, number>();
  for (const n of names) {
    if (DISCONTINUED.test(n)) continue;
    const hit = PLATFORMS.find(([re]) => re.test(n));
    const [short, rank] = hit ? [hit[1], hit[2]] : [n, 70];
    if (!out.has(short)) out.set(short, rank);
  }
  return [...out].sort((a, b) => a[1] - b[1]).map(([n]) => n);
}
