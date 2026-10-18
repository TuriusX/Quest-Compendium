/**
 * The owner's "Fix now" edits (the editor on questcompendium.com, ownerEditor.ts): a changed sentence or field on a
 * guide page, saved in guideEdits/{id} and laid over the page's data at every publish, after the page is loaded, so a
 * rebuild can never overwrite it. Each edit names its field by a path into the page's data (the same shape as the
 * page's page.json: "overview", "items/#x2/where", "walkthrough/#s3/text", "sections/1/entries/#fl1/text", "tips/2"),
 * the text it replaces and the new text.
 *
 * At publish an edit is:
 *   applied  its old text is still in the field: replaced (once);
 *   kept     the field already says the new text (a rebuild wrote it in);
 *   stale    neither: a rebuild rewrote or dropped that part, so the edit no longer knows where it goes. It is left out
 *            (never put in the wrong place) and listed for the owner (the editor's "Your edits", the Discord summary).
 * An English edit reaches the translated pages as a translation of the edited field (made at publish, kept on the
 * edit; about $0.0003 a field and language). An edit made on a translated page changes that language only.
 */
import crypto from 'crypto';

export type OwnerEdit = {
  id: string;
  key: string;
  slug: string;
  page: 'area' | 'entity';
  lang: string;
  path: string;
  before: string;
  after: string;
  label?: string;
  status: 'live' | 'undone';
  state?: 'applied' | 'kept' | 'stale';
  tr?: Record<string, { src: string; text: string }>;
};

/** A path the editor may send: field names, list positions (0-9999) and ids (#id), separated by "/". */
export const EDIT_PATH = /^[A-Za-z]{1,40}(?:\/(?:#[A-Za-z0-9_.:-]{1,80}|\d{1,4}|[A-Za-z]{1,40}))*$/;

const step = (o: any, seg: string) => {
  if (o == null) return undefined;
  if (seg.startsWith('#')) return Array.isArray(o) ? o.find((x) => x && String(x.id) === seg.slice(1)) : undefined;
  if (/^\d+$/.test(seg)) return Array.isArray(o) ? o[Number(seg)] : undefined;
  return Array.isArray(o) ? undefined : o[seg];
};

/** The string at a path, or undefined. */
export function getAt(obj: any, path: string): string | undefined {
  if (!EDIT_PATH.test(path)) return undefined;
  const segs = path.split('/');
  let o = obj;
  for (const s of segs) o = step(o, s);
  return typeof o === 'string' ? o : undefined;
}

/** Sets the string at a path (only where a string already is). */
export function setAt(obj: any, path: string, value: string): boolean {
  if (!EDIT_PATH.test(path)) return false;
  const segs = path.split('/');
  let o = obj;
  for (const s of segs.slice(0, -1)) o = step(o, s);
  const last = segs[segs.length - 1];
  if (o == null || typeof o !== 'object') return false;
  if (last.startsWith('#')) return false; // a path ends at a field, never at a list entry
  const k: any = /^\d+$/.test(last) ? Number(last) : last;
  if (typeof o[k] !== 'string') return false;
  o[k] = value;
  return true;
}

/** Quotes and spaces as the pages print them, so an edit made from the page finds its text in the data. */
export const norm = (s: string) => String(s ?? '').normalize('NFKC').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

/** One edit on a page's data: replaced in place where its old text still is. */
export function applyEdit(obj: any, e: Pick<OwnerEdit, 'path' | 'before' | 'after'>): 'applied' | 'kept' | 'stale' {
  const cur = getAt(obj, e.path);
  if (cur === undefined) return 'stale';
  if (cur.includes(e.before)) return setAt(obj, e.path, cur.replace(e.before, e.after)) ? 'applied' : 'stale';
  // The page may print it with other quotes or spacing than the data has: match those loosely.
  const n = norm(cur), b = norm(e.before);
  if (b && n.includes(b)) return setAt(obj, e.path, n.replace(b, e.after)) ? 'applied' : 'stale';
  if (e.after && n.includes(norm(e.after))) return 'kept';
  return 'stale';
}

export const fieldHash = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
