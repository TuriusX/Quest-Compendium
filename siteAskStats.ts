/**
 * The site ask box's numbers (siteAsk.ts), for the Monday Discord summary (scripts/pipeline/run.ts) and /stats
 * (ownerStats.ts), without the questions a local test server answered (test: true). Firestore only, so the pipeline can read them without the server's code.
 */
import { getFirestore } from 'firebase-admin/firestore';

/** The week's line for the Monday Discord summary (scripts/pipeline/run.ts). */
export async function siteAskWeekLine(now = Date.now()): Promise<string> {
  const db = getFirestore();
  const from = now - 7 * 86_400_000;
  const qs = (await db.collection('siteQuestions').where('at', '>=', from).get()).docs.map((d) => d.data() as any).filter((q) => !q.test);
  const fixes = (await db.collection('contributions').where('source', '==', 'site').get()).docs.filter((d) => Number(d.data().at) >= from).length;
  const dollars = qs.reduce((n, q) => n + (Number(q.dollars) || 0), 0);
  // The five most-asked guide pages this week.
  const per = new Map<string, number>();
  for (const q of qs) { const k = `${q.key}/${q.slug || ''}`; per.set(k, (per.get(k) || 0) + 1); }
  const top = [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k.replace(/\/$/, ' (front page)')} ${n}`);
  return `💬 Site questions this week: ${qs.length} asked on the guide pages, ${qs.filter((q) => !q.covered).length} the guides couldn't answer, ${fixes} fix(es) queued for the pipeline; $${dollars.toFixed(2)}.${top.length ? ` Most asked: ${top.join(', ')}.` : ''}`;
}

/** The site's questions and their cost in a window (ownerStats.ts /stats "Site"). */
export async function siteAskWindow(from: number, to: number): Promise<{ questions: number; uncovered: number; dollars: number }> {
  const qs = (await getFirestore().collection('siteQuestions').where('at', '>=', from).get()).docs.map((d) => d.data() as any).filter((q) => q.at < to && !q.test);
  return { questions: qs.length, uncovered: qs.filter((q) => !q.covered).length, dollars: qs.reduce((n, q) => n + (Number(q.dollars) || 0), 0) };
}
