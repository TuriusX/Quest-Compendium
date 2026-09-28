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
  checks: { claims: number; supported: number; rejected: number; singleSource: number };
  heldReason?: string;
  updatedAt: number;
};
