/**
 * Characters' common names (what players call them: Ciri for Cirilla Fiona Elen Riannon, Regis, Dijkstra), shown in
 * lists, hover previews and page titles; the full name stays the page's name and its opening line. Saved as
 * entities/{slug}.displayName (only when it differs). Page addresses don't change. No search.
 *
 *   npx tsx scripts/guides/commonNames.ts [--only <guide key>]
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, usageScope } from './common';
import { FieldValue } from 'firebase-admin/firestore';
import { entityKind } from './siteText';

/** The common names for a game's characters, by full name (only those that differ). */
export async function commonNames(game: string, names: string[]): Promise<Record<string, string>> {
  if (!names.length) return {};
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `Characters in the video game "${game}", by their full names. For each, the name players and the game itself most commonly use for them (e.g. "Cirilla Fiona Elen Riannon" -> "Ciri", "Emiel Regis Rohellec Terzieff-Godefroy" -> "Regis", "Sigismund Dijkstra" -> "Dijkstra", "Arthur Morgan" -> "Arthur Morgan"). Keep the full name when that is what's commonly used, or when the short form would be ambiguous in this game.`,
      ...names.map((n) => `- ${n}`),
      'Reply with JSON only: {"<full name>": "<common name>", ...} for every name.',
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 2000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  let j: Record<string, string> = {};
  try { const t = String(res?.text || ''); j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { /* none */ }
  const out: Record<string, string> = {};
  for (const n of names) {
    const c = String(j[n] || '').trim();
    // Only a real shortening that's part of the full name (no invented nicknames that share nothing with it).
    const full = n.toLowerCase().split(/[\s,'-]+/).filter(Boolean);
    if (c && c !== n && c.length < n.length && c.toLowerCase().split(/[\s-]+/).filter(Boolean).every((w) => full.some((f) => f.startsWith(w)))) out[n] = c;
  }
  return out;
}

async function main() {
  const only = arg('only') && arg('only') !== 'true' ? String(arg('only')) : '';
  const scope = { dollars: 0, searches: 0 };
  await usageScope.run(scope, async () => {
    for (const g of (await db().collection('guideCompendium').get()).docs) {
      if (only && g.id !== only) continue;
      const game = String((await db().collection('guides').doc(g.id).get()).data()?.game || g.id);
      // A page can opt out (noDisplayName: an ambiguous short form, e.g. "Projection" for Sorcerous Sundries Projection).
      const people = (await g.ref.collection('entities').where('status', '==', 'published').get()).docs.filter((d) => entityKind(d.data().typeLabel || d.data().type) === 'person' && !d.data().noDisplayName);
      if (!people.length) continue;
      const map = await commonNames(game, people.map((d) => String(d.data().name)));
      for (const d of people) {
        const c = map[String(d.data().name)];
        if (c && c !== d.data().displayName) await d.ref.set({ displayName: c }, { merge: true });
        else if (!c && d.data().displayName) await d.ref.update({ displayName: FieldValue.delete() });
      }
      console.log(`${g.id}: ${Object.entries(map).map(([n, c]) => `${n} -> ${c}`).join('; ') || 'no short names'}`);
    }
  });
  console.log(`commonNames: $${scope.dollars.toFixed(3)}`);
  setTimeout(() => process.exit(0), 300);
}
if (/commonNames\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('commonNames failed:', e?.message || e); process.exit(1); });
