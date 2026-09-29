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

export type GuideEntry = { id: string; name?: string; text?: string; where?: string; weakness?: string; steal?: string; sells?: string; notes?: string; missable?: boolean; sources?: string[] };
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
  /** false = a quick page, written from the AI's own knowledge and not yet fact-checked. Missing = checked (older pages). */
  verified?: boolean;
  checks: { claims: number; supported: number; rejected: number; singleSource: number };
  heldReason?: string;
  updatedAt: number;
};
