/**
 * Official localised names for a translated guide's pages, from sources (the site audit found machine-translated
 * place names, e.g. Spanish "Encrucijada de la posada" where the game and its players say "Posada de la Encrucijada").
 * Searched calls ask for the official names; only lines a source supports count. A page name changes only when a
 * sourced official name differs from what the translation uses; the same name is replaced in that language's text.
 *
 *   npx tsx scripts/guides/officialNames.ts --key the-witcher-3-wild-hunt-complete-edition --langs es,pt [--dry]
 * Cost: about 3 searched calls per game and language (≈ $0.24), once.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, usageScope, searchesIn } from './common';
import { supportedSegments } from './claimCheck';

const LANG_NAME: Record<string, string> = { es: 'Spanish', pt: 'Brazilian Portuguese', de: 'German', fr: 'French', ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Simplified Chinese' };

/** "English = Official" pairs from the source-backed lines of a searched answer. */
export function sourcedPairs(lines: string[], wanted: string[]): Record<string, string> {
  const want = new Map(wanted.map((w) => [w.toLowerCase().replace(/[’']/g, "'").trim(), w]));
  const out: Record<string, string> = {};
  for (const line of lines) {
    const m = line.replace(/^[-*•\d.)\s]+/, '').match(/^"?([^"=:→]+?)"?\s*(?:=|→|->)\s*"?([^"(]+?)"?\s*(?:\(.*\))?\.?$/);
    if (!m) continue;
    const en = want.get(m[1].toLowerCase().replace(/[’']/g, "'").trim());
    const official = m[2].trim();
    if (en && official && official.length <= 80) out[en] = official;
  }
  return out;
}

export async function officialNames(key: string, lang: string, dry = false) {
  const info: any = (await db().collection('guides').doc(key).get()).data();
  const game = String(info?.game || key);
  const ref = db().collection('guides').doc(key).collection('i18n').doc(lang);
  const t: any = (await ref.get()).data();
  if (!t?.areas) return { lang, changed: [] as string[], found: 0, note: 'no translation' };
  // Our own qualifiers ("Crow's Perch (Underground)") aren't in-game names: those pages keep their translation.
  const names = (info.areas || []).filter((a: any) => t.areas[a.slug] && !/[()]/.test(String(a.name))).map((a: any) => String(a.name));
  const found: Record<string, string> = {};
  for (let i = 0; i < names.length; i += 30) {
    const batch = names.slice(i, i + 30);
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: `In the official ${LANG_NAME[lang]} version of the video game "${game}" (its in-game text), what are these places called? For each one whose official ${LANG_NAME[lang]} name a source shows, write one line exactly as: English name = official ${LANG_NAME[lang]} name. Leave out any you can't find in a source; never translate a name yourself.\n${batch.join('\n')}\nRun a few searches (the game's ${LANG_NAME[lang]} wikis and guides; never fandom.com; at most five).` }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    searchesIn(res);
    Object.assign(found, sourcedPairs(supportedSegments(res).flatMap((s) => s.text.split('\n')), batch));
  }
  // Pages whose translated name differs from the sourced official one.
  const bySlug = new Map((info.areas || []).map((a: any) => [String(a.name), String(a.slug)]));
  const changes: { slug: string; en: string; from: string; to: string }[] = [];
  for (const [en, official] of Object.entries(found)) {
    const slug = bySlug.get(en) as string | undefined;
    const cur = slug ? String(t.areas[slug]?.name || '') : '';
    // A page name starts with a capital; and never the same name as another page of the guide in this language.
    const to = official.charAt(0).toUpperCase() + official.slice(1);
    const taken = Object.entries(t.areas).some(([s2, x]: [string, any]) => s2 !== slug && String(x?.name || '').toLowerCase() === to.toLowerCase());
    if (slug && cur && cur.toLowerCase() !== to.toLowerCase() && !taken) changes.push({ slug, en, from: cur, to });
  }
  if (!dry && changes.length) {
    let text = JSON.stringify({ areas: t.areas, glossary: t.glossary || {} });
    for (const c of changes) text = text.split(JSON.stringify(c.from).slice(1, -1)).join(JSON.stringify(c.to).slice(1, -1));
    const next = JSON.parse(text);
    for (const c of changes) next.glossary[c.en] = c.to;
    await ref.set({ areas: next.areas, glossary: next.glossary, officialNames: { ...(t.officialNames || {}), ...found }, officialNamesAt: Date.now() }, { merge: true });
  } else if (!dry) await ref.set({ officialNames: { ...(t.officialNames || {}), ...found }, officialNamesAt: Date.now() }, { merge: true });
  return { lang, found: Object.keys(found).length, changed: changes.map((c) => `${c.en}: ${c.from} → ${c.to}`) };
}

async function main() {
  const key = String(arg('key') || '');
  const langs = String(arg('langs') || 'es,pt').split(',').map((s) => s.trim()).filter(Boolean);
  const dry = arg('dry') === 'true';
  for (const lang of langs) {
    const scope = { dollars: 0, searches: 0 };
    const r = await usageScope.run(scope, () => officialNames(key, lang, dry));
    console.log(`${lang}: ${r.found} official name(s) found in sources; ${r.changed.length} page name(s) ${dry ? 'would change' : 'changed'}; $${scope.dollars.toFixed(3)} (${scope.searches} searches)`);
    for (const c of r.changed) console.log(`   ${c}`);
  }
  setTimeout(() => process.exit(0), 300);
}
if (/officialNames\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('officialNames failed:', e?.message || e); process.exit(1); });
