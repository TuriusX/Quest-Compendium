/**
 * The owner's "Fix now" edits at publish (ownerEdits.ts): loaded once, laid over each page's data before it is drawn
 * (English first, then each translation), and what happened to each saved back on the edit for the editor's "Your
 * edits" list and the Discord summary.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini } from './common';
import { applyEdit, getAt, setAt, fieldHash, type OwnerEdit } from './ownerEdits';

const LITE = process.env.GUIDE_LITE_MODEL || 'gemini-3.1-flash-lite';
const LANG_NAME: Record<string, string> = { es: 'Spanish (Latin American, neutral)', pt: 'Brazilian Portuguese', de: 'German', fr: 'French', ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Simplified Chinese' };

let EDITS: OwnerEdit[] = [];
const STATE = new Map<string, OwnerEdit['state']>();
const TR = new Map<string, OwnerEdit['tr']>();

/** The live edits (every guide, or one with --only). */
export async function loadOwnerEdits(only = ''): Promise<number> {
  let q: FirebaseFirestore.Query = db().collection('guideEdits').where('status', '==', 'live');
  if (only) q = q.where('key', '==', only);
  EDITS = ((await q.get().catch(() => null))?.docs || []).map((d) => ({ id: d.id, ...(d.data() as any) }));
  STATE.clear();
  TR.clear();
  return EDITS.length;
}

/** Lays a page's edits for this language over its data (in place). */
export function applyOwnerEdits(key: string, slug: string, data: any, lang = 'en'): void {
  if (!data) return;
  for (const e of EDITS) {
    if (e.key !== key || e.slug !== slug || (e.lang || 'en') !== lang) continue;
    const s = applyEdit(data, e);
    // An English edit's state is its English one; a translated page's own edits keep theirs.
    if (lang === (e.lang || 'en')) STATE.set(e.id, s);
  }
}

/**
 * A translated page gets the edited English fields in its language: the whole field translated again (kept on the
 * edit, made again only when the English field changes). Fields the translation doesn't have show the English anyway.
 */
export async function translateOwnerEdits(key: string, slug: string, en: any, tr: any, lang: string): Promise<void> {
  if (!tr || !LANG_NAME[lang]) return;
  for (const e of EDITS) {
    if (e.key !== key || e.slug !== slug || (e.lang || 'en') !== 'en' || STATE.get(e.id) !== 'applied') continue;
    // A new order is the same order in every language.
    if (e.op === 'order') { applyEdit(tr, e); continue; }
    const src = getAt(en, e.path);
    if (src === undefined || getAt(tr, e.path) === undefined) continue;
    const h = fieldHash(src);
    const have = { ...(e.tr || {}), ...(TR.get(e.id) || {}) };
    let text = have[lang]?.src === h ? have[lang].text : '';
    if (!text) {
      text = await translate(src, lang).catch(() => '');
      if (text) TR.set(e.id, { ...(TR.get(e.id) || {}), [lang]: { src: h, text } });
    }
    if (text) setAt(tr, e.path, text);
  }
}

async function translate(text: string, lang: string): Promise<string> {
  const res: any = await gemini().models.generateContent({
    model: LITE,
    contents: [{ role: 'user', parts: [{ text: `Translate this line from a video game guide into ${LANG_NAME[lang]}. Keep names of places, characters and items as the game uses them in that language, keep numbers as they are, and reply with the translation only.\n\n${text}` }] }],
    config: { temperature: 0, maxOutputTokens: 1200, thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
  });
  return String(res.text || '').trim();
}

/** Saves what happened to each edit (and new translations). Returns the counts for the log. */
export async function saveOwnerEditStates(): Promise<{ applied: number; kept: number; stale: number }> {
  const out = { applied: 0, kept: 0, stale: 0 };
  const batch = db().batch();
  let n = 0;
  for (const e of EDITS) {
    const s = STATE.get(e.id);
    if (!s) continue;
    // The nightly improvements' edits (auto) are counted on their own log (/admin/asked), not as the owner's.
    if (!e.auto) out[s]++;
    const tr = TR.get(e.id);
    if (s === e.state && !tr) continue;
    batch.set(db().collection('guideEdits').doc(e.id), { state: s, stateAt: Date.now(), ...(tr ? { tr: { ...(e.tr || {}), ...tr } } : {}) }, { merge: true });
    if (++n >= 400) break;
  }
  if (n) await batch.commit();
  return out;
}
