/**
 * Missing facts from app answers (owner, Oct 31 2026): when an answer names something for the player's place that the
 * guide page doesn't have (FF6 South Figaro's mansion: the Hyper Wrist and Hermes Sandals), it goes to the nightly
 * improver as a "missing" item for that page, the same way as the site's ask box (siteAsk.ts):
 *
 *   1. here, in /api/chat: the model lists them in a <qc-missing> line (removed from the text); names the page already
 *      has are dropped, and the rest are saved in contributions/{id} (source "app", kind "missing"): the page, the thing
 *      and one sentence about it from the answer. No player id, question or conversation text.
 *   2. scripts/guides/contributions.ts (nightly): one targeted search and the claim check, as for every contribution.
 *   3. scripts/guides/autoImprove.ts (missing facts): what sources back is placed on the page, logged with an undo.
 *
 * At most APP_MISSING_PER_DAY a day across all players, and a thing already waiting for the page in the last 30 days is
 * not queued again.
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { isTestTraffic } from './testTraffic';
import type { GuidePageForPlace } from './guidesApi';

export const APP_MISSING_PER_DAY = 10;

/** Added to the prompt with the guide notes for the place. */
export const MISSING_RULES = `
- Missing from the guide: if your answer names things for this place (items, secrets, characters, quests, side areas)
  that the guide notes above don't have, add one line at the very end (removed before the player sees it), at most 5,
  only things you're sure of, never guesses:
<qc-missing>[{"name": "<the thing>", "fact": "<one short self-contained sentence: what it is, where exactly and how to get it>"}]</qc-missing>`;

export type MissingOut = { name: string; fact: string };

/** Pull the <qc-missing> line out of an answer (always removed from the text). */
export function extractMissing(text: string): { text: string; missing: MissingOut[] } {
  const missing: MissingOut[] = [];
  const cleaned = text.replace(/(?:```[a-z]*\s*)?<qc-missing>([\s\S]*?)<\/qc-missing>(?:\s*```)?/gi, (_m, body) => {
    try {
      const j = JSON.parse(String(body).trim());
      const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
      for (const x of Array.isArray(j) ? j : [j]) {
        const m = { name: str(x?.name, 80), fact: str(x?.fact, 400) };
        if (m.name && m.fact && !missing.some((y) => norm(y.name) === norm(m.name))) missing.push(m);
      }
    } catch {
      /* a broken line is dropped */
    }
    return '';
  });
  return { text: cleaned.replace(/\n{3,}/g, '\n\n').trim(), missing: missing.slice(0, 5) };
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Everything the page says, normalized, to tell what it already has. */
function pageText(pg: GuidePageForPlace): string {
  const parts: unknown[] = [pg.name, pg.overview, ...pg.tips];
  for (const e of [...pg.items, ...pg.secrets, ...pg.enemies, ...pg.shops]) parts.push(e?.name, e?.text, e?.where, e?.how, e?.notes, e?.sells);
  for (const x of pg.sections) for (const e of x.entries) parts.push(e.text);
  for (const f of pg.fights || []) parts.push(f.name, f.enemies, f.rewards);
  for (const s of pg.walkthrough || []) parts.push(s.title, s.text);
  if (pg.info) parts.push(...(pg.info.quests || []), ...(pg.info.services || []), pg.info.directions);
  return ` ${parts.map(norm).filter(Boolean).join(' ')} `;
}

/** The ones the page doesn't name already. */
export function notOnPage(pg: GuidePageForPlace, missing: MissingOut[]): MissingOut[] {
  const have = pageText(pg);
  return missing.filter((m) => norm(m.name).length >= 3 && !have.includes(` ${norm(m.name)} `));
}

/** The app's language names as the guides' codes. */
const LANG_CODES: Record<string, string> = { English: 'en', Spanish: 'es', 'Brazilian Portuguese': 'pt', German: 'de', French: 'fr', Russian: 'ru', Japanese: 'ja', Korean: 'ko', 'Simplified Chinese': 'zh' };

const dayOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

/** Saves them as "missing" items for the page (see the top of the file). Returns how many were queued. */
export async function saveMissingFacts(opts: { page: GuidePageForPlace | null; missing: MissingOut[]; uid: string; language?: string }, db = getFirestore()): Promise<number> {
  const { page } = opts;
  if (!page || !opts.missing.length || isTestTraffic(opts.uid)) return 0;
  const fresh = notOnPage(page, opts.missing);
  if (!fresh.length) return 0;
  try {
    const since = Date.now() - 30 * 86_400_000;
    const waiting = (await db.collection('contributions').where('key', '==', page.key).where('slug', '==', page.slug).get()).docs
      .map((d) => d.data())
      .filter((x) => x.kind === 'missing' && Number(x.at) > since)
      .map((x) => norm(x.name || x.label));
    const dayRef = db.collection('appMissingDays').doc(dayOf());
    let queued = 0;
    for (const m of fresh) {
      if (waiting.some((w) => w === norm(m.name) || w === norm(`Missing: ${m.name}`))) continue;
      const room = await db.runTransaction(async (tx) => {
        const n = Number((await tx.get(dayRef)).data()?.queued) || 0;
        if (n >= APP_MISSING_PER_DAY) return false;
        tx.set(dayRef, { queued: FieldValue.increment(1), at: Date.now() }, { merge: true });
        return true;
      });
      if (!room) break;
      await db.collection('contributions').add({
        key: page.key, slug: page.slug, page: 'area', anchor: '', label: `Missing: ${m.name}`, name: m.name, kind: 'missing',
        text: m.fact, lang: LANG_CODES[opts.language || 'English'] || 'en', credit: false, owner: false, uid: 'app', source: 'app', status: 'pending', at: Date.now(),
      });
      queued++;
    }
    if (queued) console.log(`[missing] ${queued} missing fact(s) for ${page.key}/${page.slug}`);
    return queued;
  } catch (e: any) {
    console.warn('[missing] save failed:', e?.message);
    return 0;
  }
}
