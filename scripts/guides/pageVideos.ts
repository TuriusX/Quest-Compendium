/**
 * Fight videos on guide pages (owner, Nov 19 2026: "add video links, images, etc where it will help players but also I
 * don't want it to clutter the guides"). At most one video per page: its first key fight, the most-searched pages
 * first. The video finder of the visual answers (visualAnswer.ts findVideo): a YouTube search, the best match ranked,
 * the top pick WATCHED (Gemini, from its link) to make sure it really shows the fight, and where it starts. Saved on the
 * fight (fights[i].video); publish.ts shows a small link with the thumbnail under the fight, no embedded player.
 *
 * YouTube's searches are shared with the app's visual answers (system/visualAnswers, about 100 a day): this takes at
 * most --guide-share of the day's count (default 60), so players' answers always keep the rest.
 *
 *   npx tsx scripts/guides/pageVideos.ts --keys a,b [--max-pages 30] [--max-dollars 3] [--guide-share 60]
 */
import { getFirestore } from 'firebase-admin/firestore';
import { db, arg, gemini, ledgerDollars } from './common';
import { findVideo, YouTubeQuotaOut, type VideoOut } from '../../visualAnswer';
import { pacificDay } from '../../visualServer';

async function main() {
  const keys = String(arg('keys') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const maxPages = Number(arg('max-pages', '30')) || 30;
  const max = Number(arg('max-dollars', '3')) || 3;
  const share = Number(arg('guide-share', '60')) || 60;
  const ytKey = String(process.env.YOUTUBE_API_KEY || '');
  if (!ytKey) throw new Error('YOUTUBE_API_KEY is not set (the server has it; mount it on the job)');
  const { loadPageStats } = await import('./pageStats');
  const stats = await loadPageStats();
  // One of today's YouTube searches, only while the guides' share isn't used (the same counter as the app's answers).
  const beforeSearch = async () => {
    const ref = getFirestore().collection('system').doc('visualAnswers');
    const day = pacificDay();
    const ok = await getFirestore().runTransaction(async (tx) => {
      const d: any = (await tx.get(ref)).data() || {};
      const used = d.searchDay === day ? Number(d.searches) || 0 : 0;
      if (used >= share) return false;
      tx.set(ref, { searchDay: day, searches: used + 1, guideSearches: (d.searchDay === day ? Number(d.guideSearches) || 0 : 0) + 1 }, { merge: true });
      return true;
    });
    if (!ok) throw new YouTubeQuotaOut(`the guides' ${share} of today's YouTube searches are used`);
  };
  const ai: any = gemini();
  let done = 0, found = 0;
  outer: for (const key of keys) {
    const info: any = (await db().collection('guides').doc(key).get()).data() || {};
    const game = String(info.game || key);
    const pages = (await db().collection('guides').doc(key).collection('areas').where('status', '==', 'published').get()).docs
      .map((d) => ({ ref: d.ref, slug: d.id, a: d.data() as any }))
      .filter((p) => Array.isArray(p.a.fights) && p.a.fights.some((f: any) => f?.name) && !p.a.fights.some((f: any) => f?.video))
      .sort((x, y) => (Number(stats[`${key}/${y.slug}`]?.[0]) || 0) - (Number(stats[`${key}/${x.slug}`]?.[0]) || 0));
    console.log(`${game}: ${pages.length} page(s) with a key fight and no video`);
    for (const p of pages) {
      if (done >= maxPages) break outer;
      if (ledgerDollars() + 0.05 > max) { console.log(`stopped at $${ledgerDollars().toFixed(3)}`); break outer; }
      const i = p.a.fights.findIndex((f: any) => f?.name);
      const f = p.a.fights[i];
      const question = `How do I beat ${f.name} in ${game}?`;
      const answer = [f.tactics, f.threats, f.weaknesses].filter(Boolean).join(' ').slice(0, 1500) || `${f.name}, a key fight in ${p.a.name}.`;
      const out: VideoOut = { searches: 0, steps: [], beforeSearch };
      done++;
      try {
        const v: any = await findVideo(ai, { d: 0 }, ytKey, game, question, answer, `${game} ${f.name} boss fight`, out);
        if (v?.kind === 'video' && v.videoId) {
          const fights = p.a.fights.map((x: any, j: number) => (j === i ? { ...x, video: { videoId: v.videoId, title: String(v.title || '').slice(0, 120), channel: String(v.channel || '').slice(0, 60), start: Number(v.start) || 0, seconds: Number(v.seconds) || 0, at: Date.now() } } : x));
          await p.ref.set({ fights }, { merge: true });
          found++;
          console.log(`  ${key}/${p.slug} ${f.name}: ${v.title} (${v.channel}) from ${v.start}s`);
        } else console.log(`  ${key}/${p.slug} ${f.name}: no video that clearly shows it`);
      } catch (e: any) {
        if (e instanceof YouTubeQuotaOut || /YouTube searches are used/i.test(String(e?.message))) { console.log(`  ${String(e.message)}`); break outer; }
        console.log(`  ${key}/${p.slug} ${f.name}: error ${String(e?.message || e).slice(0, 120)}`);
      }
    }
  }
  console.log(`\nFight videos: ${found} found for ${done} page(s); $${ledgerDollars().toFixed(3)}.`);
  setTimeout(() => process.exit(0), 300);
}

if (/pageVideos\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('pageVideos failed:', e?.message || e); process.exit(1); });
