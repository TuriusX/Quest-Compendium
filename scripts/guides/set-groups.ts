/**
 * Sort a game's existing guide pages into sections, such as the base game and each expansion, and order the page list
 * so each section's pages sit together (base game first, then expansions in release order).
 *
 *   npx tsx scripts/guides/set-groups.ts --game "The Witcher 3: Wild Hunt" --groups "Base game,Hearts of Stone,Blood and Wine"
 *     Asks the AI which section each page belongs to (from what it knows about the game; no searches), shows the
 *     result and saves it as a plan file in scratchpad/, without changing the guide. To fix a misplaced page, edit its
 *     "group" in the plan file (it must be one of the plan's "groups").
 *   npx tsx scripts/guides/set-groups.ts --game "The Witcher 3: Wild Hunt" --apply
 *     Saves exactly what the plan file says (no AI call), after writing a backup of the page list to scratchpad/.
 *
 * Pages keep their relative order within a section. Sections show as headings on the website, the desktop app and the
 * Deck. Chapter and calendar guides already use sections for characters and months; don't run this on those.
 */
import fs from 'fs';
import path from 'path';
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, gameKey, arg } from './common';

const game = arg('game');
const groupsArg = (arg('groups') || '').split(',').map((g) => g.trim()).filter(Boolean);
const apply = arg('apply') === 'true';
if (!game || (!apply && groupsArg.length < 2)) {
  console.log('Preview: npx tsx scripts/guides/set-groups.ts --game "Game" --groups "Base game,Expansion 1,Expansion 2"');
  console.log('Apply:   npx tsx scripts/guides/set-groups.ts --game "Game" --apply   (uses the plan file the preview saved)');
  process.exit(1);
}

type Page = { slug: string; name: string; story?: string; group?: string };
type Plan = { game: string; groups: string[]; createdAt: string; pages: { slug: string; name: string; group: string }[] };

const planPath = () => path.join('scratchpad', `groups-plan-${gameKey(game!)}.json`);

function show(groups: string[], sorted: { name: string; group: string }[]) {
  for (const g of groups) {
    const list = sorted.filter((o) => o.group === g);
    console.log(`\n${g} (${list.length}):\n  ${list.map((o) => o.name).join('\n  ')}`);
  }
}

/** Ask the AI which section each page belongs to, then save that as the plan to review. */
async function preview(order: Page[]) {
  const groups = groupsArg;
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
  const tagged = order.map((o, i) => ({ slug: o.slug, name: o.name, group: picked.get(i) || groups[0] }));
  const sorted = groups.flatMap((g) => tagged.filter((o) => o.group === g));
  show(groups, sorted);
  const unplaced = order.length - picked.size;
  if (unplaced) console.log(`\n(${unplaced} page(s) weren't placed by the AI and went to "${groups[0]}".)`);
  const plan: Plan = { game: game!, groups, createdAt: new Date().toISOString(), pages: sorted };
  fs.mkdirSync('scratchpad', { recursive: true });
  fs.writeFileSync(planPath(), JSON.stringify(plan, null, 2));
  console.log(`\nNothing changed in the guide. Plan saved to ${planPath()}: edit a page's "group" there to move it, then run again with --apply.`);
}

/** Save the reviewed plan: sections and order exactly as the plan file says. */
async function applyPlan(ref: FirebaseFirestore.DocumentReference, info: any, order: Page[]) {
  if (!fs.existsSync(planPath())) throw new Error(`no plan file at ${planPath()}; run the preview (with --groups) first`);
  const plan: Plan = JSON.parse(fs.readFileSync(planPath(), 'utf8'));
  const groups = plan.groups;
  if (groupsArg.length && groupsArg.join(',') !== groups.join(',')) {
    throw new Error(`--groups "${groupsArg.join(',')}" doesn't match the plan's groups "${groups.join(',')}"; run the preview again or leave --groups out`);
  }
  const unknown = plan.pages.filter((p) => !groups.includes(p.group));
  if (unknown.length) throw new Error(`these pages have a group that isn't in the plan's groups: ${unknown.map((p) => `${p.name} ("${p.group}")`).join(', ')}`);

  // Match the plan to the guide as it is now: pages removed since the preview are skipped, new ones go to the first section.
  const planned = new Map(plan.pages.map((p) => [p.slug, p.group]));
  const added = order.filter((o) => !planned.has(o.slug));
  const gone = plan.pages.filter((p) => !order.some((o) => o.slug === p.slug));
  const tagged = order.map((o) => ({ ...o, group: planned.get(o.slug) || groups[0] }));
  // Order within a section follows the plan (so moving a page in the plan file moves it), then any new pages.
  const rank = new Map(plan.pages.map((p, i) => [p.slug, i]));
  const sorted = groups.flatMap((g) =>
    tagged.filter((o) => o.group === g).sort((a, b) => (rank.get(a.slug) ?? Infinity) - (rank.get(b.slug) ?? Infinity)),
  );
  show(groups, sorted);
  if (added.length) console.log(`\n(New since the preview, put in "${groups[0]}": ${added.map((o) => o.name).join(', ')})`);
  if (gone.length) console.log(`\n(In the plan but no longer in the guide, skipped: ${gone.map((p) => p.name).join(', ')})`);

  fs.mkdirSync('scratchpad', { recursive: true });
  const backup = path.join('scratchpad', `groups-backup-${gameKey(game!)}-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(info.areas, null, 2));
  await ref.set({ areas: sorted, updatedAt: Date.now() }, { merge: true });
  const batch = db().batch();
  for (const o of sorted) batch.set(ref.collection('areas').doc(o.slug), { group: o.group }, { merge: true });
  await batch.commit();
  console.log(`\nSaved from ${planPath()}: ${sorted.length} pages in ${groups.length} sections. Backup of the old page list: ${backup}`);
}

async function main() {
  const ref = db().collection('guides').doc(gameKey(game!));
  const info = (await ref.get()).data();
  if (!info?.areas?.length) throw new Error(`no guide found for ${game}`);
  const order: Page[] = info.areas;
  if (apply) await applyPlan(ref, info, order);
  else await preview(order);
  process.exit(0);
}

main().catch((e) => {
  console.error('set-groups failed:', e?.message || e);
  process.exit(1);
});
