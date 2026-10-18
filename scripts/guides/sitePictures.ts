/**
 * Pictures on the public guide pages (roadmap 14, phase 3): the pictures the owner approved in /admin/images, where his
 * switches put them. Read by publish.ts on every publish, so a new approval goes live with the next nightly publish.
 *
 *   - "Guide page" on an area or compendium page: the page's picture, beside the opening text (300 wide, 4:3, on wider
 *     screens; a 112px square on phones, tap to enlarge), and the page's preview image for search and Discord
 *     (a 1200×630 JPEG made here: og.jpg).
 *   - "Quest log / step" on a walkthrough step or a checklist entry: a small picture there (lazy-loaded), only where
 *     the owner turned it on.
 * The owner's caption and alt text as written; a credit line only where an official source's terms ask for one (never
 * under his own captures). One picture per place: the best source (his captures first), then the latest approved.
 *
 * Files: copied once from the private bucket (guideImages.ts) into the site at /img/g/{id}/ (the publish only clears
 * /guides/, and Netlify's upload sends only new files), in the sizes already made: 300 and 600 wide in AVIF and WebP,
 * 1280 WebP for the enlarged view, a 160 WebP thumbnail.
 *
 * Every cut of a picture (the page's 4:3 and phone square, the 16:9 thumbnails, the share image) is centred on its
 * focal point (src/utils/focus.ts): the owner's, or the one found once when it is first published (pictureFocus.ts).
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { getStorage } from 'firebase-admin/storage';
import { db } from './common';
import { asFocus, defaultFocus, coverOffsets, coverPosition, type Focus } from '../../src/utils/focus';
import { findFocus, pictureBudget, FOCUS_COST } from './pictureFocus';

const BUCKET = process.env.GUIDE_IMAGE_BUCKET || 'quest-compendium-guide-images';
const FILES = ['w300.webp', 'w300.avif', 'w600.webp', 'w600.avif', 'w1280.webp', 'thumb.webp'];

export type SitePicture = {
  id: string;
  kind: 'area' | 'entity' | 'step' | 'entry';
  game: string;
  slug: string;
  entry?: string;
  page: boolean;
  step: boolean;
  /** "App answer": the card under an app answer that uses this entry or page. */
  answer: boolean;
  alt: string;
  caption: string;
  credit: string;
  width: number;
  height: number;
  /** Where its cuts are centred (the owner's, the one found, or the default). */
  focus: Focus;
};
/** A character's picture: without a focal point it is held near the top (a portrait's head). */
const PERSON = /charac|person|npc|companion|ally|villain|gang|member|boss|enemy|creature|monster/i;

const PICS = new Map<string, SitePicture>();
const keyOf = (game: string, kind: string, slug: string, entry = '') => `${game}|${kind}|${slug}|${entry}`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const url = (id: string, f: string) => `/img/g/${id}/${f}`;

/**
 * The approved pictures (every game, or one with --only), the best one per place, with their files in <out>/img/g/.
 * Returns how many are on the site.
 */
export async function loadSitePictures(out: string, only = ''): Promise<number> {
  PICS.clear();
  let q: FirebaseFirestore.Query = db().collection('guideImages').where('status', '==', 'approved');
  if (only) q = q.where('game', '==', only);
  const rows = (await q.get()).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  // Best first: the owner's captures, then press, IGDB, wiki, Steam; the latest approval among equals.
  rows.sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0) || (Number(b.approvedAt) || 0) - (Number(a.approvedAt) || 0));
  const bucket = getStorage().bucket(BUCKET);
  let budget: Awaited<ReturnType<typeof pictureBudget>> | null = null, looked = 0;
  for (const x of rows) {
    const t = x.target || {};
    if (!t.kind || !t.slug) continue;
    const page = !!x.placement?.page && (t.kind === 'area' || t.kind === 'entity');
    const step = !!x.placement?.step;
    const answer = !!x.placement?.answer;
    if (!page && !step && !answer) continue;
    const k = keyOf(String(x.game), t.kind, String(t.slug), t.id ? String(t.id) : '');
    if (PICS.has(k)) continue;
    // The files, once (a later publish finds them in place).
    const dir = path.join(out, 'img', 'g', x.id);
    let focus: Focus, w = 0, h = 0;
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of FILES) {
        const file = path.join(dir, f);
        if (!fs.existsSync(file)) fs.writeFileSync(file, (await bucket.file(`v/${x.id}/${f}`).download())[0]);
      }
      const big = path.join(dir, 'w1280.webp');
      ({ width: w = 0, height: h = 0 } = await sharp(big).metadata());
      // Its focal point: the owner's, else the one found before, else look once (within the pictures' budget).
      let f = asFocus(x.focus) || asFocus(x.autoFocus);
      if (!f && !x.autoFocusTried && process.env.PICTURE_FOCUS !== 'off') {
        budget ||= await pictureBudget();
        if (budget.nightLeft >= FOCUS_COST && budget.monthLeft >= FOCUS_COST) {
          f = await findFocus(await sharp(path.join(dir, 'w600.webp')).jpeg({ quality: 80 }).toBuffer(), String(t.name || ''), String(t.label || ''));
          await budget.add(FOCUS_COST);
          looked++;
          await db().collection('guideImages').doc(x.id).set({ autoFocus: f, autoFocusTried: Date.now() }, { merge: true });
        }
      }
      focus = f || defaultFocus(w, h, t.kind === 'entity' && PERSON.test(String(t.label || '')));
      // The share image: 1200×630 JPEG (what Discord, Facebook and search previews read best), pages only, cut around
      // the focal point (made again when that moves: og.txt holds the one it was made with).
      const og = path.join(dir, 'og.jpg'), ogAt = path.join(dir, 'og.txt'), at = JSON.stringify(focus);
      if (page && (!fs.existsSync(og) || (fs.existsSync(ogAt) ? fs.readFileSync(ogAt, 'utf8') : '') !== at)) {
        const s = Math.max(1200 / w, 630 / h), sw = Math.round(w * s), sh = Math.round(h * s), o = coverOffsets(w, h, focus, 1200, 630);
        fs.writeFileSync(og, await sharp(big).resize(sw, sh).extract({ left: Math.round((sw - 1200) * o.x), top: Math.round((sh - 630) * o.y), width: 1200, height: 630 }).jpeg({ quality: 82, mozjpeg: true }).toBuffer());
        fs.writeFileSync(ogAt, at);
      }
    } catch (e: any) {
      console.warn(`Picture ${x.id} (${t.name}) left out: ${e?.message}`);
      continue;
    }
    PICS.set(k, {
      id: x.id, kind: t.kind, game: String(x.game), slug: String(t.slug), entry: t.id ? String(t.id) : undefined, page, step, answer,
      alt: String(x.alt || t.name || ''), caption: String(x.caption || t.name || ''),
      // Only an official source's credit, and only where its terms ask for one.
      credit: x.source !== 'mine' && x.credit ? String(x.credit) : '',
      width: w, height: h, focus,
    });
  }
  if (looked) console.log(`Pictures: found the focal point of ${looked} new picture(s) (about $${(looked * FOCUS_COST).toFixed(3)}).`);
  return PICS.size;
}

/** The page's own picture (an area or compendium page with "Guide page" on). */
export function pagePicture(game: string, slug: string): SitePicture | null {
  const p = PICS.get(keyOf(game, 'area', slug)) || PICS.get(keyOf(game, 'entity', slug));
  return p && p.page ? p : null;
}
/** A walkthrough step's or a checklist entry's picture ("Quest log / step" on). */
export function stepPicture(game: string, slug: string, id: string, kind: 'step' | 'entry'): SitePicture | null {
  const p = PICS.get(keyOf(game, kind, slug, id));
  return p && p.step ? p : null;
}
/**
 * A game's pictures for the apps (guides/{key}/pictures.json): where each may show (page, quest log / step, app answer),
 * its sizes as absolute addresses, the owner's caption and alt text, and a credit where the source needs one.
 */
export function picturesOf(game: string, site = 'https://questcompendium.com') {
  return [...PICS.values()].filter((p) => p.game === game).map((p) => ({
    kind: p.kind, slug: p.slug, ...(p.entry ? { id: p.entry } : {}), page: p.page, step: p.step, answer: p.answer,
    thumb: `${site}${url(p.id, 'thumb.webp')}`, w300: `${site}${url(p.id, 'w300.webp')}`, w600: `${site}${url(p.id, 'w600.webp')}`, big: `${site}${url(p.id, 'w1280.webp')}`,
    alt: p.alt, caption: p.caption, ...(p.credit ? { credit: p.credit } : {}), w: p.width, h: p.height, focus: p.focus,
  }));
}

/** One picture for the apps' data files (page.json): its sizes as absolute addresses, caption, alt text, credit. */
export function pictureJson(p: SitePicture, site = 'https://questcompendium.com') {
  return { thumb: `${site}${url(p.id, 'thumb.webp')}`, w300: `${site}${url(p.id, 'w300.webp')}`, w600: `${site}${url(p.id, 'w600.webp')}`, big: `${site}${url(p.id, 'w1280.webp')}`, alt: p.alt, caption: p.caption, ...(p.credit ? { credit: p.credit } : {}), w: p.width, h: p.height, focus: p.focus };
}

/** The share image's address (absolute, for og:image). */
export const shareImage = (site: string, p: SitePicture) => `${site}${url(p.id, 'og.jpg')}`;

const credit = (p: SitePicture) => (p.credit ? `<span class="block text-zinc-500">${esc(p.credit)}</span>` : '');

/**
 * The page's picture beside the opening text: floated right, 300 wide (4:3) from 640px up, a 112px square on phones
 * with ⤢ (the link opens the large picture). It's at the top of the page, so it loads first (no lazy loading).
 */
export function heroHtml(p: SitePicture): string {
  const sizes = '(min-width: 640px) 288px, 104px';
  // Cut around its focal point: the phone's square and the 4:3 from 640px up each have their own position.
  const fp = `--fp:${coverPosition(p.width, p.height, p.focus, 104, 104)};--fp-sm:${coverPosition(p.width, p.height, p.focus, 288, 216)}`;
  return `<figure class="float-right ml-4 sm:ml-5 mb-3 mt-1 w-28 sm:w-[300px] rounded-xl border border-[#c4b0ff]/25 bg-[#12121b] p-1 sm:p-1.5">
        <a href="${url(p.id, 'w1280.webp')}" class="relative block" aria-label="${esc(p.caption)}">
          <picture><source type="image/avif" srcset="${url(p.id, 'w300.avif')} 300w, ${url(p.id, 'w600.avif')} 600w" sizes="${sizes}"><img src="${url(p.id, 'w600.webp')}" srcset="${url(p.id, 'w300.webp')} 300w, ${url(p.id, 'w600.webp')} 600w" sizes="${sizes}" width="288" height="216" alt="${esc(p.alt)}" fetchpriority="high" decoding="async" style="${fp}" class="block w-full aspect-square sm:aspect-[4/3] object-cover [object-position:var(--fp)] sm:[object-position:var(--fp-sm)] rounded-lg"></picture>
          <span class="sm:hidden absolute right-1 bottom-1 rounded bg-black/65 px-1 text-[10px] leading-4 text-white" aria-hidden="true">&#10530;</span>
        </a>
        ${p.caption || p.credit ? `<figcaption class="mt-1 sm:mt-1.5 text-[10.5px] sm:text-xs leading-snug"><span class="hidden sm:block font-semibold text-zinc-200">${esc(p.caption)}</span>${credit(p)}</figcaption>` : ''}
      </figure>`;
}

/** A walkthrough step's picture: 160×90 under its text, lazy (below the first screen), the link opens it large. */
export function stepHtml(p: SitePicture): string {
  return `<figure class="mt-2 flex items-center gap-3">
              <a href="${url(p.id, 'w1280.webp')}" class="shrink-0" aria-label="${esc(p.caption)}"><img src="${url(p.id, 'thumb.webp')}" srcset="${url(p.id, 'thumb.webp')} 160w, ${url(p.id, 'w300.webp')} 300w" sizes="160px" width="160" height="90" loading="lazy" decoding="async" alt="${esc(p.alt)}" style="object-position:${coverPosition(p.width, p.height, p.focus, 160, 90)}" class="block w-40 aspect-video object-cover rounded-lg border border-white/10"></a>
              <figcaption class="text-xs leading-snug text-zinc-400">${esc(p.caption)}${credit(p)}</figcaption>
            </figure>`;
}

/** A checklist entry's picture: a small one under the entry's text, lazy. */
export function entryHtml(p: SitePicture): string {
  return `<a href="${url(p.id, 'w1280.webp')}" class="mt-1.5 block w-24" aria-label="${esc(p.caption)}"><img src="${url(p.id, 'thumb.webp')}" width="96" height="54" loading="lazy" decoding="async" alt="${esc(p.alt)}" style="object-position:${coverPosition(p.width, p.height, p.focus, 96, 54)}" class="block w-24 aspect-video object-cover rounded-md border border-white/10"></a>${p.credit ? `<span class="block text-[11px] text-zinc-500">${esc(p.credit)}</span>` : ''}`;
}
