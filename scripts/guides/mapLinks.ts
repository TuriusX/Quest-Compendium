/**
 * Interactive map links (owner, Nov 19 2026: maps where they help players, without clutter): for each guide, the best
 * free interactive map of the game elsewhere (MapGenie, the Fextralife map, the official one, a well-known fan map),
 * found with one searched call and checked: the page must answer and be about this game's map. Saved as
 * guides/{key}.mapLink { url, site, title }; publish.ts shows one small link under the game's name. Never embedded.
 *
 *   npx tsx scripts/guides/mapLinks.ts [--keys a,b | --top 40] [--redo] [--max-dollars 1]
 */
import { db, arg, gemini, MODEL, ledgerDollars } from './common';
import { ThinkingLevel } from '@google/genai';

const UA = 'Mozilla/5.0 (compatible; QuestCompendium/1.0; +https://questcompendium.com)';
/** Sites known for full interactive maps: accepted even when they turn away a check from a server (403). */
const KNOWN = /(^|\.)(mapgenie\.io|fextralife\.com|ign\.com|game8\.co)$/i;

async function main() {
  const max = Number(arg('max-dollars', '1')) || 1;
  const redo = arg('redo') === 'true';
  let keys = String(arg('keys') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!keys.length) {
    const { loadPageStats } = await import('./pageStats');
    const stats = await loadPageStats();
    const per = new Map<string, number>();
    for (const [id, v] of Object.entries(stats)) { const k = id.split('/')[0]; per.set(k, (per.get(k) || 0) + (Number((v as any)[0]) || 0)); }
    keys = [...per.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).filter((k) => !k.includes('--')).slice(0, Number(arg('top', '40')) || 40);
  }
  let saved = 0;
  for (const key of keys) {
    if (ledgerDollars() + 0.05 > max) { console.log(`stopped at $${ledgerDollars().toFixed(3)}`); break; }
    const ref = db().collection('guides').doc(key);
    const g: any = (await ref.get()).data();
    if (!g) continue;
    if (g.mapLink && !redo) { console.log(`${key}: has one`); continue; }
    const game = String(g.game || key);
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: `Find the interactive map page for the video game "${game}" on one of these well-known sites, in this order of preference: MapGenie (mapgenie.io), the game's Fextralife wiki interactive map (*.wiki.fextralife.com), IGN's interactive maps (ign.com/maps), Game8. Only a full interactive map of the game world with markers; not a static image, a video, a forum post or any other site. If none of these sites has one (or the game has no real world map), say so. Reply with JSON only: {"url": "the map page's https address, or empty", "site": "the site's short name", "title": "the page's title"}.` }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 800, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    let j: any = {};
    try { const t = String(res?.text || ''); j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { j = {}; }
    const url = String(j.url || '').trim();
    if (!/^https:\/\//.test(url)) { console.log(`${key}: none (${j.site || 'no map'})`); await ref.set({ mapLink: null, mapChecked: Date.now() }, { merge: true }); continue; }
    const host = new URL(url).hostname.replace(/^www\./, '');
    // Well-known map sites only (owner's players shouldn't land on ad-heavy copies).
    if (!KNOWN.test(host)) { console.log(`${key}: ${url} rejected (not a known map site)`); await ref.set({ mapLink: null, mapChecked: Date.now() }, { merge: true }); continue; }
    // The page answers and is about this game's map (or it's a site known for interactive maps that refuses servers).
    const words = game.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    let ok = false, why = '';
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (r.ok) {
        const html = (await r.text()).toLowerCase().slice(0, 300_000);
        ok = /map/.test(html) && (!words.length || words.some((w) => html.includes(w)));
        why = ok ? 'checked' : 'page is not about this game\'s map';
      } else { ok = KNOWN.test(host) && (r.status === 403 || r.status === 429); why = `HTTP ${r.status}${ok ? ' (known map site)' : ''}`; }
    } catch (e: any) { why = `unreachable: ${String(e?.message).slice(0, 60)}`; }
    if (!ok) { console.log(`${key}: ${url} rejected (${why})`); continue; }
    await ref.set({ mapLink: { url, site: String(j.site || host).slice(0, 40), title: String(j.title || '').slice(0, 120), at: Date.now() } }, { merge: true });
    saved++;
    console.log(`${key}: ${url} (${j.site || host}; ${why})`);
  }
  console.log(`\nMap links: ${saved} saved; $${ledgerDollars().toFixed(3)}.`);
  setTimeout(() => process.exit(0), 300);
}

if (/mapLinks\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('mapLinks failed:', e?.message || e); process.exit(1); });
