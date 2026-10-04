import { getApiBaseUrl } from './api';

/**
 * Quest Compendium's own guides feed (/api/guides/...), fetched once per path and language and shared by the Guide
 * and the objectives tracker, so opening one doesn't fetch again for the other. The guide's language follows the
 * app's: a translated guide where one exists, English otherwise.
 */
const cache = new Map<string, Promise<any>>();

export function guideApi(rawPath: string, lang = 'en'): Promise<any> {
  const path = lang === 'en' || rawPath === '/api/guides' ? rawPath : `${rawPath}${rawPath.includes('?') ? '&' : '?'}lang=${lang}`;
  if (!cache.has(path)) {
    const p = fetch(`${getApiBaseUrl()}${path}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path)!;
}

/** A guide area as the guide's area list has it. */
export type GuideAreaInfo = { slug: string; name: string; story: string; group?: string; total?: number; search?: string };
/** One entry on a guide page (an item, secret, enemy, shop…). */
export type GuideEntry = {
  id: string; name?: string; text?: string; where?: string; weakness?: string; steal?: string; sells?: string; notes?: string; missable?: boolean;
  /** The exact final step (the action or check that gets it). */
  how?: string;
  /** Missable because: what locks it out. */
  lockout?: string;
};
/** A guide page (one area). */
export type GuidePage = {
  key: string; slug: string; name: string; story: string; overview: string;
  items: GuideEntry[]; secrets: GuideEntry[]; enemies: GuideEntry[]; shops: GuideEntry[]; tips: string[];
  sections?: { title: string; check: boolean; entries: { id: string; text: string }[] }[];
  /** Key fights: bosses and set-piece battles in this area, with what it takes to win them. */
  fights?: { id: string; name: string; enemies?: string; threats?: string; weaknesses?: string; tactics?: string; rewards?: string }[];
};
