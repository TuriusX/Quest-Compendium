/**
 * Does re-verification move search traffic? (owner, Oct 22 2026) Mondays in the Discord summary: the re-verified pages
 * against similar pages left alone, each page's Search Console figures now (system/searchConsolePages, the latest 28
 * days) against the same page's before the work (frozen once in system/reverifyStudy from the Sep 19 - Oct 16 pull).
 *
 *   re-verified  pages the October fund (system/core.boost) or November's work (system/auditWork) rebuilt and put live
 *   untouched    the next pages in the same queue (similar search traffic, highest first) that are still unchecked;
 *                a page leaves this group when it is re-verified
 * Read only (no AI). Totals: impressions and clicks summed, position weighted by impressions.
 */
import { db } from '../guides/common';

const REF = () => db().collection('system').doc('reverifyStudy');
type Stat = [number, number, number];

/** Freezes the before figures once (every queued page's numbers from the pull before the work began). */
export async function freezeBaseline(): Promise<string> {
  const have: any = (await REF().get()).data();
  if (have?.baseline) return `already frozen (${have.baselineRange?.start} to ${have.baselineRange?.end})`;
  const ps: any = (await db().collection('system').doc('searchConsolePages').get()).data() || {};
  const aw: any = (await db().collection('system').doc('auditWork').get()).data() || {};
  const queue: any[] = (aw.queue || []).filter((w: any) => w.kind === 'reverify');
  const baseline: Record<string, Stat> = {};
  for (const w of queue) { const id = `${w.key}/${w.ref}`; baseline[id] = ps.pages?.[id] || [0, 0, 0]; }
  await REF().set({ baseline, baselineRange: ps.range || null, order: queue.map((w) => `${w.key}/${w.ref}`), frozenAt: Date.now() }, { merge: true });
  return `frozen: ${queue.length} pages, ${ps.range?.start} to ${ps.range?.end}`;
}

const sum = (rows: Stat[]) => {
  const imp = rows.reduce((a, r) => a + r[0], 0), clk = rows.reduce((a, r) => a + r[1], 0);
  const pos = imp ? rows.reduce((a, r) => a + r[0] * r[2], 0) / imp : 0;
  return { imp, clk, pos };
};
const pct = (a: number, b: number) => (a ? `${b >= a ? '+' : ''}${Math.round(((b - a) / a) * 100)}%` : 'n/a');

/** The Monday lines. */
export async function reverifyStudyLines(): Promise<string[]> {
  const st: any = (await REF().get()).data();
  if (!st?.baseline) return [];
  const ps: any = (await db().collection('system').doc('searchConsolePages').get()).data() || {};
  const now: Record<string, Stat> = ps.pages || {};
  if (!ps.range || !st.baselineRange || ps.range.end <= st.baselineRange.end) {
    return [`📈 Re-verification vs untouched pages: waiting for the first weekly Search Console pull after the work (before: ${st.baselineRange?.start} to ${st.baselineRange?.end}).`];
  }
  // Re-verified and live: the October fund's log and November's.
  const core: any = (await db().collection('system').doc('core').get()).data() || {};
  const aw: any = (await db().collection('system').doc('auditWork').get()).data() || {};
  const live = new Set<string>([
    ...((core.boost?.log || []) as any[]).filter((x) => /^live/.test(String(x.status))).map((x) => `${x.key}/${x.ref}`),
    ...((aw.log || []) as any[]).filter((x) => x.kind === 'reverify' && /^live/.test(String(x.status))).map((x) => `${x.key}/${x.ref}`),
  ]);
  const tried = new Set<string>([...((core.boost?.log || []) as any[]), ...((aw.log || []) as any[])].map((x) => `${x.key}/${x.ref}`));
  const treated = [...live].filter((id) => st.baseline[id]);
  // Untouched: the next queued pages after the treated ones, never tried, as many as were treated (similar traffic).
  const control: string[] = [];
  for (const id of st.order as string[]) {
    if (control.length >= treated.length) break;
    if (tried.has(id)) continue;
    const [k, s] = id.split('/');
    const a: any = (await db().collection('guides').doc(k).collection('areas').doc(s).get()).data();
    if (a && a.status === 'published' && a.verified !== true) control.push(id);
  }
  const stats = (ids: string[]) => ({ b: sum(ids.map((id) => st.baseline[id])), n: sum(ids.map((id) => now[id] || [0, 0, 0])) });
  const line = (name: string, ids: string[]) => {
    const { b, n } = stats(ids);
    return `${name} (${ids.length} pages): impressions ${b.imp} → ${n.imp} (${pct(b.imp, n.imp)}), clicks ${b.clk} → ${n.clk} (${pct(b.clk, n.clk)}), position ${b.pos.toFixed(1)} → ${n.pos.toFixed(1)}`;
  };
  const text = `Re-verification vs untouched pages, Search Console ${ps.range.start} to ${ps.range.end} against ${st.baselineRange.start} to ${st.baselineRange.end}: ${line('re-verified', treated)}; ${line('untouched, similar traffic', control)}. (Lower position is better; site-wide changes hit both groups alike.)`;
  // The owner's flag (Oct 26 2026): no gain, or a loss, or no better than the pages left alone.
  const t = stats(treated), c = stats(control);
  const change = (x: { b: { imp: number }; n: { imp: number } }) => (x.b.imp ? (x.n.imp - x.b.imp) / x.b.imp : 0);
  const flag = treated.length > 0 && (change(t) <= 0 || change(t) <= change(c));
  return [flag ? `⚠️ Re-verification isn't gaining traffic: ${change(t) <= 0 ? 'the re-verified pages show no gain or a loss' : 'the re-verified pages do no better than similar untouched ones'}. ${text}` : `📈 ${text}`];
}

if (/reverifyStudy\.ts$/.test(process.argv[1] || '')) {
  (async () => {
    if (process.argv.includes('--freeze')) console.log(await freezeBaseline());
    for (const l of await reverifyStudyLines()) console.log(l);
    process.exit(0);
  })();
}
