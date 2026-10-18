/**
 * Guide images (roadmap 14, visual aid; phase 2): one review queue for every picture of a guide entry, and the store
 * behind it. Nothing here is shown to players yet: pages and apps start using approved images in phases 3 and 4.
 *
 *   GET  /admin/images                      the admin page (sign in with Google; only ADMIN_EMAILS get the data)
 *   GET  /api/admin/images?status=&game=    the queue: waiting (default), approved or deleted
 *   POST /api/admin/images                  add one: a capture from the desktop app (imageBase64 + crop), a picture
 *                                           from a URL (press kit, wiki, Steam), or an IGDB screenshot or artwork
 *   POST /api/admin/images/:id              { action: approve | delete | restore | update, target?, placement?,
 *                                           caption?, alt?, credit?, terms? }
 *   GET  /api/admin/images/:id/file/:size   one of its stored sizes (the admin page shows them; it can't use a URL)
 *   GET  /api/admin/images/targets?game=&q= what a picture can belong to: areas, characters and other compendium
 *                                           pages, an area's items, secrets, fights and checklist lines, its steps
 *   POST /api/admin/images/suggest          the capture window's suggestions (from the app), as the guide names them
 *   GET  /api/admin/images/wanted?game=     the game's most-searched pages that have no approved picture yet
 *   GET  /api/admin/images/needs-capture    top pages no source has a picture for: only the owner's captures can fill them
 *   GET  /api/admin/images/games            the guides, for the page's game list
 *   GET  /api/admin/images/igdb?game=       the game's IGDB screenshots and artworks, to pick from
 *
 * Images live in Firestore guideImages/{id}; the files in the private bucket gs://quest-compendium-guide-images: the
 * original as received (orig/{id}.{ext}) and the sizes the site and apps use (v/{id}/{size}), made once when the
 * picture comes in. Sources: the owner's captures first, then press kits, IGDB, wikis and Steam; never AI-generated
 * pictures. A credit line is kept only where an official source's terms ask for one, never under the owner's captures.
 *
 * Where a picture shows (the owner's switches): `page`, the main picture of an area or compendium page; `answer`, the
 * card under an app answer that mentions it; `step`, beside a walkthrough step, checklist line or quest log row. `step`
 * starts off: a picture goes there only when it shows the actual thing the objective needs (the lever, the lamp, the
 * door), never a portrait or a view.
 */
import type { Express, Request, Response, NextFunction } from 'express';
import sharp from 'sharp';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { isAdmin } from './reviewQueue';

type Mw = (req: Request, res: Response, next: NextFunction) => any;
type Deps = { requireAuth: Mw; firebaseWebConfig: Record<string, string> };

export const IMAGE_BUCKET = process.env.GUIDE_IMAGE_BUCKET || 'quest-compendium-guide-images';
export const IMAGE_SOURCES = ['mine', 'press', 'igdb', 'wiki', 'steam', 'other'] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];
/** When an entry has several approved pictures, the owner's capture wins, then a press kit, IGDB, a wiki, Steam. */
export const SOURCE_RANK: Record<ImageSource, number> = { mine: 0, press: 1, igdb: 2, wiki: 3, steam: 4, other: 5 };

export type TargetKind = 'area' | 'entity' | 'entry' | 'step';
/** What a picture belongs to: a page (area or compendium entity), or one entry or walkthrough step on an area page. */
export type ImageTarget = { kind: TargetKind; slug: string; id?: string; name: string; label: string; area?: string };
export type Placement = { page: boolean; answer: boolean; step: boolean };

/** The sizes made for every picture (width in px; the height follows the crop). */
export const SIZES = {
  'w1280.webp': { width: 1280, fmt: 'webp' },
  'w600.webp': { width: 600, fmt: 'webp' },
  'w600.avif': { width: 600, fmt: 'avif' },
  'w300.webp': { width: 300, fmt: 'webp' },
  'w300.avif': { width: 300, fmt: 'avif' },
  'thumb.webp': { width: 160, fmt: 'webp' },
} as const;
type SizeName = keyof typeof SIZES;

/** A page picture shows on the page; a step's or an entry's doesn't have a page of its own. Quest log/step starts off. */
export const defaultPlacement = (kind: TargetKind): Placement => ({ page: kind === 'area' || kind === 'entity', answer: true, step: false });

const MAX_BYTES = 25 * 1024 * 1024;
const col = () => getFirestore().collection('guideImages');
const bucket = () => getStorage().bucket(IMAGE_BUCKET);
const clean = (s: unknown, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The crop in the original's pixels, kept inside it; none when it's missing or covers (almost) the whole picture. */
export function cleanCrop(c: any, w: number, h: number): { left: number; top: number; width: number; height: number } | null {
  if (!c || !w || !h) return null;
  const left = Math.max(0, Math.min(w - 1, Math.round(Number(c.x ?? c.left) || 0)));
  const top = Math.max(0, Math.min(h - 1, Math.round(Number(c.y ?? c.top) || 0)));
  const width = Math.max(1, Math.min(w - left, Math.round(Number(c.w ?? c.width) || 0)));
  const height = Math.max(1, Math.min(h - top, Math.round(Number(c.h ?? c.height) || 0)));
  if (width < 16 || height < 16) return null;
  if (width >= w - 2 && height >= h - 2) return null;
  return { left, top, width, height };
}

/** Every size of one picture: cropped once, then scaled down (never up) to each width. */
export async function makeSizes(buf: Buffer, crop: ReturnType<typeof cleanCrop>): Promise<{ files: Record<SizeName, Buffer>; width: number; height: number }> {
  const base = crop ? await sharp(buf).extract(crop).toBuffer() : await sharp(buf).toBuffer();
  const meta = await sharp(base).metadata();
  const files = {} as Record<SizeName, Buffer>;
  for (const [name, s] of Object.entries(SIZES) as [SizeName, (typeof SIZES)[SizeName]][]) {
    const img = sharp(base).resize({ width: s.width, withoutEnlargement: true });
    files[name] = s.fmt === 'avif' ? await img.avif({ quality: 50 }).toBuffer() : await img.webp({ quality: 80 }).toBuffer();
  }
  return { files, width: meta.width || 0, height: meta.height || 0 };
}

// ---- What a picture can belong to -------------------------------------------------------------------------------

const targetCache = new Map<string, { at: number; list: ImageTarget[] }>();

/** Every page, entry and step of a game's published guide (cached for ten minutes). */
export async function targetsFor(key: string): Promise<ImageTarget[]> {
  const hit = targetCache.get(key);
  if (hit && Date.now() - hit.at < 600_000) return hit.list;
  const fs = getFirestore();
  const [areas, ents] = await Promise.all([
    fs.collection('guides').doc(key).collection('areas').where('status', '==', 'published').get(),
    fs.collection('guideCompendium').doc(key).collection('entities').where('status', '==', 'published').get().catch(() => null),
  ]);
  const list: ImageTarget[] = [];
  const first = (s: unknown) => clean(String(s || '').split(/[.:;]/)[0], 70);
  for (const d of areas.docs.sort((a, b) => (a.get('order') ?? 0) - (b.get('order') ?? 0))) {
    const a: any = d.data();
    const slug = String(a.slug || d.id);
    const area = String(a.name || slug);
    list.push({ kind: 'area', slug, name: area, label: 'Area' });
    (a.walkthrough || []).forEach((st: any, i: number) => st?.id && list.push({ kind: 'step', slug, id: String(st.id), name: clean(st.title || `Step ${i + 1}`, 90), label: `Step ${i + 1}`, area }));
    for (const e of a.items || []) e?.id && list.push({ kind: 'entry', slug, id: String(e.id), name: clean(e.name || first(e.text), 90), label: 'Item', area });
    for (const e of a.secrets || []) e?.id && list.push({ kind: 'entry', slug, id: String(e.id), name: first(e.text || e.name), label: 'Secret', area });
    for (const f of a.fights || []) f?.id && list.push({ kind: 'entry', slug, id: String(f.id), name: clean(f.name, 90), label: 'Key fight', area });
    for (const x of a.sections || []) for (const e of x?.entries || []) e?.id && list.push({ kind: 'entry', slug, id: String(e.id), name: first(e.text), label: clean(x.title, 40) || 'Checklist', area });
  }
  for (const d of ents?.docs || []) {
    const e: any = d.data();
    list.push({ kind: 'entity', slug: String(e.slug || d.id), name: clean(e.name, 90), label: clean(e.typeLabel || e.type || 'Compendium', 40) });
  }
  targetCache.set(key, { at: Date.now(), list });
  return list;
}

const norm = (s: string) => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const sameTarget = (a: Pick<ImageTarget, 'kind' | 'slug' | 'id'>, b: Pick<ImageTarget, 'kind' | 'slug' | 'id'>) => a.kind === b.kind && a.slug === b.slug && (a.id || '') === (b.id || '');

/** The best matches for what was typed: names that start with it first, then names and areas that contain it. */
export function searchTargets(list: ImageTarget[], q: string, limit = 40): ImageTarget[] {
  const n = norm(q);
  if (!n) return list.filter((t) => t.kind === 'area' || t.kind === 'entity').slice(0, limit);
  const words = n.split(' ');
  const scored = list
    .map((t) => {
      const name = norm(t.name), area = norm(t.area || '');
      if (!words.every((w) => name.includes(w) || area.includes(w))) return null;
      const s = (name === n ? 0 : name.startsWith(n) ? 1 : name.includes(n) ? 2 : 3) * 10 + (t.kind === 'area' || t.kind === 'entity' ? 0 : 1);
      return { t, s };
    })
    .filter(Boolean) as { t: ImageTarget; s: number }[];
  return scored.sort((a, b) => a.s - b.s).slice(0, limit).map((x) => x.t);
}

/** The target as the guide has it now (its name and label from the guide, not from the request), or null. */
export async function resolveTarget(key: string, t: any): Promise<ImageTarget | null> {
  if (!t?.slug) return null;
  const list = await targetsFor(key);
  const slug = String(t.slug), id = t.id ? String(t.id) : undefined;
  if (t.kind) return list.find((x) => sameTarget(x, { kind: t.kind, slug, id })) || null;
  // From the app, which knows a guide entry only by page and id (an answer's guide refs): any entry or step with that
  // id on that page, else the page itself.
  return (id ? list.find((x) => x.slug === slug && x.id === id) : list.find((x) => x.slug === slug && (x.kind === 'area' || x.kind === 'entity'))) || null;
}

/** The app's suggestions, resolved against the guide (names from the guide), unknown ones and repeats left out. */
export async function resolveSuggestions(key: string, list: any[]): Promise<(ImageTarget & { why: string })[]> {
  const out: (ImageTarget & { why: string })[] = [];
  for (const s of (Array.isArray(list) ? list : []).slice(0, 12)) {
    const t = await resolveTarget(key, s).catch(() => null);
    if (t && !out.some((o) => sameTarget(o, t))) out.push({ ...t, why: clean(s.why, 80) });
  }
  return out;
}

// ---- The most-searched pages without a picture -------------------------------------------------------------------

/** Every guide page's Search Console impressions (the weekly per-page list, else the summary's top pages). */
export async function pageImpressionList(): Promise<{ key: string; slug: string; impressions: number }[]> {
  const fs = getFirestore();
  const per: any = (await fs.collection('system').doc('searchConsolePages').get()).data();
  if (per?.pages && Object.keys(per.pages).length) {
    return Object.entries(per.pages as Record<string, [number, number, number]>)
      .map(([id, v]) => { const [key, slug] = id.split('/'); return { key, slug, impressions: v[0] }; })
      .filter((p) => p.key && p.slug)
      .sort((a, b) => b.impressions - a.impressions);
  }
  // Until the weekly pull has stored every page: the top 100 list the suggester was given (system/imageSuggest.topPages).
  const sug: any = (await fs.collection('system').doc('imageSuggest').get()).data();
  if (Array.isArray(sug?.topPages) && sug.topPages.length) return sug.topPages.map((p: any) => ({ key: String(p.key), slug: String(p.slug), impressions: Number(p.impressions) || 0 }));
  const sum: any = (await fs.collection('system').doc('searchConsole').get()).data();
  return (sum?.topPages || []).filter((p: any) => p?.key && p?.slug).map((p: any) => ({ key: String(p.key), slug: String(p.slug), impressions: Number(p.impressions) || 0 }));
}

/**
 * "Needs your capture": the most-searched pages the suggester has looked for in every source (the game's wiki, IGDB and
 * its press kit) without finding anything, and that have no picture waiting, suggested or approved. Only the owner's own
 * captures can fill these. Kept up to date by the suggester (system/imageSuggest.pages) and by what's in the queue.
 */
export async function needsCapture(game?: string): Promise<{ key: string; slug: string; impressions: number; rank: number; checkedAt: number }[]> {
  const fs = getFirestore();
  const [pages, sug, live] = await Promise.all([
    pageImpressionList(),
    fs.collection('system').doc('imageSuggest').get().then((d) => (d.data() as any) || {}),
    col().where('status', 'in', ['waiting', 'suggested', 'approved']).get(),
  ]);
  const has = new Set(live.docs.map((d) => { const x: any = d.data(); return x.target?.kind === 'area' || x.target?.kind === 'entity' ? `${x.game}/${x.target.slug}` : ''; }));
  const checked = sug.pages || {};
  return pages.slice(0, 100)
    .map((p, i) => ({ ...p, rank: i + 1, checkedAt: Number(checked[`${p.key}/${p.slug}`]?.at) || 0, done: !!checked[`${p.key}/${p.slug}`]?.all }))
    .filter((p) => p.done && !has.has(`${p.key}/${p.slug}`) && (!game || p.key === game))
    .map(({ done, ...p }) => p);
}

/** Pages (area or compendium page) with an approved picture switched on for the page. */
export async function pagesWithPictures(): Promise<Set<string>> {
  const snap = await col().where('status', '==', 'approved').get();
  const out = new Set<string>();
  for (const d of snap.docs) {
    const x: any = d.data();
    if (x.placement?.page && (x.target?.kind === 'area' || x.target?.kind === 'entity')) out.add(`${x.game}/${x.target.slug}`);
  }
  return out;
}

/**
 * The Monday summary's line (scripts/pipeline/run.ts): of the 100 most-searched guide pages, how many have an approved
 * page picture, the change since last week, and how many pictures wait for review. Stored in system/pipeline.
 */
export async function imagesWeekLine(): Promise<string> {
  const [pages, have, waiting] = await Promise.all([pageImpressionList(), pagesWithPictures(), col().where('status', '==', 'waiting').count().get()]);
  const top = pages.slice(0, 100);
  const count = top.filter((p) => have.has(`${p.key}/${p.slug}`)).length;
  const ref = getFirestore().collection('system').doc('pipeline');
  const prev: any = ((await ref.get()).data() || {}).pagePictures;
  const diff = prev && Number.isFinite(Number(prev.count)) ? count - Number(prev.count) : null;
  await ref.set({ pagePictures: { count, of: top.length, at: Date.now() } }, { merge: true });
  const wait = waiting.data().count;
  return `🖼️ Top ${top.length} pages with a picture: ${count} / ${top.length}${diff == null || diff === 0 ? '' : ` (${diff > 0 ? '+' : ''}${diff} this week)`}${wait ? ` · waiting for review: ${wait}` : ''}.`;
}

// ---- Storing a picture --------------------------------------------------------------------------------------------

/** Fetches a picture from a URL (press kit, wiki, Steam, IGDB): images only, at most 25 MB. */
async function fetchImage(url: string): Promise<{ buf: Buffer; ext: string }> {
  if (!/^https?:\/\//i.test(url)) throw new Error('That is not a web address.');
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'QuestCompendium-ImageQueue/1.0 (+https://questcompendium.com)' } });
  if (!r.ok) throw new Error(`The picture could not be fetched (${r.status}).`);
  const type = String(r.headers.get('content-type') || '');
  if (!/^image\//i.test(type)) throw new Error('That address is not a picture.');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('The picture is over 25 MB.');
  return { buf, ext: (type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').replace('jpeg', 'jpg') || 'jpg' };
}

/** Stores the original and its sizes, and adds the picture to the queue (waiting). */
export async function addImage(input: {
  game: string; target: ImageTarget; source: ImageSource; buf: Buffer; ext: string; crop?: any; by: string;
  caption?: string; alt?: string; credit?: string; terms?: string; sourceUrl?: string; sourceRef?: string; why?: string; lowMatch?: boolean;
  /** 'suggested': found by the nightly suggester (scripts/guides/suggestImages.ts), with its confidence and second guess. */
  status?: 'waiting' | 'suggested'; confidence?: string; altGuess?: string; sourceName?: string;
}): Promise<string> {
  const meta = await sharp(input.buf).metadata();
  if (!meta.width || !meta.height) throw new Error('That file is not a picture we can read.');
  const crop = cleanCrop(input.crop, meta.width, meta.height);
  const { files, width, height } = await makeSizes(input.buf, crop);
  const ref = col().doc();
  const id = ref.id;
  const ext = /^(png|jpg|webp|avif|gif)$/.test(input.ext) ? input.ext : 'png';
  await bucket().file(`orig/${id}.${ext}`).save(input.buf, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, resumable: false });
  await Promise.all(Object.entries(files).map(([name, b]) => bucket().file(`v/${id}/${name}`).save(b, { contentType: name.endsWith('.avif') ? 'image/avif' : 'image/webp', resumable: false })));
  const own = input.source === 'mine';
  await ref.set({
    game: input.game,
    target: input.target,
    status: input.status || 'waiting',
    source: input.source,
    rank: SOURCE_RANK[input.source],
    sourceUrl: clean(input.sourceUrl, 500) || null,
    sourceRef: clean(input.sourceRef, 120) || null,
    // No credit under the owner's own captures; an official source's only when its terms ask for one.
    credit: own ? null : clean(input.credit, 160) || null,
    terms: own ? null : clean(input.terms, 600) || null,
    caption: clean(input.caption, 160) || input.target.name,
    alt: clean(input.alt, 300) || `${input.target.name}${input.target.area ? `, ${input.target.area}` : ''}`,
    placement: defaultPlacement(input.target.kind),
    original: { path: `orig/${id}.${ext}`, width: meta.width, height: meta.height, bytes: input.buf.length },
    crop: crop || null,
    width, height,
    sizes: Object.keys(files),
    why: clean(input.why, 160) || null,
    lowMatch: !!input.lowMatch,
    ...(input.confidence ? { confidence: clean(input.confidence, 20) } : {}),
    ...(input.altGuess ? { altGuess: clean(input.altGuess, 120) } : {}),
    ...(input.sourceName ? { sourceName: clean(input.sourceName, 80) } : {}),
    createdBy: input.by,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return id;
}

// ---- The routes ---------------------------------------------------------------------------------------------------

export function registerGuideImages(app: Express, deps: Deps) {
  const requireAdmin: Mw = (req, res, next) => (isAdmin((req as any).user) ? next() : res.status(403).json({ error: 'Not an admin.' }));
  const gameOk = (k: unknown) => /^[a-z0-9-]{1,100}$/.test(String(k || ''));

  app.get('/api/admin/images', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const status = ['waiting', 'suggested', 'approved', 'deleted'].includes(String(req.query.status)) ? String(req.query.status) : 'waiting';
      let q: FirebaseFirestore.Query = col().where('status', '==', status);
      if (gameOk(req.query.game)) q = q.where('game', '==', String(req.query.game));
      const snap = await q.get();
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 300);
      const counts: Record<string, number> = {};
      for (const s of ['waiting', 'suggested', 'approved', 'deleted']) counts[s] = (await col().where('status', '==', s).count().get()).data().count;
      res.json({ items, counts });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load the images.' });
    }
  });

  app.get('/api/admin/images/:id/file/:size', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const size = String(req.params.size);
    if (!(size in SIZES) && size !== 'original') return res.status(400).json({ error: 'Unknown size.' });
    try {
      const x: any = (await col().doc(String(req.params.id)).get()).data();
      if (!x) return res.status(404).json({ error: 'No such image.' });
      const path = size === 'original' ? x.original?.path : `v/${req.params.id}/${size}`;
      const [buf] = await bucket().file(path).download();
      res.set('Cache-Control', 'private, max-age=3600');
      res.type(size === 'original' ? path.split('.').pop() : size.split('.').pop()).send(buf);
    } catch (e: any) {
      res.status(404).json({ error: e?.message || 'Could not load the file.' });
    }
  });

  app.post('/api/admin/images', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const b = req.body || {};
    try {
      if (!gameOk(b.game)) return res.status(400).json({ error: 'Pick a game.' });
      const source = (IMAGE_SOURCES as readonly string[]).includes(b.source) ? (b.source as ImageSource) : 'other';
      const target = await resolveTarget(String(b.game), b.target);
      if (!target) return res.status(400).json({ error: 'That page, entry or step is not in the published guide.' });
      let buf: Buffer, ext = 'png', sourceUrl = b.sourceUrl, sourceRef = b.sourceRef;
      if (b.imageBase64) {
        const m = String(b.imageBase64).match(/^data:image\/([a-z0-9+]+);base64,(.+)$/i);
        buf = Buffer.from(m ? m[2] : String(b.imageBase64), 'base64');
        ext = m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
        if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'The picture is over 25 MB.' });
      } else if (b.igdb?.id && /^[a-z0-9]{3,40}$/i.test(String(b.igdb.id))) {
        // IGDB's own CDN, at its largest size (1920 wide at most).
        sourceRef = String(b.igdb.id);
        sourceUrl = `https://images.igdb.com/igdb/image/upload/t_1080p/${sourceRef}.jpg`;
        ({ buf, ext } = await fetchImage(sourceUrl));
      } else if (b.url) {
        sourceUrl = String(b.url);
        ({ buf, ext } = await fetchImage(sourceUrl));
      } else {
        return res.status(400).json({ error: 'No picture was sent.' });
      }
      if (sourceRef && source === 'igdb') {
        const dup = await col().where('game', '==', String(b.game)).where('sourceRef', '==', sourceRef).limit(1).get();
        if (!dup.empty) return res.status(409).json({ error: 'That IGDB picture is already in the queue.', id: dup.docs[0].id });
      }
      const id = await addImage({
        game: String(b.game), target, source, buf, ext, crop: b.crop, by: String((req as any).user?.email || ''),
        caption: b.caption, alt: b.alt, credit: b.credit, terms: b.terms, sourceUrl, sourceRef, why: b.why, lowMatch: !!b.lowMatch,
      });
      res.json({ ok: true, id });
    } catch (e: any) {
      console.error('[images] add failed:', e?.message);
      res.status(500).json({ error: e?.message || 'Could not add the picture.' });
    }
  });

  // The capture window's "Belongs to" list: what the app suggests, as the guide names it.
  app.post('/api/admin/images/suggest', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    if (!gameOk(req.body?.game)) return res.json({ suggestions: [] });
    try {
      res.json({ suggestions: await resolveSuggestions(String(req.body.game), req.body.suggestions) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not match the suggestions.' });
    }
  });

  app.post('/api/admin/images/:id', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const b = req.body || {};
    const ref = col().doc(String(req.params.id));
    try {
      const x: any = (await ref.get()).data();
      if (!x) return res.status(404).json({ error: 'No such image.' });
      const by = String((req as any).user?.email || '');
      const patch: Record<string, any> = { updatedAt: Date.now() };
      if (b.action === 'approve') Object.assign(patch, { status: 'approved', approvedBy: by, approvedAt: Date.now(), lowMatch: false });
      else if (b.action === 'delete') Object.assign(patch, { status: 'deleted', deletedBy: by, deletedAt: Date.now() });
      else if (b.action === 'restore') Object.assign(patch, { status: x.suggestedAt || x.confidence ? 'suggested' : 'waiting', notThis: false });
      // Not this: a suggestion that's wrong. Gone, and never suggested again (the suggester skips every picture it has met).
      else if (b.action === 'notthis') Object.assign(patch, { status: 'deleted', notThis: true, deletedBy: by, deletedAt: Date.now() });
      else if (b.action !== 'update') return res.status(400).json({ error: 'Unknown action.' });
      if (b.target) {
        const t = await resolveTarget(x.game, b.target);
        if (!t) return res.status(400).json({ error: 'That page, entry or step is not in the published guide.' });
        // A new match: its own switches (a step's picture never keeps a page placement it can't have).
        Object.assign(patch, { target: t, placement: defaultPlacement(t.kind), lowMatch: false, why: 'Re-matched by hand' });
        if (!b.caption && x.caption === x.target?.name) patch.caption = t.name;
      }
      if (b.placement && typeof b.placement === 'object') {
        const kind: TargetKind = (patch.target || x.target)?.kind;
        const cur = patch.placement || x.placement || defaultPlacement(kind);
        patch.placement = {
          page: (kind === 'area' || kind === 'entity') && ('page' in b.placement ? !!b.placement.page : cur.page),
          answer: 'answer' in b.placement ? !!b.placement.answer : cur.answer,
          step: 'step' in b.placement ? !!b.placement.step : cur.step,
        };
      }
      for (const k of ['caption', 'alt'] as const) if (typeof b[k] === 'string') patch[k] = clean(b[k], k === 'alt' ? 300 : 160);
      // Credits and terms belong to official sources only.
      if (x.source !== 'mine') for (const k of ['credit', 'terms'] as const) if (typeof b[k] === 'string') patch[k] = clean(b[k], k === 'terms' ? 600 : 160) || null;
      await ref.set(patch, { merge: true });
      res.json({ ok: true, image: { id: ref.id, ...x, ...patch } });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not save.' });
    }
  });

  app.get('/api/admin/images/targets', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    if (!gameOk(req.query.game)) return res.status(400).json({ error: 'Pick a game.' });
    try {
      res.json({ targets: searchTargets(await targetsFor(String(req.query.game)), String(req.query.q || '')) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not search the guide.' });
    }
  });

  app.get('/api/admin/images/wanted', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const game = gameOk(req.query.game) ? String(req.query.game) : '';
      const [pages, have, live] = await Promise.all([pageImpressionList(), pagesWithPictures(), col().where('status', 'in', ['waiting', 'suggested']).get()]);
      // Wanted: no picture at all yet (one waiting or suggested is already on its way to the owner).
      const pending = new Set(live.docs.map((d) => { const x: any = d.data(); return x.target?.kind === 'area' || x.target?.kind === 'entity' ? `${x.game}/${x.target.slug}` : ''; }));
      const rankOf = new Map(pages.map((p, i) => [`${p.key}/${p.slug}`, i + 1]));
      const top100 = pages.slice(0, 100);
      const list = (game ? pages.filter((p) => p.key === game) : top100).filter((p) => !have.has(`${p.key}/${p.slug}`) && !pending.has(`${p.key}/${p.slug}`)).slice(0, 20);
      const names = game ? new Map((await targetsFor(game)).filter((t) => t.kind === 'area' || t.kind === 'entity').map((t) => [t.slug, t])) : new Map();
      res.json({
        top100: { with: top100.filter((p) => have.has(`${p.key}/${p.slug}`)).length, of: top100.length },
        wanted: list.map((p) => ({ ...p, rank: rankOf.get(`${p.key}/${p.slug}`), target: names.get(p.slug) || null })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load the wanted list.' });
    }
  });

  app.get('/api/admin/images/needs-capture', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const game = gameOk(req.query.game) ? String(req.query.game) : undefined;
      const list = await needsCapture(game);
      const names = new Map<string, string>();
      for (const k of [...new Set(list.map((p) => p.key))]) for (const t of await targetsFor(k)) if (t.kind === 'area' || t.kind === 'entity') names.set(`${k}/${t.slug}`, t.name);
      res.json({ pages: list.map((p) => ({ ...p, name: names.get(`${p.key}/${p.slug}`) || p.slug })) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load the list.' });
    }
  });

  app.get('/api/admin/images/games', deps.requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const snap = await getFirestore().collection('guides').select('game').get();
      res.json({ games: snap.docs.filter((d) => !d.id.endsWith('--next')).map((d) => ({ key: d.id, name: String(d.get('game') || d.id) })).sort((a, b) => a.name.localeCompare(b.name)) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not list the guides.' });
    }
  });

  app.get('/api/admin/images/igdb', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    if (!gameOk(req.query.game)) return res.status(400).json({ error: 'Pick a game.' });
    try {
      const game = String(req.query.game);
      const igdb: any = (await getFirestore().collection('guides').doc(game).get()).get('igdb') || {};
      const used = new Set((await col().where('game', '==', game).where('source', '==', 'igdb').get()).docs.map((d) => String(d.get('sourceRef'))));
      const pic = (type: string) => (x: any) => x?.id && ({ id: String(x.id), type, w: x.w, h: x.h, thumb: `https://images.igdb.com/igdb/image/upload/t_screenshot_med/${x.id}.jpg`, used: used.has(String(x.id)) });
      const art = Array.isArray(igdb.art) ? igdb.art : igdb.art ? [igdb.art] : [];
      res.json({ images: [...(igdb.screenshots || []).map(pic('screenshot')), ...art.map(pic('artwork'))].filter(Boolean) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load IGDB pictures.' });
    }
  });

  app.get('/admin/images', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    res.type('html').send(imagesPage(deps.firebaseWebConfig));
  });
}

// ---- The admin page -----------------------------------------------------------------------------------------------

function imagesPage(firebaseConfig: Record<string, string>): string {
  const cfg = JSON.stringify(firebaseConfig).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Guide images</title>
<style>
  :root { color-scheme: dark; --bg: #07070a; --card: #111118; --line: #24242e; --text: #e4e4e7; --dim: #a1a1aa; --accent: #a87ffb; --ok: #34d399; --bad: #f87171; --warn: #fbbf24; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 Inter, system-ui, sans-serif; background: var(--bg); color: var(--text); }
  header { position: sticky; top: 0; z-index: 5; background: rgba(7,7,10,.92); backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); padding: 10px 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  h1 { font-size: 16px; margin: 0 8px 0 0; }
  main { max-width: 1240px; margin: 0 auto; padding: 16px; }
  button, select, input, textarea { font: inherit; color: var(--text); background: #1b1b24; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; }
  button { cursor: pointer; } button:hover { border-color: var(--accent); } button:disabled { opacity: .5; cursor: default; }
  button.on, button.primary { background: var(--accent); color: #12091f; border-color: var(--accent); font-weight: 600; }
  button.ok { background: var(--ok); color: #06140d; border-color: var(--ok); font-weight: 600; }
  button.bad { color: #fca5a5; border-color: #f8717166; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 12px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .card img { display: block; width: 100%; aspect-ratio: 16/9; object-fit: cover; background: #0c0c12; cursor: zoom-in; }
  .body { padding: 10px 12px 12px; }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .chip { font-size: 11px; padding: 1px 8px; border-radius: 99px; border: 1px solid var(--line); color: var(--dim); }
  .chip.mine { color: var(--ok); border-color: #34d39966; }
  .chip.sug { color: #c4b0ff; border-color: #a87ffb66; }
  .why { margin-top: 7px; padding: 7px 9px; border-left: 3px solid var(--accent); background: #a87ffb10; border-radius: 0 8px 8px 0; font-size: 12.5px; }
  .hi { color: var(--ok); font-weight: 700; } .mid { color: var(--warn); font-weight: 700; }
  .dim { color: var(--dim); } .small { font-size: 12px; } .warn { color: var(--warn); }
  .name { font-weight: 700; color: #fff; }
  label.sw { display: inline-flex; gap: 5px; align-items: center; font-size: 12.5px; color: var(--text); margin-right: 10px; cursor: pointer; }
  label.sw.na { color: #52525b; cursor: default; }
  .field { display: flex; flex-direction: column; gap: 3px; margin-top: 7px; font-size: 12px; color: var(--dim); }
  .field input, .field textarea { width: 100%; }
  .acts { display: flex; gap: 6px; margin-top: 10px; }
  .panel { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; }
  .results { max-height: 240px; overflow: auto; margin-top: 6px; border: 1px solid var(--line); border-radius: 8px; }
  .results div { padding: 6px 10px; cursor: pointer; border-top: 1px solid var(--line); } .results div:first-child { border-top: 0; }
  .results div:hover { background: #2a2140; }
  .igdb { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-top: 8px; }
  .igdb img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 8px; cursor: pointer; border: 2px solid transparent; }
  .igdb img.sel { border-color: var(--accent); } .igdb img.used { opacity: .35; }
  #zoom { position: fixed; inset: 0; background: rgba(0,0,0,.88); display: flex; align-items: center; justify-content: center; z-index: 20; cursor: zoom-out; }
  #zoom img { max-width: 94vw; max-height: 92vh; }
  [hidden] { display: none !important; }
  a { color: var(--accent); }
</style>
</head>
<body>
<header>
  <h1>Guide images</h1>
  <button id="tWaiting" class="on">Waiting</button><button id="tSuggested">Suggested</button><button id="tApproved">Approved</button><button id="tDeleted">Deleted</button>
  <select id="game"><option value="">All games</option></select>
  <span id="top100" class="dim small"></span>
  <span style="flex:1"></span>
  <button id="addBtn">Add a picture</button>
  <a href="/admin/reviews" class="small">Review queue</a>
</header>
<main>
  <div id="gate" class="panel"><b>Admin sign-in</b><p class="dim">This page is for Quest Compendium admins. Sign in with the Google account listed as an admin (ADMIN_EMAILS).</p><button id="signin" class="primary">Sign in with Google</button> <button id="signinRedirect">Sign in (if the popup is blocked)</button><p id="gateMsg" class="dim">Not signed in.</p><noscript><p style="color:var(--bad)">This page needs JavaScript to sign in. Turn JavaScript on for this site and reload.</p></noscript></div>
  <div id="denied" class="panel" hidden><b>Not allowed</b><p id="deniedMsg" class="dim"></p><button id="switchAcct" class="primary">Sign in with another account</button></div>
  <div id="wanted" class="panel" hidden></div>
  <div id="needs" class="panel" hidden></div>
  <div id="add" class="panel" hidden>
    <b>Add a picture</b> <span class="dim small">from a press kit, wiki, Steam or IGDB. Never AI-generated pictures. Your own captures come from the desktop app (Ctrl+Shift+P).</span>
    <div class="row" style="margin-top:8px">
      <select id="addSource"><option value="press">Press kit</option><option value="wiki">Wiki</option><option value="igdb">IGDB</option><option value="steam">Steam</option><option value="other">Other</option></select>
      <input id="addUrl" placeholder="Picture address (https://…)" style="flex:1;min-width:260px">
      <input id="addFile" type="file" accept="image/*">
    </div>
    <div class="row"><input id="addSourceUrl" placeholder="Page it came from (optional)" style="flex:1"><input id="addCredit" placeholder="Credit line, only if the source's terms ask for one" style="flex:1"></div>
    <div class="field">Terms (what the source allows)<textarea id="addTerms" rows="2"></textarea></div>
    <div class="field">Belongs to <input id="addQ" placeholder="Search the guide: an area, character, item, step…"></div>
    <div id="addResults" class="results" hidden></div>
    <div id="addPicked" class="small" style="margin-top:6px"></div>
    <div id="igdbBox"></div>
    <div class="acts"><button id="addSave" class="ok" disabled>Add to the queue</button><span id="addMsg" class="dim small"></span></div>
  </div>
  <p id="msg" class="dim"></p>
  <div id="list" class="grid"></div>
</main>
<div id="zoom" hidden><img alt=""></div>
<script type="module">
  // Every state says something on the page: signed out (the sign-in card), sign-in blocked or failed (why), loading,
  // and signed in with an account that isn't an admin (Not allowed). Never an empty page.
  const gateMsg = (t, bad) => { const m = document.getElementById('gateMsg'); if (m) { m.textContent = t; m.style.color = bad ? 'var(--bad)' : ''; } };
  let fb;
  try {
    fb = { ...(await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js")), ...(await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js")) };
  } catch (e) {
    gateMsg('Sign-in could not load (' + (e && e.message ? e.message : e) + '). A blocker or this browser may be stopping www.gstatic.com: allow it for this page, or open it in Chrome, Edge or Firefox.', true);
    throw e;
  }
  const { initializeApp, getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut } = fb;
  const auth = getAuth(initializeApp(${cfg}));
  getRedirectResult(auth).catch((e) => gateMsg('Sign-in failed: ' + (e.code || e.message), true));
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const SOURCE = { mine: 'My capture', press: 'Press kit', igdb: 'IGDB', wiki: 'Wiki', steam: 'Steam', other: 'Other' };
  const SITE = 'https://questcompendium.com/guides/';
  let status = 'waiting', items = [], games = [], picked = null, igdbPick = null;
  const blobs = new Map();

  async function api(path, body) {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }
  // The files are private: fetched with the sign-in token, shown from a blob.
  async function fileUrl(id, size) {
    const k = id + '/' + size;
    if (blobs.has(k)) return blobs.get(k);
    const token = await auth.currentUser.getIdToken();
    const r = await fetch('/api/admin/images/' + encodeURIComponent(id) + '/file/' + size, { headers: { Authorization: 'Bearer ' + token } });
    const u = r.ok ? URL.createObjectURL(await r.blob()) : '';
    blobs.set(k, u);
    return u;
  }
  const targetLine = (t) => esc(t.name) + ' <span class="dim">· ' + esc(t.label) + (t.area ? ' · ' + esc(t.area) : '') + '</span>';
  const gameName = (k) => (games.find((g) => g.key === k) || {}).name || k;
  const pageLink = (x) => '<a href="' + SITE + esc(x.game) + '/' + esc(x.target.slug) + '/' + (x.target.id ? '#e-' + esc(x.target.id) : '') + '" target="_blank" rel="noopener">open</a>';

  function card(x) {
    const p = x.placement || {};
    const pageNa = !(x.target.kind === 'area' || x.target.kind === 'entity');
    const sw = (k, label, na) => '<label class="sw' + (na ? ' na' : '') + '"><input type="checkbox" data-pl="' + k + '" data-id="' + x.id + '"' + (p[k] ? ' checked' : '') + (na ? ' disabled' : '') + '>' + label + '</label>';
    const official = x.source !== 'mine';
    return '<div class="card" id="c-' + x.id + '"><img data-img="' + x.id + '" alt="' + esc(x.alt) + '">'
      + '<div class="body"><div class="row"><span class="name">' + targetLine(x.target) + '</span><span class="chip ' + (x.source === 'mine' ? 'mine' : x.status === 'suggested' ? 'sug' : '') + '">' + esc(x.sourceName || SOURCE[x.source] || x.source) + (x.status === 'suggested' ? ' · suggested' : '') + '</span></div>'
      + '<div class="small dim">' + esc(gameName(x.game)) + ' · ' + pageLink(x) + ' · ' + new Date(x.createdAt).toLocaleString() + ' · ' + esc(x.width) + '×' + esc(x.height) + (x.original ? ' (from ' + esc(x.original.width) + '×' + esc(x.original.height) + ')' : '') + '</div>'
      + (x.status === 'suggested' || x.confidence
        ? '<div class="why"><b>Why:</b> ' + esc(x.why || '') + (x.confidence ? '<br><span class="dim">Confidence:</span> <span class="' + (x.confidence === 'high' ? 'hi' : 'mid') + '">' + esc(x.confidence) + '</span>' : '') + (x.altGuess ? ' · <span class="dim">Also possible:</span> ' + esc(x.altGuess) : '') + '</div>'
        : x.lowMatch ? '<div class="small warn">Not sure about this match: check it before approving.</div>' : x.why ? '<div class="small dim">Matched: ' + esc(x.why) + '</div>' : '')
      + '<div style="margin-top:8px">' + sw('page', 'Guide page', pageNa) + sw('answer', 'App answer', false) + sw('step', 'Quest log / step', false) + '</div>'
      + '<div class="small dim">Quest log / step: only when the picture shows what the objective needs (the lever, the lamp, the door).</div>'
      + '<div class="field">Caption<input data-f="caption" data-id="' + x.id + '" value="' + esc(x.caption) + '"></div>'
      + '<div class="field">Alt text<input data-f="alt" data-id="' + x.id + '" value="' + esc(x.alt) + '"></div>'
      + (official ? '<div class="field">Credit line (only if the terms ask for one)<input data-f="credit" data-id="' + x.id + '" value="' + esc(x.credit || '') + '"></div><div class="field">Terms<input data-f="terms" data-id="' + x.id + '" value="' + esc(x.terms || '') + '"></div>' + (x.sourceUrl ? '<div class="small dim">Source: <a href="' + esc(x.sourceUrl) + '" target="_blank" rel="noopener">' + esc(x.sourceUrl.slice(0, 70)) + '</a></div>' : '') : '')
      + '<div class="acts">' + (status === 'waiting' || status === 'suggested' ? '<button class="ok" data-act="approve" data-id="' + x.id + '">Approve</button>' : '') + '<button data-act="rematch" data-id="' + x.id + '">Re-match</button>'
      + (status === 'deleted' ? '<button data-act="restore" data-id="' + x.id + '">Restore</button>' : status === 'suggested' ? '<button class="bad" data-act="notthis" data-id="' + x.id + '">Not this</button>' : '<button class="bad" data-act="delete" data-id="' + x.id + '">Delete</button>') + '</div>'
      + '<div data-rm="' + x.id + '" hidden><input placeholder="Search the guide…" data-rq="' + x.id + '" style="width:100%;margin-top:8px"><div class="results" data-rr="' + x.id + '"></div></div>'
      + '</div></div>';
  }

  async function load() {
    $('msg').textContent = 'Loading…';
    const g = $('game').value;
    const j = await api('/api/admin/images?status=' + status + (g ? '&game=' + encodeURIComponent(g) : ''));
    items = j.items;
    $('tWaiting').textContent = 'Waiting · ' + (j.counts.waiting || 0);
    $('tSuggested').textContent = 'Suggested · ' + (j.counts.suggested || 0);
    $('tApproved').textContent = 'Approved · ' + (j.counts.approved || 0);
    $('tDeleted').textContent = 'Deleted · ' + (j.counts.deleted || 0);
    $('msg').textContent = items.length ? '' : status === 'waiting' ? 'Nothing waiting. Capture with Ctrl+Shift+P in the desktop app, or add a picture.' : status === 'suggested' ? 'No suggestions waiting. The nightly suggester adds pictures from wikis, IGDB and press kits here.' : 'Nothing here.';
    $('list').innerHTML = items.map(card).join('');
    for (const x of items) fileUrl(x.id, 'w600.webp').then((u) => { const im = document.querySelector('img[data-img="' + x.id + '"]'); if (im) im.src = u; });
    loadWanted();
    loadNeeds();
  }
  async function loadWanted() {
    const g = $('game').value;
    const w = await api('/api/admin/images/wanted' + (g ? '?game=' + encodeURIComponent(g) : '')).catch(() => null);
    if (!w) return;
    $('top100').textContent = 'Top 100 pages with a picture: ' + w.top100.with + ' / ' + w.top100.of;
    $('wanted').hidden = !w.wanted.length;
    $('wanted').innerHTML = '<b>Wanted' + (g ? ' in ' + esc(gameName(g)) : ' (top 100 pages)') + '</b> <span class="dim small">most-searched pages without a picture</span><div class="small" style="margin-top:6px">'
      + w.wanted.map((p) => '#' + esc(p.rank || '–') + ' <a href="' + SITE + esc(p.key) + '/' + esc(p.slug) + '/" target="_blank" rel="noopener">' + esc(p.target ? p.target.name : (g ? '' : gameName(p.key) + ' / ') + p.slug) + '</a> <span class="dim">' + esc(p.impressions) + '</span>').join(' · ') + '</div>';
  }
  // Needs your capture: top pages every source was checked for, with nothing found. Only your captures can fill them.
  async function loadNeeds() {
    const g = $('game').value;
    const n = await api('/api/admin/images/needs-capture' + (g ? '?game=' + encodeURIComponent(g) : '')).catch(() => null);
    $('needs').hidden = !n || !n.pages.length;
    if (!n || !n.pages.length) return;
    $('needs').innerHTML = '<b>Needs your capture</b> <span class="dim small">the wiki, IGDB and press kits had nothing for these, so only Ctrl+Shift+P can fill them</span><div class="small" style="margin-top:6px">'
      + n.pages.map((p) => '#' + esc(p.rank) + ' <a href="' + SITE + esc(p.key) + '/' + esc(p.slug) + '/" target="_blank" rel="noopener">' + esc((g ? '' : gameName(p.key) + ' / ') + p.name) + '</a> <span class="dim">' + esc(p.impressions) + '</span>').join(' · ') + '</div>';
  }
  async function search(game, q, box, onPick) {
    if (!game) { box.innerHTML = '<div class="dim">Pick a game first.</div>'; box.hidden = false; return; }
    const j = await api('/api/admin/images/targets?game=' + encodeURIComponent(game) + '&q=' + encodeURIComponent(q));
    box.hidden = false;
    box.innerHTML = j.targets.map((t, i) => '<div data-i="' + i + '">' + targetLine(t) + '</div>').join('') || '<div class="dim">Nothing matches.</div>';
    box.onclick = (e) => { const d = e.target.closest('[data-i]'); if (d) onPick(j.targets[Number(d.dataset.i)]); };
  }
  const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // Card actions: approve / delete / restore, re-match, the placement switches, and edits saved when a field is left.
  $('list').addEventListener('click', async (e) => {
    const im = e.target.closest('img[data-img]');
    if (im) { const u = await fileUrl(im.dataset.img, 'w1280.webp'); $('zoom').querySelector('img').src = u; $('zoom').hidden = false; return; }
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'rematch') { const box = document.querySelector('[data-rm="' + id + '"]'); box.hidden = !box.hidden; box.querySelector('input').focus(); return; }
    b.disabled = true;
    try { await api('/api/admin/images/' + encodeURIComponent(id), { action: b.dataset.act }); await load(); } catch (err) { alert(err.message); b.disabled = false; }
  });
  $('list').addEventListener('input', debounce(async (e) => {
    const q = e.target.closest('input[data-rq]');
    if (!q) return;
    const x = items.find((i) => i.id === q.dataset.rq);
    await search(x.game, q.value, document.querySelector('[data-rr="' + x.id + '"]'), async (t) => {
      try { await api('/api/admin/images/' + encodeURIComponent(x.id), { action: 'update', target: { kind: t.kind, slug: t.slug, id: t.id } }); await load(); } catch (err) { alert(err.message); }
    });
  }));
  $('list').addEventListener('change', async (e) => {
    const c = e.target.closest('input[data-pl]');
    if (c) { try { await api('/api/admin/images/' + encodeURIComponent(c.dataset.id), { action: 'update', placement: { [c.dataset.pl]: c.checked } }); } catch (err) { alert(err.message); c.checked = !c.checked; } return; }
    const f = e.target.closest('input[data-f]');
    if (f) { try { await api('/api/admin/images/' + encodeURIComponent(f.dataset.id), { action: 'update', [f.dataset.f]: f.value }); f.style.borderColor = 'var(--ok)'; } catch (err) { alert(err.message); } }
  });
  $('zoom').addEventListener('click', () => { $('zoom').hidden = true; });

  // Adding a picture by hand: a file or an address, or one of the game's IGDB pictures, matched to an entry.
  $('addBtn').addEventListener('click', () => { $('add').hidden = !$('add').hidden; showIgdb(); });
  $('addQ').addEventListener('input', debounce(() => search($('game').value, $('addQ').value, $('addResults'), (t) => { picked = t; $('addPicked').innerHTML = 'Belongs to: ' + targetLine(t); $('addResults').hidden = true; $('addSave').disabled = false; })));
  $('addSource').addEventListener('change', showIgdb);
  async function showIgdb() {
    const g = $('game').value;
    if ($('addSource').value !== 'igdb' || !g) { $('igdbBox').innerHTML = $('addSource').value === 'igdb' ? '<p class="dim small">Pick a game to see its IGDB pictures.</p>' : ''; return; }
    const j = await api('/api/admin/images/igdb?game=' + encodeURIComponent(g));
    $('igdbBox').innerHTML = '<div class="igdb">' + j.images.map((x) => '<img src="' + esc(x.thumb) + '" data-igdb="' + esc(x.id) + '" class="' + (x.used ? 'used' : '') + '" title="' + esc(x.type + (x.used ? ' (already in the queue)' : '')) + '">').join('') + '</div>' + (j.images.length ? '' : '<p class="dim small">IGDB has no screenshots or artworks stored for this game.</p>');
  }
  $('igdbBox').addEventListener('click', (e) => { const im = e.target.closest('img[data-igdb]'); if (!im) return; document.querySelectorAll('.igdb img').forEach((x) => x.classList.remove('sel')); im.classList.add('sel'); igdbPick = im.dataset.igdb; });
  $('addSave').addEventListener('click', async () => {
    const g = $('game').value;
    if (!g || !picked) return;
    const body = { game: g, target: { kind: picked.kind, slug: picked.slug, id: picked.id }, source: $('addSource').value, sourceUrl: $('addSourceUrl').value, credit: $('addCredit').value, terms: $('addTerms').value };
    const file = $('addFile').files[0];
    if ($('addSource').value === 'igdb' && igdbPick) body.igdb = { id: igdbPick };
    else if (file) body.imageBase64 = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(file); });
    else if ($('addUrl').value) body.url = $('addUrl').value;
    else { $('addMsg').textContent = 'Add a file, an address or an IGDB picture.'; return; }
    $('addSave').disabled = true; $('addMsg').textContent = 'Adding…';
    try { await api('/api/admin/images', body); $('addMsg').textContent = 'Added.'; $('addFile').value = ''; $('addUrl').value = ''; igdbPick = null; showTab('waiting'); }
    catch (err) { $('addMsg').textContent = err.message; }
    $('addSave').disabled = false;
  });

  function showTab(s) { status = s; for (const [id, v] of [['tWaiting', 'waiting'], ['tSuggested', 'suggested'], ['tApproved', 'approved'], ['tDeleted', 'deleted']]) $(id).classList.toggle('on', v === s); load().catch((e) => ($('msg').textContent = e.message)); }
  $('tWaiting').addEventListener('click', () => showTab('waiting'));
  $('tSuggested').addEventListener('click', () => showTab('suggested'));
  $('tApproved').addEventListener('click', () => showTab('approved'));
  $('tDeleted').addEventListener('click', () => showTab('deleted'));
  $('game').addEventListener('change', () => { picked = null; $('addPicked').textContent = ''; $('addSave').disabled = true; showIgdb(); load(); });
  const provider = () => { const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return p; };
  const popup = async () => {
    try {
      if (auth.currentUser) await signOut(auth);
      await signInWithPopup(auth, provider());
    } catch (e) {
      const code = e.code || e.message;
      gateMsg(code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user' ? 'The sign-in popup was blocked or closed. Use "Sign in (if the popup is blocked)".' : 'Sign-in failed: ' + code, true);
    }
  };
  $('signin').addEventListener('click', popup);
  $('switchAcct').addEventListener('click', popup);
  $('signinRedirect').addEventListener('click', () => signInWithRedirect(auth, provider()));
  // The page's own parts (tabs, game list, Add) only once an admin is signed in.
  const showTools = (on) => { for (const id of ['tWaiting', 'tSuggested', 'tApproved', 'tDeleted', 'game', 'addBtn', 'top100']) $(id).hidden = !on; };
  showTools(false);
  onAuthStateChanged(auth, async (u) => {
    $('gate').hidden = !!u;
    $('denied').hidden = true;
    $('list').innerHTML = '';
    $('wanted').hidden = true;
    $('needs').hidden = true;
    $('add').hidden = true;
    if (!u) { showTools(false); gateMsg('Not signed in.'); $('msg').textContent = ''; return; }
    $('msg').textContent = 'Signed in as ' + (u.email || '') + '. Loading…';
    try {
      games = (await api('/api/admin/images/games')).games;
      $('game').innerHTML = '<option value="">All games</option>' + games.map((g) => '<option value="' + esc(g.key) + '">' + esc(g.name) + '</option>').join('');
      const want = new URLSearchParams(location.search).get('game');
      if (want) $('game').value = want;
      showTools(true);
      await load();
    } catch (e) {
      showTools(false);
      if (/admin/i.test(e.message)) {
        $('msg').textContent = '';
        $('deniedMsg').textContent = (u.email || 'This account') + ' is not an admin, so the image queue is closed to it. Sign in with the admin account.';
        $('denied').hidden = false;
      } else {
        $('msg').textContent = 'Could not load the image queue: ' + String(e.message).replace(/[.]$/, '') + '. Reload to try again.';
      }
    }
  });
</script>
</body>
</html>`;
}
