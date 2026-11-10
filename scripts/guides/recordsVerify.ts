/**
 * Fact database: the verify step (roadmap 29). A page's unconfirmed records (tier C, and B with --recheck) checked
 * against sources: one searched research call per page about exactly those records (where each is, how to get it,
 * whether it can be missed, what a merchant sells, an enemy's weaknesses), saved into the page's evidence pack so
 * later checks reuse it, then the pipeline's claim check (claimCheck.ts) on every claim the records make.
 *
 *   all of a record's claims supported   -> checked
 *   any claim contradicted               -> disputed (the evidence's correction kept in `fix`)
 *   otherwise                            -> stays unconfirmed (tried; tried again after 30 days)
 *
 * Saved in gameRecords/{key}/verified/{slug} with each record's content signature; recordsImport.ts lays it over the
 * records while their content is unchanged. Nothing on a page is deleted here: a disputed fact is left out of pages and answers until disputeSettle.ts settles it, shown as being
 * re-checked.
 *
 *   npx tsx scripts/guides/recordsVerify.ts --only KEY[,KEY] [--max-dollars N] [--recheck] [--dry-run]
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, ledger, ledgerDollars, searchesIn } from './common';
import { claimCheck, claimSlots, supportedSegments, trusted, type Evidence, type EvidencePack, type ClaimPage } from './claimCheck';
import { RECORDS } from './recordsImport';
import { contentSig, type GameRecord } from './records';

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const VERIFY_TYPES = new Set(['item', 'secret', 'shop', 'enemy', 'boss', 'checklist', 'tip', 'warning', 'noreturn', 'npc', 'quest', 'thing']);
const f = (r: GameRecord, k: string) => { const v = r.fields?.[k]; return Array.isArray(v) ? v.join('; ') : String(v || ''); };

/** The records as a claim page: entries (location, how, missable), fights, and the rest as statements. */
export function claimPageOf(recs: GameRecord[]): { page: ClaimPage; owner: Map<string, string> } {
  const owner = new Map<string, string>();
  const page: ClaimPage = { steps: [], entries: [], choices: [], advice: [], services: [], fights: [] };
  for (const r of recs) {
    if (r.type === 'item' || r.type === 'secret' || r.type === 'checklist') {
      page.entries.push({ id: r.id, name: r.type === 'item' ? r.name : undefined, text: r.type === 'item' ? undefined : f(r, 'text') || r.name, where: f(r, 'where'), how: f(r, 'how'), lockout: f(r, 'lockout') });
    } else if (r.type === 'boss') {
      page.fights.push({ name: r.name, enemies: f(r, 'enemies'), rewards: f(r, 'rewards'), weaknesses: f(r, 'weaknesses') });
    } else if (r.type === 'shop') {
      page.services.push(`${r.name} sells or offers: ${f(r, 'sells') || 'goods'}`);
    } else if (r.type === 'enemy') {
      page.services.push(`${r.name} is an enemy here${f(r, 'weakness') ? `; weak to ${f(r, 'weakness')}` : ''}${f(r, 'steal') ? `; drops or can be stolen: ${f(r, 'steal')}` : ''}`);
    } else {
      page.advice.push(cut(r.prose?.text || f(r, 'text') || r.short || r.name, 400));
    }
  }
  // The slot labels say which record each claim belongs to: E (entries, in order), F (fights), P (services), A (advice).
  const entries = recs.filter((r) => r.type === 'item' || r.type === 'secret' || r.type === 'checklist');
  const fights = recs.filter((r) => r.type === 'boss');
  const services = recs.filter((r) => r.type === 'shop' || r.type === 'enemy');
  const advice = recs.filter((r) => !['item', 'secret', 'checklist', 'boss', 'shop', 'enemy'].includes(r.type));
  entries.forEach((r, i) => owner.set(`E${i + 1}`, r.id));
  fights.forEach((r, i) => owner.set(`F${i + 1}`, r.id));
  services.forEach((r, i) => owner.set(`P${i + 1}`, r.id));
  advice.forEach((r, i) => owner.set(`A${i + 1}`, r.id));
  // claimPageOf orders services as shops then enemies in record order; keep the same order as above.
  page.services = services.map((r) => (r.type === 'shop' ? `${r.name} sells or offers: ${f(r, 'sells') || 'goods'}` : `${r.name} is an enemy here${f(r, 'weakness') ? `; weak to ${f(r, 'weakness')}` : ''}${f(r, 'steal') ? `; drops or can be stolen: ${f(r, 'steal')}` : ''}`));
  page.advice = advice.map((r) => cut(r.prose?.text || f(r, 'text') || r.short || r.name, 400));
  return { page, owner };
}

/** One searched call about exactly these records, added to the page's evidence pack (kept for later checks). */
async function research(key: string, slug: string, game: string, place: string, recs: GameRecord[]): Promise<EvidencePack> {
  const ref = db().collection('evidencePacks').doc(`${key}__${slug}`);
  const have = ((await ref.get()).data() as EvidencePack | undefined) || { key, slug, game, area: place, evidence: [], sites: [], servicesComplete: false, searches: 0, at: 0 };
  const list = recs.slice(0, 30).map((r) => {
    if (r.type === 'shop') return `the merchant ${r.name} (what they sell)`;
    if (r.type === 'enemy') return `the enemy ${r.name} (weaknesses, drops)`;
    if (r.type === 'boss') return `the boss fight ${r.name} (weaknesses, rewards)`;
    if (r.type === 'item') return `${r.name} (where exactly, how to get it, whether it can be permanently missed)`;
    return cut(r.short || r.prose?.text || f(r, 'text') || r.name, 140);
  });
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: `In the video game "${game}", the place "${place}": for each of these, say what the game's guides and wikis say about it (and whether it is really in ${place} at all):\n- ${list.join('\n- ')}\nRun a few searches (at most four). Answer in short factual sentences, one fact per line, only what the sources say. Start every line with the name of the thing it is about ("Iguana Egg: in the terrarium by the penthouse entrance"), never "It" or a bare label, and name the place each thing is in.` }] }],
    config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 5000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const evidence: Evidence[] = [...(have.evidence || [])];
  const sites = new Set<string>(have.sites || []);
  for (const seg of supportedSegments(res)) {
    if (evidence.some((e) => e.text === seg.text)) continue;
    evidence.push({ id: `e${evidence.length + 1}`, text: cut(seg.text, 400), sources: seg.sites.slice(0, 4), topic: 'records' });
    seg.sites.forEach((s) => sites.add(s));
  }
  const pack: EvidencePack = { ...have, key, slug, game, area: have.area || place, evidence, sites: [...sites], searches: (have.searches || 0) + searchesIn(res), at: Date.now() };
  await ref.set(JSON.parse(JSON.stringify(pack)));
  return trusted(pack);
}

export type Verified = { at: number; dollars: number; results: Record<string, { sig: string; status: 'checked' | 'disputed' | 'unconfirmed'; fix?: string; claims: number; supported: number }> };

async function verifyPage(key: string, slug: string, game: string, recs: GameRecord[], useStored: boolean): Promise<Verified> {
  const before = ledgerDollars();
  const place = recs[0].placeName || slug;
  const stored = ((await db().collection('evidencePacks').doc(`${key}__${slug}`).get()).data() as EvidencePack | undefined);
  const ev = useStored && stored?.evidence?.length ? trusted(stored) : await research(key, slug, game, place, recs);
  const { page, owner } = claimPageOf(recs);
  const verdicts = ev.evidence.length ? await claimCheck(game, place, claimSlots(page), ev) : [];
  const results: Verified['results'] = {};
  for (const r of recs) {
    const mine = verdicts.filter((v) => owner.get(v.label) === r.id && v.verdict !== 'general');
    const bad = mine.find((v) => v.verdict === 'contradicted');
    const ok = mine.length > 0 && mine.every((v) => v.verdict === 'supported');
    results[r.id] = { sig: contentSig(r), status: bad ? 'disputed' : ok ? 'checked' : 'unconfirmed', ...(bad?.fix ? { fix: bad.fix } : {}), claims: mine.length, supported: mine.filter((v) => v.verdict === 'supported').length };
  }
  return { at: Date.now(), dollars: Math.round((ledgerDollars() - before) * 10000) / 10000, results };
}

async function main() {
  const keys = String(arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!keys.length) throw new Error('--only KEY[,KEY] is required');
  const max = Number(arg('max-dollars', '5')) || 5;
  const dry = process.argv.includes('--dry-run');
  const recheck = process.argv.includes('--recheck');
  const t = { pages: 0, records: 0, checked: 0, disputed: 0, unconfirmed: 0 };
  // Every page to check across the guides, most-searched first, so a stop at the cap leaves the least-wanted ones.
  type Job = { key: string; game: string; slug: string; recs: GameRecord[]; done: Map<string, any>; impressions: number };
  const jobs: Job[] = [];
  for (const key of keys) {
    const game = String(((await db().collection('guides').doc(key).get()).data() as any)?.game || key);
    const all = (await RECORDS().doc(key).collection('records').get()).docs.map((d) => d.data() as GameRecord);
    const done = new Map<string, any>(((await RECORDS().doc(key).collection('verified').get()).docs).map((d) => [d.id, d.data()]));
    const byPlace = new Map<string, GameRecord[]>();
    for (const r of all) {
      if (!r.place || !VERIFY_TYPES.has(r.type) || !(r.origin.from === 'area' || r.origin.from === 'entity' || r.origin.from === 'extract')) continue;
      if (!(r.tier === 'C' || (recheck && r.tier === 'B'))) continue;
      const prev = done.get(r.place)?.results?.[r.id];
      if (prev && prev.sig === contentSig(r) && (prev.status !== 'unconfirmed' || Date.now() - Number(done.get(r.place)?.at || 0) < 30 * 86_400_000)) continue;
      byPlace.set(r.place, [...(byPlace.get(r.place) || []), r]);
    }
    for (const [slug, recs] of byPlace) jobs.push({ key, game, slug, recs, done, impressions: recs[0].impressions || 0 });
  }
  jobs.sort((x, y) => y.impressions - x.impressions);
  for (let i = 0; i < jobs.length; i += 4) {
    if (ledgerDollars() >= max - 0.15) { console.log(`Stopped at the $${max.toFixed(2)} cap.`); break; }
    const group = jobs.slice(i, i + 4);
    if (dry) { group.forEach((j) => console.log(`would verify ${j.key}/${j.slug}: ${j.recs.length} record(s), ${j.impressions} impressions`)); t.pages += group.length; t.records += group.reduce((n, j) => n + j.recs.length, 0); continue; }
    let capped = false;
    await Promise.all(group.map(async ({ key, game, slug, recs, done }) => {
      try {
        // B rechecks use the stored evidence (no searches); C records get their own research.
        const v = await verifyPage(key, slug, game, recs, recs.every((r) => r.tier === 'B'));
        const prev = done.get(slug)?.results || {};
        await RECORDS().doc(key).collection('verified').doc(slug).set({ at: v.at, dollars: v.dollars, results: { ...prev, ...v.results } });
        const st = Object.values(v.results);
        t.pages++; t.records += st.length;
        t.checked += st.filter((x) => x.status === 'checked').length; t.disputed += st.filter((x) => x.status === 'disputed').length; t.unconfirmed += st.filter((x) => x.status === 'unconfirmed').length;
        console.log(`${key}/${slug}: ${st.length} record(s): ${st.filter((x) => x.status === 'checked').length} checked, ${st.filter((x) => x.status === 'disputed').length} disputed, ${st.filter((x) => x.status === 'unconfirmed').length} unconfirmed`);
      } catch (e: any) {
        console.warn(`${key}/${slug} skipped: ${e?.message}`);
        if (/spending cap/.test(String(e?.message))) capped = true;
      }
    }));
    if (capped) break;
  }
  console.log(`Verified ${t.pages} page(s), ${t.records} record(s): ${t.checked} checked, ${t.disputed} disputed, ${t.unconfirmed} still unconfirmed; $${ledgerDollars().toFixed(4)} in ${ledger.calls} call(s) (${ledger.searches} searches).`);
  setTimeout(() => process.exit(0), 300);
}
if (/recordsVerify\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('recordsVerify failed:', e?.message || e); process.exit(1); });
