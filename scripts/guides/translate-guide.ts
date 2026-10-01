/**
 * Translate a game's guide into other languages.
 *
 *   npx tsx scripts/guides/translate-guide.ts --game "The Witcher 3: Wild Hunt - Complete Edition" --lang pt
 *   options: --lang pt,es,de   several languages      --redo   retranslate every page (not just new or changed ones)
 *
 * Every published page is translated (overview, items, secrets, enemies, shops, tips and calendar sections), plus the
 * page names, story notes and section headings. The AI uses the game's official names in that language for places,
 * items, enemies and characters when the game was released in it. Translations are saved in Firestore at
 * guides/{game}/i18n/{lang}; checklist ids stay the same, so ticks carry over between languages. Re-running only
 * translates pages added or changed since the last run. Then run publish.ts to build the translated pages; the apps
 * show them automatically.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, gameKey, arg, type GuideArea } from './common';

const LANGS: Record<string, string> = {
  es: 'Spanish (Latin American, neutral)', pt: 'Brazilian Portuguese', de: 'German', fr: 'French', ru: 'Russian',
  ja: 'Japanese', ko: 'Korean', zh: 'Simplified Chinese',
};
const game = arg('game');
const langs = (arg('lang') || '').split(',').map((s) => s.trim()).filter((l) => LANGS[l]);
const redo = arg('redo') === 'true';
if (!game || !langs.length) {
  console.log('Usage: npx tsx scripts/guides/translate-guide.ts --game "Game" --lang pt[,es,…] [--redo]');
  process.exit(1);
}

type Tr = {
  name: string; story: string; overview: string;
  items: { id: string; name?: string; where?: string }[];
  secrets: { id: string; text?: string }[];
  enemies: { id: string; name?: string; weakness?: string; steal?: string; notes?: string }[];
  shops: { id: string; name?: string; sells?: string }[];
  tips: string[];
  sections: { title: string; entries: { id: string; text: string }[] }[];
  src: number;
};

/** What gets translated on a page (ids kept so translations line up). */
function source(a: GuideArea) {
  return {
    name: a.name, story: a.story || '', overview: a.overview || '',
    items: a.items.map((e) => ({ id: e.id, name: e.name, where: e.where })),
    secrets: a.secrets.map((e) => ({ id: e.id, text: e.text })),
    enemies: a.enemies.map((e) => ({ id: e.id, name: e.name, weakness: e.weakness, steal: e.steal, notes: e.notes })),
    shops: a.shops.map((e) => ({ id: e.id, name: e.name, sells: e.sells })),
    tips: a.tips || [],
    sections: (a.sections || []).map((x) => ({ title: x.title, entries: x.entries.map((e) => ({ id: e.id, text: e.text })) })),
  };
}

/** Same shape and ids as the original: anything else is rejected (the page stays in English). */
function sameShape(src: ReturnType<typeof source>, tr: any): boolean {
  if (!tr || typeof tr.name !== 'string') return false;
  const ids = (l: any[]) => (Array.isArray(l) ? l.map((e) => String(e?.id)).join(',') : '');
  return (
    ids(tr.items) === ids(src.items) && ids(tr.secrets) === ids(src.secrets) && ids(tr.enemies) === ids(src.enemies) &&
    ids(tr.shops) === ids(src.shops) && Array.isArray(tr.tips) && tr.tips.length === src.tips.length &&
    Array.isArray(tr.sections) && tr.sections.length === src.sections.length &&
    tr.sections.every((x: any, i: number) => ids(x?.entries) === ids(src.sections[i].entries))
  );
}

async function main() {
  const key = gameKey(game!);
  const ref = db().collection('guides').doc(key);
  const info = (await ref.get()).data();
  if (!info) throw new Error(`no guide found for ${game}`);
  const snap = await ref.collection('areas').where('status', '==', 'published').get();
  const pages = snap.docs.map((d) => d.data() as GuideArea);
  const groups = [...new Set((info.areas || []).map((o: any) => o.group).filter(Boolean))] as string[];
  const ai = gemini();
  let dollars = 0;

  const call = async (prompt: string) => {
    const res: any = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json', temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const u = res?.usageMetadata;
    if (u) dollars += ((u.promptTokenCount || 0) * 0.5 + ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * 3) / 1_000_000;
    return JSON.parse(String(res?.text || '{}').replace(/```json|```/g, '').trim());
  };
  const RULES = (lang: string) =>
    `Translate into ${LANGS[lang]}. This is a player's guide for the video game "${info.game || game}". Use the game's ` +
    `official ${LANGS[lang]} names for places, items, enemies, characters and quests if the game was released in that ` +
    'language; otherwise keep the original names. Keep numbers, ids and the JSON structure exactly the same, and translate ' +
    'only the text values. Natural, clear wording a player would expect.';

  for (const lang of langs) {
    const trRef = ref.collection('i18n').doc(lang);
    const existing = redo ? {} : ((await trRef.get()).data() || {});
    const areas: Record<string, Tr> = { ...(existing.areas || {}) };
    const todo = pages.filter((p) => !areas[p.slug] || (areas[p.slug].src || 0) < (p.updatedAt || 0));
    console.log(`${lang}: ${pages.length} published pages, ${todo.length} to translate`);
    let done = 0, failed = 0;
    for (const p of todo) {
      const src = source(p);
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const tr = await call(`${RULES(lang)}\n${JSON.stringify(src)}`);
          if (sameShape(src, tr)) {
            areas[p.slug] = { ...tr, src: p.updatedAt || Date.now() };
            ok = true;
          }
        } catch (e: any) {
          if (attempt) console.warn(`  ${p.name}: ${e?.message}`);
        }
      }
      if (ok) done++;
      else {
        failed++;
        console.warn(`  ${p.name}: couldn't translate it cleanly; it stays in English for now`);
      }
      if ((done + failed) % 10 === 0) console.log(`  ${done + failed}/${todo.length}`);
    }
    // Section headings (an expansion, a character, "Calendar").
    let groupNames: Record<string, string> = { ...(existing.groups || {}) };
    const newGroups = groups.filter((g) => !groupNames[g]);
    if (newGroups.length) {
      try {
        const arr = await call(`${RULES(lang)} Reply with a JSON array of the translations, same order.\n${JSON.stringify(newGroups)}`);
        if (Array.isArray(arr) && arr.length === newGroups.length) newGroups.forEach((g, i) => (groupNames[g] = String(arr[i] || g)));
      } catch {
        /* headings stay in English */
      }
    }
    // Remove translations of pages that are no longer published.
    const live = new Set(pages.map((p) => p.slug));
    for (const s of Object.keys(areas)) if (!live.has(s)) delete areas[s];
    await trRef.set({ lang, areas, groups: groupNames, updatedAt: Date.now() });
    await ref.set({ languages: [...new Set([...(info.languages || []), lang])] }, { merge: true });
    console.log(`${lang}: ${done} translated, ${failed} left in English, ${Object.keys(areas).length} pages available in this language.`);
  }
  console.log(`Done. Estimated cost ≈ $${dollars.toFixed(3)}. Next: npx tsx scripts/guides/publish.ts`);
  setTimeout(() => process.exit(0), 1500);
}

main().catch((e) => {
  console.error('Translating the guide failed:', e?.message || e);
  process.exit(1);
});
