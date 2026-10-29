/**
 * Picture touch-ups (owner, Oct 29 2026): each guide picture is measured, and only what needs it is fixed, with sharp
 * (no AI):
 *   - shadows   a dark picture's dark and middle tones lifted along a curve that keeps black black and white white (so
 *               it isn't washed out), on brightness only (colours keep their hue);
 *   - contrast  a flat picture's tones spread a little (half-way to its own 1st..99th percentile), and a dull one's
 *               colour raised a touch;
 *   - sharpen   a soft picture sharpened lightly.
 * The original is always kept: the touched-up sizes are stored apart from the untouched ones (guideImages.ts), so a
 * touch-up can be switched off ("Original") at any time.
 */
import sharp from 'sharp';

export type TouchupMetrics = { median: number; mean: number; p02: number; p98: number; spread: number; saturation: number; sharpness: number };
export type TouchupOp = 'shadows' | 'contrast' | 'color' | 'sharpen';
export type TouchupPlan = { ops: TouchupOp[]; lift: number; stretch: { lo: number; hi: number } | null; saturation: number; sharpen: number; metrics: TouchupMetrics };

// The thresholds: what counts as dark, flat, dull and soft (on a 512-wide copy).
const DARK_MEDIAN = 0.26;
const FLAT_SPREAD = 0.62;
const DULL_SATURATION = 0.16;
const SOFT_SHARPNESS = 0.0016;

/** Brightness, spread, colour and sharpness of a picture (from a 512-wide copy). */
export async function measure(buf: Buffer): Promise<TouchupMetrics> {
  // A cut-out (a portrait on a see-through background): only the visible part counts.
  const { data, info } = await sharp(buf).rotate().resize({ width: 512, withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const all = info.width * info.height;
  const hist = new Array(256).fill(0);
  const lum = new Float32Array(all);
  let sum = 0, sat = 0, n = 0;
  for (let i = 0, p = 0; p < all; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[p] = y / 255;
    if (data[i + 3] < 128) continue;
    n++;
    hist[Math.min(255, Math.round(y))]++;
    sum += y;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx ? (mx - mn) / mx : 0;
  }
  const pct = (q: number) => { let c = 0; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= q * n) return v / 255; } return 1; };
  // Sharpness: the variance of the Laplacian of brightness (low: soft).
  let lsum = 0, lsq = 0, m = 0;
  const w = info.width, h = info.height;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const l = lum[i - 1] + lum[i + 1] + lum[i - w] + lum[i + w] - 4 * lum[i];
    lsum += l; lsq += l * l; m++;
  }
  const sharpness = m ? lsq / m - (lsum / m) ** 2 : 0;
  n ||= 1;
  const p02 = pct(0.02), p98 = pct(0.98);
  return { median: pct(0.5), mean: sum / n / 255, p02, p98, spread: p98 - p02, saturation: sat / n, sharpness };
}

/** What a picture needs (nothing, for most). */
export function plan(m: TouchupMetrics): TouchupPlan {
  const ops: TouchupOp[] = [];
  // Dark: lift by how far the middle tones sit below a comfortable level (most at very dark pictures), at most 0.8:
  // a dark place should still look dark, only easier to read.
  const lift = m.median < DARK_MEDIAN ? Math.min(0.8, (DARK_MEDIAN + 0.06 - m.median) * 3) : 0;
  if (lift > 0.1) ops.push('shadows');
  // Flat: spread the tones half-way to the picture's own 2nd..98th percentile (a dark picture keeps its black point).
  let stretch: TouchupPlan['stretch'] = null;
  if (m.spread < FLAT_SPREAD) {
    const lo = Math.max(0, m.p02) * 0.5, hi = 1 - (1 - Math.min(1, m.p98)) * 0.5;
    if (hi - lo > 0.2 && (lo > 0.01 || hi < 0.99)) { stretch = { lo, hi }; ops.push('contrast'); }
  }
  const saturation = m.saturation < DULL_SATURATION && m.saturation > 0.03 ? 1.12 : 1;
  if (saturation > 1) ops.push('color');
  const sharpen = m.sharpness < SOFT_SHARPNESS ? 0.8 : 0;
  if (sharpen) ops.push('sharpen');
  return { ops: ops.filter((o) => o !== 'shadows' || lift > 0.1), lift: lift > 0.1 ? lift : 0, stretch, saturation, sharpen, metrics: m };
}

/** The touched-up picture (same size, PNG), or null when it needs nothing. */
export async function touchUp(buf: Buffer, p?: TouchupPlan): Promise<{ buf: Buffer; plan: TouchupPlan } | null> {
  p ||= plan(await measure(buf));
  if (!p.ops.length) return null;
  const { data, info } = await sharp(buf).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // One curve for brightness: the stretch, then the shadow lift y = x + k·x^1.5·(1−x)² (0 and 1 stay put, and the
  // curve leaves the black end flat, so blacks stay black and nothing turns milky; the lift is largest just under the
  // middle tones, and the highlights are untouched).
  const curve = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    let x = v / 255;
    if (p.stretch) x = Math.min(1, Math.max(0, (x - p.stretch.lo) / (p.stretch.hi - p.stretch.lo)));
    if (p.lift) x = x + p.lift * 1.6 * x ** 1.5 * (1 - x) * (1 - x);
    curve[v] = Math.min(1, x) * 255;
  }
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i + 3] = data[i + 3];
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const ny = curve[Math.min(255, Math.round(y))];
    // Brightness only, hue kept: the new brightness, with the colour around it raised by half as much (scaling the
    // colour fully over-saturates a lifted fire or sunset), never past white.
    const k = (ny + 1) / (y + 1), c = 1 + (k - 1) * 0.5;
    out[i] = Math.max(0, Math.min(255, Math.round(ny + (r - y) * c)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round(ny + (g - y) * c)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round(ny + (b - y) * c)));
  }
  let img = sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } });
  if (p.saturation > 1) img = img.modulate({ saturation: p.saturation });
  if (p.sharpen) img = img.sharpen({ sigma: p.sharpen, m1: 0.5, m2: 1.5 });
  return { buf: await img.png().toBuffer(), plan: p };
}

/** How much a touch-up changes a picture: the mean difference per pixel, 0..1 (on 256-wide copies). */
export async function changeOf(a: Buffer, b: Buffer): Promise<number> {
  const small = (x: Buffer) => sharp(x).rotate().resize(256, 256, { fit: 'fill' }).flatten({ background: '#808080' }).raw().toBuffer();
  const [x, y] = await Promise.all([small(a), small(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]);
  return d / x.length / 255;
}

/** A short line for people: what was done. */
export const opsLabel = (ops: TouchupOp[]) => ops.map((o) => ({ shadows: 'shadows lifted', contrast: 'more contrast', color: 'a little more colour', sharpen: 'lightly sharpened' })[o]).join(', ');
