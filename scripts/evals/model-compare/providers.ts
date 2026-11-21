// Cross-provider comparison (owner-approved Nov 19 2026, $3 hard stop): the 20 captured production requests (the exact
// Pro prompts, search allowed) answered by
//   Fast tier: gemini-3.8-flash (thinking LOW, as Fast) vs claude-haiku-5-5 vs gpt-6-luna
//   Pro tier:  gemini-3.1-pro-preview (thinking LOW) vs claude-sonnet-5-5 vs gpt-6.2-sol
// each with its own provider's web search. Read-only: nothing live changes. Pro answers already in
// results-hydrogen.jsonl (same requests, Nov 18) are reused, not paid for again.
//   STOP_DOLLARS=3 npx tsx scripts/evals/model-compare/providers.ts
// Prices per 1M tokens (Nov 19 2026): Anthropic's and OpenAI's price pages; searches $0.01 (Claude, OpenAI),
// about $0.014 billed for Gemini's.
import 'dotenv/config';
import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { gemini } from '../../guides/common';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory, ThinkingLevel } from '@google/genai';
import { WHAT_NEXT_IN_FULL_V1 as WHAT_NEXT_IN_FULL, WHAT_NEXT_IN_FULL_V2, WHAT_NEXT_IN_FULL_V3 } from '../../../searchPolicy';

const DIR = 'scratchpad/model-compare';
const OUT = process.env.RESULTS || `${DIR}/results-providers.jsonl`;
const STOP = Number(process.env.STOP_DOLLARS || 0) || 3;
const PRICE: Record<string, { in: number; out: number; search: number; est: number }> = {
  'gemini-3.8-flash': { in: 0.75, out: 3.75, search: 0.014, est: 0.06 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, search: 0.01, est: 0.06 },
  'gpt-6-luna': { in: 0.1, out: 0.5, search: 0.01, est: 0.06 },
  'gemini-3.1-pro-preview': { in: 2, out: 12, search: 0.014, est: 0.14 },
  'claude-sonnet-5-5': { in: 2, out: 10, search: 0.01, est: 0.18 },
  // Nov 21 2026 "what next" test (Anthropic's model docs): Opus 5.5 $4/$20, Fable 5.2 $8/$40 per 1M.
  'claude-opus-5-5': { in: 4, out: 20, search: 0.01, est: 0.3 },
  'claude-fable-5-2': { in: 8, out: 40, search: 0.01, est: 0.5 },
  'gpt-6.2-sol': { in: 2, out: 10, search: 0.01, est: 0.18 },
  // OpenAI's flagship (Nov 21 2026 "what next" test): $8 in / $40 out per 1M (OpenAI pricing page, released Nov 17).
  'gpt-6.2-astra': { in: 8, out: 40, search: 0.01, est: 0.5 },
  // Gemini 4 (Nov 21 2026 "what next" test): launch prices; Carbon and Argon go to $4/$20 on Dec 1.
  'gemini-4-hydrogen': { in: 1.5, out: 7.5, search: 0.014, est: 0.2 },
  'gemini-4-neon': { in: 3, out: 15, search: 0.014, est: 0.35 },
  'gemini-4-carbon': { in: 2, out: 10, search: 0.014, est: 0.25 },
  'gemini-4-argon': { in: 2, out: 10, search: 0.014, est: 0.25 },
};
// A model can carry its thinking level: "gemini-4-neon@high" (Gemini; default low). High is estimated at twice the cost.
const baseOf = (m: string) => m.split('@')[0];
const levelOf = (m: string) => (m.split('@')[1] || 'low').toLowerCase();
const priceOf = (m: string) => { const p = PRICE[baseOf(m)]; return levelOf(m) === 'high' ? { ...p, est: p.est * 2 } : p; };
// Second run (Nov 19 2026, $6): FAST=gemini-3.8-flash,gpt-6-luna PRO=gemini-3.1-pro-preview,gpt-6.2-sol, then EXTRA
// (claude-haiku-5-5) if money is left.
const FAST = (process.env.FAST ?? 'gemini-3.8-flash,claude-haiku-5-5,gpt-6-luna').split(',').filter(Boolean);
const PRO = (process.env.PRO ?? 'gemini-3.1-pro-preview,claude-sonnet-5-5,gpt-6.2-sol').split(',').filter(Boolean);
const FAST_MODELS = ['gemini-3.8-flash', 'claude-haiku-5-5', 'gpt-6-luna'];
const EXTRA = (process.env.EXTRA || '').split(',').filter(Boolean);
// Answers from an earlier results file that are kept (not paid for again): REUSE=<file>. Ones that only asked for a
// search, or came back blank, are answered again.
if (process.env.REUSE && !fs.existsSync(OUT)) {
  const keep = fs.readFileSync(process.env.REUSE, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .filter((x) => !x.error && [...FAST, ...PRO, ...EXTRA].includes(x.model) && x.text.replace(/<qc-[\s\S]*?>/g, '').trim() && !/<qc-search\s*\/?>/i.test(x.text));
  fs.writeFileSync(OUT, keep.map((x) => JSON.stringify({ ...x, reused: true })).join('\n') + '\n');
}

// CAPTURED=<file> reads another capture file; MODE=roleplay takes the Immersive captures (ids "r1~roleplay") under their plain ids.
const MODE = process.env.MODE || 'standard';
const caps = fs.readFileSync(process.env.CAPTURED || `${DIR}/captured.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .map((c) => (MODE === 'standard' ? c : { ...c, id: String(c.id).endsWith(`~${MODE}`) ? String(c.id).slice(0, -MODE.length - 1) : '' }))
  .filter((c) => /^[rcsdn]\d+$/.test(c.id))
  // ROUTE=1: the live prompt's last rule (WHAT_NEXT_IN_FULL, Nov 21 2026), which these captures predate.
  // ROUTE=2: version 2 instead. Newer captures already end with version 1; it is taken out first so each runs once.
  .map((c) => {
    const base = String(c.systemInstruction).replace(`\n\n${WHAT_NEXT_IN_FULL}`, '');
    if (process.env.ROUTE === '1') return { ...c, systemInstruction: `${base}\n\n${WHAT_NEXT_IN_FULL}` };
    if (process.env.ROUTE === '2') return { ...c, systemInstruction: `${base}\n\n${WHAT_NEXT_IN_FULL_V2}` };
    if (process.env.ROUTE === '3') return { ...c, systemInstruction: `${base}\n\n${WHAT_NEXT_IN_FULL_V3}` };
    if (process.env.ROUTE === '0') return { ...c, systemInstruction: base };
    return c;
  });
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => !x.error).map((x) => `${x.id}|${x.model}`) : []);
const reusedPro = new Map<string, any>();
if (fs.existsSync(`${DIR}/results-hydrogen.jsonl`)) {
  for (const l of fs.readFileSync(`${DIR}/results-hydrogen.jsonl`, 'utf8').trim().split('\n')) {
    const x = JSON.parse(l);
    if (x.model === 'gemini-3.1-pro-preview' && x.text && !x.error) reusedPro.set(x.id, x);
  }
}

// ---- the request in each provider's shape (Gemini contents: role user/model, parts text/inlineData) ----
type Part = { text?: string; inlineData?: { mimeType: string; data: string } };
const turns = (c: any) => (c.contents as { role: string; parts: Part[] }[]).map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', parts: t.parts }));

// OWN_GEMINI=1 (owner OK, Nov 21 2026, "what next" test): a plain client whose searches don't draw on the pipeline's
// month share (it was used up); they still count against this run's hard stop (STOP_DOLLARS), never the players' share.
const g: any = process.env.OWN_GEMINI === '1' ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : gemini();
const safety = [HarmCategory.HARM_CATEGORY_HATE_SPEECH, HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, HarmCategory.HARM_CATEGORY_HARASSMENT].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));
const LEVELS: Record<string, ThinkingLevel> = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };
async function askGemini(spec: string, c: any) {
  const r = await g.models.generateContent({
    model: baseOf(spec), contents: c.contents,
    config: { systemInstruction: c.systemInstruction, safetySettings: safety, temperature: c.temperature, maxOutputTokens: 16384, thinkingConfig: { thinkingLevel: LEVELS[levelOf(spec)] || ThinkingLevel.LOW }, ...(c.withSearch ? { tools: [{ googleSearch: {} }] } : {}) },
  });
  const u = r.usageMetadata || {};
  return { text: String(r.text || ''), inTok: Number(u.promptTokenCount || 0), outTok: Number(u.candidatesTokenCount || 0) + Number(u.thoughtsTokenCount || 0), searches: (r.candidates?.[0]?.groundingMetadata?.webSearchQueries || []).length };
}

const anthropic = new Anthropic();
// Haiku's searches errored with the dynamic-filtering tool in the first run: the basic tool for it.
let haikuSearchTool = 'web_search_20250305';
async function askClaude(model: string, c: any) {
  const messages: Anthropic.MessageParam[] = turns(c).map((t) => ({
    role: t.role as 'user' | 'assistant',
    content: t.parts.map((p): Anthropic.ContentBlockParam => p.inlineData
      ? { type: 'image', source: { type: 'base64', media_type: p.inlineData.mimeType as 'image/jpeg', data: p.inlineData.data } }
      : { type: 'text', text: p.text || ' ' }),
  }));
  const tool = (type: string) => ({ type, name: 'web_search', max_uses: 5 }) as any;
  const base = { model, max_tokens: 16000, system: c.systemInstruction as string, output_config: { effort: 'low' } } as any;
  let inTok = 0, outTok = 0, searches = 0, text = '';
  for (let turn = 0; turn < 4; turn++) {
    let res: Anthropic.Message;
    try {
      res = await anthropic.messages.stream({ ...base, messages, ...(c.withSearch ? { tools: [tool(model.includes('haiku') ? haikuSearchTool : 'web_search_20260209')] } : {}) }).finalMessage();
    } catch (e) {
      // Haiku may only take the basic web search tool: once, then remember.
      if (model.includes('haiku') && haikuSearchTool !== 'web_search_20250305' && e instanceof Anthropic.BadRequestError) { haikuSearchTool = 'web_search_20250305'; turn--; continue; }
      throw e;
    }
    const u: any = res.usage;
    inTok += Number(u.input_tokens || 0) + Number(u.cache_read_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0);
    outTok += Number(u.output_tokens || 0);
    searches += Number(u.server_tool_use?.web_search_requests || 0);
    text += res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    if (res.stop_reason === 'refusal') text += `\n[refused: ${(res as any).stop_details?.category || ''}]`;
    if (res.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: res.content as any });
  }
  return { text, inTok, outTok, searches };
}

const openai = new OpenAI();
async function askOpenAI(model: string, c: any) {
  const input: any[] = turns(c).map((t) => t.role === 'assistant'
    ? { role: 'assistant', content: t.parts.map((p) => p.text || '').join('\n') }
    : { role: 'user', content: t.parts.map((p) => p.inlineData ? { type: 'input_image', image_url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`, detail: 'auto' } : { type: 'input_text', text: p.text || ' ' }) });
  const req: any = { model, instructions: c.systemInstruction, input, max_output_tokens: 16000, reasoning: { effort: 'low' }, ...(c.withSearch ? { tools: [{ type: 'web_search' }] } : {}) };
  let r: any;
  try { r = await openai.responses.create(req); }
  catch (e: any) {
    if (e?.status === 400 && /reasoning/i.test(String(e?.message))) { delete req.reasoning; r = await openai.responses.create(req); } else throw e;
  }
  const u = r.usage || {};
  return { text: String(r.output_text || ''), inTok: Number(u.input_tokens || 0), outTok: Number(u.output_tokens || 0), searches: (r.output || []).filter((o: any) => o.type === 'web_search_call').length };
}

const once = (model: string, c: any) => (model.startsWith('gemini') ? askGemini(model, c) : model.startsWith('claude') ? askClaude(baseOf(model), c) : askOpenAI(baseOf(model), c));
const blank = (t: string) => !t.replace(/(?:```[a-z]*\s*)?<qc-[a-z-]+[^>]*>[\s\S]*?<\/qc-[a-z-]+>(?:\s*```)?/gi, '').replace(/<qc-[a-z-]+[^>]*\/>/gi, '').trim();
// As the app does: an answer that only asks for a search ("ask" mode, <qc-search/>) is asked again with search on;
// a blank answer is asked once more.
async function ask(model: string, c: any) {
  const calls = [await once(model, c)];
  let last = calls[0];
  if (c.searchMode === 'ask' && /<qc-search\s*\/?>/i.test(last.text)) { last = await once(model, { ...c, withSearch: true }); calls.push(last); }
  if (blank(last.text)) { last = await once(model, calls.length > 1 ? { ...c, withSearch: true } : c); calls.push(last); }
  const sum = (k: 'inTok' | 'outTok' | 'searches') => calls.reduce((n, x) => n + x[k], 0);
  return { text: last.text, inTok: sum('inTok'), outTok: sum('outTok'), searches: sum('searches'), calls: calls.length };
}

// The hard stop covers every run into this results file, not just this one.
let total = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).reduce((n, x) => n + (x.reused ? 0 : x.error ? (PRICE[baseOf(x.model)]?.est || 0) / 2 : Number(x.cost || 0)), 0) : 0;
if (process.env.ONLY) caps.splice(0, caps.length, ...caps.filter((c) => process.env.ONLY!.split(',').includes(c.id)));
async function run(model: string, c: any) {
  if (done.has(`${c.id}|${model}`)) return true;
  if (model === 'gemini-3.1-pro-preview' && reusedPro.has(c.id)) {
    const x = reusedPro.get(c.id);
    fs.appendFileSync(OUT, JSON.stringify({ id: c.id, model, tier: 'pro', reused: true, text: x.text, ms: x.totalMs, inTok: x.inTok, outTok: x.outTok, searches: x.searches, cost: x.tokenCost[0] + x.searchCost }) + '\n');
    return true;
  }
  const p = priceOf(model);
  if (total + p.est > STOP) { console.log(`hard stop: $${total.toFixed(3)} spent, the next could pass $${STOP}`); return false; }
  const t0 = Date.now();
  try {
    const r = await ask(model, c);
    const cost = (r.inTok * p.in + r.outTok * p.out) / 1e6 + r.searches * p.search;
    total += cost;
    fs.appendFileSync(OUT, JSON.stringify({ id: c.id, model, tier: FAST_MODELS.includes(model) ? 'fast' : 'pro', calls: r.calls, text: r.text, ms: Date.now() - t0, inTok: r.inTok, outTok: r.outTok, searches: r.searches, cost }) + '\n');
    console.log(`${c.id} ${model.padEnd(23)} ${String(Date.now() - t0).padStart(6)} ms  in ${r.inTok} out ${r.outTok}  ${r.searches} search  $${cost.toFixed(4)}  (run $${total.toFixed(3)})`);
  } catch (e: any) {
    // A failed call may still be billed: count the estimate.
    total += p.est / 2;
    fs.appendFileSync(OUT, JSON.stringify({ id: c.id, model, error: String(e?.status || '') + ' ' + String(e?.message || e).slice(0, 300) }) + '\n');
    console.log(`${c.id} ${model} ERROR ${String(e?.status || '')} ${String(e?.message || e).slice(0, 200)}`);
  }
  return true;
}

// Fast tier on all 20 first (cheap), then the Pro tier, questions with a reused Pro answer first.
outer: for (const c of caps) for (const m of FAST) if (!(await run(m, c))) break outer;
const proOrder = [...caps.filter((c) => reusedPro.has(c.id)), ...caps.filter((c) => !reusedPro.has(c.id))];
outer2: for (const c of proOrder) for (const m of PRO) if (!(await run(m, c))) break outer2;
outer3: for (const c of caps) for (const m of EXTRA) if (!(await run(m, c))) break outer3;
console.log(`spent this run: $${total.toFixed(3)} (limit $${STOP})`);
process.exit(0);
