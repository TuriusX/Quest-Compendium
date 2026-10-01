/**
 * Translate the website's main page into the app's other languages, and connect the versions.
 *
 *   npx tsx scripts/i18n/translate-site.ts                (all languages)
 *   npx tsx scripts/i18n/translate-site.ts --only pt,es
 *
 * Writes Marketing_Website_Files/<lang>/index.html for each language, translated from the English index.html: the
 * visible text and the text in alt, title, aria-label and placeholder attributes, the page title and the search
 * description. The page's structure is untouched (only text is swapped), links are adjusted for the extra folder
 * level, and every version (English included) gets a language menu and the hreflang tags that tell Google which
 * version to show in which country. Translations are cached in scripts/i18n/site/<lang>.json, so re-running only
 * translates text that changed. Run publish.ts afterwards: it fills in each version's guides section.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

dotenv.config();
const SITE = 'https://questcompendium.com';
const ROOT = path.resolve('Marketing_Website_Files');
const CACHE = path.resolve('scripts/i18n/site');
const MODEL = process.env.GUIDE_MODEL || process.env.MAIN_MODEL || 'gemini-3.8-flash';
const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? (process.argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
})();

export const SITE_LANGS: { code: string; tag: string; label: string; name: string }[] = [
  { code: 'en', tag: 'en', label: 'English', name: 'English' },
  { code: 'es', tag: 'es', label: 'Español', name: 'Spanish (Latin American, neutral)' },
  { code: 'pt', tag: 'pt-BR', label: 'Português', name: 'Brazilian Portuguese' },
  { code: 'de', tag: 'de', label: 'Deutsch', name: 'German' },
  { code: 'fr', tag: 'fr', label: 'Français', name: 'French' },
  { code: 'ru', tag: 'ru', label: 'Русский', name: 'Russian' },
  { code: 'ja', tag: 'ja', label: '日本語', name: 'Japanese' },
  { code: 'ko', tag: 'ko', label: '한국어', name: 'Korean' },
  { code: 'zh', tag: 'zh-CN', label: '简体中文', name: 'Simplified Chinese' },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const hasWords = (s: string) => /\p{L}{2,}/u.test(s);
const has = (map: Record<string, string>, k: string) => Object.prototype.hasOwnProperty.call(map, k);
/** Write a file with the line endings it already has (or the given default for a new file). */
const eolOf = (file: string, fallback = '\n') => (fs.existsSync(file) ? (fs.readFileSync(file, 'utf8').includes('\r\n') ? '\r\n' : '\n') : fallback);
const withEol = (s: string, eol: string) => s.replace(/\r?\n/g, eol);

/** Split the page into parts that may be translated and parts that must stay exactly as they are. */
function segments(html: string): { text: string; locked: boolean }[] {
  const lockRe = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!-- QC-(?:GUIDES|LANGS|HREFLANG):START -->[\s\S]*?<!-- QC-(?:GUIDES|LANGS|HREFLANG):END -->|<!--[\s\S]*?-->|<code[\s\S]*?<\/code>/g;
  const out: { text: string; locked: boolean }[] = [];
  let last = 0;
  for (const m of html.matchAll(lockRe)) {
    if (m.index! > last) out.push({ text: html.slice(last, m.index), locked: false });
    out.push({ text: m[0], locked: true });
    last = m.index! + m[0].length;
  }
  out.push({ text: html.slice(last), locked: false });
  return out;
}

const ATTR_RE = /\b(alt|title|aria-label|placeholder)="([^"]*)"/g;
const META_RE = /(<meta\s+(?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description)"\s+content=")([^"]*)(")/g;
const TEXT_RE = />([^<>]+)</g;

export function collect(html: string): Set<string> {
  const found = new Set<string>();
  for (const seg of segments(html)) {
    if (seg.locked) continue;
    for (const m of seg.text.matchAll(TEXT_RE)) {
      const t = decode(m[1]).trim();
      if (hasWords(t)) found.add(t);
    }
    for (const m of seg.text.matchAll(ATTR_RE)) {
      const t = decode(m[2]).trim();
      if (hasWords(t)) found.add(t);
    }
    for (const m of seg.text.matchAll(META_RE)) {
      const t = decode(m[2]).trim();
      if (hasWords(t)) found.add(t);
    }
  }
  return found;
}

/**
 * Texts that sit right next to an inline element in a sentence ("Press" <kbd>Ctrl + V</kbd> "to paste"). Some languages
 * need no words on one side of it, so an empty translation is fine for these.
 */
export function fragments(html: string): Set<string> {
  const found = new Set<string>();
  const INLINE = /^<\/?(kbd|strong|em|b|a|code)\b/i;
  for (const seg of segments(html)) {
    if (seg.locked) continue;
    for (const m of seg.text.matchAll(TEXT_RE)) {
      const t = decode(m[1]).trim();
      if (!hasWords(t)) continue;
      const before = seg.text.slice(seg.text.lastIndexOf('<', m.index!), m.index! + 1);
      const after = seg.text.slice(m.index! + m[0].length - 1, seg.text.indexOf('>', m.index! + m[0].length - 1) + 1);
      if ((before.startsWith('</') && INLINE.test(before)) || (!after.startsWith('</') && INLINE.test(after))) found.add(t);
    }
  }
  return found;
}

export function applyMap(html: string, map: Record<string, string>): string {
  const swap = (raw: string) => {
    const t = decode(raw).trim();
    if (!has(map, t)) return raw;
    const lead = raw.match(/^\s*/)![0], trail = raw.match(/\s*$/)![0];
    return lead + esc(map[t]) + trail;
  };
  return segments(html)
    .map((seg) =>
      seg.locked
        ? seg.text
        : seg.text
            .replace(TEXT_RE, (_m, t) => `>${swap(t)}<`)
            .replace(ATTR_RE, (_m, a, t) => `${a}="${swap(t).trim()}"`)
            .replace(META_RE, (_m, a, t, b) => `${a}${swap(t).trim()}${b}`),
    )
    .join('');
}

/** Links in a page one folder down: relative paths get "../". */
export function rebase(html: string): string {
  return html.replace(/\b(href|src)="(?!https?:|\/\/|#|mailto:|data:|\/)([^"]+)"/g, (_m, a, p) => `${a}="../${p}"`);
}

function langMenu(current: string, depth: number): string {
  const up = depth ? '../' : '';
  const link = (l: (typeof SITE_LANGS)[number]) => `${up}${l.code === 'en' ? '' : `${l.code}/`}index.html`;
  const cur = SITE_LANGS.find((l) => l.code === current)!;
  return `<!-- QC-LANGS:START -->
      <details class="relative">
        <summary class="list-none cursor-pointer flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white select-none" aria-label="Language">
          <i data-lucide="globe" class="w-4 h-4"></i><span>${esc(cur.label)}</span>
        </summary>
        <div class="absolute right-0 mt-2 w-44 rounded-xl border border-white/10 bg-[#0c0d14] p-1 shadow-xl z-50">
          ${SITE_LANGS.map((l) => `<a href="${link(l)}" hreflang="${l.tag}" lang="${l.tag}" class="block px-3 py-1.5 rounded-lg text-sm ${l.code === current ? 'text-white bg-white/10' : 'text-zinc-300 hover:bg-white/5 hover:text-white'}">${esc(l.label)}</a>`).join('\n          ')}
        </div>
      </details>
      <!-- QC-LANGS:END -->`;
}

function hreflang(): string {
  return `<!-- QC-HREFLANG:START -->
  ${SITE_LANGS.map((l) => `<link rel="alternate" hreflang="${l.tag}" href="${SITE}/${l.code === 'en' ? '' : `${l.code}/`}">`).join('\n  ')}
  <link rel="alternate" hreflang="x-default" href="${SITE}/">
  <!-- QC-HREFLANG:END -->`;
}

const setBlock = (html: string, name: string, block: string) =>
  html.replace(new RegExp(`<!-- QC-${name}:START -->[\\s\\S]*?<!-- QC-${name}:END -->`), block);

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing from .env');
  const ai = new GoogleGenAI({ apiKey });
  const srcFile = path.join(ROOT, 'index.html');
  let src = fs.readFileSync(srcFile, 'utf8');
  if (!src.includes('QC-LANGS:START') || !src.includes('QC-HREFLANG:START')) throw new Error('index.html is missing the QC-LANGS / QC-HREFLANG markers');

  // The English page gets the menu and hreflang tags too. Every page keeps the English page's line endings.
  const eol = eolOf(srcFile);
  src = withEol(setBlock(setBlock(src, 'LANGS', langMenu('en', 0)), 'HREFLANG', hreflang()), eol);
  fs.writeFileSync(srcFile, src);

  const strings = [...collect(src)];
  const frag = fragments(src);
  fs.mkdirSync(CACHE, { recursive: true });
  let dollars = 0;
  for (const lang of SITE_LANGS.filter((l) => l.code !== 'en')) {
    if (onlyArg.length && !onlyArg.includes(lang.code)) continue;
    const cacheFile = path.join(CACHE, `${lang.code}.json`);
    const cache: Record<string, string> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
    const todo = strings.filter((s) => !has(cache, s));
    console.log(`${lang.code}: ${strings.length} texts, ${todo.length} to translate`);
    for (let i = 0; i < todo.length; i += 40) {
      const batch = todo.slice(i, i + 40);
      const prompt =
        `Translate these texts from the website of Quest Compendium (an AI game guide app) into ${lang.name}. Reply with a ` +
        'JSON array of the translations, in the same order and the same number of items. Keep product and platform names ' +
        '(Quest Compendium, Steam, Steam Deck, Windows, Discord, Decky Loader, Gemini, Google, Premium), prices and ' +
        'keyboard keys as they are. Natural, friendly marketing tone for gamers; keep headings short. Some texts are the ' +
        'parts of one sentence split around a keyboard key or bold words: translate them so the sentence reads naturally ' +
        'in that order, and use an empty string for a part the language doesn\'t need.\n' +
        JSON.stringify(batch);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res: any = await ai.models.generateContent({
            model: MODEL,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { responseMimeType: 'application/json', temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
          });
          const u = res?.usageMetadata;
          if (u) dollars += ((u.promptTokenCount || 0) * 0.5 + ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * 3) / 1_000_000;
          const arr = JSON.parse(String(res?.text || '[]').replace(/```json|```/g, '').trim());
          if (!Array.isArray(arr) || arr.length !== batch.length) throw new Error('wrong number of translations');
          batch.forEach((s, k) => {
            if (typeof arr[k] === 'string' && (arr[k].trim() || frag.has(s))) cache[s] = arr[k].trim();
          });
          break;
        } catch (e: any) {
          console.warn(`  batch failed (${e?.message})${attempt ? '; those texts stay in English for now' : '; retrying'}`);
        }
      }
    }
    fs.writeFileSync(cacheFile, withEol(JSON.stringify(cache, null, 2), eolOf(cacheFile)));
    let page = applyMap(src, cache);
    page = rebase(page)
      .replace(/<html lang="[^"]*"/, `<html lang="${lang.tag}"`)
      .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${SITE}/${lang.code}/$2`)
      .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${SITE}/${lang.code}/$2`);
    page = setBlock(setBlock(page, 'LANGS', langMenu(lang.code, 1)), 'HREFLANG', hreflang());
    const out = path.join(ROOT, lang.code, 'index.html');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, withEol(page, eolOf(out, eol)));
    console.log(`  wrote ${lang.code}/index.html`);
  }
  console.log(`Done. Estimated cost ≈ $${dollars.toFixed(3)}. Next: npx tsx scripts/guides/publish.ts (fills each version's guides section).`);
}

if (process.argv[1] && process.argv[1].includes('translate-site')) {
  main().catch((e) => {
    console.error('Translating the site failed:', e?.message || e);
    process.exit(1);
  });
}
