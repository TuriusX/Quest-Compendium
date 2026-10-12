/**
 * Steam store art paths for each guide with a Steam app id, from Steam's public store API (IStoreBrowseService/GetItems,
 * no key): the large capsule with the logo (616×353, and 1232×706), the portrait library art (600×900, 1200×1800) and the
 * header. Newer apps keep these under hashed folders that can't be guessed, so the exact paths are saved, weekly, as
 * guides/{key}.steamArt.
 *
 *   npx tsx scripts/pipeline/steamArt.ts
 */
import { db } from '../guides/common';

const BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';
const FIELDS: Record<string, string> = { main_capsule: 'capsule', main_capsule_2x: 'capsule2x', library_capsule: 'library', library_capsule_2x: 'library2x', header: 'header', header_2x: 'header2x' };

async function main() {
  const guides = (await db().collection('guides').get()).docs.filter((d) => !d.id.includes('--') && Number((d.data() as any).appId) > 0);
  let saved = 0;
  for (let i = 0; i < guides.length; i += 40) {
    const batch = guides.slice(i, i + 40);
    const input = { ids: batch.map((d) => ({ appid: Number((d.data() as any).appId) })), context: { language: 'english', country_code: 'US' }, data_request: { include_assets: true } };
    const r = await fetch(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    if (!r.ok) throw new Error(`Steam store API: ${r.status}`);
    const items: any[] = (await r.json())?.response?.store_items || [];
    for (const d of batch) {
      const it = items.find((x) => Number(x.appid) === Number((d.data() as any).appId));
      const a = it?.assets;
      if (!a?.asset_url_format) continue;
      const url = (file: string) => BASE + String(a.asset_url_format).replace('${FILENAME}', file);
      const art: Record<string, string> = {};
      for (const [k, name] of Object.entries(FIELDS)) if (a[k]) art[name] = url(a[k]);
      await d.ref.update({ steamArt: { ...art, at: Date.now() } });
      saved++;
    }
  }
  console.log(`steamArt: ${saved} of ${guides.length} Steam guide(s) have their store art paths.`);
}
main().then(() => process.exit(0), (e) => { console.error('steamArt failed:', e?.message || e); process.exit(1); });
