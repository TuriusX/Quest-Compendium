/**
 * The website's "Recent updates" (the homepage's section and the /updates/ page), kept up to date with the app's
 * releases: system/changelog { entries: [{ v, date, text, tr: { <lang>: text } }] }.
 *
 *   each run (run.ts): the GitHub releases of TuriusX/Quest-Compendium (public); a release not in the list yet gets one
 *   short player-facing line written from its notes, in the list's style, and its translations; publish.ts shows them.
 *   --seed: the list from scripts/pipeline/changelog-seed.json (entries marked fromHomepage keep the homepage's own
 *   wording and translations), translated where needed.
 *
 *   npx tsx scripts/pipeline/changelog.ts [--seed] [--add <version> --text "<the line>"]
 */
import fs from 'fs';
import path from 'path';
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg } from '../guides/common';

const LANGS = ['es', 'pt', 'de', 'fr', 'ru', 'ja', 'ko', 'zh'];
const NAMES: Record<string, string> = { es: 'Spanish', pt: 'Brazilian Portuguese', de: 'German', fr: 'French', ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Simplified Chinese' };
const ref = () => db().collection('system').doc('changelog');
type Entry = { v: string; date: string; text: string; tr: Record<string, string> };
/** The repo root (scripts run from it, locally and in the job). */
const ROOT = process.cwd();
const HERE = path.join(ROOT, 'scripts', 'pipeline');

async function translate(texts: string[]): Promise<Record<string, string>[]> {
  const out: Record<string, string>[] = texts.map(() => ({}));
  for (const l of LANGS) {
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: `Translate each line of a game app's release notes into ${NAMES[l]}, short and natural for players. Keep product names (Quest Compendium, Gemini, Premium, Pro, Fast, Steam, Microsoft Store), key names and anything in quotes that is a button label translated naturally. Reply with JSON only: {"lines": ["...", ...]} in the same order.\n${texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}` }] }],
      config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 6000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    let lines: any[] = [];
    try { const t = String(res?.text || ''); lines = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)).lines || []; } catch { /* left untranslated: English shows */ }
    texts.forEach((_, i) => { if (lines[i]) out[i][l] = String(lines[i]); });
  }
  return out;
}

/** The homepage's own wording for a version, in English and each language (for the entries kept from it). */
function fromHomepage(v: string): { text: string; tr: Record<string, string> } {
  const read = (file: string) => {
    const html = fs.readFileSync(file, 'utf8');
    const m = html.match(new RegExp(`<strong class="text-white">${v.replace(/\./g, '\\.')}:</strong>\\s*([\\s\\S]*?)</span>`));
    return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  };
  const site = path.join(ROOT, 'Marketing_Website_Files');
  const tr: Record<string, string> = {};
  for (const l of LANGS) { const t = fs.existsSync(path.join(site, l, 'index.html')) ? read(path.join(site, l, 'index.html')) : ''; if (t) tr[l] = t; }
  return { text: read(path.join(site, 'index.html')), tr };
}

async function main() {
  let entries: Entry[] = ((await ref().get()).data()?.entries || []) as Entry[];
  if (arg('seed') === 'true' && !entries.length) {
    const seed = JSON.parse(fs.readFileSync(path.join(HERE, 'changelog-seed.json'), 'utf8')) as any[];
    entries = seed.map((s) => (s.fromHomepage ? { v: s.v, date: s.date, ...fromHomepage(s.v) } : { v: s.v, date: s.date, text: s.text, tr: {} }));
    const need = entries.filter((e) => Object.keys(e.tr).length < LANGS.length);
    const tr = await translate(need.map((e) => e.text));
    need.forEach((e, i) => { e.tr = { ...tr[i], ...e.tr }; });
  }
  // A release's line written by hand (--add 0.5.5 --text "..."): used as is, translated, in place of the AI's line.
  const addV = arg('add');
  const addText = arg('text');
  if (addV && addV !== 'true' && addText && addText !== 'true' && !entries.some((e) => e.v === addV)) {
    const [tr] = await translate([addText]);
    entries.unshift({ v: addV, date: new Date().toISOString().slice(0, 10), text: addText, tr });
    console.log(`changelog: ${addV} added by hand: ${addText}`);
  }
  // New releases since the last entry.
  const r = await fetch('https://api.github.com/repos/TuriusX/Quest-Compendium/releases?per_page=30', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'quest-compendium-pipeline' } });
  const releases: any[] = r.ok ? await r.json() : [];
  const have = new Set(entries.map((e) => e.v));
  const fresh = releases.filter((x) => /^v\d+\.\d+\.\d+$/.test(String(x.tag_name)) && !x.draft && !x.prerelease && !have.has(String(x.tag_name).slice(1)));
  for (const x of fresh.reverse()) {
    const v = String(x.tag_name).slice(1);
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: [
        'Write one line for a game app website\'s "Recent updates" list about this release: player-facing, short (at most about 45 words), the main changes joined with semicolons, starting in lower case unless it starts with a name. Match the style of these lines:',
        ...entries.slice(0, 4).map((e) => `${e.v}: ${e.text}`), '', `RELEASE ${v} NOTES:`, String(x.body || '').slice(0, 4000), '', 'Reply with the line only, without the version number.',
      ].join('\n') }] }],
      config: { temperature: 0.2, maxOutputTokens: 400, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const text = String(res?.text || '').replace(/^\s*v?\d+\.\d+\.\d+:\s*/, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const [tr] = await translate([text]);
    entries.unshift({ v, date: String(x.published_at || '').slice(0, 10), text, tr });
    console.log(`changelog: ${v} added: ${text}`);
  }
  entries.sort((a, b) => b.v.split('.').map(Number).reduce((s, n, i) => s || n - Number(a.v.split('.')[i]), 0));
  await ref().set({ entries, updatedAt: Date.now() });
  console.log(`changelog: ${entries.length} release(s); ${fresh.length} new.`);
  setTimeout(() => process.exit(0), 300);
}
main().catch((e) => { console.error('changelog failed:', e?.message || e); process.exit(1); });
