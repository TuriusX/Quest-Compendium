/**
 * Better pictures (owner, Oct 29 2026): every guide picture the finder brings in is improved before the owner reviews
 * it, and the original is always kept ("Original" switch on /admin/images and in the editor).
 *
 *   1. Upscale (character portraits only, smaller than the full-size view, 1280 wide): Gemini 3.1 Flash Image redraws
 *      it at 2K. Kept only when it passes two checks: the picture lines up with the original (same framing, measured),
 *      and an AI look at both (same character, face, eye colour and framing; no added people or body parts; small
 *      invented details on clothing are fine). A see-through background gets the original's transparency back, or the
 *      upscale is skipped when that can't be done cleanly. Failed or skipped: the original is used.
 *   2. Touch-ups (imageTouchup.ts, no AI): shadows, contrast, colour, sharpening, only what the picture needs.
 *
 * Files: the original's sizes stay at v/{id}/; the improved ones at e/{id}/{stamp}/ (a new stamp each time, so the site,
 * which copies a picture's files once, never keeps an old version), the upscaled master at up/{id}.png. The doc's
 * `enhance` says what was done; `useOriginal` is the switch. The owner's own pictures are left alone unless he asks
 * (force). Costs: the nightly ones count in the pictures' budget ($0.50 a night, $5 a month, pictureFocus.ts).
 */
import sharp from 'sharp';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { ThinkingLevel } from '@google/genai';
import { measure, plan, touchUp, opsLabel, type TouchupOp } from './imageTouchup';
import { gemini, MODEL, ledgerDollars } from './scripts/guides/common';

const BUCKET = process.env.GUIDE_IMAGE_BUCKET || 'quest-compendium-guide-images';
const bucket = () => getStorage().bucket(BUCKET);
const col = () => getFirestore().collection('guideImages');
const LITE = process.env.GUIDE_LITE_MODEL || 'gemini-3.1-flash-lite';
export const UPSCALE_MODEL = process.env.UPSCALE_MODEL || 'gemini-3.1-flash-image';
/** What one upscale costs at most (2K image out at $60 a million tokens, about $0.12), with its checks. */
export const UPSCALE_COST = 0.135;
/** The full-size view (the site's largest size): a portrait narrower than this is worth upscaling. */
const FULL = 1280;
/** How far the upscale may drift from the original (mean difference after scaling it back down, 0..1). */
const ALIGN_MAX = 0.05;
const SIZES: Record<string, { width: number; fmt: 'webp' | 'avif' }> = {
  'w1280.webp': { width: 1280, fmt: 'webp' }, 'w600.webp': { width: 600, fmt: 'webp' }, 'w600.avif': { width: 600, fmt: 'avif' },
  'w300.webp': { width: 300, fmt: 'webp' }, 'w300.avif': { width: 300, fmt: 'avif' }, 'thumb.webp': { width: 160, fmt: 'webp' },
};

/** A character's page (its compendium type), the only pictures that may be upscaled. */
export const isCharacter = (t: any) => t?.kind === 'entity' && /charac|person|people|npc|companion|ally|villain|gang|member|boss|human/i.test(String(t?.label || ''));

export type Budget = { left: () => number; add: (d: number) => Promise<void> };
export type UpscaleResult = { status: 'done' | 'failed' | 'skipped'; why: string; at: number; from?: [number, number]; to?: [number, number]; model?: string; dollars: number; check?: any };
export type EnhanceResult = { id: string; ops: TouchupOp[]; upscale?: UpscaleResult; dollars: number; changed: boolean };

const imagePart = (b: Buffer, mime = 'image/png') => ({ inlineData: { mimeType: mime, data: b.toString('base64') } });
const jsonOf = (t: string) => { const s = String(t || '').replace(/```json|```/g, ''); const a = s.indexOf('{'), z = s.lastIndexOf('}'); try { return a >= 0 && z > a ? JSON.parse(s.slice(a, z + 1)) : null; } catch { return null; } };

/** Has a see-through background (some pixels clearly transparent). */
async function hasAlpha(b: Buffer): Promise<boolean> {
  const m = await sharp(b).metadata();
  if (!m.hasAlpha) return false;
  const { data } = await sharp(b).resize({ width: 256, withoutEnlargement: true }).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  let see = 0;
  for (const a of data) if (a < 200) see++;
  return see > data.length * 0.01;
}

/** How much the upscale drifted: scaled back to the original's size, the mean difference on what's visible. */
export async function drift(orig: Buffer, up: Buffer): Promise<number> {
  const m = await sharp(orig).metadata();
  const w = Math.min(512, m.width!), h = Math.round((m.height! * w) / m.width!);
  const a = await sharp(orig).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const b = await sharp(up).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  let d = 0, n = 0;
  for (let i = 0, j = 0; i < a.length; i += 4, j += 3) {
    if (a[i + 3] < 220) continue;
    d += Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]);
    n += 3;
  }
  return n ? d / n / 255 : 1;
}

/** One cheap look first: is this a character portrait, without readable text? (Items, maps, places, text: no.) */
async function portraitLook(b: Buffer, name: string): Promise<{ ok: boolean; why: string }> {
  const small = await sharp(b).resize({ width: 512, withoutEnlargement: true }).flatten({ background: '#808080' }).jpeg({ quality: 80 }).toBuffer();
  const res: any = await gemini().models.generateContent({
    model: LITE,
    contents: [{ role: 'user', parts: [imagePart(small, 'image/jpeg'), { text: `This picture is for a game guide page about the character "${name}". Is it a portrait of one character (a person or creature as the main subject), and does it contain readable text, a map or game interface? Reply with JSON only: {"portrait": true|false, "text": true|false}` }] }],
    config: { temperature: 0, maxOutputTokens: 60, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
  });
  const j = jsonOf(res.text) || {};
  if (j.portrait !== true) return { ok: false, why: 'not a character portrait' };
  if (j.text === true) return { ok: false, why: 'has text or interface in it' };
  return { ok: true, why: '' };
}

/** The upscale itself (2K). Returns the picture and what it cost. */
async function upscaleCall(b: Buffer): Promise<{ buf: Buffer | null; dollars: number }> {
  const png = await sharp(b).flatten({ background: '#808080' }).png().toBuffer();
  const res: any = await gemini().models.generateContent({
    model: UPSCALE_MODEL,
    contents: [{ role: 'user', parts: [imagePart(png), { text: 'Upscale this game screenshot to a higher resolution. Reproduce it exactly: the same framing, composition, colours, lighting, faces, expressions, text and every object. Only restore fine detail and sharpness that is consistent with the original. Do not add, remove, move or restyle anything.' }] }],
    config: { responseModalities: ['IMAGE'], imageConfig: { imageSize: '2K' } } as any,
  });
  const u = res.usageMetadata || {};
  const dollars = ((u.promptTokenCount || 0) * 0.5 + ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * 60) / 1e6;
  const part = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
  return { buf: part ? Buffer.from(part.inlineData.data, 'base64') : null, dollars };
}

/** The AI check: the upscale against the original. */
export async function upscaleCheck(orig: Buffer, up: Buffer, name: string): Promise<{ pass: boolean; why: string; reply: any; dollars: number }> {
  const before = ledgerDollars();
  const a = await sharp(orig).resize({ width: 768, withoutEnlargement: true }).flatten({ background: '#808080' }).jpeg({ quality: 85 }).toBuffer();
  const b = await sharp(up).resize({ width: 768 }).flatten({ background: '#808080' }).jpeg({ quality: 85 }).toBuffer();
  const ask = () => gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [
      { text: `Picture A is the original portrait of "${name}" from a game; picture B is an AI upscale of it. Check B against A strictly. Where A has a plain or see-through background, judge only the character.` }, imagePart(a, 'image/jpeg'), imagePart(b, 'image/jpeg'),
      { text: 'Answer each: same character (identity)? same face (shape, features, expression, age)? same eye colour? same framing (crop, pose, position)? Did B add any person or creature? Did B add body parts that A does not show (hands, arms, legs, a body below the frame)? Small invented details on clothing or the background texture are acceptable. Reply with JSON only: {"sameCharacter": bool, "sameFace": bool, "sameEyeColour": bool, "sameFraming": bool, "addedPeople": bool, "addedBodyParts": bool, "note": "one short sentence"}' },
    ] }],
    config: { temperature: 0, maxOutputTokens: 2000, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  // An empty or cut-off reply: asked once more (no answer at all counts as a fail).
  let j = jsonOf(((await ask()) as any).text);
  if (!j) j = jsonOf(((await ask()) as any).text);
  if (!j) return { pass: false, why: 'the check gave no answer', reply: {}, dollars: Math.max(0, ledgerDollars() - before) };
  const fails: string[] = [];
  if (j.sameCharacter !== true) fails.push('not the same character');
  if (j.sameFace !== true) fails.push('the face changed');
  if (j.sameEyeColour !== true) fails.push('the eye colour changed');
  if (j.sameFraming !== true) fails.push('the framing changed');
  if (j.addedPeople !== false) fails.push('added a person');
  if (j.addedBodyParts !== false) fails.push('added body parts');
  return { pass: !fails.length, why: fails.join(', ') || String(j.note || 'passed'), reply: j, dollars: Math.max(0, ledgerDollars() - before) };
}

/** The original's transparency on the upscale (its alpha, scaled up). */
async function withAlpha(orig: Buffer, up: Buffer): Promise<Buffer> {
  const m = await sharp(up).metadata();
  // As one raw channel (an encoded single channel would come back as colour, and join as three bands).
  const alpha = await sharp(orig).ensureAlpha().extractChannel(3).resize(m.width!, m.height!, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  // The colour first, on its own (sharp would drop a joined channel again when removing the old alpha). Where the
  // picture is partly see-through (soft edges, a fade), the original's colour, enlarged: the upscale's background
  // would otherwise show there as a halo.
  const rgb = await sharp(up).removeAlpha().raw().toBuffer();
  const own = await sharp(orig).removeAlpha().resize(m.width!, m.height!, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  for (let p = 0, i = 0; p < alpha.length; p++, i += 3) {
    const w = Math.min(1, Math.max(0, (alpha[p] - 200) / 55));
    if (w >= 1) continue;
    for (let c = 0; c < 3; c++) rgb[i + c] = Math.round(rgb[i + c] * w + own[i + c] * (1 - w));
  }
  const out = await sharp(rgb, { raw: { width: m.width!, height: m.height!, channels: 3 } }).joinChannel(alpha, { raw: { width: m.width!, height: m.height!, channels: 1 } }).png().toBuffer();
  if (!(await sharp(out).metadata()).hasAlpha) throw new Error('the transparency could not be restored');
  return out;
}

/** The picture as shown: the original, cut to its crop. */
async function baseOf(x: any): Promise<Buffer> {
  const [orig] = await bucket().file(x.original.path).download();
  return x.crop ? sharp(orig).extract(x.crop).png().toBuffer() : sharp(orig).png().toBuffer();
}

/**
 * Improves one picture: the upscale (when allowed, a character portrait and room in the budget), then the touch-ups.
 * opts.upscale: try the upscale; opts.upscaled: an upscale made before (the test's Dutch), checked like a new one;
 * opts.force: the owner asked (his own pictures too, and a redo).
 */
export async function enhanceImage(id: string, opts: { upscale?: boolean; budget?: Budget; upscaled?: Buffer; force?: boolean; dryRun?: boolean } = {}): Promise<EnhanceResult | null> {
  const ref = col().doc(id);
  const x: any = (await ref.get()).data();
  if (!x || x.status === 'deleted' || !x.original?.path) return null;
  if (x.owner && !opts.force) return null;
  const base = await baseOf(x);
  const bm = await sharp(base).metadata();
  let work = base, dollars = 0;
  let upscale: UpscaleResult | undefined = x.enhance?.upscale;
  const name = String(x.target?.name || '');
  // 1. The upscale: once per picture (a failed or skipped one isn't tried again unless the owner asks).
  const tried = upscale && ['done', 'failed', 'skipped'].includes(upscale.status);
  if (opts.upscale && isCharacter(x.target) && (bm.width || 0) < FULL && (!tried || opts.force || opts.upscaled)) {
    if (!opts.upscaled && opts.budget && opts.budget.left() < UPSCALE_COST) {
      upscale = undefined; // no room tonight: tried again another night
    } else {
      const at = Date.now();
      const before = ledgerDollars();
      const look = opts.upscaled ? { ok: true, why: '' } : await portraitLook(base, name);
      if (!look.ok) upscale = { status: 'skipped', why: look.why, at, dollars: 0 };
      else {
        const call = opts.upscaled ? { buf: opts.upscaled, dollars: 0 } : await upscaleCall(base);
        dollars += call.dollars;
        if (!call.buf) upscale = { status: 'failed', why: 'no picture came back', at, dollars: call.dollars, model: UPSCALE_MODEL };
        else {
          const um = await sharp(call.buf).metadata();
          const d = await drift(base, call.buf);
          const see = await hasAlpha(base);
          // Checked as it would be used: a cut-out with the original's transparency back.
          const chk = d > ALIGN_MAX ? null : await upscaleCheck(base, see ? await withAlpha(base, call.buf) : call.buf, name);
          dollars += chk?.dollars || 0;
          const res = { at, from: [bm.width!, bm.height!] as [number, number], to: [um.width!, um.height!] as [number, number], model: UPSCALE_MODEL, check: chk?.reply || { drift: d } };
          if (!chk) upscale = { status: 'failed', why: `the framing moved (drift ${(d * 100).toFixed(1)}%)`, dollars: call.dollars, ...res };
          else if (!chk.pass) upscale = { status: 'failed', why: chk.why, dollars: call.dollars + chk.dollars, ...res };
          // A see-through background: the original's transparency back, only when the picture lines up closely.
          else if (see && d > ALIGN_MAX * 0.75) upscale = { status: 'skipped', why: 'its see-through background could not be restored cleanly', dollars: call.dollars + chk.dollars, ...res };
          else {
            work = see ? await withAlpha(base, call.buf) : await sharp(call.buf).png().toBuffer();
            upscale = { status: 'done', why: chk.why, dollars: call.dollars + chk.dollars, ...res };
            if (!opts.dryRun) await bucket().file(`up/${id}.png`).save(work, { contentType: 'image/png', resumable: false });
          }
        }
      }
      dollars = Math.max(dollars, ledgerDollars() - before);
      if (opts.budget && dollars) await opts.budget.add(dollars);
    }
  } else if (upscale?.status === 'done' && !opts.force) {
    // Upscaled before: the touch-ups are made again from the upscale (free), not by upscaling again.
    const [up] = await bucket().file(`up/${id}.png`).download().catch(() => [null as any]);
    if (up) work = up;
  }
  // 2. The touch-ups.
  const p = plan(await measure(work));
  const t = p.ops.length ? await touchUp(work, p) : null;
  const final = t?.buf || (upscale?.status === 'done' ? work : null);
  const enhance: any = { v: 1, at: Date.now(), ops: p.ops, label: [upscale?.status === 'done' ? `upscaled ${upscale.from![0]}→${upscale.to![0]} wide` : '', opsLabel(p.ops)].filter(Boolean).join(', '), metrics: p.metrics, ...(upscale ? { upscale } : {}), ...(opts.force ? { byOwner: true } : {}) };
  if (final && !opts.dryRun) {
    const stamp = Date.now().toString(36);
    const b0 = await sharp(final).toBuffer();
    const meta = await sharp(b0).metadata();
    await Promise.all(Object.entries(SIZES).map(async ([nm, s]) => {
      const img = sharp(b0).resize({ width: s.width, withoutEnlargement: true });
      const out = s.fmt === 'avif' ? await img.avif({ quality: 50 }).toBuffer() : await img.webp({ quality: 80 }).toBuffer();
      await bucket().file(`e/${id}/${stamp}/${nm}`).save(out, { contentType: s.fmt === 'avif' ? 'image/avif' : 'image/webp', resumable: false });
    }));
    Object.assign(enhance, { dir: stamp, sizes: Object.keys(SIZES), width: meta.width, height: meta.height });
    // The previous improved version's files go.
    if (x.enhance?.dir && x.enhance.dir !== stamp) await bucket().deleteFiles({ prefix: `e/${id}/${x.enhance.dir}/` }).catch(() => undefined);
  }
  if (!opts.dryRun) {
    await ref.set({ enhance, updatedAt: Date.now() }, { merge: true });
    // A picture on the site changed: the next publish takes it.
    if (x.status === 'approved' && !x.useOriginal && final) await getFirestore().collection('system').doc('editor').set({ dirtyAt: Date.now() }, { merge: true });
  }
  return { id, ops: p.ops, upscale, dollars, changed: !!final };
}

/** The live files' place in the bucket and on the site: the improved version unless switched to the original. */
export const liveFiles = (id: string, x: any) => (x?.enhance?.dir && !x.useOriginal ? { bucket: `e/${id}/${x.enhance.dir}/`, site: `${id}/${x.enhance.dir}` } : { bucket: `v/${id}/`, site: id });

/** Monday's summary: pictures touched up and upscaled this week, and the upscales that failed the check. */
export async function enhanceWeekLines(now = Date.now()): Promise<string[]> {
  const snap = await col().where('enhance.at', '>=', now - 7 * 86_400_000).get();
  const xs = snap.docs.map((d) => d.data() as any);
  const touched = xs.filter((x) => x.enhance?.dir).length;
  const up = xs.filter((x) => x.enhance?.upscale?.status === 'done' && x.enhance.upscale.at >= now - 7 * 86_400_000);
  const failed = xs.filter((x) => x.enhance?.upscale?.status === 'failed' && x.enhance.upscale.at >= now - 7 * 86_400_000);
  const out = [`✨ Pictures touched up this week: ${touched}, of which ${up.length} upscaled ($${up.concat(failed).reduce((s, x) => s + (Number(x.enhance.upscale.dollars) || 0), 0).toFixed(2)}).`];
  if (failed.length) out.push(`🚫 Failed the upscale check, kept as they were: ${failed.slice(0, 10).map((x) => `${x.target?.name} (${x.enhance.upscale.why})`).join(' · ')}${failed.length > 10 ? ` · and ${failed.length - 10} more` : ''}`);
  return out;
}
