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

/**
 * "Suggest a fix" / "Add a tip" (siteFix.ts) for the Monday summary: the week's submissions by kind, and what the nightly
 * check did with the ones decided this week (applied: on the page; covered: the page already said it; dismissed: sources
 * contradicted it, or still couldn't confirm it a month on), and how many wait for a check.
 */
export async function siteFixWeekLine(now = Date.now()): Promise<string> {
  const from = now - 7 * 86_400_000;
  const all = (await getFirestore().collection('contributions').where('source', '==', 'site-fix').get()).docs.map((d) => d.data() as any);
  const week = all.filter((x) => Number(x.at) >= from);
  const decided = (s: string) => all.filter((x) => x.status === s && Number(x.decided?.at || 0) >= from).length;
  const kinds: [string, string][] = [['correction', 'wrong info'], ['missing', 'missing'], ['missable', 'missable'], ['tip', 'tips'], ['detail', 'no kind']];
  const by = kinds.map(([k, l]) => [week.filter((x) => x.kind === k).length, l] as const).filter(([n]) => n).map(([n, l]) => `${n} ${l}`);
  const waiting = all.filter((x) => ['pending', 'checked', 'unconfirmed'].includes(x.status)).length;
  return `🛠️ Fixes and tips from the site this week: ${week.length} sent${by.length ? ` (${by.join(', ')})` : ''}; ${decided('auto')} applied, ${decided('covered')} already on the page, ${decided('dismissed')} dismissed; ${waiting} waiting for a check.`;
}

/** The site's questions and their cost in a window (ownerStats.ts /stats "Site"). */
export async function siteAskWindow(from: number, to: number): Promise<{ questions: number; uncovered: number; dollars: number; home: number; homeShots: number; homeNoGuide: number }> {
  const qs = (await getFirestore().collection('siteQuestions').where('at', '>=', from).get()).docs.map((d) => d.data() as any).filter((q) => q.at < to && !q.test);
  const home = qs.filter((q) => q.surface === 'home');
  return { questions: qs.length, uncovered: qs.filter((q) => !q.covered).length, dollars: qs.reduce((n, q) => n + (Number(q.dollars) || 0), 0), home: home.length, homeShots: home.filter((q) => q.hadImage).length, homeNoGuide: home.filter((q) => q.noGuide).length };
}
