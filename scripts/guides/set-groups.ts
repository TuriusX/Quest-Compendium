/**
 * Sort a game's existing guide pages into sections, such as the base game and each expansion, and order the page list
 * so each section's pages sit together (base game first, then expansions in release order).
 *
 *   npx tsx scripts/guides/set-groups.ts --game "The Witcher 3: Wild Hunt" --groups "Base game,Hearts of Stone,Blood and Wine"
 *     Asks the AI which section each page belongs to (from what it knows about the game; no searches) and shows the
 *     result without changing anything.
 *   add --apply to save it (a backup of the page list is written to scratchpad/ first).
 *
 * Pages keep their relative order within a section. Sections show as headings on the website, the desktop app and the
 * Deck. Chapter and calendar guides already use sections for characters and months; don't run this on those.
 */
import fs from 'fs';
import path from 'path';
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, gameKey, arg } from './common';

const game = arg('game');
const groups = (arg('groups') || '').split(',').map((g) => g.trim()).filter(Boolean);
const apply = arg('apply') === 'true';
if (!game || groups.length < 2) {
  console.log('Usage: npx tsx scripts/guides/set-groups.ts --game "Game" --groups "Base game,Expansion 1,Expansion 2" [--apply]');
  process.exit(1);
}

async function main() {
  const ref = db().collection('guides').doc(gameKey(game!));
  const info = (await ref.get()).data();
  if (!info?.areas?.length) throw new Error(`no guide found for ${game}`);
  const order: { slug: string; name: string; story?: string; group?: string }[] = info.areas;

  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{
      role: 'user',
      parts: [{
        text:
          `These are guide pages for the video game "${game}". Say which part of the game each belongs to: ${groups.map((g) => `"${g}"`).join(', ')}. ` +
          'A place from the base game that an expansion only revisits belongs to the base game. Reply with one line per page, exactly: ' +
          'number | part\n' + order.map((o, i) => `${i + 1}. ${o.name}${o.story ? ` (${o.story})` : ''}`).join('\n'),
      }],
    }],
    config: { temperature: 0, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const picked = new Map<number, string>();
  for (const line of String(res?.text || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s*[.|:)-]?\s*[^|]*?\|\s*(.+?)\s*$/) || line.match(/^\s*(\d+)\s*\|\s*(.+?)\s*$/);
    if (!m) continue;
    const g = groups.find((x) => x.toLowerCase() === m[2].replace(/["']/g, '').trim().toLowerCase());
    if (g) picked.set(Number(m[1]) - 1, g);
  }
  // Anything the AI didn't place stays with the first section (the base game).
  const tagged = order.map((o, i) => ({ ...o, group: picked.get(i) || groups[0] }));
  const sorted = groups.flatMap((g) => tagged.filter((o) => o.group === g));
  for (const g of groups) {
    const list = sorted.filter((o) => o.group === g);
    console.log(`\n${g} (${list.length}):\n  ${list.map((o) => o.name).join('\n  ')}`);
  }
  const unplaced = order.length - picked.size;
  if (unplaced) console.log(`\n(${unplaced} page(s) weren't placed by the AI and went to "${groups[0]}".)`);
  if (!apply) {
    console.log('\nNothing changed. Add --apply to save these sections.');
    process.exit(0);
  }
  fs.mkdirSync('scratchpad', { recursive: true });
  const backup = path.join('scratchpad', `groups-backup-${gameKey(game!)}-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(info.areas, null, 2));
  await ref.set({ areas: sorted, updatedAt: Date.now() }, { merge: true });
  const batch = db().batch();
  for (const o of sorted) batch.set(ref.collection('areas').doc(o.slug), { group: o.group }, { merge: true });
  await batch.commit();
  console.log(`\nSaved: ${sorted.length} pages in ${groups.length} sections. Backup of the old page list: ${backup}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('set-groups failed:', e?.message || e);
  process.exit(1);
});
