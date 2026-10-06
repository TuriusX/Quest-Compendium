/**
 * The pipeline's Discord summary: the run's report lines grouped into a short summary, split into messages under
 * Discord's 2,000-character limit (nothing dropped or cut), and posted in order.
 *
 * Grouping: repair-queue items by outcome (passed / failed review / blocked / waiting / skipped / errors) with counts,
 * names only for failures and things needing a decision; plan actions (new guides, achievement guides, translations,
 * upgrades) the same way. Every other line (activity, corrections, Search Console, translations kept in sync, the
 * flagship programme, costs, alerts, the website) stays as it is.
 *
 *   npx tsx scripts/pipeline/summary.ts --post    post system/pipeline.lastReport again (today's run's summary)
 *                                      --closing-only   just its closing line
 */
import { db, arg } from '../guides/common';

/** Discord's limit is 2,000 characters a message: a little room is kept. */
export const DISCORD_LIMIT = 1900;

const QUEUE = /^(✅|⚠️|⏳|⏸️|➖) queue (.+?) \*\*(.+?)\*\*: (.*)$/u;
const PLAN = /^(✅|⚠️) (build|build-checked|revisit|upgrade|achievements|translate) \*\*(.+?)\*\*(?: → (\w+))?: (.*)$/u;

/** The report lines, grouped: queue and plan items as counts by outcome, names only where something needs attention. */
export function summarize(report: string[]): string[] {
  const q = { passed: [] as string[], failed: [] as string[], blocked: [] as string[], waiting: [] as string[], skipped: [] as string[], errors: [] as string[] };
  const plan: Record<string, { ok: number; bad: string[] }> = {};
  const rest: string[] = [];
  let queueAt = -1, planAt = -1;
  for (const line of report) {
    const m = line.match(QUEUE);
    if (m) {
      if (queueAt < 0) queueAt = rest.length;
      const [, icon, action, game, what] = m;
      const name = `${game} (${action})`;
      if (icon === '✅') q.passed.push(name);
      else if (icon === '⏸️') q.blocked.push(name);
      else if (icon === '⏳') q.waiting.push(name);
      else if (icon === '➖') q.skipped.push(name);
      else if (/^failed \(\d+/.test(what)) q.failed.push(`${game} (${action}, ${(what.match(/^failed \((\d+)/) || [])[1]}: ${(what.match(/queued for review: ([^.(]+)/) || [])[1]?.trim() || 'see /admin/reviews'})`);
      else q.errors.push(`${name}: ${what.replace(/\s*\(see the job log\)\.?$/, '')}`);
      continue;
    }
    const p = line.match(PLAN);
    if (p) {
      if (planAt < 0) planAt = rest.length;
      const [, icon, kind, game, lang] = p;
      const label = { build: 'New guides', 'build-checked': 'Careful new guides', revisit: 'Revisits', upgrade: 'Upgrades', achievements: 'Achievement guides', translate: 'Translations' }[kind] || kind;
      const g = (plan[label] = plan[label] || { ok: 0, bad: [] });
      if (icon === '✅') g.ok++;
      else g.bad.push(`${game}${lang ? ` → ${lang}` : ''}`);
      continue;
    }
    rest.push(line);
  }
  const out = [...rest];
  const queueLines: string[] = [];
  const total = Object.values(q).reduce((n, l) => n + l.length, 0);
  if (total) {
    const counts = [q.passed.length && `${q.passed.length} passed`, q.failed.length && `${q.failed.length} failed review`, q.blocked.length && `${q.blocked.length} blocked`, q.waiting.length && `${q.waiting.length} waiting`, q.skipped.length && `${q.skipped.length} skipped`, q.errors.length && `${q.errors.length} error(s)`].filter(Boolean);
    queueLines.push(`🛠️ Repair queue: ${counts.join(', ')}.`);
    if (q.failed.length) queueLines.push(`⚠️ Failed review (decide on /admin/reviews): ${q.failed.join('; ')}.`);
    if (q.blocked.length) queueLines.push(`⏸️ Blocked by a staged rebuild waiting for a decision: ${q.blocked.join(', ')}.`);
    if (q.errors.length) queueLines.push(`❌ Repair errors: ${q.errors.join('; ')}.`);
  }
  const planLines = Object.entries(plan).map(([label, g]) => `${g.bad.length ? '⚠️' : '✅'} ${label}: ${g.ok} done${g.bad.length ? `, ${g.bad.length} failed (${g.bad.join(', ')})` : ''}.`);
  // In the report's own order: the queue where its first item was, then the plan actions.
  if (planAt >= 0) out.splice(planAt, 0, ...planLines);
  if (queueAt >= 0) out.splice(queueAt, 0, ...queueLines);
  else if (planAt < 0) out.push(...queueLines);
  return out;
}

/**
 * Text split into messages under the limit, at line breaks; a single line longer than the limit is split at spaces.
 * Nothing is dropped or cut: the parts joined back give the whole text.
 */
export function splitForDiscord(text: string, limit = DISCORD_LIMIT): string[] {
  const parts: string[] = [];
  let cur = '';
  const pieces = text.split('\n').flatMap((line) => {
    if (line.length <= limit) return [line];
    const words: string[] = [];
    let w = '';
    for (const word of line.split(' ')) {
      if ((w ? w.length + 1 : 0) + word.length > limit) {
        if (w) words.push(w);
        w = word;
        while (w.length > limit) { words.push(w.slice(0, limit)); w = w.slice(limit); }
      } else w = w ? `${w} ${word}` : word;
    }
    if (w) words.push(w);
    return words;
  });
  for (const piece of pieces) {
    if (cur && cur.length + 1 + piece.length > limit) { parts.push(cur); cur = piece; }
    else cur = cur ? `${cur}\n${piece}` : piece;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Post text to a Discord webhook, in as many messages as it needs, in order; waits out a 429 and tries again. */
export async function postDiscord(webhook: string, text: string): Promise<boolean> {
  const parts = splitForDiscord(text);
  let ok = true;
  for (let i = 0; i < parts.length; i++) {
    const content = parts[i];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
        if (r.ok) break;
        if (r.status === 429) {
          const j: any = await r.json().catch(() => ({}));
          await new Promise((res) => setTimeout(res, Math.ceil((Number(j.retry_after) || 1) * 1000)));
          continue;
        }
        console.warn(`Discord post ${i + 1}/${parts.length} failed: HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
        ok = false;
        break;
      } catch (e: any) {
        console.warn(`Discord post ${i + 1}/${parts.length} failed: ${e?.message}`);
        if (attempt === 2) ok = false;
      }
    }
  }
  return ok;
}

/** The summary message: a heading, the grouped lines as bullets, then the closing line. */
export function summaryText(report: string[], closing: string, heading = '**Quest Compendium guide pipeline**') {
  return `${heading}\n${summarize(report).map((l) => `• ${l}`).join('\n')}\n${closing}`;
}

async function cli() {
  const s: any = (await db().collection('system').doc('pipeline').get()).data() || {};
  const report: string[] = Array.isArray(s.lastReport) ? s.lastReport : [];
  const when = s.lastRun ? new Date(s.lastRun).toISOString().slice(0, 16).replace('T', ' ') : '?';
  // A run from before closing lines were saved gets one from the saved state: it finished, and what it spent.
  const closing = s.lastEnd || `🏁 Run finished at ${when} UTC. Today $${Number(s.spend?.dollars || 0).toFixed(2)} of $8; this month $${Number(s.dollars || 0).toFixed(2)} (tokens and searches).`;
  const text = summaryText(report, closing, `**Quest Compendium guide pipeline** (run of ${when} UTC)`);
  console.log(text);
  if (arg('post') === 'true') {
    if (!process.env.DISCORD_WEBHOOK_URL) { console.log('DISCORD_WEBHOOK_URL is not set.'); process.exit(1); }
    // --closing-only: just the run's closing line (when its summary is already posted without one).
    const out = arg('closing-only') === 'true' ? `**Quest Compendium guide pipeline** (run of ${when} UTC)\n${closing}` : text;
    console.log((await postDiscord(process.env.DISCORD_WEBHOOK_URL, out)) ? `Posted (${splitForDiscord(out).length} message(s)).` : 'Posting failed (see above).');
  }
  setTimeout(() => process.exit(0), 300);
}
if (/summary\.ts$/.test(process.argv[1] || '')) cli().catch((e) => { console.error('summary failed:', e?.message || e); process.exit(1); });
