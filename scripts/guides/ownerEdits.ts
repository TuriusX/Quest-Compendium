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
 *
 * The nightly improvements (autoImprove.ts, auto: the change's id) use the same overlay, with two more kinds:
 *   op "append"  a checked sentence added at the end of a field ("after"); it stays through rebuilds as long as the field
 *                is there, and is "kept" once the field says it anyway;
 *   op "order"   a list's entries put in a better order ("ids": entry ids, or headings/names for lists without ids);
 *                entries it doesn't name keep their place after the named ones.
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
  op?: 'replace' | 'append' | 'order';
  ids?: string[];
  auto?: string;
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

/** The list at a path (for op "order"), or undefined. */
export function listAt(obj: any, path: string): any[] | undefined {
  if (!EDIT_PATH.test(path)) return undefined;
  let o = obj;
  for (const s of path.split('/')) o = step(o, s);
  return Array.isArray(o) ? o : undefined;
}
/** What an "order" edit calls an entry: its id, else its heading or name. */
export const entryKey = (x: any) => String(x?.id ?? x?.heading ?? x?.name ?? x?.title ?? '');

/** One edit on a page's data: replaced in place where its old text still is. */
export function applyEdit(obj: any, e: Pick<OwnerEdit, 'path' | 'before' | 'after'> & { op?: OwnerEdit['op']; ids?: string[] }): 'applied' | 'kept' | 'stale' {
  if (e.op === 'order') {
    const list = listAt(obj, e.path);
    const ids = (e.ids || []).map(String);
    if (!list || ids.length < 2) return 'stale';
    const named = ids.map((id) => list.find((x) => entryKey(x) === id)).filter(Boolean);
    if (named.length < 2) return 'stale';
    const rest = list.filter((x) => !named.includes(x));
    const next = [...named, ...rest];
    if (next.every((x, i) => x === list[i])) return 'kept';
    list.splice(0, list.length, ...next);
    return 'applied';
  }
  if (e.op === 'append') {
    const cur = getAt(obj, e.path);
    if (cur === undefined || !e.after) return 'stale';
    if (norm(cur).includes(norm(e.after))) return 'kept';
    return setAt(obj, e.path, cur.trim() ? `${cur.trim()} ${e.after}` : e.after) ? 'applied' : 'stale';
  }
  const cur = getAt(obj, e.path);
  if (cur === undefined) return 'stale';
  // A sentence taken out (after: ''; a fact moved to the page it belongs on) leaves no doubled or trailing space.
  const tidy = (t: string) => (e.after ? t : t.replace(/[ 	]{2,}/g, ' ').trim());
  if (cur.includes(e.before)) return setAt(obj, e.path, tidy(cur.replace(e.before, e.after))) ? 'applied' : 'stale';
  // The page may print it with other quotes or spacing than the data has: match those loosely.
  const n = norm(cur), b = norm(e.before);
  if (b && n.includes(b)) return setAt(obj, e.path, tidy(n.replace(b, e.after))) ? 'applied' : 'stale';
  if (e.after && n.includes(norm(e.after))) return 'kept';
  return 'stale';
}

export const fieldHash = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
