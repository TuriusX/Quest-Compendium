/**
 * Fextralife watch (for the Discord summary, three weeks after Fextralife was blocked as evidence, Oct 11 2026):
 * per guide that leaned on it (Elden Ring, Baldur's Gate 3, Dark Souls, Sekiro), what was built since and how much
 * passed (core pages from system/core.pageLog, entity, quest, list and reference pages by their build time and
 * status), and how much of the guide's stored research cited Fextralife (lines it backed, and lines only it backed,
 * which are now dropped). system/pipeline.fextralifeWatchUntil overrides the end date.
 */
import { db } from '../guides/common';

export const FEXTRALIFE_BLOCKED_AT = Date.parse('2026-10-11T22:00:00Z');
const WATCH = ['elden-ring', 'baldur-s-gate-3', 'dark-souls-remastered', 'dark-souls-iii', 'sekiro-shadows-die-twice-goty-edition'];
const FEX = /(^|\.)fextralife\.com$/i;

export async function fextralifeWatchLines(until?: number): Promise<string[]> {
  const end = until || FEXTRALIFE_BLOCKED_AT + 21 * 86_400_000;
  if (Date.now() > end) return [];
  const core: any = (await db().collection('system').doc('core').get()).data() || {};
  const log = ((core.pageLog || []) as any[]).filter((x) => Number(x.at) >= FEXTRALIFE_BLOCKED_AT);
  const parts: string[] = [];
  for (const key of WATCH) {
    const g: any = (await db().collection('guides').doc(key).get()).data();
    if (!g) continue;
    const pages = log.filter((x) => x.key === key);
    const ents = (await db().collection('guideCompendium').doc(key).collection('entities').get()).docs.map((d) => d.data() as any);
    const built = ents.filter((e) => Number(e.builtAt || 0) >= FEXTRALIFE_BLOCKED_AT);
    const passed = built.filter((e) => e.status === 'published' && !(Number(e.rewriteFailed?.at || 0) >= Number(e.builtAt || 0)));
    const failed = ents.filter((e) => Number(e.rewriteFailed?.at || 0) >= FEXTRALIFE_BLOCKED_AT).length + built.filter((e) => e.status === 'held').length;
    const packs = (await db().collection('evidencePacks').where('key', '==', key).get()).docs.map((d) => d.data() as any);
    let lines = 0, cited = 0, only = 0;
    for (const p of packs) for (const e of p.evidence || []) {
      lines++;
      const s: string[] = e.sources || [];
      if (s.some((x) => FEX.test(x))) { cited++; if (s.every((x) => FEX.test(x))) only++; }
    }
    const pct = (n: number) => (lines ? `${Math.round((100 * n) / lines)}%` : '-');
    const built2 = [pages.length ? `pages ${pages.filter((x) => x.status === 'passed').length}/${pages.length} passed` : '', passed.length + failed ? `entity and quest pages ${passed.length}/${passed.length + failed} passed` : ''].filter(Boolean).join(', ') || 'nothing built yet';
    const research = lines ? `; research citing Fextralife ${pct(cited)} (only Fextralife ${pct(only)}, now dropped)` : '';
    parts.push(`${String(g.game || key).replace(/[™®]/g, '')}: ${built2}${research}`);
  }
  return parts.length ? [`🧪 Since Fextralife was blocked (Oct 11): ${parts.join(' · ')}.`] : [];
}
