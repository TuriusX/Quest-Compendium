/**
 * Filling the translation gaps, a little each night (owner, Nov 1 2026): the next guide and language, most-visited guides
 * first and the languages players use first (run.ts, TRANSLATE_SHARE a day). A guide shows a language only once every
 * page has it (translate-guide.ts --max-dollars carries on the next night).
 *
 * How much a language counts: questions asked in it (gameStats), players who set the app to it (users), and search
 * impressions on the site's pages in it (system/searchConsole.byLang). The site doesn't record visits by language, so
 * those impressions stand in for them. Every language counts for at least 1, so none is left out for good.
 */
import { db } from './common';
import { demandScore } from '../pipeline/demandReport';

export const TRANSLATE_LANGS = ['es', 'pt', 'de', 'fr', 'ru', 'ja', 'ko', 'zh'];
const CODE_BY_NAME: Record<string, string> = { Spanish: 'es', 'Brazilian Portuguese': 'pt', Portuguese: 'pt', German: 'de', French: 'fr', Russian: 'ru', Japanese: 'ja', Korean: 'ko', 'Simplified Chinese': 'zh', Chinese: 'zh' };
/** Search impressions are far more numerous than questions and app settings. */
const IMPRESSIONS_PER_POINT = 100;

export function languageWeights(usage: { questions?: Record<string, number>; settings?: Record<string, number>; impressions?: Record<string, number> }): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(TRANSLATE_LANGS.map((l) => [l, 1]));
  for (const [name, n] of Object.entries(usage.questions || {})) if (CODE_BY_NAME[name]) out[CODE_BY_NAME[name]] += Number(n) || 0;
  for (const [code, n] of Object.entries(usage.settings || {})) if (code in out) out[code] += Number(n) || 0;
  for (const [code, n] of Object.entries(usage.impressions || {})) if (code in out) out[code] += (Number(n) || 0) / IMPRESSIONS_PER_POINT;
  return out;
}

export type Gap = { key: string; game: string; lang: string; score: number };
/** Every guide and language not finished yet, the most wanted first. */
export function rankTranslations(guides: { key: string; game: string; demand: number; languages: string[] }[], weights: Record<string, number>): Gap[] {
  const out: Gap[] = [];
  // A guide nobody has found yet still gets its turn, after the rest.
  for (const g of guides) for (const lang of TRANSLATE_LANGS) if (!g.languages.includes(lang)) out.push({ key: g.key, game: g.game, lang, score: (g.demand + 1) * weights[lang] });
  return out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key) || a.lang.localeCompare(b.lang));
}

export async function translationGaps(): Promise<{ gaps: Gap[]; weights: Record<string, number> }> {
  const questions: Record<string, number> = {};
  for (const d of (await db().collection('gameStats').get()).docs) for (const [l, n] of Object.entries((d.data() as any).languages || {})) questions[l] = (questions[l] || 0) + Number(n);
  const settings: Record<string, number> = {};
  for (const d of (await db().collection('users').select('language', 'settings.language').get()).docs) {
    const x: any = d.data();
    const l = String(x.language || x.settings?.language || '');
    if (l) settings[l] = (settings[l] || 0) + 1;
  }
  const impressions = ((await db().collection('system').doc('searchConsole').get()).data() as any)?.byLang || {};
  const weights = languageWeights({ questions, settings, impressions });
  // Refreshed with the demand report (system/demand): search impressions and players' questions per guide.
  const demand: Record<string, any> = ((await db().collection('system').doc('demand').get()).data() as any)?.guides || {};
  const guides: { key: string; game: string; demand: number; languages: string[] }[] = [];
  for (const g of (await db().collection('guides').get()).docs) {
    if (g.id.endsWith('--next')) continue;
    const info: any = g.data();
    if (info.unpublished) continue;
    if ((await g.ref.collection('areas').where('status', '==', 'published').limit(1).get()).empty) continue;
    guides.push({ key: g.id, game: String(info.game || g.id), demand: demandScore(demand[g.id]), languages: Array.isArray(info.languages) ? info.languages : [] });
  }
  return { gaps: rankTranslations(guides, weights), weights };
}
