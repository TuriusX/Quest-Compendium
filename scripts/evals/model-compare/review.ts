// Part 2: the evidence check (claim review) on 10 RDR2 quest pages whose outcome is known (5 published = passed,
// 5 held = failed), with the current reviewer (gemini-3.1-pro-preview, thinking LOW as in claimCheck) and with Argon
// (default thinking), both through the Batch API (half price). Read-only: nothing is written to Firestore.
//   npx tsx review.mts submit    builds the exact requests claimCheck sends (captured, not sent) and submits two batches
//   npx tsx review.mts collect   waits for both, scores them like scoreClaims, compares with the known outcomes
import fs from 'fs';
import { ThinkingLevel } from '@google/genai';
import { claimPrompt as __claimPrompt } from '../../guides/claimCheck';
import { db, gemini } from '../../guides/common';
import { claimSlots, parseClaims, scoreClaims, trusted, evidenceText, type ClaimPage, type EvidencePack } from '../../guides/claimCheck';

const KEY = 'red-dead-redemption-2';
const FILE = 'scratchpad/model-compare/review-state.json';
const MODELS = { pro: 'gemini-3.1-pro-preview', argon: 'gemini-4-argon' };
const BATCH = { pro: { in: 1, out: 6 }, argon: [{ in: 1, out: 5 }, { in: 2, out: 10 }] };

/** quests.ts claimsOf, as the page is reviewed (copied: it isn't exported). */
function claimsOf(name: string, overview: string, q: any): ClaimPage {
  const services: string[] = [];
  if (q.giver) services.push(`"${name}" is given by ${q.giver}`);
  if (q.chapter) services.push(`"${name}" takes place in ${q.chapter}`);
  if (q.where) services.push(`"${name}" starts ${q.where}`);
  (q.rewards || []).forEach((r: string) => services.push(`Completing "${name}" rewards: ${r}`));
  (q.missables || []).forEach((r: string) => services.push(`In "${name}", this can be permanently missed: ${r}`));
  (q.goldMedal || []).forEach((r: string) => services.push(`A gold medal requirement for "${name}": ${r}`));
  (q.choices || []).forEach((c: any) => services.push(`In "${name}", choosing "${c.choice}" leads to: ${c.outcome}`));
  (q.parts || []).forEach((p: any) => {
    services.push(`"${p.name}" is a part of "${name}"`);
    if (p.chapter) services.push(`"${p.name}" takes place in ${p.chapter}`);
    if (p.where) services.push(`"${p.name}" starts ${p.where}`);
  });
  const steps = [{ title: 'Overview', text: overview }, ...(q.parts || []).flatMap((p: any) => p.steps.map((s: any) => ({ title: p.name, text: s.text })))];
  return { steps, entries: [], choices: [], advice: [], services, fights: [] } as ClaimPage;
}

/** Planted errors: false facts that contradict or aren't in the evidence (the page must then fail). */
function plant(q: any, name: string) {
  const x = JSON.parse(JSON.stringify(q));
  const notes: string[] = [];
  if (x.giver) { x.giver = 'Hosea Matthews'; notes.push('giver changed to Hosea Matthews'); }
  else { x.giver = 'Leopold Strauss'; notes.push('giver set to Leopold Strauss'); }
  x.chapter = x.chapter && /\d/.test(x.chapter) ? x.chapter.replace(/\d/, (d: string) => String((Number(d) % 6) + 1)) : 'Chapter 5';
  notes.push(`chapter changed to ${x.chapter}`);
  x.rewards = [...(x.rewards || []), 'the Legendary Buck Antler Trinket and $500'];
  notes.push('reward added: Legendary Buck Antler Trinket and $500');
  return { q: x, notes };
}

async function pages() {
  const snap = await db().collection('guideCompendium').doc(KEY).collection('entities').where('kind', '==', 'quest').get();
  const pub = snap.docs.map((d) => d.data() as any).filter((e) => e.status === 'published');
  // Both kinds (Stranger missions with steps, story missions), 10 pages: 5 as published, 5 with planted errors.
  const pick = [...pub.filter((e) => e.quest?.parts?.length).slice(0, 5), ...pub.filter((e) => !e.quest?.parts?.length).slice(0, 5)];
  return pick.map((e, i) => (i % 2 === 0 ? { e, known: 'passed', q: e.quest, notes: [] as string[] } : { e, known: 'failed', ...plant(e.quest, e.name) }));
}

if (process.argv[2] === 'submit') {
  const info: any = (await db().collection('guides').doc(KEY).get()).data() || {};
  const game = String(info.game || KEY);
  const meta: any[] = [];
  const reqs: any[] = [];
  for (const p of await pages()) {
    const pack = (await db().collection('evidencePacks').doc(`${KEY}__quest__${p.e.slug}`).get()).data() as EvidencePack | undefined;
    if (!pack?.evidence?.length) { console.log('no evidence:', p.e.name); continue; }
    const ev = trusted(pack);
    const slots = claimSlots(claimsOf(p.e.name, p.e.overview || '', p.q || {}));
    const before = reqs.length;
    // The same request claimCheck sends (60 claims a request).
    for (let i = 0; i < slots.length; i += 60) reqs.push({ text: __claimPrompt(game, p.e.name, slots.slice(i, i + 60), evidenceText(ev)) });
    meta.push({ slug: p.e.slug, name: p.e.name, known: p.known, planted: p.notes, requests: [before, reqs.length], slots, evIds: ev.evidence.map((x) => x.id) });
    console.log(`${p.e.name}: should ${p.known === 'passed' ? 'pass' : 'fail'}${p.notes.length ? ` (planted: ${p.notes.join('; ')})` : ''}, ${slots.length} claims`);
  }
  const real = gemini() as any;
  const config = (m: 'pro' | 'argon') => ({ responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 12000, ...(m === 'pro' ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}) });
  const jobs: any = {};
  for (const m of ['pro', 'argon'] as const) {
    const job = await real.batches.create({ model: MODELS[m], src: reqs.map((r) => ({ contents: [{ role: 'user', parts: [{ text: r.text }] }], config: config(m) })), config: { displayName: `qc-argon-eval-${m}` } });
    jobs[m] = job.name;
    console.log(m, 'batch', job.name, job.state);
  }
  fs.writeFileSync(FILE, JSON.stringify({ meta, jobs, n: reqs.length }, null, 1));
  process.exit(0);
}

if (process.argv[2] === 'collect') {
  const st = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const real = gemini() as any;
  const out: any = {};
  for (const m of ['pro', 'argon'] as const) {
    let job: any;
    for (let i = 0; i < 120; i++) {
      job = await real.batches.get({ name: st.jobs[m] });
      if (/SUCCEEDED|FAILED|CANCELLED|EXPIRED/.test(String(job.state))) break;
      await new Promise((r) => setTimeout(r, 30000));
    }
    console.log(m, job.state);
    out[m] = (job.dest?.inlinedResponses || []).map((x: any) => x.response || { error: x.error });
  }
  let cost = 0;
  const rows: any[] = [];
  for (const p of st.meta) {
    const row: any = { name: p.name, known: p.known, planted: p.planted };
    const ev = { evidence: p.evIds.map((id: string) => ({ id })) } as any;
    const verdicts: any = {};
    for (const m of ['pro', 'argon'] as const) {
      const resps = out[m].slice(p.requests[0], p.requests[1]);
      let all: any[] = [];
      let off = 0;
      for (const r of resps) {
        const chunk = p.slots.slice(off, off + 60); off += 60;
        all = all.concat(parseClaims(String(r?.candidates?.[0]?.content?.parts?.map((x: any) => x.text || '').join('') || ''), chunk, ev));
        const u = r?.usageMetadata || {};
        const outTok = Number(u.candidatesTokenCount || 0) + Number(u.thoughtsTokenCount || 0), inTok = Number(u.promptTokenCount || 0);
        const c = m === 'pro' ? (inTok * BATCH.pro.in + outTok * BATCH.pro.out) / 1e6 : (inTok * BATCH.argon[0].in + outTok * BATCH.argon[0].out) / 1e6;
        cost += c;
        row[`${m}Cost`] = (row[`${m}Cost`] || 0) + c;
        row[`${m}CostDec`] = (row[`${m}CostDec`] || 0) + (m === 'pro' ? c : (inTok * BATCH.argon[1].in + outTok * BATCH.argon[1].out) / 1e6);
      }
      const s = scoreClaims(all);
      row[m] = `${s.status} ${s.score} (${s.supported}/${s.total})`;
      verdicts[m] = all;
    }
    // Claims the two reviewers judge differently.
    row.diff = p.slots.map((sl: any, i: number) => ({ text: sl.text, pro: verdicts.pro[i]?.verdict, argon: verdicts.argon[i]?.verdict, argonWhy: verdicts.argon[i]?.why || '', proWhy: verdicts.pro[i]?.why || '' })).filter((d: any) => d.pro !== d.argon);
    rows.push(row);
    console.log(`${p.name} | known ${p.known} | Pro ${row.pro} | Argon ${row.argon} | ${row.diff.length} claim(s) judged differently`);
  }
  fs.mkdirSync('scratchpad/model-compare', { recursive: true });
  fs.writeFileSync('scratchpad/model-compare/review-results.json', JSON.stringify(rows, null, 1));
  console.log(`review batches: $${cost.toFixed(3)} (Argon at intro batch prices)`);
  process.exit(0);
}
