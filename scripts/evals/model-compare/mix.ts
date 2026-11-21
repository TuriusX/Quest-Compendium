// "Ultimate answer" test (owner OK, Nov 21 2026: "as much money as you need"; hard stop STOP_DOLLARS, default $10).
// The 12 "what next" captures (captured-next.jsonl), three ways of combining Neon low and gpt-6.2-sol:
//   sol+route  sol alone with a stronger "what next in full" rule added to the prompt (one call)
//   neon>check Neon's draft (the round 1 and round 2 answers, already paid for), then sol checks the facts only
//   neon>sol   Neon's draft, then sol writes the final reply from it (keeps the route, fixes, trims, fills gaps)
// Times for the two-step setups are Neon's draft time plus sol's. Read-only: nothing live changes.
//   OWN_GEMINI not needed (no Gemini calls). npx tsx scripts/evals/model-compare/mix.ts
import 'dotenv/config';
import fs from 'fs';
import OpenAI from 'openai';

const DIR = 'scratchpad/model-compare';
const OUT = process.env.RESULTS || `${DIR}/results-mix.jsonl`;
const STOP = Number(process.env.STOP_DOLLARS || 0) || 10;
const SOL = { in: 2, out: 10, search: 0.01 };
const caps = fs.readFileSync(`${DIR}/captured-next.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((c) => /^n\d+$/.test(c.id));
const drafts: { id: string; model: string; round: number; text: string; ms: number; cost: number }[] = [];
[['results-next.jsonl', 1], ['results-next-r2.jsonl', 2]].forEach(([f, round]) => {
  for (const l of fs.readFileSync(`${DIR}/${f}`, 'utf8').trim().split('\n')) {
    const x = JSON.parse(l);
    if (['gemini-4-neon', 'gemini-4-hydrogen'].includes(x.model) && !x.error && x.text) drafts.push({ id: x.id, model: x.model, round: round as number, text: x.text, ms: x.ms, cost: x.cost });
  }
});
// Flash and luna drafts: round 1 from round 2 / round 3 of the model test, round 2 from results-next-r4.
[['results-next-r2.jsonl', 1, 'gemini-3.8-flash'], ['results-next-r3.jsonl', 1, 'gpt-6-luna'], ['results-next-r4.jsonl', 2, 'gemini-3.8-flash'], ['results-next-r4.jsonl', 2, 'gpt-6-luna']].forEach(([f, round, m]) => {
  if (!fs.existsSync(`${DIR}/${f}`)) return;
  for (const l of fs.readFileSync(`${DIR}/${f}`, 'utf8').trim().split('\n')) {
    const x = JSON.parse(l);
    if (x.model === m && !x.error && x.text) drafts.push({ id: x.id, model: x.model, round: round as number, text: x.text, ms: x.ms, cost: x.cost });
  }
});

export const ROUTE_PLUS = `[WHAT NEXT, IN FULL]
When the player asks what to do next or where to go, cover the whole stretch ahead, not just the next step:
1. Everything worth doing nearby right now, judged from their save and where they are: companions or allies to recruit, side quests that open here, merchants, and gear or items that are easy to miss on the way.
2. The fights, traps or dangers between them and the next objective, and how to handle or avoid them.
3. The main objective and where it is.
Treat their save as fact. Keep it tight: short groups or numbered steps, one or two lines each.`;

const CHECK = `(App note, not from the player.) Your previous reply is a draft. Check every specific game fact in it (names, places, numbers, quest order, what unlocks what, rewards) and use web search for anything you are not sure of. Then give the full reply to the player again with only the wrong facts fixed or removed. Keep its order, coverage, length, language, formatting and any <qc-...> tags as they are, and add nothing new. Output only the reply.`;
const REWRITE = `(App note, not from the player.) Your previous reply is a draft. Write the best final reply to the player from it: keep its route and everything useful, fix anything wrong (check doubtful facts with web search), cut padding, and add anything important nearby that it missed. Same language, formatting and <qc-...> tags as the draft. Output only the reply.`;
// Second pass (speed test): the reply always in the player's language (the draft may have slipped into English).
const REWRITE2 = REWRITE.replace('Same language, formatting', "Write it in the language the player wrote their question in, even if the draft is in another language. Same formatting");

const openai = new OpenAI();
type Part = { text?: string; inlineData?: { mimeType: string; data: string } };
function input(c: any, extra: { draft: string; task: string } | null) {
  const msgs: any[] = (c.contents as { role: string; parts: Part[] }[]).map((t) => t.role === 'model'
    ? { role: 'assistant', content: t.parts.map((p) => p.text || '').join('\n') }
    : { role: 'user', content: t.parts.map((p) => p.inlineData ? { type: 'input_image', image_url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`, detail: 'auto' } : { type: 'input_text', text: p.text || ' ' }) });
  if (extra) msgs.push({ role: 'assistant', content: extra.draft }, { role: 'user', content: [{ type: 'input_text', text: extra.task }] });
  return msgs;
}
// Third pass ("more" set): the draft goes in as hidden notes in a user turn, never as the model's own words (a rewrite
// that saw the draft as its earlier reply once said "I had the quest order wrong").
const NOTES = (draft: string) => `(App note, hidden from the player.) Notes from a quick first draft of the reply. They may contain mistakes.

<draft-notes>
${draft}
</draft-notes>

Write the reply to the player's last message. Use the notes' route and details where they are right, check doubtful facts with web search, fix or drop anything wrong, add anything important nearby that they missed, and cut padding. Never mention the notes, a draft, corrections or earlier mistakes. Write in the language of the player's question. Keep the notes' formatting and any <qc-...> tags. Output only the reply.`;
function inputNotes(c: any, draft: string) {
  const msgs = input(c, null);
  msgs.push({ role: 'user', content: [{ type: 'input_text', text: NOTES(draft) }] });
  return msgs;
}
const PRICES: Record<string, { in: number; out: number; search: number }> = { 'gpt-6.2-sol': SOL, 'gpt-6-luna': { in: 0.1, out: 0.5, search: 0.01 }, 'gpt-6.2-astra': { in: 8, out: 40, search: 0.01 } };
async function sol(instructions: string, inp: any[], search: boolean, model = 'gpt-6.2-sol') {
  const P = PRICES[model];
  const r: any = await openai.responses.create({ model, instructions, input: inp, max_output_tokens: 16000, reasoning: { effort: 'low' }, ...(search ? { tools: [{ type: 'web_search' }] } : {}) } as any);
  const u = r.usage || {};
  const searches = (r.output || []).filter((o: any) => o.type === 'web_search_call').length;
  return { text: String(r.output_text || ''), inTok: Number(u.input_tokens || 0), outTok: Number(u.output_tokens || 0), searches, cost: (Number(u.input_tokens || 0) * P.in + Number(u.output_tokens || 0) * P.out) / 1e6 + searches * P.search };
}

const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => !x.error).map((x) => `${x.id}|${x.model}|${x.round}`) : []);
let total = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).reduce((n, x) => n + Number(x.cost || 0) - Number(x.draftCost || 0), 0) : 0;
const EST = 0.15;
async function job(id: string, model: string, round: number, f: () => Promise<any>) {
  if (done.has(`${id}|${model}|${round}`)) return true;
  if (total + EST > STOP) { console.log(`hard stop at $${total.toFixed(3)}`); return false; }
  try {
    const r = await f();
    total += r.newCost;
    fs.appendFileSync(OUT, JSON.stringify({ id, model, round, ...r }) + '\n');
    console.log(`${id} r${round} ${model.padEnd(11)} ${String(Math.round(r.ms / 1000)).padStart(4)} s  ${r.searches} search  $${r.newCost.toFixed(4)}  (run $${total.toFixed(3)})`);
  } catch (e: any) {
    total += EST / 2;
    fs.appendFileSync(OUT, JSON.stringify({ id, model, round, error: String(e?.status || '') + ' ' + String(e?.message || e).slice(0, 300) }) + '\n');
    console.log(`${id} ${model} ERROR ${String(e?.message || e).slice(0, 200)}`);
  }
  return true;
}

const tasks: (() => Promise<boolean>)[] = [];
const SET = (process.env.SET || 'first').split(',');
// "routed" set (Noah's fairness point, Nov 21): the two best mixes again with the route rule in BOTH steps. Drafts
// made with ROUTE=1 (results-routed-r1/r2), rewrites with ROUTE_PLUS added to the prompt.
const routedDrafts: typeof drafts = [];
[['results-routed-r1.jsonl', 1], ['results-routed-r2.jsonl', 2]].forEach(([f, round]) => {
  if (!fs.existsSync(`${DIR}/${f}`)) return;
  for (const l of fs.readFileSync(`${DIR}/${f}`, 'utf8').trim().split('\n')) {
    const x = JSON.parse(l);
    if (!x.error && x.text) routedDrafts.push({ id: x.id, model: x.model, round: round as number, text: x.text, ms: x.ms, cost: x.cost });
  }
});
for (const c of caps) if (SET.includes('routed')) {
  for (const round of [1, 2]) {
    for (const [model, drafter, rewriter] of [['neon>sol+R', 'gemini-4-neon', 'gpt-6.2-sol'], ['flash>astra+R', 'gemini-3.8-flash', 'gpt-6.2-astra']] as const) {
      const d = routedDrafts.find((x) => x.id === c.id && x.round === round && x.model === drafter);
      if (!d) continue;
      tasks.push(() => job(c.id, model, round, async () => {
        const sys = `${c.systemInstruction}\n\n${ROUTE_PLUS}`;
        const t0 = Date.now(); let r = await sol(sys, inputNotes(c, d.text), true, rewriter);
        if (!r.text.replace(/<qc-[\s\S]*?>/g, '').trim()) { const r2 = await sol(sys, inputNotes(c, d.text), true, rewriter); r = { ...r2, cost: r.cost + r2.cost, searches: r.searches + r2.searches }; }
        return { text: r.text, ms: d.ms + (Date.now() - t0), solMs: Date.now() - t0, searches: r.searches, draftCost: d.cost, cost: d.cost + r.cost, newCost: r.cost };
      }));
    }
  }
}
// "lunaroute" set: the free tier's luna with the same stronger route rule as sol+route.
for (const c of caps) if (SET.includes('lunaroute')) {
  for (const round of [1, 2]) {
    tasks.push(() => job(c.id, 'luna+route', round, async () => {
      const t0 = Date.now(); const r = await sol(`${c.systemInstruction}\n\n${ROUTE_PLUS}`, input(c, null), !!c.withSearch, 'gpt-6-luna');
      return { text: r.text, ms: Date.now() - t0, searches: r.searches, cost: r.cost, newCost: r.cost };
    }));
  }
}
// "astra" set: OpenAI's flagship as the rewriter over the quick drafters.
for (const c of caps) if (SET.includes('astra')) {
  for (const round of [1, 2]) {
    for (const [model, drafter] of [['hyd>astra', 'gemini-4-hydrogen'], ['luna>astra', 'gpt-6-luna'], ['flash>astra', 'gemini-3.8-flash']] as const) {
      const d = drafts.find((x) => x.id === c.id && x.round === round && x.model === drafter);
      if (!d) continue;
      tasks.push(() => job(c.id, model, round, async () => {
        const t0 = Date.now(); let r = await sol(c.systemInstruction, inputNotes(c, d.text), true, 'gpt-6.2-astra');
        if (!r.text.replace(/<qc-[\s\S]*?>/g, '').trim()) { const r2 = await sol(c.systemInstruction, inputNotes(c, d.text), true, 'gpt-6.2-astra'); r = { ...r2, cost: r.cost + r2.cost, searches: r.searches + r2.searches }; }
        return { text: r.text, ms: d.ms + (Date.now() - t0), solMs: Date.now() - t0, searches: r.searches, draftCost: d.cost, cost: d.cost + r.cost, newCost: r.cost };
      }));
    }
  }
}
for (const c of caps) if (SET.includes('more') && !SET.includes('astra')) {
  for (const round of [1, 2]) {
    for (const [model, drafter, rewriter, search] of [
      ['neon>sol3', 'gemini-4-neon', 'gpt-6.2-sol', true], ['hyd>sol-q3', 'gemini-4-hydrogen', 'gpt-6.2-sol', false],
      ['luna>sol3', 'gpt-6-luna', 'gpt-6.2-sol', true], ['flash>sol3', 'gemini-3.8-flash', 'gpt-6.2-sol', true],
      ['hyd>luna3', 'gemini-4-hydrogen', 'gpt-6-luna', true],
    ] as const) {
      if (SET.includes('astra')) continue;
      const d = drafts.find((x) => x.id === c.id && x.round === round && x.model === drafter);
      if (!d) continue;
      tasks.push(() => job(c.id, model, round, async () => {
        const t0 = Date.now(); let r = await sol(c.systemInstruction, inputNotes(c, d.text), search, rewriter);
        // As the app does: a blank reply is asked once more.
        if (!r.text.replace(/<qc-[\s\S]*?>/g, '').trim()) { const r2 = await sol(c.systemInstruction, inputNotes(c, d.text), search, rewriter); r = { ...r2, cost: r.cost + r2.cost, searches: r.searches + r2.searches }; }
        return { text: r.text, ms: d.ms + (Date.now() - t0), solMs: Date.now() - t0, searches: r.searches, draftCost: d.cost, cost: d.cost + r.cost, newCost: r.cost };
      }));
    }
  }
}
for (const c of caps) if (SET.includes('speed')) {
  for (const round of [1, 2]) {
    // hyd>sol: Hydrogen low's draft (13 s) instead of Neon's; neon>sol-q: sol rewrites without web search (quicker).
    for (const [model, drafter, search] of [['hyd>sol', 'gemini-4-hydrogen', true], ['neon>sol-q', 'gemini-4-neon', false], ['neon>sol2', 'gemini-4-neon', true]] as const) {
      const d = drafts.find((x) => x.id === c.id && x.round === round && x.model === drafter);
      if (!d) continue;
      tasks.push(() => job(c.id, model, round, async () => {
        const t0 = Date.now(); const r = await sol(c.systemInstruction, input(c, { draft: d.text, task: REWRITE2 }), search);
        return { text: r.text, ms: d.ms + (Date.now() - t0), solMs: Date.now() - t0, searches: r.searches, draftCost: d.cost, cost: d.cost + r.cost, newCost: r.cost };
      }));
    }
  }
}
for (const c of caps) if (SET.includes('first')) {
  for (const round of [1, 2]) {
    tasks.push(() => job(c.id, 'sol+route', round, async () => {
      const t0 = Date.now(); const r = await sol(`${c.systemInstruction}\n\n${ROUTE_PLUS}`, input(c, null), !!c.withSearch);
      return { text: r.text, ms: Date.now() - t0, searches: r.searches, cost: r.cost, newCost: r.cost };
    }));
    const d = drafts.find((x) => x.id === c.id && x.round === round && x.model === 'gemini-4-neon');
    if (!d) continue;
    for (const [model, task] of [['neon>check', CHECK], ['neon>sol', REWRITE]] as const) {
      tasks.push(() => job(c.id, model, round, async () => {
        const t0 = Date.now(); const r = await sol(c.systemInstruction, input(c, { draft: d.text, task }), true);
        return { text: r.text, ms: d.ms + (Date.now() - t0), solMs: Date.now() - t0, searches: r.searches, draftCost: d.cost, cost: d.cost + r.cost, newCost: r.cost };
      }));
    }
  }
}
// Three at a time.
let i = 0; let stop = false;
await Promise.all([0, 1, 2].map(async () => { while (!stop && i < tasks.length) { const t = tasks[i++]; if (!(await t())) stop = true; } }));
console.log(`spent this run: $${total.toFixed(3)} (limit $${STOP})`);
process.exit(0);
