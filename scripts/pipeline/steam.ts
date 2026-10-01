/**
 * Popular RPG and adventure games on Steam right now (new releases and top sellers), for the guide pipeline.
 * Uses Steam's public store endpoints; no key needed. Results include whether a game is a new release (out within
 * the last 12 months), since the AI doesn't know new games and their guides need the search-backed mode.
 */
const GENRES = new Set(['RPG', 'Adventure']);

export async function steamCandidates(): Promise<{ name: string; released: number; isNew: boolean }[]> {
  const res = await fetch('https://store.steampowered.com/api/featuredcategories?cc=us&l=english');
  if (!res.ok) throw new Error(`Steam returned ${res.status}`);
  const data: any = await res.json();
  const ids = new Map<number, string>();
  for (const list of [data?.new_releases?.items, data?.top_sellers?.items]) {
    for (const it of Array.isArray(list) ? list : []) if (it?.id && it?.name) ids.set(Number(it.id), String(it.name));
  }
  const out: { name: string; released: number; isNew: boolean }[] = [];
  for (const [id, name] of [...ids].slice(0, 40)) {
    try {
      const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic,genres,release_date&cc=us&l=english`);
      const d: any = (await r.json())?.[id]?.data;
      if (!d || d.type !== 'game') continue;
      const genres = (d.genres || []).map((g: any) => String(g.description));
      if (!genres.some((g: string) => GENRES.has(g)) || genres.includes('Massively Multiplayer')) continue;
      const released = Date.parse(d.release_date?.date || '') || 0;
      if (d.release_date?.coming_soon) continue;
      out.push({ name: String(d.name || name), released, isNew: released > Date.now() - 365 * 86_400_000 });
    } catch {
      /* skip this one */
    }
    await new Promise((r) => setTimeout(r, 400)); // be gentle with the store API
  }
  return out;
}
