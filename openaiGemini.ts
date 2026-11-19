/**
 * Gemini requests answered by OpenAI (owner, Nov 19 2026: "switch most of it ... so I'm not managing the cost of two
 * APIs"). The guide pipeline calls Gemini through one wrapper (scripts/guides/common.ts gemini()); with
 * PIPELINE_OPENAI=1 that wrapper hands each request here, and the reply comes back shaped like Gemini's, so the
 * pipeline's code (searches counted, cited sites, the evidence method's supported sentences, JSON parsing, costs) works
 * unchanged:
 *   text, candidates[0].content.parts, candidates[0].finishReason,
 *   candidates[0].groundingMetadata { webSearchQueries, groundingChunks [{ web: { uri, title, domain } }],
 *     groundingSupports [{ segment: { text }, groundingChunkIndices }] },
 *   usageMetadata { promptTokenCount, candidatesTokenCount, thoughtsTokenCount }, model (the OpenAI model, for prices).
 *
 * Models: Gemini Pro -> gpt-6.2-sol; Flash and Flash-Lite -> gpt-6-luna (the Nov 19 tests: fewer mistakes, the
 * reviewer as good or better). What OpenAI can't do stays on Gemini (openaiFor returns ''): image output (upscales),
 * speech, video by link, and prompts asking for Gemini's own box_2d boxes.
 */
import OpenAI from 'openai';
import { stripInlineCitations } from './openaiAnswer';

let client: OpenAI | null = null;
const oa = () => (client ||= new OpenAI({ maxRetries: 1 }));

export const OPENAI_FOR: Record<string, string> = {
  'gemini-3.1-pro-preview': 'gpt-6.2-sol',
  'gemini-3.8-flash': 'gpt-6-luna',
  'gemini-3.1-flash-lite': 'gpt-6-luna',
};

/** The OpenAI model for a Gemini request, or '' to keep it on Gemini. */
export function openaiFor(request: any): string {
  if (!process.env.OPENAI_API_KEY) return '';
  const model = OPENAI_FOR[String(request?.model || '')];
  if (!model) return '';
  const cfg = request?.config || {};
  if (cfg.responseModalities || cfg.imageConfig || cfg.speechConfig) return '';
  const parts = partsOf(request?.contents);
  if (parts.some((p: any) => p?.fileData || (p?.inlineData && !/^image\//.test(String(p.inlineData.mimeType || ''))))) return '';
  if (parts.some((p: any) => typeof p?.text === 'string' && /box_2d/.test(p.text))) return '';
  return model;
}

/** Any Gemini `contents` shape as a flat list of parts. */
function partsOf(contents: any): any[] {
  if (contents == null) return [];
  if (typeof contents === 'string') return [{ text: contents }];
  if (Array.isArray(contents)) return contents.flatMap((c) => (c && typeof c === 'object' && Array.isArray(c.parts) ? c.parts : typeof c === 'string' ? [{ text: c }] : [c]));
  if (Array.isArray(contents.parts)) return contents.parts;
  return [contents];
}

/** Gemini contents -> Responses input (turns kept; images as images). */
function inputOf(contents: any): any[] {
  const turns: { role: string; parts: any[] }[] = Array.isArray(contents) && contents.some((c) => c && typeof c === 'object' && Array.isArray(c.parts))
    ? contents.map((c: any) => ({ role: c.role === 'model' ? 'assistant' : 'user', parts: c.parts || [] }))
    : [{ role: 'user', parts: partsOf(contents) }];
  return turns.map((t) => t.role === 'assistant'
    ? { role: 'assistant', content: t.parts.map((p) => p?.text || '').join('\n') || ' ' }
    : { role: 'user', content: t.parts.map((p) => p?.inlineData ? { type: 'input_image', image_url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`, detail: 'high' } : { type: 'input_text', text: String(p?.text ?? '') || ' ' }) });
}

const systemOf = (s: any): string => (typeof s === 'string' ? s : s && Array.isArray(s.parts) ? s.parts.map((p: any) => p?.text || '').join('\n') : '');
const EFFORT: Record<string, 'low' | 'medium' | 'high'> = { MINIMAL: 'low', LOW: 'low', MEDIUM: 'medium', HIGH: 'high' };
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/**
 * The sentence a citation backs: OpenAI marks where a citation sits (the link after a sentence), not the sentence, so
 * the supported text is what comes before it, back to the previous citation, line break or sentence end.
 */
function citedSentence(text: string, start: number, prevEnd: number): string {
  const before = text.slice(Math.max(prevEnd, 0), start);
  const lineStart = before.lastIndexOf('\n');
  let s = lineStart >= 0 ? before.slice(lineStart + 1) : before;
  // More than one sentence before the citation on the same line: the last one or two (a citation backs what's next to it).
  const sentences = s.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  if (sentences.length > 2) s = sentences.slice(-1).join(' ');
  return stripInlineCitations(s).replace(/^[*\-\s#\d.)]+/, '').trim();
}

/** One Gemini-style generateContent request, answered by OpenAI. Throws the OpenAI error as it is. */
export async function openaiGenerate(request: any, model = openaiFor(request)): Promise<any> {
  const cfg = request?.config || {};
  const wantsJson = cfg.responseMimeType === 'application/json';
  const search = (cfg.tools || []).some((t: any) => t && (t.googleSearch || t.googleSearchRetrieval));
  const sys = systemOf(cfg.systemInstruction);
  const instructions = [sys, wantsJson ? 'Reply with JSON only, exactly in the format asked for: no other text, no code fences. When a list ([...]) is asked for, reply with the list itself, never an object around it.' : '', search ? 'Check several different sites (the game\'s wikis and the major guide sites), and cite the page each fact comes from right after that fact. Do not add links or citations beyond the ones the search tool adds.' : ''].filter(Boolean).join('\n\n');
  // At most 3 minutes a call unless the request sets its own (a searched call hung for 25 minutes on Nov 19 2026); a
  // timed-out call goes to Gemini (openaiUnavailable).
  const timeout = Number(cfg.httpOptions?.timeout || request?.httpOptions?.timeout || 0) || 180_000;
  const r: any = await oa().responses.create({
    model,
    ...(instructions ? { instructions } : {}),
    input: inputOf(request?.contents),
    // Gemini's cap counts the answer (and thinking); reasoning counts against OpenAI's cap, so a little more room.
    max_output_tokens: Math.max(2000, Math.round((Number(cfg.maxOutputTokens) || 8192) * 1.25)),
    reasoning: { effort: EFFORT[String(cfg.thinkingConfig?.thinkingLevel || '').toUpperCase()] || 'low' },
    store: false,
    ...(search ? { tools: [{ type: 'web_search' }] } : {}),
  } as any, { timeout, maxRetries: 0 });
  const out: any[] = Array.isArray(r?.output) ? r.output : [];
  const queries: string[] = out.filter((x) => x?.type === 'web_search_call').map((x) => String(x?.action?.query || x?.action?.queries?.[0] || 'search'));
  const chunks: { web: { uri: string; title: string; domain: string } }[] = [];
  const supports: { segment: { text: string }; groundingChunkIndices: number[] }[] = [];
  let raw = '';
  for (const m of out.filter((x) => x?.type === 'message')) {
    for (const c of (m.content || []).filter((c: any) => c?.type === 'output_text')) {
      const text = String(c.text || '');
      let prevEnd = 0;
      const anns = (c.annotations || []).filter((a: any) => a?.type === 'url_citation' && a.url).sort((a: any, b: any) => a.start_index - b.start_index);
      for (const a of anns) {
        const host = hostOf(a.url);
        let idx = chunks.findIndex((x) => x.web.uri === a.url);
        if (idx < 0) { chunks.push({ web: { uri: String(a.url), title: host || String(a.title || ''), domain: host } }); idx = chunks.length - 1; }
        const seg = citedSentence(text, Number(a.start_index) || 0, prevEnd);
        if (seg.length >= 12) {
          const same = supports.find((s) => s.segment.text === seg);
          if (same) { if (!same.groundingChunkIndices.includes(idx)) same.groundingChunkIndices.push(idx); }
          else supports.push({ segment: { text: seg }, groundingChunkIndices: [idx] });
        }
        prevEnd = Math.max(prevEnd, Number(a.end_index) || 0);
      }
      raw += text;
    }
  }
  let text = stripInlineCitations(raw);
  if (wantsJson) text = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const u = r?.usage || {};
  const reasoning = Number(u.output_tokens_details?.reasoning_tokens || 0);
  return {
    text,
    model,
    usageMetadata: {
      promptTokenCount: Number(u.input_tokens || 0),
      candidatesTokenCount: Math.max(0, Number(u.output_tokens || 0) - reasoning),
      thoughtsTokenCount: reasoning,
      cachedContentTokenCount: Number(u.input_tokens_details?.cached_tokens || 0),
    },
    candidates: [{
      content: { role: 'model', parts: [{ text }] },
      finishReason: r?.status === 'incomplete' ? 'MAX_TOKENS' : 'STOP',
      ...(search || chunks.length ? { groundingMetadata: { webSearchQueries: queries, groundingChunks: chunks, groundingSupports: supports } } : {}),
    }],
  };
}
