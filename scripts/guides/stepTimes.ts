/**
 * Time ranges on walkthrough steps (owner, Nov 15 2026; roadmap item 30, step 4): roughly how long each step takes a
 * typical first playthrough, as a range ("10–20 min"), never a precise figure. Taken from the step's own text when the
 * guide gives a time, otherwise estimated with Flash from what the step involves (a conversation, a fight, a dungeon
 * crawl), and marked as an estimate. One call per area, no searches.
 *
 * Saved in gameRecords/{key}/times/{slug} { steps: { stepId: { lo, hi, from: 'guide' | 'estimate' } }, at }; the
 * quest log (guidesApi.ts areaFacts) and the site's route show them.
 *
 *   npx tsx scripts/guides/stepTimes.ts --only KEY [--max-dollars 0.5] [--redo] [--dry-run]
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, ledgerDollars } from './common';
import { RECORDS } from './recordsImport';
import type { GameRecord } from './records';

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const json = (t: string): any => { try { const s = String(t || ''); return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); } catch { return null; } };

async function main() {
  const key = String(arg('only') || '');
  if (!key) throw new Error('--only KEY is required');
  const max = Number(arg('max-dollars', '0.5')) || 0.5;
  const dry = process.argv.includes('--dry-run'), redo = process.argv.includes('--redo');
  const game = String(((await db().collection('guides').doc(key).get()).data() as any)?.game || key);
  const steps = (await RECORDS().doc(key).collection('records').where('type', '==', 'step').get()).docs.map((d) => d.data() as GameRecord).filter((r) => r.place && r.origin?.from === 'area');
  const byPlace = new Map<string, GameRecord[]>();
  for (const r of steps) byPlace.set(r.place!, [...(byPlace.get(r.place!) || []), r]);
  const done = new Set((await RECORDS().doc(key).collection('times').get()).docs.map((d) => d.id));
  const todo = [...byPlace.keys()].filter((p) => redo || !done.has(p));
  console.log(`${game}: ${steps.length} steps on ${byPlace.size} areas; ${todo.length} to do.`);
  if (dry) return void setTimeout(() => process.exit(0), 200);
  let n = 0;
  for (let i = 0; i < todo.length; i += 6) {
    if (ledgerDollars() >= max - 0.03) { console.log(`Stopped at the $${max.toFixed(2)} cap.`); break; }
    await Promise.all(todo.slice(i, i + 6).map(async (slug) => {
      const rs = byPlace.get(slug)!.sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
      const prompt = [
        `In the video game "${game}", the area "${rs[0].placeName || slug}": below are the guide's walkthrough steps. For each, how long does it take a typical player on a first playthrough, in minutes, as a range?`,
        'If the step text itself states a time, use it and mark "from": "guide". Otherwise estimate from what the step involves (walking somewhere, a conversation, a puzzle, a fight, a dungeon) and mark "from": "estimate".',
        'Ranges, not exact numbers: lo and hi in whole minutes, hi at least lo + 5, both rounded to 5 (or 1-5 for very short steps). Be realistic, not optimistic.',
        'Return JSON: {"steps":{"step id":{"lo":10,"hi":20,"from":"estimate"}, ...}} with every step id.',
        '',
        ...rs.map((r) => `${String(r.origin?.entry)}: ${cut(r.name, 80)}: ${cut(r.prose?.text || r.short || '', 600)}`),
      ].join('\n');
      try {
        const res: any = await gemini().models.generateContent({
          model: MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        });
        const j = json(String(res?.text || ''));
        const out: Record<string, { lo: number; hi: number; from: string }> = {};
        for (const r of rs) {
          const id = String(r.origin?.entry);
          const v = j?.steps?.[id];
          const lo = Math.max(1, Math.round(Number(v?.lo) || 0)), hi = Math.round(Number(v?.hi) || 0);
          if (!lo || !hi || hi < lo || hi > 600) continue;
          out[id] = { lo, hi: Math.max(hi, lo + (lo < 5 ? 2 : 5)), from: v?.from === 'guide' ? 'guide' : 'estimate' };
        }
        await RECORDS().doc(key).collection('times').doc(slug).set({ steps: out, at: Date.now() });
        n++;
      } catch (e: any) { console.warn(`${slug} skipped: ${e?.message}`); }
    }));
  }
  console.log(`Timed ${n} area(s); $${ledgerDollars().toFixed(4)}.`);
  setTimeout(() => process.exit(0), 300);
}
if (/stepTimes\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('stepTimes failed:', e?.message || e); process.exit(1); });
