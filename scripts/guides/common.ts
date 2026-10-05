/**
 * Shared bits for the guide builder and publisher (run on your PC with `npx tsx`, like the dev server: it uses the
 * GEMINI_API_KEY from .env and your gcloud login for Firestore).
 */
import dotenv from 'dotenv';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';

dotenv.config();
if (!getApps().length) initializeApp({ projectId: 'quest-compendium-1bccf' });

export const db = () => getFirestore();

export function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing from .env');
  return new GoogleGenAI({ apiKey });
}

export const MODEL = process.env.GUIDE_MODEL || process.env.MAIN_MODEL || 'gemini-3.8-flash';

/** Whether a game is a remake or remaster of an earlier game, and the years of both (saved as guides/{game}.edition). */
export type Edition = { checked: number; remake: boolean; kind?: 'remake' | 'remaster'; year?: number; original?: string; originalYear?: number };

/**
 * Work out once per guide whether the game is a remake or remaster. The release year and store description come from
 * Steam (where a new remake usually says what it remakes, even when the AI doesn't know the game yet); the AI decides
 * from that, with no web search, so quick mode stays search-free. Saved on the guide document and reused after that.
 */
export async function editionOf(game: string, guideRef: FirebaseFirestore.DocumentReference): Promise<Edition> {
  const saved = (await guideRef.get()).data()?.edition as Edition | undefined;
  if (saved?.checked) return saved;
  let year: number | undefined, about = '';
  try {
    const items: any[] = (((await (await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(game)}&cc=us&l=english`)).json()) as any)?.items) || [];
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const hit = items.find((i) => norm(i.name) === norm(game)) || items[0];
    if (hit) {
      const d: any = ((await (await fetch(`https://store.steampowered.com/api/appdetails?appids=${hit.id}&filters=basic,release_date&cc=us&l=english`)).json()) as any)?.[hit.id]?.data;
      year = Number((String(d?.release_date?.date || '').match(/(19|20)\d\d/) || [])[0]) || undefined;
      about = String(d?.short_description || '').replace(/<[^>]+>/g, ' ').slice(0, 600);
    }
  } catch {
    /* not on Steam (or Steam unreachable): the AI decides from what it knows */
  }
  let e: Edition = { checked: Date.now(), remake: false, ...(year ? { year } : {}) };
  try {
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text:
        `Is the video game "${game}"${year ? ` (released ${year})` : ''} a remake or remaster of an earlier game?` +
        (about ? ` Its store description: "${about}"` : '') +
        '\nReply with these lines only:\nKIND: remake, remaster or neither\nYEAR: this version\'s release year\nORIGINAL: the earlier game it remakes or remasters (or empty)\nORIGINAL_YEAR: that game\'s release year (or empty)',
      }] }],
      config: { temperature: 0 },
    });
    const text = String(res?.text || '');
    const get = (k: string) => (text.match(new RegExp(`^\\s*${k}:\\s*(.+)$`, 'im')) || [])[1]?.trim() || '';
    const kind = get('KIND').toLowerCase();
    if (kind === 'remake' || kind === 'remaster') {
      e = {
        checked: Date.now(), remake: true, kind,
        year: year || Number((get('YEAR').match(/(19|20)\d\d/) || [])[0]) || undefined,
        original: get('ORIGINAL').slice(0, 120) || undefined,
        originalYear: Number((get('ORIGINAL_YEAR').match(/(19|20)\d\d/) || [])[0]) || undefined,
      };
    }
  } catch {
    return e; // not saved, so the next run asks again
  }
  await guideRef.set({ edition: JSON.parse(JSON.stringify(e)) }, { merge: true });
  return e;
}

/** The prompt note for a remake or remaster (empty for other games). */
export function editionNote(e: Edition | undefined, game: string): string {
  if (!e?.remake) return '';
  const what = `the ${e.year ? `${e.year} ` : ''}${e.kind || 'remake'}${e.original ? ` of ${e.original}${e.originalYear ? ` (${e.originalYear})` : ''}` : ' of an earlier game'}`;
  return (
    ` Important: "${game}" is ${what}. Only include details confirmed for this ${e.year ? `${e.year} ` : ''}version: item ` +
    'locations, features, menus, systems and achievements often differ from the original. Do not use sources about the ' +
    'original release for those unless they confirm this version is the same; leave out anything only confirmed for the original.'
  );
}

/** Same key rules as the game knowledge base (searchGuard.ts), so guides and facts line up. */
export const slug = (x: string, max = 80) =>
  x
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
export const gameKey = (game: string) =>
  game
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/**
 * A revisit (the same place in a later world, era or chapter) is its own page: "Narshe (World of Ruin)", address
 * narshe-world-of-ruin. The first visit keeps the plain name.
 */
export const visitName = (name: string, revisit?: string) => {
  const base = name.trim();
  const raw = String(revisit || '').trim();
  // The AI sometimes puts the whole visit name in the revisit field ("Baron Castle (Surface)"): use it as the name.
  if (raw.toLowerCase().startsWith(`${base.toLowerCase()} (`) && raw.endsWith(')')) return raw;
  // Brackets inside the field ("Other Place (Surface)"): keep just the last bracketed part, never a nested name.
  const r = (raw.match(/\(([^()]*)\)\s*$/)?.[1] ?? raw.replace(/[()]/g, '')).trim();
  if (!r || /^(none|n\/a|-|first visit)$/i.test(r) || base.toLowerCase().includes(`(${r.toLowerCase()})`)) return base;
  return `${base} (${r})`;
};

/**
 * Tidy an area name from the AI's list: drop a description after a colon ("Kaer Morhen: Defending the fortress"),
 * shorten at a word boundary, and never leave an unclosed bracket (a cut-off "(Battle of Kaer" is removed).
 */
export function cleanAreaName(raw: string, max = 80): string {
  let n = String(raw || '').replace(/\s+/g, ' ').trim();
  const colon = n.search(/:\s/);
  if (colon > 0) n = n.slice(0, colon).trim();
  if (n.length > max) n = (/\s/.test(n[max]) ? n.slice(0, max) : n.slice(0, max).replace(/\s+\S*$/, '')).trim();
  while ((n.match(/\(/g) || []).length > (n.match(/\)/g) || []).length) n = n.slice(0, n.lastIndexOf('(')).trim();
  while ((n.match(/\)/g) || []).length > (n.match(/\(/g) || []).length) n = n.replace(/\)(?!.*\))/, '').trim();
  return n.replace(/[\s,;:–-]+$/, '').trim();
}

/** Loose key for spotting the same place under slightly different names ("Returner Hideout" vs "Returners' Hideout"). */
export const looseKey = (name: string) =>
  slug(name)
    .split('-')
    .filter((w) => w && w !== 'the')
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join('-');

/**
 * Which page an area name belongs to: an alias saved on the guide (a merged or renamed page), else an existing page
 * with the same loose name, else a new page.
 */
export function resolveArea(
  name: string,
  order: { slug: string; name: string }[],
  aliases: Record<string, string> = {},
): { slug: string; name: string } {
  const s = slug(name);
  const target = aliases[s];
  if (target) return { slug: target, name: order.find((o) => o.slug === target)?.name || name };
  const same = order.find((o) => o.slug === s) || order.find((o) => looseKey(o.name) === looseKey(name));
  return same ? { slug: same.slug, name: same.name } : { slug: s, name };
}

const baseName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim();

/**
 * Tidy a new area list against the guide: a "(World of Ruin)" suffix only marks a revisit, so it's dropped when the
 * place has no earlier visit (no existing page for it and not listed earlier without the suffix). Names that already
 * match a page (exactly, loosely or through an alias) are left alone, so they reuse that page.
 */
export function normalizeVisits<T extends { name: string }>(
  areas: T[],
  order: { slug: string; name: string }[],
  aliases: Record<string, string> = {},
): T[] {
  const known = (n: string) => {
    const r = resolveArea(n, order, aliases);
    return order.some((o) => o.slug === r.slug);
  };
  return areas.map((a, i) => {
    const base = baseName(a.name);
    if (base === a.name || known(a.name)) return a;
    // Compare with the base names of earlier entries too: "Sun Keep (600 A.D.)" after "Sun Keep (65,000,000 B.C.)" is a
    // later visit to the same place, so it keeps its suffix (and gets its own page).
    const earlierVisit = known(base) || areas.slice(0, i).some((b) => looseKey(baseName(b.name)) === looseKey(base));
    return earlierVisit ? a : { ...a, name: base };
  });
}

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

/** Pull the first JSON array or object out of a model reply (grounded replies can't be forced into pure JSON). */
export function parseJson<T = any>(text: string): T | null {
  const clean = String(text || '').replace(/```json|```/g, '');
  for (const [open, close] of [['[', ']'], ['{', '}']] as const) {
    const a = clean.indexOf(open);
    const b = clean.lastIndexOf(close);
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(clean.slice(a, b + 1)) as T;
      } catch {
        /* try the other shape */
      }
    }
  }
  return null;
}

export const searchesIn = (response: any): number => {
  const q = response?.candidates?.[0]?.groundingMetadata?.webSearchQueries;
  return Array.isArray(q) ? q.length : 0;
};

export const sourcesIn = (response: any): string[] => {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  const out: string[] = [];
  if (Array.isArray(chunks)) for (const c of chunks) {
    const t = String(c?.web?.title || c?.web?.domain || '').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
};

export type GuideEntry = {
  id: string; name?: string; text?: string; where?: string; weakness?: string; steal?: string; sells?: string; notes?: string; missable?: boolean; sources?: string[];
  /** The exact final step: the action or check that gets it ("drag the Scuffed Rock aside", "pass a Perception check"). */
  how?: string;
  /** Missable because: what locks it out ("lost once you leave for Act 2"). */
  lockout?: string;
};

/**
 * The standard for a missable entry (shared by the builders, the missables repair and the reviewer): where starts from
 * a findable anchor and ends at the exact spot, how is the final action or check, lockout is what makes it missable.
 */
export const MISSABLE_STANDARD =
  'A missable entry must be findable: "where" starts from a findable anchor (a waypoint, a named NPC, a major landmark, or ' +
  'the map coordinates if the game shows them) and ends at the exact container or object; "how" is the exact final step, ' +
  'the action or check needed ("drag the Scuffed Rock aside", "jump down to the lower ledge", "pass a Perception check"); ' +
  '"missable because" says what locks it out ("lost once you leave for Act 2", "gone if you side with the goblins").';

/**
 * An ITEM line's fields: name | where | how | missable because. The older name | where | missable: yes/no still reads.
 * An item is missable when it has a lockout (or an older "yes").
 */
export function parseItem(f: string[], id: string, sources: string[] = []): GuideEntry {
  const strip = (v: string | undefined, label: RegExp) => String(v || '').replace(label, '').trim();
  const none = (v: string) => (/^(none|n\/a|-|no|empty|not missable|can'?t be missed|cannot be missed)\.?$/i.test(v) ? '' : v);
  const where = strip(f[1], /^(exactly\s+)?where\s*:\s*/i);
  if (/^missable\s*:/i.test(f[2] || '')) return { id, name: f[0], where, missable: /yes/i.test(f[2] || ''), sources };
  const how = none(strip(f[2], /^how\s*:\s*/i)).slice(0, 300);
  const lockout = none(strip(f[3], /^(missable(\s+because)?|lockout)\s*:\s*/i)).slice(0, 300);
  return { id, name: f[0], where, ...(how ? { how } : {}), ...(lockout ? { lockout } : {}), missable: !!lockout, sources };
}

/**
 * A page's player-facing text, the part translations cover (names, places, steps, notes; not sources or bookkeeping).
 * Two pages with the same signature need no new translation.
 */
export function translatableText(p: any): string {
  const pick = (list: any[] | undefined, keys: string[]) => (Array.isArray(list) ? list : []).map((e) => keys.map((k) => e?.[k] ?? ''));
  return JSON.stringify([
    p?.name ?? '', p?.story ?? '', p?.overview ?? '',
    pick(p?.items, ['id', 'name', 'where', 'how', 'lockout']),
    pick(p?.secrets, ['id', 'text']),
    pick(p?.enemies, ['id', 'name', 'weakness', 'steal', 'notes']),
    pick(p?.shops, ['id', 'name', 'sells']),
    pick(p?.fights, ['id', 'name', 'enemies', 'threats', 'weaknesses', 'tactics', 'rewards']),
    Array.isArray(p?.tips) ? p.tips : [],
    (Array.isArray(p?.sections) ? p.sections : []).map((x: any) => [x?.title ?? '', pick(x?.entries, ['id', 'text'])]),
  ]);
}

/** What a missable entry still lacks against the standard (an anchor can only be judged by reading it). */
export function missableGaps(e: { where?: string; how?: string; lockout?: string }): string[] {
  const gaps: string[] = [];
  if (String(e.where || '').trim().length < 25) gaps.push('vague where');
  if (!String(e.how || '').trim()) gaps.push('no final step');
  if (!String(e.lockout || '').trim()) gaps.push('no lockout');
  return gaps;
}
export type GuideArea = {
  name: string;
  slug: string;
  order: number;
  story: string;
  overview: string;
  items: GuideEntry[];
  secrets: GuideEntry[];
  enemies: GuideEntry[];
  shops: GuideEntry[];
  tips: string[];
  sources: string[];
  status: 'draft' | 'published' | 'held';
  /** How the game's guide is organized, and which group this page is in (a character, "Calendar", "Reference"). */
  group?: string;
  /** Extra sections some structures use (a calendar page's deadlines, missable events, social links, activities). */
  sections?: GuideSection[];
  /** Key fights here: bosses and major set-piece battles, with what it takes to win them. */
  fights?: GuideFight[];
  /** A clearer search-result title and description (from the weekly Search Console check), English pages. */
  seoTitle?: string;
  seoDescription?: string;
  /** false = a quick page, written from the AI's own knowledge and not yet fact-checked. Missing = checked (older pages). */
  verified?: boolean;
  /** When an --upgrade run last tried this quick page and couldn't confirm it (later upgrades skip it). */
  upgradeTried?: string;
  checks: { claims: number; supported: number; rejected: number; singleSource: number };
  heldReason?: string;
  updatedAt: number;
};

/** Placeholder values the AI sometimes writes instead of leaving a field empty ("Steal: nothing", "Weakness: N/A"). */
export function blankish(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase().replace(/[.!]+$/, '');
  return !s || /^(none|nothing|no|n\/?a|-+|—|unknown|not applicable|nothing to steal|cannot be stolen|can't be stolen|not stealable|no weakness(es)?|none known)$/.test(s);
}

/** An enemy/item entry with placeholder values removed. */
export function cleanEntry<T extends Record<string, any>>(e: T): T {
  const out: Record<string, any> = { ...e };
  for (const k of ['weakness', 'steal', 'notes', 'where', 'sells']) if (k in out && blankish(out[k])) delete out[k];
  return out as T;
}

/**
 * How a game's guide is organized: its outline by game type. Every page of a guide is the same kind of unit (the
 * guide review found that mixing places, chapters and topics in one guide is the most common way guides go wrong):
 *   area          place to place (towns, dungeons) in story order: most RPGs and adventures
 *   regions       open worlds: a page per region or major city/dungeon, never per visit or story phase
 *   linear        linear games split into numbered chapters, missions or levels (Dead Space, Resident Evil 4,
 *                 Half-Life 2): a page per chapter, named as the game names it, and nothing else
 *   chapters      several protagonists' separate stories (Octopath Traveler): a page per character chapter, grouped by
 *                 character
 *   calendar      calendar-driven games (Persona): a page per month or deadline stretch, reference pages at the end
 *   roguelike     run-based games (Hades): a page per region of a run, plus the hub; never split by run
 *   metroidvania  one interconnected map (Hollow Knight, Metroid): a page per map region in a first-time route
 */
export const LAYOUTS = ['area', 'regions', 'linear', 'chapters', 'calendar', 'roguelike', 'metroidvania'] as const;
export type Layout = (typeof LAYOUTS)[number];
export const isLayout = (v: unknown): v is Layout => (LAYOUTS as readonly string[]).includes(String(v));
/** One line per layout, for prompts that pick or judge a guide's outline. */
export const LAYOUT_CHOICES =
  'area: the player moves from place to place in story order (towns, dungeons, fields), like most RPGs and adventures\n' +
  'regions: an open world, best split by region and major city or dungeon (Skyrim, Elden Ring, The Witcher 3)\n' +
  'linear: a linear game split into numbered chapters, missions or levels (Dead Space, Resident Evil 4, Half-Life 2, Devil May Cry 5, Black Myth: Wukong)\n' +
  'chapters: several protagonists each have their own story chapters, played in any order (Octopath Traveler)\n' +
  'calendar: the game runs on an in-game calendar with deadlines and free days (Persona 3, 4, 5)\n' +
  'roguelike: run-based; each run goes through the same regions (Hades, Dead Cells)\n' +
  'metroidvania: one interconnected map explored as new abilities open it up (Hollow Knight, Metroid Prime, Ori)';

/**
 * Staging: a rebuild or fix is built into guides/{key}--next (its pages never published), reviewed there, and only
 * replaces the live guide when it passes review (scripts/guides/promote.ts). gameKey never produces "--".
 */
export const STAGE_SUFFIX = '--next';
export const stageKey = (key: string) => `${key}${STAGE_SUFFIX}`;
export const isStageKey = (key: string) => key.endsWith(STAGE_SUFFIX);
export const liveKey = (key: string) => (isStageKey(key) ? key.slice(0, -STAGE_SUFFIX.length) : key);

/**
 * Knowledge cutoffs. Quick builds write from the build model's own knowledge, which stops about here (judged from
 * how quick builds of 2024–2026 games turned out), so games released later are never built quick. The reviewer's
 * model can't judge names in games released after its own cutoff, so those reviews always spot-check with searches.
 */
export const QUICK_MODEL_CUTOFF = process.env.QUICK_MODEL_CUTOFF || '2025-01-01';
export const REVIEWER_CUTOFF = process.env.REVIEWER_CUTOFF || '2025-01-01';

/** A game's release date on Steam (the PC date; a console original may be earlier). time is null if unknown or unreleased. */
export async function releaseInfo(game: string, appId?: number): Promise<{ text: string; time: number | null }> {
  try {
    let id = appId;
    if (!id) {
      const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(game)}&cc=us&l=english`);
      const items: any[] = (await r.json())?.items || [];
      const norm = (s: string) => s.toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      id = (items.find((i) => norm(i.name) === norm(game)) || null)?.id;
    }
    if (!id) return { text: 'unknown', time: null };
    const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=release_date&cc=us&l=english`);
    const d: any = (await r.json())?.[id]?.data?.release_date;
    const text = d?.date || 'unknown';
    const t = Date.parse(text);
    return { text, time: d?.coming_soon || !Number.isFinite(t) ? null : t };
  } catch {
    return { text: 'unknown', time: null };
  }
}
/**
 * The release date the cutoffs go by: the guide's `firstReleased` override (YYYY-MM-DD) when set, else Steam's date.
 * The override is for PC ports of older console games (Steam has the later PC date, but the models know the game
 * from its first release): set it on guides/{key} by hand.
 */
export async function guideRelease(game: string, live?: any): Promise<{ text: string; time: number | null }> {
  const first = Date.parse(String(live?.firstReleased || ''));
  if (Number.isFinite(first)) return { text: `${live.firstReleased} (first release)`, time: first };
  return releaseInfo(game, Number(live?.appId) || undefined);
}
/** Released after the cutoff (or not released yet). An unknown date counts as after only when the guide says it's new. */
export const releasedAfter = (r: { text: string; time: number | null }, cutoff: string, newRelease = false) =>
  r.time === null ? newRelease || /coming soon|to be announced|tba|20(2[6-9]|3\d)/i.test(r.text) : r.time >= Date.parse(cutoff);

export type GuideSection = { title: string; check: boolean; entries: { id: string; text: string }[] };

/**
 * A key fight on an area page: a boss or a major set-piece battle (not ordinary enemies), with the enemies, their
 * notable abilities and threats, weaknesses and resistances, the tactics and positions that win it, and the rewards.
 */
export type GuideFight = { id: string; name: string; enemies?: string; threats?: string; weaknesses?: string; tactics?: string; rewards?: string; sources?: string[]; updatedFrom?: string };

/** Steam's language names for its pages (official translations of achievement names and descriptions). */
export const STEAM_LANG: Record<string, string> = {
  en: 'english', es: 'latam', pt: 'brazilian', de: 'german', fr: 'french', ru: 'russian', ja: 'japanese', ko: 'koreana', zh: 'schinese',
};

/** A game's public achievement list from Steam in one language: name, description, icon and % of players. */
export async function steamAchievements(appId: number, lang = 'en'): Promise<{ name: string; desc: string; icon: string; rarity: number | null }[]> {
  const l = STEAM_LANG[lang] || 'english';
  const r = await fetch(`https://steamcommunity.com/stats/${appId}/achievements/?l=${l}`, { headers: { Cookie: `Steam_Language=${l}` } });
  if (!r.ok) throw new Error(`Steam returned ${r.status}`);
  const html = await r.text();
  // Windows-1252 control bytes Steam sometimes sends as characters: 0x85 is "…"; the rest of that range is dropped.
  const decode = (x: string) =>
    x.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\u0085/g, '…').replace(/[\u0080-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  return html
    .split('class="achieveRow')
    .slice(1)
    .map((row) => {
      const pct = Number((row.match(/achievePercent">\s*([\d.,]+)%/) || [])[1]?.replace(',', '.') ?? 'NaN');
      return {
        name: decode((row.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || ''),
        desc: decode((row.match(/<h5>([\s\S]*?)<\/h5>/) || [])[1] || ''),
        icon: (row.match(/<img src="([^"]+)"/) || [])[1] || '',
        rarity: Number.isFinite(pct) ? pct : null,
      };
    })
    .filter((a) => a.name);
}
