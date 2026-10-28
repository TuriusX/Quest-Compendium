/**
 * Games-not-tabs dry run over every account (owner, Oct 27 2026): counts only, no content (no tab or game names, no
 * text, no ids). Read only; the report goes to a local folder.
 *
 *   npx tsx scripts/games/dryRunAll.ts [out dir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../guides/common';
import { cleanTombstones } from '../../src/hooks/tabMerge';
import { planMigration } from '../../src/utils/gameSpaces';
import { guideCatalog, guideResolver } from './resolveTab';

const hist = (xs: number[], edges: number[]) => {
  const out: Record<string, number> = {};
  for (const x of xs) {
    const i = edges.findIndex((e) => x <= e);
    const k = i < 0 ? `>${edges[edges.length - 1]}` : i === 0 ? `${edges[0]}` : `${edges[i - 1] + 1}-${edges[i]}`;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
};

async function main() {
  const out = process.argv[2] || join(process.env.USERPROFILE || '.', 'Desktop', 'QC-games-not-tabs', 'dry-run-all');
  const catalog = await guideCatalog();
  const resolve = guideResolver(catalog);
  const snap = await db().collection('users').select('tabs', 'deletedTabs', 'gameSpaces').get();
  const t = { accounts: snap.size, withTabs: 0, tabs: 0, carried: 0, games: 0, gamesWithGuide: 0, steamOnly: 0, nameOnly: 0,
    accountsWithMerges: 0, merges: 0, tabsMerged: 0, unrecognized: 0, unrecognizedWithSuggestion: 0, unrecognizedCollection: 0,
    accountsWithUnrecognized: 0, skippedDeleted: 0, skippedEmpty: 0, skippedWelcome: 0, messages: 0, failed: 0, errors: 0 };
  const problemKinds: Record<string, number> = {};
  const tabsPer: number[] = [], bigDocs: number[] = [];
  for (const d of snap.docs) {
    const doc: any = d.data();
    const tabs: any[] = Array.isArray(doc.tabs) ? doc.tabs : [];
    if (!tabs.length) continue;
    t.withTabs++; t.tabs += tabs.length; tabsPer.push(tabs.length);
    const size = Buffer.byteLength(JSON.stringify(doc.tabs));
    if (size > 500_000) bigDocs.push(Math.round(size / 1000));
    try {
      const p = await planMigration(tabs, cleanTombstones(doc.deletedTabs), resolve, catalog, doc.gameSpaces?.tabMap || {});
      t.carried += p.before.tabs; t.messages += p.before.messages;
      const games = p.games.filter((g) => g.kind === 'game');
      t.games += games.length;
      t.gamesWithGuide += games.filter((g) => !g.id.includes(':')).length;
      t.steamOnly += games.filter((g) => g.id.startsWith('steam:')).length;
      t.nameOnly += games.filter((g) => g.id.startsWith('name:')).length;
      if (p.merges.length) t.accountsWithMerges++;
      t.merges += p.merges.length; t.tabsMerged += p.merges.reduce((n, m) => n + m.tabs.length, 0);
      t.unrecognized += p.needsGame.length;
      if (p.needsGame.length) t.accountsWithUnrecognized++;
      t.unrecognizedWithSuggestion += p.needsGame.filter((n) => n.suggestion).length;
      t.unrecognizedCollection += p.needsGame.filter((n) => n.options).length;
      t.skippedDeleted += p.skipped.filter((s) => s.why === 'deleted').length;
      t.skippedEmpty += p.skipped.filter((s) => s.why === 'empty').length;
      t.skippedWelcome += p.skipped.filter((s) => s.why === 'welcome').length;
      if (!p.ok) {
        t.failed++;
        // The kind only ("messages", "notes", ...): problem lines can name a tab.
        for (const pr of p.problems) { const k = pr.startsWith('"') ? pr.replace(/^"[^"]*":\s*\d*\s*/, 'per tab: ') : pr.split(':')[0]; problemKinds[k] = (problemKinds[k] || 0) + 1; }
      }
    } catch (e: any) {
      t.errors++;
      const k = `error: ${String(e?.message || e).slice(0, 60).replace(/[A-Za-z0-9_-]{20,}/g, '…')}`;
      problemKinds[k] = (problemKinds[k] || 0) + 1;
    }
  }
  const L = [
    '# Games-not-tabs dry run: all accounts (counts only)', '', `Read ${new Date().toISOString()}. Read only: nothing written to Firestore. No names or text recorded.`, '',
    `**Check: ${t.failed || t.errors ? `${t.failed} account(s) would fail the check, ${t.errors} error(s)` : 'every account passes, nothing lost'}**`, '',
    '| | |', '|---|---|',
    `| Accounts | ${t.accounts} (${t.withTabs} with tabs) |`,
    `| Tabs | ${t.tabs} (${t.carried} carried over; left out: ${t.skippedDeleted} deleted, ${t.skippedEmpty} empty with no game, ${t.skippedWelcome} old welcome tabs) |`,
    `| Messages carried | ${t.messages} |`,
    `| Games made | ${t.games} (${t.gamesWithGuide} with a guide, ${t.steamOnly} Steam game without a guide, ${t.nameOnly} by name only) |`,
    `| Merges | ${t.merges} games from ${t.tabsMerged} tabs, in ${t.accountsWithMerges} account(s) |`,
    `| "Which game is this?" | ${t.unrecognized} tabs in ${t.accountsWithUnrecognized} account(s); ${t.unrecognizedWithSuggestion} with a suggestion, ${t.unrecognizedCollection} a collection's pick |`,
    `| Would fail the check | ${t.failed} |`, `| Errors | ${t.errors} |`, '',
    '## Tabs per account', '', ...Object.entries(hist(tabsPer, [1, 2, 3, 5, 10, 20])).map(([k, v]) => `- ${k} tab(s): ${v} account(s)`), '',
    '## Tab arrays over 500 KB (Firestore limit: 1 MB per document)', '', bigDocs.length ? bigDocs.sort((a, b) => b - a).map((k) => `- ${k} KB`).join('\n') : 'None.', '',
    '## Problems (kinds only)', '', Object.keys(problemKinds).length ? Object.entries(problemKinds).map(([k, v]) => `- ${k}: ${v}`).join('\n') : 'None.',
  ];
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'REPORT.md'), L.join('\n') + '\n');
  console.log(L.slice(4, 17).join('\n'));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
