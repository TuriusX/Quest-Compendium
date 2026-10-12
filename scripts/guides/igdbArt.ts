/**
 * IGDB image URLs for a guide's game (guides/{key}.igdb, from scripts/pipeline/igdb.ts), sized for each spot. Images
 * load from IGDB's image server; a size is only offered when the original is at least that wide, so nothing is
 * upscaled. A guide IGDB has no art for falls back to its Steam art (callers keep that path).
 */
export type IgdbImg = { id: string; w: number; h: number };
export type IgdbInfo = { id?: number; name?: string; url?: string; released?: string | null; platforms?: string[]; genres?: string[]; cover?: IgdbImg | null; art?: IgdbImg | null; screenshots?: IgdbImg[]; missing?: boolean };

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
