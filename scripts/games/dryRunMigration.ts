/**
 * Games-not-tabs dry run (owner, Oct 27 2026): what the migration would make of one account's compendium tabs, read
 * from Firestore (users/{uid}: tabs, deletedTabs; users/{uid}/playthrough: memory). Writes nothing to Firestore; the
 * report goes to a local folder.
 *
 *   npx tsx scripts/games/dryRunMigration.ts <email> [out dir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAuth } from 'firebase-admin/auth';
import { db } from '../guides/common';
import { cleanTombstones } from '../../src/hooks/tabMerge';
import { planMigration } from '../../src/utils/gameSpaces';
import { playKey } from '../../src/utils/playthrough';
import { guideCatalog, guideResolver } from './resolveTab';

async function main() {
  const email = process.argv[2];
  const out = process.argv[3] || join(process.env.USERPROFILE || '.', 'Desktop', 'QC-games-not-tabs', 'dry-run');
  if (!email) throw new Error('usage: dryRunMigration.ts <email> [out dir]');
  const user = await getAuth().getUserByEmail(email);
  const doc: any = (await db().collection('users').doc(user.uid).get()).data() || {};
  const tabs: any[] = Array.isArray(doc.tabs) ? doc.tabs : [];
  const deleted = cleanTombstones(doc.deletedTabs);
  const catalog = await guideCatalog();
  const plan = await planMigration(tabs, deleted, guideResolver(catalog), catalog, doc.gameSpaces?.tabMap || {});

  // Playthrough memory and progress: every saved game should be read by some playthrough.
  const memory = (await db().collection('users').doc(user.uid).collection('playthrough').get()).docs.map((d) => d.id);
  const read = new Set(plan.playthroughs.flatMap((p) => p.legacyGames.map(playKey)));
  const progress = Object.keys(doc.settings?.gameDone || {});
  const readProgress = new Set(plan.playthroughs.flatMap((p) => p.legacyGames.map((g) => g.toLowerCase())));
  const tabsWithGame = new Set(tabs.map((t) => playKey((t.activeSteamGame?.name || t.name || '').trim())));

  const L: string[] = [];
  L.push(`# Games-not-tabs dry run: ${email}`, '', `Read ${new Date().toISOString()}. Nothing was written to Firestore.`, '');
  L.push(`**Check: ${plan.ok ? 'OK, nothing lost' : 'PROBLEMS, the migration would stop and keep the tabs'}**`, '');
  for (const p of plan.problems) L.push(`- ⚠️ ${p}`);
  L.push('', '| | Before (tabs) | After (games) |', '|---|---|---|');
  L.push(`| Tabs / games | ${tabs.length} tabs (${plan.before.tabs} carried over) | ${plan.games.length} spaces (${plan.games.filter((g) => g.kind === 'game').length} games, ${plan.needsGame.length} need a game) |`);
  L.push(`| Messages | ${plan.before.messages} | ${plan.after.messages} |`, `| Notes (characters) | ${plan.before.notesChars} | ${plan.after.notesChars} |`, `| Quest log entries | ${plan.before.quests} | ${plan.after.quests} |`, '');
  L.push('## Games', '', '| Game | Id | From tabs | Messages | Quests | Notes | Memory read from |', '|---|---|---|---|---|---|---|');
  for (const g of plan.games) {
    const pt = plan.playthroughs.find((p) => p.gameId === g.id)!;
    const names = g.fromTabs.map((id) => `"${tabs.find((t) => t.id === id)?.name}"`).join(', ');
    L.push(`| ${g.kind === 'game' ? g.name : `❓ ${g.name}`} | \`${g.id}\` | ${names} | ${pt.messages.length} | ${pt.personalQuests.length} | ${g.notes.replace(/<[^>]*>/g, '').length} ch | ${pt.legacyGames.map((x) => `${x}${memory.includes(playKey(x)) ? ' ✓' : ''}`).join('; ')} |`);
  }
  L.push('', '## Merged', '');
  if (!plan.merges.length) L.push('No game had more than one tab.');
  for (const m of plan.merges) L.push(`- **${m.name}**: ${m.tabs.map((t) => `"${t}"`).join(', ')} → one playthrough`);
  L.push('', '## "Which game is this?"', '');
  if (!plan.needsGame.length) L.push('None: every tab with something in it was recognized.');
  for (const n of plan.needsGame) L.push(`- "${n.tabName}" (${n.messages} messages, last used ${new Date(n.lastActive).toISOString().slice(0, 10)})${n.suggestion ? `: suggested ${n.suggestion.name} (named ${n.suggestion.mentions}×)` : ''}${n.options ? `: one of ${n.options.map((o) => o.name).join(', ')}` : ''}`);
  L.push('', '## Left out', '');
  if (!plan.skipped.length) L.push('Nothing.');
  for (const s of plan.skipped) L.push(`- "${s.tabName}": ${s.why === 'empty' ? 'empty, no game' : s.why === 'deleted' ? 'deleted earlier' : 'the old welcome tab'}`);
  L.push('', '## Playthrough memory and progress', '');
  const orphanMem = memory.filter((k) => !read.has(k));
  const orphanProg = progress.filter((k) => !readProgress.has(k));
  L.push(`- Memory documents: ${memory.length}; read by a playthrough: ${memory.length - orphanMem.length}.`);
  for (const k of orphanMem) L.push(`  - not read: \`${k}\`${tabsWithGame.has(k) ? ' ⚠️ (a live tab used it)' : ' (no live tab uses it: a deleted tab\'s, as today)'}`);
  L.push(`- Progress lists (settings.gameDone): ${progress.length}; read by a playthrough: ${progress.length - orphanProg.length}.`);
  for (const k of orphanProg) L.push(`  - not read: \`${k}\``);
  L.push('', 'Guide ticks are kept by guide key, which is the game id for games with a guide: unchanged.');

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'REPORT.md'), L.join('\n') + '\n');
  const summary = { ...plan, playthroughs: plan.playthroughs.map((p) => ({ ...p, messages: p.messages.length })), games: plan.games.map((g) => ({ ...g, notes: `${g.notes.length} chars`, activeSteamGame: g.activeSteamGame?.name || null })) };
  writeFileSync(join(out, 'plan.json'), JSON.stringify(summary, null, 2));
  console.log(`${plan.ok ? 'OK' : 'PROBLEMS'}: ${tabs.length} tabs → ${plan.games.length} spaces, ${plan.merges.length} merge(s), ${plan.needsGame.length} need a game. Report: ${join(out, 'REPORT.md')}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
