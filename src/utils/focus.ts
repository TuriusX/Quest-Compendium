/**
 * Where a picture is cut. Every place shows pictures cut to a fixed shape (the guide page's 4:3, the phone's square,
 * the 16:9 thumbnails, the share image), and a cut from the middle loses a tall portrait's head. Each picture has a
 * focal point instead: the owner's (/admin/images) or, until he sets one, the one found when it was approved (the
 * face for a character, the main subject otherwise). Every cut keeps it in frame, as near the middle as the picture
 * allows; a face sits a little above the middle so the shoulders show.
 */
export type Focus = { x: number; y: number; face?: boolean };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A stored focal point, if it is one (0..1 on both axes). */
export function asFocus(v: any): Focus | null {
  if (!v || typeof v !== 'object') return null;
  const x = Number(v.x), y = Number(v.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y, ...(v.face ? { face: true } : {}) };
}

/** Without one: a portrait-shaped picture of a character is held near the top (where the head is), anything else in the middle. */
export function defaultFocus(w: number, h: number, character = false): Focus {
  return character && h > w * 1.1 ? { x: 0.5, y: 0.15, face: true } : { x: 0.5, y: 0.5 };
}

/**
 * The left and top offsets (0..1 of the overflow) for a w×h picture cut to a boxW×boxH shape (object-fit: cover)
 * with the focal point as near the middle as it can be; a face as near 40% from the top.
 */
export function coverOffsets(w: number, h: number, f: Focus | null, boxW: number, boxH: number): { x: number; y: number } {
  if (!w || !h || !f) return { x: 0.5, y: 0.5 };
  const s = Math.max(boxW / w, boxH / h);
  const axis = (len: number, box: number, c: number, at: number) => {
    const over = len * s - box;
    return over <= 0.5 ? 0.5 : clamp01((c * len * s - box * at) / over);
  };
  return { x: axis(w, boxW, f.x, 0.5), y: axis(h, boxH, f.y, f.face ? 0.4 : 0.5) };
}

/** The same as a CSS object-position ("23.5% 0%"). */
export function coverPosition(w: number, h: number, f: Focus | null, boxW: number, boxH: number): string {
  const o = coverOffsets(w, h, f, boxW, boxH);
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  return `${pct(o.x)} ${pct(o.y)}`;
}
