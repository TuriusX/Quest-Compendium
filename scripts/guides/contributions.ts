/**
 * The nightly check of players' suggestions (contributions.ts, "Suggest an edit"):
 *
 *   pending   one targeted search for what the suggestion says, the claim check of each of its sentences against what
 *             the search found, a verdict (supported: every sentence backed; contradicted: a source says otherwise;
 *             unverifiable: the rest), the evidence, and a proposed wording for the page (only what the evidence backs,
 *             or the player's own words when nothing could be checked). Status "checked", for the owner's decision.
 *   approved  once the page has been rebuilt since the approval, does it state the suggestion itself? Then it's
 *             "absorbed" and the site stops showing it as a separate note.
 *
 *   npx tsx scripts/guides/contributions.ts [--max 30]
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, usageScope } from './common';
import { claimCheck, type ClaimSlot, type EvidencePack } from './claimCheck';
import { searchedEvidence } from './entityV2';
import { coverage, pageText } from './benchmark';
import { apiLimits, searchesToday, pipelineRoom } from '../../apiLimits';

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const sentences = (t: string) => String(t || '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 3);
/** A page's text for the absorbed check: an entity page's fields, or an area page's text fields. */
async function pageOf(c: any): Promise<{ name: string; text: string; builtAt: number } | null> {
  if (c.page === 'entity') {
    const e: any = (await db().collection('guideCompendium').doc(c.key).collection('entities').doc(c.slug).get()).data();
    return e ? { name: e.name, text: pageText(e), builtAt: Number(e.builtAt || 0) } : null;
  }
  const a: any = (await db().collection('guides').doc(c.key).collection('areas').doc(c.slug).get()).data();
  if (!a) return null;
  const strings: string[] = [];
  const walk = (v: any) => { if (typeof v === 'string') strings.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk({ overview: a.overview, walkthrough: a.walkthrough, items: a.items, secrets: a.secrets, choices: a.choices, shops: a.shops, fights: a.fights, tips: a.tips, sections: a.sections });
  return { name: a.name, text: strings.join('\n'), builtAt: Number(a.updatedAt || a.builtAt || a.verifiedAt || 0) };
}

async function check(id: string, c: any): Promise<string> {
  const game = String((await db().collection('guides').doc(c.key).get()).data()?.game || c.key);
  const page = await pageOf(c);
  const where = [page?.name, c.label].filter(Boolean).join(' / ');
  const scope = { dollars: 0, searches: 0 };
  const out = await usageScope.run(scope, async () => {
    const found = await searchedEvidence(`In the video game "${game}", about "${where}": a player says: "${cut(c.text, 1200)}". Check what the game's wikis and guides say about each point.`, 'c', 'player check');
    // What the search found, with the page's stored evidence (the research it was built from).
    const packId = c.page === 'entity' ? `${c.key}__entity__${c.slug}` : `${c.key}__${c.slug}`;
    const stored: any = (await db().collection('evidencePacks').doc(packId).get()).data();
    const all = [...found.evidence, ...((stored?.evidence || []) as any[]).map((e: any, i: number) => ({ ...e, id: `p${i + 1}` }))];
    const ev: EvidencePack = { evidence: all, sites: [...new Set(all.flatMap((e: any) => e.sources || []))], searches: found.searches } as any;
    const ss = sentences(c.text).slice(0, 12);
    const slots: ClaimSlot[] = ss.map((t, i) => ({ id: `K${i + 1}`, label: `S${i + 1}`, kind: 'sentence', sentence: 0, text: t }));
    const v = ev.evidence.length && slots.length ? await claimCheck(game, where, slots, ev) : [];
    const verdictOf = (i: number) => v.find((x) => x.id === `K${i + 1}`)?.verdict || 'unsupported';
    const contra = ss.filter((_, i) => verdictOf(i) === 'contradicted');
    const backed = ss.filter((_, i) => verdictOf(i) === 'supported' || verdictOf(i) === 'general');
    const verdict = contra.length ? 'contradicted' : backed.length === ss.length && ss.length ? 'supported' : 'unverifiable';
    const used = new Set(v.flatMap((x) => x.evidence || []));
    // The wording for the page: only what the evidence backs (or the player's words when nothing could be checked).
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: [
        `A player suggested this for the guide section "${where}" of "${game}" (${c.kind === 'correction' ? 'a correction' : 'an extra detail'}):`, c.text, '',
        verdict === 'unverifiable' && !backed.length ? 'Nothing could be checked against sources. Rewrite it as a short guide note in plain, neutral words (no "I", no opinions), keeping its facts.' : `Sources back these parts: ${backed.join(' ') || '(none)'}${contra.length ? `\nSources contradict these parts: ${contra.join(' ')}` : ''}\nEVIDENCE:\n${ev.evidence.map((e) => `- ${e.text}`).join('\n')}\n\nWrite a short guide note (1-3 sentences, plain, no "I") stating what the evidence backs; for a contradicted part, state what the evidence says instead.`,
        'Reply with the note only: plain sentences, no heading, no markdown.',
      ].join('\n') }] }],
      config: { temperature: 0.2, maxOutputTokens: 600, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    return {
      verdict, reason: contra.length ? `Sources contradict: ${cut(contra.join(' '), 300)}` : verdict === 'supported' ? 'Every sentence is backed by a source.' : `${ss.length - backed.length} of ${ss.length} sentence(s) not found in sources.`,
      evidence: ev.evidence.filter((e) => used.has(e.id)).slice(0, 6).map((e) => ({ text: cut(e.text, 300), sources: e.sources.slice(0, 3) })),
      proposal: cut(String(res?.text || '').replace(/\*\*[^*]*\*\*\s*/g, '').replace(/^#+\s.*$/gm, ''), 1200) || c.text,
    };
  });
  await db().collection('contributions').doc(id).set({ status: 'checked', check: { ...out, at: Date.now(), dollars: Math.round(scope.dollars * 10000) / 10000, searches: scope.searches } }, { merge: true });
  return `${c.key}/${c.slug}: ${out.verdict}, $${scope.dollars.toFixed(3)}`;
}

async function main() {
  const max = Number(arg('max')) || 30;
  let checked = 0, absorbed = 0, dollars = 0;
  const pending = (await db().collection('contributions').where('status', '==', 'pending').limit(max).get()).docs;
  for (const d of pending) {
    if (pipelineRoom(await apiLimits(), await searchesToday(true)) < 10) { console.log("Today's searches are used up; the rest wait for tomorrow."); break; }
    try { console.log(`  ${await check(d.id, d.data())}`); checked++; dollars += Number((await d.ref.get()).data()?.check?.dollars || 0); }
    catch (e: any) { console.log(`  ${d.id}: not checked (${cut(e?.message || e, 120)})`); }
  }
  // Approved ones the page now states itself.
  for (const d of (await db().collection('contributions').where('status', '==', 'approved').get()).docs) {
    const c: any = d.data();
    if (c.absorbed) continue;
    const page = await pageOf(c);
    if (!page || page.builtAt <= Number(c.decided?.at || 0)) continue;
    const game = String((await db().collection('guides').doc(c.key).get()).data()?.game || c.key);
    const [has] = await coverage(game, page.name, page.text, [{ point: String(c.decided?.text || c.text), kind: 'other', core: true }]);
    if (has) { await d.ref.set({ absorbed: { at: Date.now() } }, { merge: true }); absorbed++; }
  }
  // Declined suggestions are deleted after 90 days (the privacy policy says so).
  let deleted = 0;
  for (const d of (await db().collection('contributions').where('status', '==', 'rejected').get()).docs) {
    if (Number(d.data().decided?.at || d.data().at || 0) < Date.now() - 90 * 86_400_000) { await d.ref.delete(); deleted++; }
  }
  if (deleted) console.log(`  ${deleted} declined suggestion(s) older than 90 days deleted`);
  const waiting = (await db().collection('contributions').where('status', '==', 'checked').count().get()).data().count;
  console.log(`suggestions: ${checked} checked, ${waiting} waiting for approval, ${absorbed} now part of their page; $${dollars.toFixed(2)}`);
  setTimeout(() => process.exit(0), 300);
}
main().catch((e) => { console.error('suggestions failed:', e?.message || e); process.exit(1); });
