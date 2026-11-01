/**
 * After every deploy: every compendium link (entity, quest, list and reference pages, from each guide's search.json in
 * the build) is requested on the live site; any that doesn't return 200 is reported (system/pipeline.linkCheck, and the
 * pipeline's Discord summary). A compendium link should never point to a page that doesn't exist.
 *
 *   npx tsx scripts/pipeline/linkCheck.ts [--dir Marketing_Website_Files]
 */
import fs from 'fs';
import path from 'path';

const SITE = 'https://questcompendium.com';
const RECHECK_MS = 3 * 60_000;

export async function checkCompendiumLinks(dir = 'Marketing_Website_Files'): Promise<{ checked: number; broken: { url: string; status: number }[] }> {
  const root = path.resolve(dir, 'guides');
  const urls = new Set<string>();
  for (const g of fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : []) {
    if (!g.isDirectory()) continue;
    const f = path.join(root, g.name, 'search.json');
    if (!fs.existsSync(f)) continue;
    try {
      for (const x of JSON.parse(fs.readFileSync(f, 'utf8')) as any[]) if (x.e && typeof x.h === 'string') urls.add(new URL(x.h, SITE).href.replace(/#.*$/, ''));
    } catch {
      /* a broken index is caught by the build */
    }
  }
  const list = [...urls];
  const broken: { url: string; status: number }[] = [];
  let i = 0;
  const statusOf = async (url: string) => {
    let status = 0;
    for (let attempt = 0; attempt < 2 && status !== 200; attempt++) {
      try {
        status = (await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20_000) })).status;
      } catch {
        status = 0;
      }
    }
    return status;
  };
  const worker = async () => {
    while (i < list.length) {
      const url = list[i++];
      const status = await statusOf(url);
      if (status !== 200) broken.push({ url, status });
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  if (!broken.length) return { checked: list.length, broken };
  // A page just deployed can answer 404 for a moment (Nov 1 2026: 3 of that run's new pages, fine soon after): only
  // what still fails after a wait is broken.
  await new Promise((r) => setTimeout(r, RECHECK_MS));
  const still: { url: string; status: number }[] = [];
  for (const b of broken) {
    const status = await statusOf(b.url);
    if (status !== 200) still.push({ url: b.url, status });
  }
  return { checked: list.length, broken: still };
}

if (/linkCheck\.ts$/.test(process.argv[1] || '')) {
  const i = process.argv.indexOf('--dir');
  checkCompendiumLinks(i > 0 ? process.argv[i + 1] : undefined).then((r) => {
    console.log(`Compendium links: ${r.checked} checked, ${r.broken.length} broken${r.broken.length ? `: ${r.broken.map((b) => `${b.url} (${b.status})`).join(', ')}` : ''}.`);
    setTimeout(() => process.exit(r.broken.length ? 1 : 0), 200);
  });
}
