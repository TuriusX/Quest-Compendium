/**
 * Translate interface strings with Gemini, for the app or the Steam Deck plugin.
 *
 *   npx tsx scripts/i18n/translate.ts --target app
 *   npx tsx scripts/i18n/translate.ts --target decky --decky ../Quest-Compendium-Decky
 *   options: --only de,fr   just these languages      --redo   retranslate everything (not just missing keys)
 *
 * Reads the English strings (and the hand-written Spanish/Portuguese, which are kept as they are), translates every
 * key that's missing in the target languages, checks each translation keeps its {placeholders}, and writes
 * locales.generated.ts. Keys that fail the check are left out and fall back to English. Re-running only translates
 * new keys, so it's cheap to run after adding strings.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

dotenv.config();
const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i < 0 ? d : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : 'true';
};
const target = arg('target', 'app');
const redo = arg('redo') === 'true';
const only = (arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const MODEL = process.env.GUIDE_MODEL || process.env.MAIN_MODEL || 'gemini-3.8-flash';

const LANGS: Record<string, string> = {
  es: 'Spanish (Latin American, neutral)',
  pt: 'Brazilian Portuguese',
  de: 'German',
  fr: 'French',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Simplified Chinese',
};

const placeholders = (s: string) => (s.match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');
/**
 * Keys ending in Pre/Post are the two halves of a sentence split around a key or value ("Press" [Ctrl + V] "to paste…").
 * Some languages put all the words on one side, so an empty translation is fine for these.
 */
const isFragment = (key: string) => /(Pre|Post)$/.test(key);
/** Write a file with the line endings it already has (CRLF in a Windows checkout); new files get LF. */
const eolOf = (file: string) => (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('\r\n') ? '\r\n' : '\n');

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing from .env');
  const ai = new GoogleGenAI({ apiKey });

  // Where the strings come from and where the translations go.
  let source: Record<string, string>;
  let hand: Record<string, Record<string, string>> = {};
  let outFile: string;
  let product: string;
  if (target === 'decky') {
    const root = path.resolve(arg('decky', '../Quest-Compendium-Decky')!);
    const mod: any = await import(pathToFileURL(path.join(root, 'src', 'i18n.ts')).href);
    source = mod.SOURCE_STRINGS;
    hand = mod.HAND_WRITTEN || {};
    outFile = path.join(root, 'src', 'locales.generated.ts');
    product = 'the Steam Deck plugin of Quest Compendium, an AI game companion (short labels in the Steam Deck Quick Access menu)';
  } else {
    const mod: any = await import(pathToFileURL(path.resolve('src/i18n.tsx')).href);
    source = mod.SOURCE_STRINGS;
    hand = mod.HAND_WRITTEN || {};
    outFile = path.resolve('src/locales.generated.ts');
    product = 'Quest Compendium, an AI game companion app that overlays your game (desktop and web)';
  }
  if (!source) throw new Error('could not read the English strings (SOURCE_STRINGS)');

  let existing: Record<string, Record<string, string>> = {};
  if (fs.existsSync(outFile) && !redo) {
    const mod: any = await import(pathToFileURL(outFile).href + `?t=${Date.now()}`);
    existing = mod.GENERATED || {};
  }

  const out: Record<string, Record<string, string>> = { ...existing };
  let dollars = 0;
  for (const [code, langName] of Object.entries(LANGS)) {
    if (only.length && !only.includes(code)) continue;
    const have = { ...(out[code] || {}) };
    const missing = Object.keys(source).filter((k) => !(hand[code] && k in hand[code]) && !(k in have));
    if (!missing.length) {
      console.log(`${code}: nothing to translate`);
      continue;
    }
    console.log(`${code}: translating ${missing.length} strings…`);
    for (let i = 0; i < missing.length; i += 60) {
      const batch = Object.fromEntries(missing.slice(i, i + 60).map((k) => [k, source[k]]));
      const prompt =
        `Translate these interface strings for ${product} into ${langName}. ` +
        'Reply with a JSON object with exactly the same keys and the translated strings as values. Rules: keep every ' +
        'placeholder in curly braces exactly as it is (like {n}, {game}, {keys}); keep product names (Quest Compendium, ' +
        'Steam, Steam Deck, Discord, Gemini, Google, Premium) and keyboard keys (Ctrl, Shift, Alt) as they are; keep ' +
        'emoji and symbols; use natural, friendly wording a gamer would expect in this language, and keep labels about ' +
        'as short as the English. Keys ending in Pre and Post are the words before and after a keyboard key or value in ' +
        'one sentence: translate them so the sentence reads naturally in that order, and use an empty string for a part ' +
        'the language doesn\'t need.\n' +
        JSON.stringify(batch);
      let parsed: Record<string, string> = {};
      for (let attempt = 0; attempt < 2 && !Object.keys(parsed).length; attempt++) {
        try {
          const res: any = await ai.models.generateContent({
            model: MODEL,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { responseMimeType: 'application/json', temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
          });
          const u = res?.usageMetadata;
          if (u) dollars += ((u.promptTokenCount || 0) * 0.5 + ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * 3) / 1_000_000;
          parsed = JSON.parse(String(res?.text || '{}').replace(/```json|```/g, '').trim());
        } catch (e: any) {
          console.warn(`  batch failed (${e?.message}); ${attempt ? 'skipping' : 'retrying'}`);
        }
      }
      let ok = 0;
      for (const [k, v] of Object.entries(batch)) {
        const tr = parsed[k];
        if (typeof tr === 'string' && (tr.trim() || isFragment(k)) && placeholders(tr) === placeholders(v)) {
          have[k] = tr;
          ok++;
        }
      }
      console.log(`  ${Math.min(i + 60, missing.length)}/${missing.length} (${ok} of ${Object.keys(batch).length} passed the checks)`);
    }
    out[code] = Object.fromEntries(Object.keys(source).filter((k) => k in have).map((k) => [k, have[k]]));
  }

  const body = Object.keys(out)
    .sort()
    .map((code) => `  ${code}: ${JSON.stringify(out[code], null, 2).replace(/\n/g, '\n  ')},`)
    .join('\n');
  const eol = eolOf(outFile);
  fs.writeFileSync(
    outFile,
    `/**\n * AI translations of the interface, written by scripts/i18n/translate.ts in the Quest Compendium repo (run it again\n * after adding English strings or a language). Used after the hand-written dictionaries; anything missing falls back\n * to English.\n */\nexport const GENERATED: Record<string, Record<string, string>> = {\n${body}\n};\n`.replace(/\n/g, eol),
  );
  console.log(`Wrote ${outFile}. Estimated cost ≈ $${dollars.toFixed(3)}.`);
}

main().catch((e) => {
  console.error('Translation failed:', e?.message || e);
  process.exit(1);
});
