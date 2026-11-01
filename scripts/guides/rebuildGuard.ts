/**
 * "Do no harm" on rebuilds: before a rebuilt page replaces a live one (flagship.ts writePage, promote.ts), the live
 * version is saved to areaHistory/{key}__{slug}/versions/{at} for rollback, and the two are compared: the named entries
 * (items, secrets, shops, fights), the choices and the walkthrough's length.
 *
 * A rebuild that passed its review can still lose correct content: the new evidence pack happened to miss it, and the
 * "fill gaps" step drops what the reviewer can't support (Crow's Perch lost its Oswin and Baron fights that way; the
 * October 2026 re-verification dropped bobbleheads, skill books and missables from 31 pages that way). So, since
 * Oct 22 2026 (owner): existing entries are kept unless sources contradict them. A rebuild carries the old page's
 * entries it lost over, marked "not yet confirmed" (flagship.ts writePage, promote.ts, carryOver). Only an entry the
 * rebuild's own claim check found contradicted may go. Since Nov 1 2026 (owner) nothing is held for review: the rebuild
 * goes live with what it lost carried over, and a walkthrough it cut too far stays as it was.
 * Restructures (promote.ts) never retire a page with impressions unless the new outline has a page with its name.
 *
 * Rebuilds held before that rule (rebuildHeld on the live page, the rebuild in its history, role "held") go live the
 * same way:
 *
 *   npx tsx scripts/guides/rebuildGuard.ts --key elden-ring --slug limgrave --release
 *
 * Code only: nothing here calls a model or searches.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db, liveKey, stageKey, isStageKey, arg } from './common';
import { trustedSites } from './claimCheck';

export type Lost = { kind: 'item' | 'secret' | 'shop' | 'fight' | 'choice' | 'checklist' | 'walkthrough'; name: string; sourced: boolean };
export type RebuildVerdict = { hold: boolean; reasons: string[]; lost: Lost[] };

/** Our own site and code or mod hosts are never a source for a claim, whatever a stored list says. */
const NOT_SOURCES = /(^|\.)(questcompendium\.com|github\.com|nexusmods\.com)$/i;
const host = (s: unknown) => String(s || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
const trusted = (sources: unknown) => trustedSites((Array.isArray(sources) ? sources : []).map(host).filter(Boolean)).filter((s) => !NOT_SOURCES.test(s));

/** A name for comparing: lower case, no accents, punctuation or leading article. */
export const normName = (s: unknown) =>
  String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/^(the|a|an) /, '').trim();

const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'and', 'or', 'for', 'with', 'from', 'by', 'is', 'it', 'its', 'you', 'your', 'this', 'that', 'can', 'be', 'are', 'here', 'there', 'into', 'near']);
export const words = (s: unknown) => normName(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));

/** Everything a page says, for "is this still on the page somewhere?" (an entry can move into a walkthrough step). */
export function pageText(p: any): string {
  const parts: unknown[] = [p?.overview];
  for (const k of ['items', 'secrets', 'shops', 'fights', 'enemies']) for (const e of Array.isArray(p?.[k]) ? p[k] : []) parts.push(e?.name, e?.text, e?.where, e?.how, e?.sells, e?.rewards, e?.tactics, e?.notes);
  for (const s of Array.isArray(p?.walkthrough) ? p.walkthrough : []) parts.push(s?.title, s?.text, s?.tip, s?.warn);
  for (const c of Array.isArray(p?.choices) ? p.choices : []) parts.push(c?.title, c?.when, ...(c?.options || []).flatMap((o: any) => [o?.label, o?.outcome]));
  for (const s of Array.isArray(p?.sections) ? p.sections : []) for (const e of s?.entries || []) parts.push(e?.text);
  return ` ${normName(parts.filter(Boolean).join(' '))} `;
}

/**
 * Whether an old entry is still on the new page: the same name in the same list, or its name anywhere in the new
 * page's text. A secret has no name, so most of its words have to be there.
 */
function kept(name: string, kind: Lost['kind'], newNames: string[], text: string, listText = text): boolean {
  const n = normName(name);
  if (!n) return true;
  // Items and secrets are checklist rows (ticked on the site, the app's quest log, the Deck): one is kept only while it's
  // still in its own list, never because the walkthrough's text mentions it (owner, Oct 31 2026: New Londo Ruins lost
  // its Transient Curse and Cursebite Ring rows that way). Fights, shops and choices may move into the walkthrough.
  if (kind === 'secret') {
    const w = words(name);
    if (!w.length) return true;
    return w.filter((x) => listText.includes(` ${x} `)).length / w.length >= 0.6;
  }
  if (newNames.some((m) => m === n || (n.length >= 4 && m.length >= 4 && (m.includes(n) || n.includes(m))))) return true;
  // Renamed in the same list ("Baron fistfight" → "Fistfight with the Bloody Baron"): every word of the old name is in
  // one new name.
  const w = words(name);
  if (w.length >= 2 && newNames.some((m) => w.every((x) => ` ${m} `.includes(` ${x} `)))) return true;
  if (kind === 'item') return false;
  return text.includes(` ${n} `);
}

const LISTS: { kind: Lost['kind']; field: string; name: (e: any) => string }[] = [
  { kind: 'item', field: 'items', name: (e) => e?.name },
  { kind: 'secret', field: 'secrets', name: (e) => e?.name || e?.text },
  { kind: 'shop', field: 'shops', name: (e) => e?.name },
  { kind: 'fight', field: 'fights', name: (e) => e?.name },
  { kind: 'choice', field: 'choices', name: (e) => e?.title },
];
/** Checklist rows (a page's own sections, "Don't miss" among them): named by their text. */
const sectionEntries = (p: any): any[] => (Array.isArray(p?.sections) ? p.sections : []).flatMap((x: any) => (Array.isArray(x?.entries) ? x.entries : []));

/**
 * Old page vs new page (each the whole page as it would be live), and the page's Search Console impressions. Pure:
 * the test replays it on stored pages for free.
 */
export function rebuildVerdict(oldPage: any, newPage: any, impressions = 0, contradicted: Set<string> = new Set()): RebuildVerdict {
  if (!oldPage) return { hold: false, reasons: [], lost: [] };
  // A page that was checked against sources (and the sources it lists) vouches for entries that carry no list of their
  // own: evidence pages keep their sources on the page, not on each entry.
  const pageSourced = oldPage.verified === true && trusted(oldPage.sources).length > 0;
  const text = pageText(newPage);
  // The checklist's own rows (items, secrets, the page's sections): what an item or secret must still be in.
  const listText = pageText({ items: newPage?.items, secrets: newPage?.secrets, sections: newPage?.sections });
  const lost: Lost[] = [];
  for (const l of LISTS) {
    const newNames = (Array.isArray(newPage?.[l.field]) ? newPage[l.field] : []).map((e: any) => normName(l.name(e))).filter(Boolean);
    for (const e of Array.isArray(oldPage[l.field]) ? oldPage[l.field] : []) {
      const name = String(l.name(e) || '').trim();
      if (!name || kept(name, l.kind, newNames, text, listText)) continue;
      const own = Array.isArray(e?.sources) && e.sources.length ? trusted(e.sources).length > 0 : pageSourced;
      lost.push({ kind: l.kind, name: name.slice(0, 120), sourced: own });
    }
  }
  // Checklist rows: still there if their words are (like a secret, they have no name of their own).
  for (const e of sectionEntries(oldPage)) {
    const name = String(e?.text || '').trim();
    if (!name || kept(name, 'secret', [], text, listText)) continue;
    lost.push({ kind: 'checklist', name: name.slice(0, 120), sourced: Array.isArray(e?.sources) && e.sources.length ? trusted(e.sources).length > 0 : pageSourced });
  }
  // A walkthrough cut to less than two thirds of its steps lost content, even when each step's name moved.
  const before = Array.isArray(oldPage.walkthrough) ? oldPage.walkthrough.length : 0;
  const after = Array.isArray(newPage?.walkthrough) ? newPage.walkthrough.length : 0;
  if (before >= 3 && after < Math.ceil((before * 2) / 3)) lost.push({ kind: 'walkthrough', name: `${before} steps → ${after}`, sourced: pageSourced });

  const reasons: string[] = [];
  const list = (xs: Lost[]) => xs.slice(0, 8).map((x) => (x.kind === 'walkthrough' ? `walkthrough ${x.name}` : `${x.kind} "${x.name}"`)).join(', ') + (xs.length > 8 ? ` and ${xs.length - 8} more` : '');
  // Any named entry lost holds the rebuild (owner, Oct 22 2026), sourced or not, checked page or not, found in Google or
  // not; only what the rebuild's claim check found contradicted may go.
  const dropped = lost.filter((x) => !contradicted.has(normName(x.name)));
  const sourced = dropped.filter((x) => x.sourced);
  if (sourced.length) reasons.push(`the rebuild drops ${sourced.length} sourced entr${sourced.length === 1 ? 'y' : 'ies'}: ${list(sourced)}`);
  const rest = dropped.filter((x) => !x.sourced);
  if (rest.length) reasons.push(`the rebuild drops ${rest.length} entr${rest.length === 1 ? 'y' : 'ies'} its sources don't contradict${impressions > 0 ? ` (the page has ${impressions} Search Console impressions)` : ''}: ${list(rest)}`);
  return { hold: reasons.length > 0, reasons, lost };
}

/**
 * Existing entries are kept unless sources contradict them (owner, Oct 22 2026): the old page's entries the rebuilt
 * fields no longer have (by the same comparison as the guard), added back marked `unconfirmed` ("Not yet confirmed" on
 * the page) with their own sources. Items, secrets, services, fights and choices go back in their lists; checklist rows
 * into the section of the same title (a new section when the rebuild has none). A walkthrough cut to under two thirds
 * of its steps stays as it was: steps can't be merged row by row. Returns the fields with them, and what was carried
 * over.
 */
export function carryOver(oldPage: any, fields: any, contradicted: Set<string> = new Set()): { fields: any; carried: Lost[] } {
  if (!oldPage) return { fields, carried: [] };
  const merged = { ...oldPage, ...fields };
  const v = rebuildVerdict(oldPage, merged, 0, contradicted);
  const want = new Set(v.lost.filter((x) => x.kind !== 'walkthrough' && !contradicted.has(normName(x.name))).map((x) => `${x.kind}|${x.name}`));
  const steps = v.lost.find((x) => x.kind === 'walkthrough');
  if (!want.size && !steps) return { fields, carried: [] };
  const out = { ...fields };
  const ids = new Set<string>();
  for (const k of ['items', 'secrets', 'shops', 'fights']) for (const e of Array.isArray(merged[k]) ? merged[k] : []) if (e?.id) ids.add(String(e.id));
  for (const e of sectionEntries(merged)) if (e?.id) ids.add(String(e.id));
  const freeId = (id: unknown, prefix: string) => {
    let n = String(id || `${prefix}${ids.size + 1}`);
    while (ids.has(n)) n = `${n}r`;
    ids.add(n);
    return n;
  };
  const carried: Lost[] = [];
  if (steps) { out.walkthrough = oldPage.walkthrough; carried.push({ ...steps, sourced: false }); }
  for (const l of LISTS) {
    for (const e of Array.isArray(oldPage[l.field]) ? oldPage[l.field] : []) {
      const name = String(l.name(e) || '').trim().slice(0, 120);
      if (!want.has(`${l.kind}|${name}`)) continue;
      const list = Array.isArray(out[l.field]) ? [...out[l.field]] : Array.isArray(merged[l.field]) ? [...merged[l.field]] : [];
      list.push({ ...e, ...(e?.id || l.field !== 'choices' ? { id: freeId(e?.id, l.field[0]) } : {}), unconfirmed: true });
      out[l.field] = list;
      carried.push({ kind: l.kind, name, sourced: false });
    }
  }
  const sections = (Array.isArray(out.sections) ? out.sections : Array.isArray(merged.sections) ? merged.sections : []).map((x: any) => ({ ...x, entries: [...(x.entries || [])] }));
  for (const x of Array.isArray(oldPage.sections) ? oldPage.sections : []) {
    for (const e of x?.entries || []) {
      const name = String(e?.text || '').trim().slice(0, 120);
      if (!want.has(`checklist|${name}`)) continue;
      let sec = sections.find((y: any) => normName(y.title) === normName(x.title));
      if (!sec) { sec = { ...x, entries: [] }; sections.push(sec); }
      sec.entries.push({ ...e, id: freeId(e?.id, 'c'), unconfirmed: true });
      carried.push({ kind: 'checklist', name, sourced: false });
    }
  }
  if (carried.some((c) => c.kind === 'checklist')) out.sections = sections;
  return { fields: out, carried };
}

/** The names a rebuild's claim check found contradicted (its removed claims), for carryOver and the guard. */
export function contradictedNames(pr: any, oldPage: any): Set<string> {
  const claims = ((pr?.claims?.removed || []) as any[]).filter((c) => c?.verdict === 'contradicted').map((c) => ` ${normName(c.claim)} `);
  const out = new Set<string>();
  if (!claims.length || !oldPage) return out;
  const names: string[] = [];
  for (const l of LISTS) for (const e of Array.isArray(oldPage[l.field]) ? oldPage[l.field] : []) names.push(String(l.name(e) || ''));
  for (const e of sectionEntries(oldPage)) names.push(String(e?.text || ''));
  for (const n of names) { const k = normName(n); if (k.length >= 4 && claims.some((c) => c.includes(` ${k} `))) out.add(k); }
  return out;
}

/** The names the page's last claim checks found contradicted (guidePrototypes, the live and the staged key). */
export async function contradictedFor(key: string, slug: string, oldPage: any): Promise<Set<string>> {
  const ids = [liveKey(key), stageKey(liveKey(key))].flatMap((k) => [`${k}__${slug}__evidence`, `${k}__${slug}`]);
  const out = new Set<string>();
  for (const p of await Promise.all(ids.map((id) => db().collection('guidePrototypes').doc(id).get()))) if (p.exists) for (const n of contradictedNames(p.data(), oldPage)) out.add(n);
  return out;
}

/** A staged page replaces the live one whole, so a list it doesn't have is a list it lost (carryOver merges the two). */
export const wholePage = (p: any) => ({ items: [], secrets: [], shops: [], fights: [], choices: [], sections: [], ...p });

/**
 * A page of the old outline that a restructure would retire: kept live when people find it in Google and the new
 * outline has no page with its name (a redirect to "the nearest page" loses them: Lakay went to Guarma).
 */
export function keepOnRestructure(oldName: string, impressions: number, newNames: string[]): boolean {
  if (impressions <= 0) return false;
  const n = normName(oldName);
  return !newNames.some((m) => normName(m) === n);
}

export const historyRef = (key: string, slug: string, at = Date.now()) =>
  db().collection('areaHistory').doc(`${liveKey(key)}__${slug}`).collection('versions').doc(String(at));

/** The live version, saved before anything replaces it (and, for a held rebuild, the version that was held back). */
export async function saveHistory(key: string, slug: string, page: any, role: 'replaced' | 'held', extra: Record<string, unknown> = {}): Promise<string> {
  const at = Date.now();
  await historyRef(key, slug, at).set(JSON.parse(JSON.stringify({ role, at, page, ...extra })));
  return String(at);
}

const hasContent = (p: any) => ['items', 'secrets', 'shops', 'fights', 'choices', 'walkthrough'].some((k) => Array.isArray(p?.[k]) && p[k].length);


/**
 * Before a rebuild's fields are merged onto a live page: the live version is saved to the history. Always true (nothing
 * is held since Nov 1 2026); a staged build isn't live, so there's nothing to save.
 */
export async function guardRebuild(target: string, slug: string, ref: FirebaseFirestore.DocumentReference): Promise<boolean> {
  if (isStageKey(target)) return true;
  const old: any = (await ref.get()).data();
  if (old && hasContent(old)) await saveHistory(target, slug, old, 'replaced');
  return true;
}

/** A rebuild held before Nov 1 2026, as it would go live: with what it lost carried over. */
export async function heldRelease(key: string, slug: string, live: any): Promise<{ fields: any; carried: Lost[] } | null> {
  const id = live?.rebuildHeld?.history;
  if (!id) return null;
  const held: any = (await historyRef(key, slug, Number(id)).get()).data();
  if (!held?.page) return null;
  // promote.ts saved the whole page (with its status); flagship.ts only the fields a rebuild writes.
  return carryOver(live, held.page.status ? wholePage(held.page) : held.page, await contradictedFor(key, slug, live));
}

/** Put it live (the live version saved to the history first). */
export async function releaseHeld(key: string, slug: string): Promise<Lost[] | null> {
  const ref = db().collection('guides').doc(liveKey(key)).collection('areas').doc(slug);
  const live: any = (await ref.get()).data();
  const r = await heldRelease(key, slug, live);
  if (!r) return null;
  await saveHistory(key, slug, live, 'replaced');
  await ref.set(JSON.parse(JSON.stringify({ ...r.fields, status: live.status, order: live.order, rebuildHeld: null, updatedAt: Date.now() })), { merge: true });
  // Its translations follow, as for any rebuild that goes live.
  await db().collection('guides').doc(liveKey(key)).set({ translationsDue: { at: Date.now(), pages: FieldValue.arrayUnion(slug) } }, { merge: true });
  return r.carried;
}

if (/rebuildGuard\.ts$/.test(process.argv[1] || '')) {
  (async () => {
    const key = arg('key'), slug = arg('slug');
    if (!key || !slug || arg('release') !== 'true') {
      console.log('Usage: npx tsx scripts/guides/rebuildGuard.ts --key key --slug slug --release   (put a rebuild held before Nov 1 2026 live)');
      process.exit(1);
    }
    const carried = await releaseHeld(key, slug);
    console.log(carried ? `Released the held rebuild of ${key}/${slug} with ${carried.length} entries carried over; republish the website (and its translations follow).` : `No held rebuild for ${key}/${slug}.`);
    setTimeout(() => process.exit(0), 300);
  })().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
}
