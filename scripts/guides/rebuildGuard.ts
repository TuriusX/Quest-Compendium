/**
 * "Do no harm" on rebuilds: before a rebuilt page replaces a live one (flagship.ts writePage, promote.ts), the live
 * version is saved to areaHistory/{key}__{slug}/versions/{at} for rollback, and the two are compared: the named entries
 * (items, secrets, shops, fights), the choices and the walkthrough's length.
 *
 * A rebuild that passed its review can still lose correct content: the new evidence pack happened to miss it, and the
 * "fill gaps" step drops what the reviewer can't support (Crow's Perch lost its Oswin and Baron fights that way). So:
 * - a rebuild that drops entries the old page had from trusted sources is held for the owner (the live page stays);
 * - so is one that drops anything from a page people find in Google (Search Console impressions), sourced or not:
 *   it ranks with what it has;
 * - a rebuild that only drops unsourced entries from a page nobody finds goes live (quick pages from memory are what
 *   rebuilds exist to replace).
 * Restructures (promote.ts) never retire a page with impressions unless the new outline has a page with its name.
 * A held rebuild is saved in the page's history (role "held") and flagged on the live page (rebuildHeld: reasons and
 * what it would drop), with a line in Discord. The owner puts it live after reading it:
 *
 *   npx tsx scripts/guides/rebuildGuard.ts --key elden-ring --slug limgrave --release
 *
 * Code only: nothing here calls a model or searches.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db, liveKey, isStageKey, arg } from './common';
import { trustedSites } from './claimCheck';
import { pageImpressions } from './pageStats';
import { notifyOwner } from '../pipeline/summary';

export type Lost = { kind: 'item' | 'secret' | 'shop' | 'fight' | 'choice' | 'walkthrough'; name: string; sourced: boolean };
export type RebuildVerdict = { hold: boolean; reasons: string[]; lost: Lost[] };

/** Our own site and code or mod hosts are never a source for a claim, whatever a stored list says. */
const NOT_SOURCES = /(^|\.)(questcompendium\.com|github\.com|nexusmods\.com)$/i;
const host = (s: unknown) => String(s || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
const trusted = (sources: unknown) => trustedSites((Array.isArray(sources) ? sources : []).map(host).filter(Boolean)).filter((s) => !NOT_SOURCES.test(s));

/** A name for comparing: lower case, no accents, punctuation or leading article. */
export const normName = (s: unknown) =>
  String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/^(the|a|an) /, '').trim();

const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'and', 'or', 'for', 'with', 'from', 'by', 'is', 'it', 'its', 'you', 'your', 'this', 'that', 'can', 'be', 'are', 'here', 'there', 'into', 'near']);
const words = (s: unknown) => normName(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));

/** Everything a page says, for "is this still on the page somewhere?" (an entry can move into a walkthrough step). */
function pageText(p: any): string {
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
function kept(name: string, kind: Lost['kind'], newNames: string[], text: string): boolean {
  const n = normName(name);
  if (!n) return true;
  if (kind === 'secret') {
    const w = words(name);
    if (!w.length) return true;
    return w.filter((x) => text.includes(` ${x} `)).length / w.length >= 0.6;
  }
  if (newNames.some((m) => m === n || (n.length >= 4 && m.length >= 4 && (m.includes(n) || n.includes(m))))) return true;
  // Renamed in the same list ("Baron fistfight" → "Fistfight with the Bloody Baron"): every word of the old name is in
  // one new name.
  const w = words(name);
  if (w.length >= 2 && newNames.some((m) => w.every((x) => ` ${m} `.includes(` ${x} `)))) return true;
  return text.includes(` ${n} `);
}

const LISTS: { kind: Lost['kind']; field: string; name: (e: any) => string }[] = [
  { kind: 'item', field: 'items', name: (e) => e?.name },
  { kind: 'secret', field: 'secrets', name: (e) => e?.name || e?.text },
  { kind: 'shop', field: 'shops', name: (e) => e?.name },
  { kind: 'fight', field: 'fights', name: (e) => e?.name },
  { kind: 'choice', field: 'choices', name: (e) => e?.title },
];

/**
 * Old page vs new page (each the whole page as it would be live), and the page's Search Console impressions. Pure:
 * the test replays it on stored pages for free.
 */
export function rebuildVerdict(oldPage: any, newPage: any, impressions = 0): RebuildVerdict {
  if (!oldPage) return { hold: false, reasons: [], lost: [] };
  // A page that was checked against sources (and the sources it lists) vouches for entries that carry no list of their
  // own: evidence pages keep their sources on the page, not on each entry.
  const pageSourced = oldPage.verified === true && trusted(oldPage.sources).length > 0;
  const text = pageText(newPage);
  const lost: Lost[] = [];
  for (const l of LISTS) {
    const newNames = (Array.isArray(newPage?.[l.field]) ? newPage[l.field] : []).map((e: any) => normName(l.name(e))).filter(Boolean);
    for (const e of Array.isArray(oldPage[l.field]) ? oldPage[l.field] : []) {
      const name = String(l.name(e) || '').trim();
      if (!name || kept(name, l.kind, newNames, text)) continue;
      const own = Array.isArray(e?.sources) && e.sources.length ? trusted(e.sources).length > 0 : pageSourced;
      lost.push({ kind: l.kind, name: name.slice(0, 120), sourced: own });
    }
  }
  // A walkthrough cut to less than two thirds of its steps lost content, even when each step's name moved.
  const before = Array.isArray(oldPage.walkthrough) ? oldPage.walkthrough.length : 0;
  const after = Array.isArray(newPage?.walkthrough) ? newPage.walkthrough.length : 0;
  if (before >= 3 && after < Math.ceil((before * 2) / 3)) lost.push({ kind: 'walkthrough', name: `${before} steps → ${after}`, sourced: pageSourced });

  const sourced = lost.filter((x) => x.sourced);
  const reasons: string[] = [];
  const list = (xs: Lost[]) => xs.slice(0, 8).map((x) => (x.kind === 'walkthrough' ? `walkthrough ${x.name}` : `${x.kind} "${x.name}"`)).join(', ') + (xs.length > 8 ? ` and ${xs.length - 8} more` : '');
  if (sourced.length) reasons.push(`the rebuild drops ${sourced.length} sourced entr${sourced.length === 1 ? 'y' : 'ies'}: ${list(sourced)}`);
  // A page never checked against sources (verified: false) losing its unsourced entries is the point of re-verifying it:
  // only a checked page with search traffic is held for unsourced losses too.
  if (impressions > 0 && oldPage.verified !== false && lost.length > sourced.length) {
    const rest = lost.filter((x) => !x.sourced);
    reasons.push(`the page has ${impressions} Search Console impressions and the rebuild drops ${rest.length} more: ${list(rest)}`);
  }
  return { hold: reasons.length > 0, reasons, lost };
}

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
 * Before a rebuild's fields are merged onto a live page: true to go ahead (the live version saved to the history
 * first), false when the rebuild is held (the live page keeps its content and gets the rebuildHeld flag). A staged
 * build isn't live, so it always goes ahead; promote.ts checks it when it goes live.
 */
export async function guardRebuild(target: string, slug: string, ref: FirebaseFirestore.DocumentReference, fields: any): Promise<boolean> {
  if (isStageKey(target)) return true;
  const old: any = (await ref.get()).data();
  if (!old || !hasContent(old)) return true;
  const impressions = await pageImpressions(target, slug);
  // Only a published page can lose readers; a held or draft page is saved to the history and replaced.
  const v = old.status === 'published' ? rebuildVerdict(old, { ...old, ...fields }, impressions) : { hold: false, reasons: [], lost: [] };
  if (v.hold) {
    const id = await saveHistory(target, slug, fields, 'held', { reasons: v.reasons, lost: v.lost, impressions });
    await ref.set({ rebuildHeld: JSON.parse(JSON.stringify({ at: Date.now(), reasons: v.reasons, lost: v.lost.slice(0, 40), history: id, impressions })) }, { merge: true });
    await notifyOwner(`Rebuild held for review: ${liveKey(target)}/${slug} (${old.name || slug}): ${v.reasons.join('; ')}. The live page is unchanged; the rebuild is in areaHistory (${id}).`);
    return false;
  }
  await saveHistory(target, slug, old, 'replaced');
  return true;
}

/** The owner's decision on a held rebuild: put it live (the current live version is saved to the history first). */
export async function releaseHeld(key: string, slug: string): Promise<boolean> {
  const ref = db().collection('guides').doc(liveKey(key)).collection('areas').doc(slug);
  const live: any = (await ref.get()).data();
  const id = live?.rebuildHeld?.history;
  if (!id) return false;
  const held: any = (await historyRef(key, slug, Number(id)).get()).data();
  if (!held?.page) return false;
  await saveHistory(key, slug, live, 'replaced');
  await ref.set({ ...held.page, rebuildHeld: null, updatedAt: Date.now() }, { merge: true });
  // Its translations follow, as for any rebuild that goes live.
  await db().collection('guides').doc(liveKey(key)).set({ translationsDue: { at: Date.now(), pages: FieldValue.arrayUnion(slug) } }, { merge: true });
  return true;
}

if (/rebuildGuard\.ts$/.test(process.argv[1] || '')) {
  (async () => {
    const key = arg('key'), slug = arg('slug');
    if (!key || !slug || arg('release') !== 'true') {
      console.log('Usage: npx tsx scripts/guides/rebuildGuard.ts --key key --slug slug --release   (put a held rebuild live)');
      process.exit(1);
    }
    console.log((await releaseHeld(key, slug)) ? `Released the held rebuild of ${key}/${slug}; republish the website (and its translations follow).` : `No held rebuild for ${key}/${slug}.`);
    setTimeout(() => process.exit(0), 300);
  })().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
}
