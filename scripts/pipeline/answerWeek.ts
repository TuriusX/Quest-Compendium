/**
 * "Answers by game" in the Monday Discord summary (run.ts; owner, Oct 31 2026), read only: for the 10 games players
 * asked most about this week, the share of answers that needed a Google Search and the number of missing facts the
 * answers sent to the nightly improver (missingFacts.ts), each against the week before. Both should fall as the guides
 * fill in. From answerGames/{day} (Central time; searchGuard.ts recordAnswerGame), counted from Oct 31 2026: no owner
 * accounts, no test traffic.
 */
import { db } from '../guides/common';

const DAY_TZ = 'America/Chicago';
const dayOf = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: DAY_TZ });
/** Counting began with server revision 00196 (Oct 31 2026): weeks before have no numbers. */
export const COUNTED_FROM = '2026-10-31';

type Counts = { name: string; q: number; s: number; m: number };
type Day = { id: string; games: Record<string, Partial<Counts>> };

/** The section's lines for the week ending yesterday (pure: the days passed in). */
export function answerWeek(days: Day[], today = Date.now(), top = 10): string[] {
  const week = new Set(Array.from({ length: 7 }, (_, i) => dayOf(today - (i + 1) * 86_400_000)));
  const prev = new Set(Array.from({ length: 7 }, (_, i) => dayOf(today - (i + 8) * 86_400_000)));
  const sum = (set: Set<string>) => {
    const out = new Map<string, Counts>();
    for (const d of days) {
      if (!set.has(d.id)) continue;
      for (const [k, c] of Object.entries(d.games || {})) {
        const cur = out.get(k) || { name: String(c.name || k), q: 0, s: 0, m: 0 };
        cur.q += Number(c.q) || 0; cur.s += Number(c.s) || 0; cur.m += Number(c.m) || 0;
        if (c.name) cur.name = String(c.name);
        out.set(k, cur);
      }
    }
    return out;
  };
  const now = sum(week), before = sum(prev);
  // The week before counts only if it was counted (from COUNTED_FROM on) at all.
  const hadBefore = [...prev].some((d) => d >= COUNTED_FROM);
  const partly = hadBefore && [...prev].some((d) => d < COUNTED_FROM);
  const games = [...now.entries()].filter(([, c]) => c.q > 0).sort((a, b) => b[1].q - a[1].q || a[1].name.localeCompare(b[1].name)).slice(0, top);
  if (!games.length) return ['**Answers by game:** no questions this week.'];
  const pct = (c?: Counts) => (c && c.q ? `${Math.round((100 * c.s) / c.q)}%` : '–');
  const lines = games.map(([k, c]) => {
    const b = before.get(k);
    const vs = hadBefore ? ` (vs ${pct(b)})` : '';
    const vm = hadBefore ? ` (vs ${b ? b.m : 0})` : '';
    return `- ${c.name}: ${c.q} answer${c.q === 1 ? '' : 's'}, ${pct(c)} needed a search${vs} · ${c.m} missing fact${c.m === 1 ? '' : 's'} sent${vm}`;
  });
  const all = (m: Map<string, Counts>) => [...m.values()].reduce((a, c) => ({ name: '', q: a.q + c.q, s: a.s + c.s, m: a.m + c.m }), { name: '', q: 0, s: 0, m: 0 });
  const tn = all(now), tb = all(before);
  return [
    `**Answers by game** (the ${games.length} most asked this week${hadBefore ? `, vs the week before${partly ? `, counted only from ${COUNTED_FROM.slice(5)}` : ''}` : '; the week before wasn\'t counted yet'}): searches and missing facts should fall as the guides fill in`,
    ...lines,
    `All games: ${pct(tn)} of ${tn.q} answers needed a search${hadBefore ? ` (vs ${pct(tb)})` : ''} · ${tn.m} missing facts sent${hadBefore ? ` (vs ${tb.m})` : ''}`,
  ];
}

export async function answerWeekLines(today = Date.now()): Promise<string[]> {
  const ids = Array.from({ length: 14 }, (_, i) => dayOf(today - (i + 1) * 86_400_000));
  const snaps = await Promise.all(ids.map((id) => db().collection('answerGames').doc(id).get()));
  return answerWeek(snaps.map((s, i) => ({ id: ids[i], games: (s.data() || {}) as Day['games'] })), today);
}
