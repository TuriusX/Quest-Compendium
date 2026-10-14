// Answers each captured production request with Gemini 3.1 Pro (as production: thinking LOW) and Gemini 4 Argon (its
// default thinking), streamed so both time to first text and total time are measured (the app waits for the whole
// answer, so its "first word" is the total). "Ask" mode: an answer asking for a search (<qc-search/>) gets a second
// call with search, as production does. Results append to results.jsonl.  npx tsx replay.mts [ids...]
import fs from 'fs';
import { gemini } from '../../guides/common';
import { HarmBlockThreshold, HarmCategory, ThinkingLevel } from '@google/genai';
const g: any = gemini();
const PRICE: Record<string, { in: number; out: number }[]> = {
  'gemini-3.1-pro-preview': [{ in: 2, out: 12 }],
  'gemini-4-argon': [{ in: 2, out: 10 }, { in: 4, out: 20 }], // intro (to Nov 30), Dec 1
};
const SEARCH = 0.014;
const safety = [HarmCategory.HARM_CATEGORY_HATE_SPEECH, HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, HarmCategory.HARM_CATEGORY_HARASSMENT].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));
const caps = fs.readFileSync(process.env.CAPTURED || 'scratchpad/model-compare/captured.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const only = process.argv.slice(2);

async function once(model: string, c: any, withSearch: boolean) {
  const config: any = {
    systemInstruction: c.systemInstruction, safetySettings: safety, temperature: c.temperature,
    maxOutputTokens: 8192, ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
    ...(model.includes('pro') ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
  };
  const t0 = Date.now(); let first = 0; let text = ''; let last: any = null; let searches = 0;
  const stream = await g.models.generateContentStream({ model, contents: c.contents, config });
  for await (const ch of stream) {
    const t = ch?.text || '';
    if (t && !first) first = Date.now() - t0;
    text += t; last = ch;
    const q = ch?.candidates?.[0]?.groundingMetadata?.webSearchQueries;
    if (Array.isArray(q)) searches = Math.max(searches, q.length);
  }
  const u = last?.usageMetadata || {};
  return { text, firstMs: first, totalMs: Date.now() - t0, inTok: Number(u.promptTokenCount || 0), outTok: Number(u.candidatesTokenCount || 0) + Number(u.thoughtsTokenCount || 0), thinkTok: Number(u.thoughtsTokenCount || 0), searches };
}

async function answer(model: string, c: any) {
  let r = await once(model, c, c.withSearch);
  let calls = [r];
  if (c.searchMode === 'ask' && /<qc-search\s*\/?>/i.test(r.text)) {
    const r2 = await once(model, c, true);
    calls.push(r2);
    r = { ...r2, firstMs: r.totalMs + r2.firstMs, totalMs: r.totalMs + r2.totalMs };
  }
  const inTok = calls.reduce((n, x) => n + x.inTok, 0), outTok = calls.reduce((n, x) => n + x.outTok, 0), searches = calls.reduce((n, x) => n + x.searches, 0);
  const cost = PRICE[model].map((p) => (inTok * p.in + outTok * p.out) / 1e6);
  return { model, text: r.text, firstMs: r.firstMs, totalMs: r.totalMs, calls: calls.length, inTok, outTok, thinkTok: calls.reduce((n, x) => n + x.thinkTok, 0), searches, tokenCost: cost, searchCost: searches * SEARCH };
}

let total = 0;
for (const c of caps.filter((x) => !only.length || only.includes(x.id))) {
  for (const model of (process.env.MODELS || 'gemini-3.1-pro-preview,gemini-4-argon').split(',')) {
    try {
      const r = await answer(model, c);
      total += r.tokenCost[0] + r.searchCost;
      fs.appendFileSync(process.env.RESULTS || 'scratchpad/model-compare/results.jsonl', JSON.stringify({ id: c.id, ...r }) + '\n');
      console.log(`${c.id} ${model.padEnd(22)} first ${r.firstMs} ms, total ${r.totalMs} ms, in ${r.inTok} out ${r.outTok} (think ${r.thinkTok}), ${r.searches} search, $${r.tokenCost.map((x) => x.toFixed(4)).join(' / ')} + $${r.searchCost.toFixed(3)}`);
    } catch (e: any) {
      fs.appendFileSync(process.env.RESULTS || 'scratchpad/model-compare/results.jsonl', JSON.stringify({ id: c.id, model, error: String(e?.message || e).slice(0, 300) }) + '\n');
      console.log(`${c.id} ${model} ERROR ${String(e?.message || e).slice(0, 200)}`);
    }
  }
}
console.log(`spent this run (intro prices, searches billed): $${total.toFixed(3)}`);
process.exit(0);
