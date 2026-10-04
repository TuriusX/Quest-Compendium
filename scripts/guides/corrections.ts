/**
 * Verify player corrections to the guides (the daily pipeline runs this; candidates come from conversations, see
 * corrections.ts at the root). No single player is trusted:
 *
 *   npx tsx scripts/guides/corrections.ts                     check every entry with new reports, apply what passes
 *   options: --max-searches N   search cap for this run (default 120; each entry gets up to 8)
 *            --group ID         just this entry (correctionGroups/{game}__{area}__{entry})
 *            --dry-run          check and show the before/after, but change nothing (no group status, no guide)
 *
 * For each entry with new reports (or one an admin approved on /admin/reviews):
 *   1. The source check: the reports and the guide's text go to the build model with Google Search (up to 8 searches,
 *      counted in the monthly budget), which says whether sources confirm, contradict or can't settle the reports,
 *      which reports agree, and rewrites the entry's where / how / notes clearly and specifically.
 *   2. The reviewer (Gemini 3.8 Flash, no searches; corrections never use Pro) checks that rewrite against the evidence.
 *   3. Confirmed by sources (and the reviewer): the entry is rewritten. Contradicted: dismissed. Can't be settled by
 *      sources: applied only once reporters worth 3 or more (a signed-in app player or Discord user 1, an anonymous
 *      website report 0.5, an app guest 0) reported the same correction, or a Discord moderator confirmed it; otherwise it
 *      stays pending (or disputed, when the reports disagree with each other).
 * Missing fights (missingFights.ts: a combat answer about a fight the area's page doesn't cover) go the same way,
 * most-reported first: the source check says whether the fight happens in that area and writes it as a Key fights
 * entry (enemies, threats, weaknesses, tactics, rewards), the reviewer checks it, and it's added to the staged page's
 * key fights. Contradicted (no such fight there): dismissed. Unclear: added from the players' battle plans only once
 * reporters worth 3 agree.
 * A verified correction is used in answers for its area at once. The guide itself changes through a staged copy and
 * the review gate (review.ts), the entry marked "updatedFrom: player reports", and checked only when sources confirmed it.
 * Logs "N searches used" and "cost ≈ $x" for the pipeline.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, arg, parseJson, searchesIn, stageKey, type GuideFight } from './common';
import { fightKnown } from '../../missingFights';
import { parseFightLines, FIGHT_FORMAT } from './fights';
import { estimateCost } from '../../usage';
import { recordMonthly } from '../../searchGuard';
import { reporterCount } from '../../corrections';
import { stageCopy, discard } from './promote';
import { reviewGuide, gateGuide } from './review';
import { FLASH_REVIEW_MODEL } from './reviewerQuota';

// Corrections never use the Pro reviewer (its daily requests are kept for careful rebuilds): Gemini 3.8 Flash checks the
// rewrite and runs the gate.
const REVIEW_MODEL = FLASH_REVIEW_MODEL;
const maxSearches = Math.max(8, Number(arg('max-searches', '120')));
const onlyGroup = arg('group') && arg('group') !== 'true' ? arg('group')! : '';
const dryRun = arg('dry-run') === 'true';
const PER_ENTRY = 8;
const MIN_PLAYERS = 3;

let searches = 0;
let dollars = 0;

type Report = { id: string; claim: string; uidHash: string; reporterKey?: string; source?: string; weight?: number; guest: boolean; via: string; placeConfirmed: boolean; field: string };
/** An item's corrected where / how / notes; a secret or checklist line's corrected whole text (it names what it is). */
type Rewrite = { where?: string; how?: string; notes?: string; text?: string; fight?: GuideFight };
type Check = { verdict: 'confirmed' | 'contradicted' | 'unclear'; agree: number[]; rewrite: Rewrite; evidence: string; sources: string[]; searches: number };

const cut = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The entry as the guide has it now (live page). */
async function liveEntry(gameKey: string, slug: string, entryId: string, kind: string) {
  const page: any = (await db().collection('guides').doc(gameKey).collection('areas').doc(slug).get()).data();
  if (!page) return null;
  if (kind === 'fight') return { page, entry: { id: entryId } };
  if (kind === 'item') return { page, entry: (page.items || []).find((e: any) => e.id === entryId) };
  if (kind === 'secret') return { page, entry: (page.secrets || []).find((e: any) => e.id === entryId) };
  for (const s of page.sections || []) {
    const e = (s.entries || []).find((x: any) => x.id === entryId);
    if (e) return { page, entry: e };
  }
  return { page, entry: null };
}

const describeEntry = (kind: string, e: any) =>
  kind === 'fight'
    ? `missing key fight${e?.name ? `: ${[e.name, e.enemies && `enemies ${e.enemies}`, e.tactics && `tactics ${e.tactics}`].filter(Boolean).join('; ')}` : ' (not on the page)'}`
    : kind === 'item'
    ? `item "${e.name}": where: ${e.where || '(not given)'}${e.notes ? `; notes: ${e.notes}` : ''}`
    : `${kind === 'secret' ? 'secret' : 'checklist line'}: ${e.text || e.name || ''}${e.where ? ` (where: ${e.where})` : ''}`;

/** Step 1: the source check, with Google Search (line format: grounded replies can't be forced into JSON). */
async function sourceCheck(game: string, area: string, kind: string, entry: any, reports: Report[]): Promise<Check> {
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `In the video game "${game}", area "${area}", a player's guide has this entry:`,
      describeEntry(kind, entry),
      ``,
      `Players said it's wrong or unclear. Their reports (each is what an assistant concluded after the player pushed back):`,
      ...reports.map((r, i) => `${i + 1}. ${r.claim}`),
      ``,
      `Search the web (at most ${PER_ENTRY} searches; prefer the game's wiki and detailed walkthroughs) to check the reports against the guide.`,
      `Then reply with these lines only:`,
      `VERDICT: confirmed (sources back the reports' correction), contradicted (sources back the guide, or show the reports are wrong), or unclear (sources don't settle it)`,
      `AGREE: the numbers of the reports that say the same thing as what you found (or, if unclear, as each other), e.g. 1, 3`,
      `WHERE: the entry's location, rewritten to be clear and specific (landmarks, directions, how to get there); empty if unclear`,
      `HOW: what it takes or how to do it (checks, keys, steps), if relevant; else empty`,
      `NOTES: anything else a player needs, if any; else empty`,
      ...(kind === 'item' ? [] : [`TEXT: the whole entry rewritten as one clear line that first names what it is (as the guide's entry does), then where and how; empty if unclear`]),
      `EVIDENCE: two to four sentences: each fact in WHERE / HOW / NOTES and which site showed it`,
      `Only use facts your searches showed: no character names, numbers, checks or contents that you didn't find. Leave a
      field empty rather than guess. Write in your own words; never copy sentences from websites.`,
    ].join('\n') }] }],
    config: { tools: [{ googleSearch: {} }], temperature: 0.1, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const n = searchesIn(res);
  searches += n;
  if (n) recordMonthly(n);
  dollars += estimateCost(MODEL, res) || 0;
  const text = String(res?.text || '');
  const line = (k: string) => cut((text.match(new RegExp(`^\\W*${k}\\W*:[ \\t]*(.*)$`, 'im')) || [])[1], 600).replace(/^(empty|none|n\/a|-)$/i, '');
  const v = line('VERDICT').toLowerCase();
  const verdict = n === 0 ? 'unclear' : v.startsWith('confirm') ? 'confirmed' : v.startsWith('contradict') ? 'contradicted' : 'unclear';
  const agree = [...line('AGREE').matchAll(/\d+/g)].map((m) => Number(m[0])).filter((x) => x >= 1 && x <= reports.length);
  const chunks = res?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = [...new Set(chunks.map((c: any) => String(c?.web?.title || c?.web?.domain || '')).filter(Boolean))].slice(0, 6) as string[];
  return { verdict, agree, rewrite: { where: line('WHERE'), how: line('HOW'), notes: line('NOTES'), text: line('TEXT') }, evidence: line('EVIDENCE'), sources, searches: n };
}

/** A missing fight's source check: does it happen in this area, and the Key fights entry from what sources say. */
async function fightSourceCheck(game: string, area: string, g: any, reports: Report[]): Promise<Check> {
  const res: any = await gemini().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `In the video game "${game}", players fought "${g.entryName}" in the area "${area}"${(g.enemies || []).length ? ` (enemies: ${g.enemies.join(', ')})` : ''}.`,
      `A player's guide for that area has no entry for this fight. The battle plans an assistant gave them:`,
      ...reports.map((r, i) => `${i + 1}. ${r.claim}`),
      ``,
      `Search the web (at most ${PER_ENTRY} searches; prefer the game's wiki and detailed walkthroughs) to check that this fight`,
      `happens in this area and is a boss or major set-piece battle, and what it takes to win it. Reply with these lines only:`,
      `VERDICT: confirmed (sources show this fight here), contradicted (no such fight in this area, or it's ordinary enemies), or unclear`,
      `AGREE: the numbers of the battle plans that fit what you found, e.g. 1, 3`,
      FIGHT_FORMAT,
      `EVIDENCE: two to four sentences: the fight's facts and which site showed each`,
      `Use the game's names for the fight, enemies and abilities. Only facts your searches showed; leave a field as "none"`,
      `rather than guess. Write in your own words; never copy sentences from websites.`,
    ].join('\n') }] }],
    config: { tools: [{ googleSearch: {} }], temperature: 0.1, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  const n = searchesIn(res);
  searches += n;
  if (n) recordMonthly(n);
  dollars += estimateCost(MODEL, res) || 0;
  const text = String(res?.text || '');
  const line = (k: string) => cut((text.match(new RegExp(`^\\W*${k}\\W*:[ \\t]*(.*)$`, 'im')) || [])[1], 600);
  const v = line('VERDICT').toLowerCase();
  const verdict = n === 0 ? 'unclear' : v.startsWith('confirm') ? 'confirmed' : v.startsWith('contradict') ? 'contradicted' : 'unclear';
  const agree = [...line('AGREE').matchAll(/\d+/g)].map((m) => Number(m[0])).filter((x) => x >= 1 && x <= reports.length);
  const chunks = res?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = [...new Set(chunks.map((c: any) => String(c?.web?.title || c?.web?.domain || '')).filter(Boolean))].slice(0, 6) as string[];
  const fight = parseFightLines(text, sources)[0];
  return { verdict: fight || verdict !== 'confirmed' ? verdict : 'unclear', agree, rewrite: fight ? { fight } : {}, evidence: line('EVIDENCE'), sources, searches: n };
}

/** The reviewer checks (and tidies) a missing fight's Key fights entry against the evidence. */
async function fightReviewerCheck(game: string, area: string, check: Check): Promise<{ ok: boolean; rewrite: Rewrite; reason: string }> {
  const f = check.rewrite.fight!;
  const res: any = await gemini().models.generateContent({
    model: REVIEW_MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `You review a new "key fight" entry for a video game guide before players see it. Game: "${game}", area: "${area}".`,
      `Proposed: name: ${f.name}; enemies: ${f.enemies || '-'}; threats: ${f.threats || '-'}; weaknesses/resistances: ${f.weaknesses || '-'}; tactics: ${f.tactics || '-'}; rewards: ${f.rewards || '-'}`,
      `Source check evidence: ${check.evidence || '(none)'}. Sources: ${check.sources.join(', ') || '(none)'}`,
      ``,
      `Is it a real boss or set-piece battle in this area, supported by the evidence, specific enough to use, and free of`,
      `guesses? If so, return it tidied (same facts, clear wording; drop any unsupported field). Reply with JSON only:`,
      `{"ok": true|false, "name": "...", "enemies": "...", "threats": "...", "weaknesses": "...", "tactics": "...", "rewards": "...", "reason": "<one sentence>"}`,
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  dollars += estimateCost(REVIEW_MODEL, res) || 0;
  const j: any = parseJson(String(res?.text || '')) || {};
  const val = (k: string, fb?: string) => cut(j[k], 400) || fb;
  return {
    ok: j.ok === true,
    rewrite: { fight: { ...f, name: val('name', f.name)!, enemies: val('enemies', f.enemies), threats: val('threats', f.threats), weaknesses: val('weaknesses', f.weaknesses), tactics: val('tactics', f.tactics), rewards: val('rewards', f.rewards) } },
    reason: cut(j.reason, 300),
  };
}

/** Step 2: the reviewer checks (and tidies) the rewrite against the evidence. */
async function reviewerCheck(game: string, area: string, kind: string, entry: any, reports: Report[], check: Check): Promise<{ ok: boolean; rewrite: Rewrite; reason: string }> {
  const res: any = await gemini().models.generateContent({
    model: REVIEW_MODEL,
    contents: [{ role: 'user', parts: [{ text: [
      `You review a correction to a video game guide entry before players see it. Game: "${game}", area: "${area}".`,
      `Current entry: ${describeEntry(kind, entry)}`,
      `Player reports: ${reports.map((r) => r.claim).join(' / ')}`,
      `Source check: ${check.verdict}. Evidence: ${check.evidence || '(none)'}. Sources: ${check.sources.join(', ') || '(none)'}`,
      kind === 'item'
        ? `Proposed entry: where: ${check.rewrite.where || '-'}; how: ${check.rewrite.how || '-'}; notes: ${check.rewrite.notes || '-'}`
        : `Proposed entry (one line): ${check.rewrite.text || [check.rewrite.where, check.rewrite.how, check.rewrite.notes].filter(Boolean).join(' ')}`,
      ``,
      `Is the proposed entry supported by the evidence, specific enough to follow in the game, and free of guesses? If so,`,
      `return it tidied (same facts, clear wording, no new facts). Reply with JSON only:`,
      kind === 'item'
        ? `{"ok": true|false, "where": "...", "how": "...", "notes": "...", "reason": "<one sentence>"}`
        : `{"ok": true|false, "text": "<the one-line entry, naming what it is first>", "reason": "<one sentence>"}`,
    ].join('\n') }] }],
    config: { responseMimeType: 'application/json', temperature: 0.1, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
  });
  dollars += estimateCost(REVIEW_MODEL, res) || 0;
  const j: any = parseJson(String(res?.text || '')) || {};
  return { ok: j.ok === true, rewrite: { where: cut(j.where, 600), how: cut(j.how, 400), notes: cut(j.notes, 400), text: cut(j.text, 900) }, reason: cut(j.reason, 300) };
}

/** A missing fight from the players' reports alone (sources couldn't settle it): its name, enemies and their plan. */
const fromPlayers = (g: any, plan: string): GuideFight => ({
  id: 'f', name: cut(g.entryName, 100), ...((g.enemies || []).length ? { enemies: g.enemies.join(', ').slice(0, 400) } : {}), tactics: cut(plan, 400),
});

/** The entry with the correction written in. Items keep where / notes; lines (secrets, checklist) are one text. */
function rewritten(kind: string, e: any, r: Rewrite, checked: boolean) {
  const how = r.how ? ` ${r.how.replace(/\.?$/, '.')}` : '';
  const marks = { updatedFrom: 'player reports', reportUpdatedAt: Date.now(), checked };
  if (kind === 'item') {
    return { ...e, where: `${(r.where || e.where || '').replace(/\.?$/, '.')}${how}`.trim(), ...(r.notes ? { notes: r.notes } : {}), ...marks };
  }
  const text = r.text || [r.where, r.how, r.notes].filter(Boolean).map((x) => x!.replace(/\.?$/, '.')).join(' ');
  return { ...e, text: text || e.text, ...marks };
}

/** Write the decided corrections of one guide into a staged copy, then the review gate. Returns the gate line. */
async function applyToGuide(gameKey: string, game: string, groups: { id: string; g: any; rewrite: Rewrite; checked: boolean }[]): Promise<string> {
  const staged: any = (await db().collection('guides').doc(stageKey(gameKey)).get()).data();
  if (staged && staged.repair !== 'correction') return 'skipped: another rebuild of this guide is staged (tried again next run)';
  await discard(gameKey);
  await stageCopy(gameKey);
  const stageRef = db().collection('guides').doc(stageKey(gameKey));
  await stageRef.set({ repair: 'correction' }, { merge: true });
  for (const { g, rewrite, checked } of groups) {
    const ref = stageRef.collection('areas').doc(g.area);
    const page: any = (await ref.get()).data();
    if (!page) continue;
    const fix = (list: any[]) => (list || []).map((e: any) => (e.id === g.entryId ? rewritten(g.entryKind, e, rewrite, checked) : e));
    if (g.entryKind === 'fight') {
      // A missing fight: added to the page's key fights (unless the page covers it by now).
      const f = rewrite.fight;
      if (!f?.name || fightKnown({ enemies: page.enemies || [], fights: page.fights || [] }, { fight: f.name, enemies: g.enemies })) continue;
      const fights = [...(page.fights || [])];
      fights.push({ ...f, id: `f-${String(g.entryId).replace(/^fight-/, '').slice(0, 40)}`, updatedFrom: 'player reports', reportUpdatedAt: Date.now(), checked });
      await ref.update({ fights, updatedAt: Date.now() });
      continue;
    }
    const patch =
      g.entryKind === 'item' ? { items: fix(page.items) }
      : g.entryKind === 'secret' ? { secrets: fix(page.secrets) }
      : { sections: (page.sections || []).map((s: any) => ({ ...s, entries: fix(s.entries) })) };
    await ref.update({ ...patch, updatedAt: Date.now() });
  }
  const r = await reviewGuide(stageKey(gameKey), { save: true, verify: false, tier: 'flash' });
  dollars += r.dollars;
  searches += r.searches;
  return r.review ? gateGuide(stageKey(gameKey), game, r.review) : 'Gate: failed (nothing to review).';
}

/**
 * Tell Discord how it went: for each report from /correction on an entry that was just applied or dismissed, one post
 * in the results channel (with a link to the report). Each report is announced once. Needs DISCORD_BOT_TOKEN and
 * DISCORD_RESULTS_CHANNEL_ID; skipped quietly without them.
 */
async function announce(groupId: string, outcome: 'applied' | 'dismissed', g: any, why = '') {
  const token = process.env.DISCORD_BOT_TOKEN, channel = process.env.DISCORD_RESULTS_CHANNEL_ID;
  if (!token || !channel || dryRun) return;
  const reports = (await db().collection('corrections').where('groupId', '==', groupId).where('source', '==', 'discord').get()).docs.filter((d) => !d.data().announced);
  for (const d of reports) {
    const link = d.data().discord?.link ? ` (${d.data().discord.link})` : '';
    const content = outcome === 'applied'
      ? `✅ Correction applied: **${g.entryName}** in ${g.game} · ${g.areaName} is updated in the guide. Thanks!${link}`
      : `❌ Correction not applied: **${g.entryName}** in ${g.game} · ${g.areaName}.${why ? ` ${why}` : ''}${link}`;
    try {
      const r = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] }, flags: 4 }), // 4: no link preview
      });
      if (r.ok) await d.ref.update({ announced: outcome, announcedAt: Date.now() });
      else console.warn(`  Discord post failed: ${r.status} ${(await r.text()).slice(0, 120)}`);
    } catch (e: any) {
      console.warn(`  Discord post failed: ${e?.message}`);
    }
  }
}

async function main() {
  // Entries with new reports, and ones an admin approved.
  const pending = onlyGroup
    ? await db().collection('corrections').where('groupId', '==', onlyGroup).get()
    : await db().collection('corrections').where('status', '==', 'pending').limit(500).get();
  const ids = new Set(pending.docs.map((d) => String(d.data().groupId)));
  if (!onlyGroup) for (const d of (await db().collection('correctionGroups').where('status', '==', 'approved').get()).docs) ids.add(d.id);
  // Verified but not in the guide yet (its review gate failed): tried again at most once a week. They're used in
  // answers meanwhile.
  const retry = onlyGroup ? [] : (await db().collection('correctionGroups').where('status', '==', 'verified').get()).docs
    .filter((d) => !ids.has(d.id) && Date.now() - Number(d.data().lastApplyTry || 0) > 7 * 86_400_000);
  console.log(`Corrections: ${ids.size} entr${ids.size === 1 ? 'y' : 'ies'} to check${dryRun ? ' (dry run: nothing is changed)' : ''}.`);
  // The most-reported entries first (more reports of the same missing fight raise its priority), within the search cap.
  const counts = new Map<string, number>();
  await Promise.all([...ids].map(async (id) => counts.set(id, Number((await db().collection('correctionGroups').doc(id).get()).data()?.reports || 0))));
  const order = [...ids].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));

  const toApply = new Map<string, { game: string; groups: { id: string; g: any; rewrite: Rewrite; checked: boolean }[] }>();
  let verified = 0, dismissed = 0, waiting = 0;
  for (const id of order) {
    const gref = db().collection('correctionGroups').doc(id);
    const g: any = (await gref.get()).data();
    if (!g) continue;
    const reportDocs = (await db().collection('corrections').where('groupId', '==', id).get()).docs;
    const reports: Report[] = reportDocs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    const live = await liveEntry(g.gameKey, g.area, g.entryId, g.entryKind);
    if (!live?.entry) {
      console.log(`- ${g.game} / ${g.areaName} / ${g.entryName}: the entry is gone from the guide; dismissed`);
      if (!dryRun) await gref.set({ status: 'dismissed', reason: 'the entry is no longer in the guide', updatedAt: Date.now() }, { merge: true });
      continue;
    }
    if (g.entryKind === 'fight' && g.status !== 'approved' && fightKnown({ enemies: live.page.enemies || [], fights: live.page.fights || [] }, { fight: g.entryName, enemies: g.enemies })) {
      console.log(`- ${g.game} / ${g.areaName} / ${g.entryName}: the page covers this fight now; dismissed`);
      if (!dryRun) await gref.set({ status: 'dismissed', reason: 'the guide covers this fight now', updatedAt: Date.now() }, { merge: true });
      continue;
    }
    console.log(`\n- ${g.game} / ${g.areaName} / ${g.entryName}${g.entryKind === 'fight' ? ' [missing fight]' : ''} (${reports.length} report(s))`);
    console.log(`  guide now: ${describeEntry(g.entryKind, live.entry)}`);

    // An admin approved it: apply the latest report as it stands (checked only if sources had confirmed it).
    if (g.status === 'approved') {
      const rewrite = g.verifiedText || (g.entryKind === 'fight' ? { fight: fromPlayers(g, g.lastClaim) } : { where: g.lastClaim });
      const checked = g.sourceCheck?.verdict === 'confirmed';
      if (!dryRun) {
        if (!toApply.has(g.gameKey)) toApply.set(g.gameKey, { game: g.game, groups: [] });
        toApply.get(g.gameKey)!.groups.push({ id, g, rewrite, checked });
        await gref.set({ status: 'verified', verifiedText: rewrite, verifiedBy: 'admin', updatedAt: Date.now() }, { merge: true });
      }
      console.log(`  approved on the review queue: applying "${JSON.stringify(rewrite)}"`);
      verified++;
      continue;
    }
    if (searches + PER_ENTRY > maxSearches) {
      console.log('  stopping: the search cap is reached (the rest wait for the next run)');
      break;
    }
    const isFight = g.entryKind === 'fight';
    const check = isFight ? await fightSourceCheck(g.game, g.areaName, g, reports) : await sourceCheck(g.game, g.areaName, g.entryKind, live.entry, reports);
    console.log(`  source check: ${check.verdict} (${check.searches} searches; agree: ${check.agree.join(', ') || 'none'}) ${check.evidence}`);
    console.log(`  proposed: ${isFight ? describeEntry('fight', check.rewrite.fight) : check.rewrite.text ? `text: ${check.rewrite.text}` : `where: ${check.rewrite.where || '-'} | how: ${check.rewrite.how || '-'} | notes: ${check.rewrite.notes || '-'}`}`);
    const agreeing = check.agree.length ? check.agree.map((i) => reports[i - 1]) : [];
    const players = reporterCount(agreeing);
    // A moderator's confirmation (Discord) stands in for the 3 reporters; it never skips the source check.
    const enough = players >= MIN_PLAYERS || !!g.modConfirmed;
    let status: string;
    let rewrite: Rewrite = check.rewrite;
    let reviewer = { ok: false, reason: '' };
    if (check.verdict === 'contradicted') status = 'dismissed';
    else if (check.verdict === 'confirmed') {
      // The reviewer unavailable (its daily quota, an outage): nothing is decided, the entry is checked again next run.
      const rv = await (isFight ? fightReviewerCheck(g.game, g.areaName, check) : reviewerCheck(g.game, g.areaName, g.entryKind, live.entry, reports, check)).catch((e: any) => ({ ok: false, rewrite: {} as Rewrite, reason: `reviewer unavailable (${String(e?.message || e).slice(0, 80)})`, failed: true }));
      reviewer = rv;
      console.log(`  reviewer: ${rv.ok ? 'ok' : 'not ok'}: ${rv.reason}`);
      if (rv.ok) {
        status = 'verified';
        rewrite = isFight ? { fight: rv.rewrite.fight || check.rewrite.fight } : { where: rv.rewrite.where || check.rewrite.where, how: rv.rewrite.how || check.rewrite.how, notes: rv.rewrite.notes || check.rewrite.notes, text: rv.rewrite.text || check.rewrite.text };
      } else status = enough && !(rv as any).failed ? 'verified' : 'pending';
    } else status = enough ? 'verified' : agreeing.length && agreeing.length < reports.length ? 'disputed' : 'pending';
    const checked = status === 'verified' && check.verdict === 'confirmed' && reviewer.ok;
    // Not settled by sources, but 3+ players agree: their own wording (the latest agreeing report).
    if (status === 'verified' && !checked) {
      const plan = agreeing[agreeing.length - 1]?.claim || g.lastClaim;
      rewrite = isFight ? { fight: check.rewrite.fight ? { ...check.rewrite.fight, sources: undefined } : fromPlayers(g, plan) } : { where: plan };
    }
    console.log(`  decision: ${status}${status === 'verified' ? (checked ? ' (confirmed by sources)' : g.modConfirmed && players < MIN_PLAYERS ? ' (confirmed by a moderator)' : ` (${players} reporters agree)`) : ''}`);
    if (status === 'verified') {
      console.log(`  before: ${describeEntry(g.entryKind, live.entry)}`);
      console.log(`  after:  ${isFight ? describeEntry('fight', rewrite.fight) : describeEntry(g.entryKind, rewritten(g.entryKind, live.entry, rewrite, checked))}`);
    }
    if (status === 'verified') verified++;
    else if (status === 'dismissed') dismissed++;
    else waiting++;
    if (dryRun) continue;
    await gref.set({
      status, players, reportsChecked: reports.length,
      sourceCheck: { verdict: check.verdict, evidence: check.evidence, sources: check.sources, searches: check.searches, reviewer: reviewer.reason, at: Date.now() },
      ...(status === 'verified' ? { verifiedText: rewrite, checked } : {}),
      updatedAt: Date.now(),
    }, { merge: true });
    // Reports stay new (checked again next run) when the reviewer couldn't look.
    if (!/reviewer unavailable/.test(reviewer.reason)) for (const d of reportDocs) if (d.data().status === 'pending') await d.ref.update({ status: 'grouped' });
    if (status === 'dismissed') await announce(id, 'dismissed', g, 'Sources say the guide was right.');
    if (status === 'verified') {
      if (!toApply.has(g.gameKey)) toApply.set(g.gameKey, { game: g.game, groups: [] });
      toApply.get(g.gameKey)!.groups.push({ id, g, rewrite, checked });
    }
  }

  for (const d of retry) {
    const g: any = d.data();
    if (!g.verifiedText) continue;
    if (!toApply.has(g.gameKey)) toApply.set(g.gameKey, { game: g.game, groups: [] });
    toApply.get(g.gameKey)!.groups.push({ id: d.id, g, rewrite: g.verifiedText, checked: !!g.checked });
  }
  if (dryRun) toApply.clear();

  let applied = 0;
  for (const [gameKey, { game, groups }] of toApply) {
    for (const { id } of groups) await db().collection('correctionGroups').doc(id).set({ lastApplyTry: Date.now() }, { merge: true });
    const gate = await applyToGuide(gameKey, game, groups);
    console.log(`\n${game}: ${groups.length} correction(s) written into a staged copy. ${gate}`);
    if (/^Gate: passed/.test(gate)) {
      applied += groups.length;
      for (const { id, g } of groups) {
        await db().collection('correctionGroups').doc(id).set({ status: 'applied', appliedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
        await announce(id, 'applied', g);
      }
    }
  }
  console.log(`Done: corrections: ${verified} verified, ${applied} applied to guides, ${dismissed} dismissed, ${waiting} waiting for more reports or a decision; ${searches} searches used, estimated AI cost ≈ $${dollars.toFixed(2)}.`);
  setTimeout(() => process.exit(0), 1500);
}

main().catch((e) => {
  console.error('Corrections failed:', e?.message || e);
  process.exit(1);
});
