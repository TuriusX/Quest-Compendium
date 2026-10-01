/**
 * Find each guide's Steam app id, so the website can show the game's official store art (loaded straight from
 * Steam's image servers) and the apps can match the game reliably. No AI and no cost: it uses Steam's store search.
 *
 *   npx tsx scripts/guides/steam-ids.ts            guides that don't have an id yet
 *   options: --redo   check every guide again      --dry-run   show what it would save
 *
 * Strict matching, so a game never gets someone else's art: the store name must match the guide's name (ignoring
 * ™, ® and punctuation), or start with it once an edition after a dash is dropped ("The Witcher 3: Wild Hunt -
 * Complete Edition" matches "The Witcher 3: Wild Hunt — Remastered"). Games not on Steam are marked noSteam, and the
 * website shows a placeholder tile for them. A wrong id can be fixed by hand: appId on the guide document in Firestore
 * (then run this again to fetch its art).
 */
import { db, arg } from './common';

const redo = arg('redo') === 'true';
const dry = arg('dry-run') === 'true';
const norm = (s: string) => s.toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function search(term: string): Promise<{ id: number; name: string }[]> {
  const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us&l=english`);
  if (!r.ok) return [];
  const items: any[] = ((await r.json()) as any)?.items || [];
  return items.map((i) => ({ id: Number(i.id), name: String(i.name || '') })).filter((i) => i.id);
}

/** The store's header art. Newer apps keep it under a hashed path, so the plain CDN url doesn't work for them. */
async function headerArt(id: number): Promise<string> {
  const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic`);
  if (!r.ok) return '';
  return String(((await r.json()) as any)?.[id]?.data?.header_image || '');
}

export async function steamIdFor(game: string): Promise<{ id: number; name: string } | null> {
  const items = await search(game);
  const exact = items.find((i) => norm(i.name) === norm(game));
  if (exact) return exact;
  const short = game.split(/\s+[-–—]\s+/)[0].trim();
  const pool = short !== game ? [...items, ...(await search(short))] : items;
  return pool.find((i) => norm(i.name).startsWith(norm(short)) && norm(short).length >= 4) || null;
}

async function main() {
  const guides = await db().collection('guides').get();
  let found = 0, missing = 0, skipped = 0;
  for (const g of guides.docs) {
    const info = g.data();
    const name = String(info.game || g.id);
    if (!redo && (info.appId || info.noSteam)) {
      // Art for an id that has none yet (or was changed by hand).
      if (info.appId && !String(info.art || '').includes(`/apps/${info.appId}/`)) {
        const art = await headerArt(Number(info.appId)).catch(() => '');
        console.log(`  ${name} (${info.appId}): art ${art || 'not found'}`);
        if (!dry && art) await g.ref.set({ art }, { merge: true });
      }
      skipped++;
      continue;
    }
    const hit = await steamIdFor(name).catch(() => null);
    if (hit) {
      found++;
      console.log(`✓ ${name} → ${hit.id} (${hit.name})`);
      const art = await headerArt(hit.id).catch(() => '');
      if (!dry) await g.ref.set({ appId: hit.id, steamName: hit.name, art, noSteam: false }, { merge: true });
    } else {
      missing++;
      console.log(`– ${name}: not found on Steam (placeholder tile)`);
      if (!dry) await g.ref.set({ noSteam: true }, { merge: true });
    }
    await new Promise((r) => setTimeout(r, 300)); // be gentle with the store search
  }
  console.log(`Done: ${found} found, ${missing} not on Steam, ${skipped} already known${dry ? ' (dry run, nothing saved)' : ''}.`);
  process.exit(0);
}

if (process.argv[1]?.includes('steam-ids')) main().catch((e) => {
  console.error('steam-ids failed:', e?.message || e);
  process.exit(1);
});
