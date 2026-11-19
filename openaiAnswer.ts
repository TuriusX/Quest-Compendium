/**
 * Player answers from OpenAI (owner, Nov 19 2026: Pro = gpt-6.2-sol, Fast = gpt-6-luna; Gemini only as the backup).
 * The 40-question blind test (scripts/evals/model-compare/providers.ts): gpt-6.2-sol 1 definite mistake against Gemini
 * 3.1 Pro's 5.5, usefulness 4.5 against 3.9, same cost; gpt-6-luna 4 against Flash's 11 on typed questions at less than
 * half the cost.
 *
 * openaiAnswer() takes the same request the server builds for Gemini (system prompt, Gemini-style contents with
 * screenshots and voice) and returns a Gemini-shaped response, so everything after the answer (searches counted,
 * sources, logUsage, the tag extraction) works unchanged:
 *   { text, usageMetadata: { promptTokenCount, candidatesTokenCount, thoughtsTokenCount },
 *     candidates: [{ finishReason, groundingMetadata: { webSearchQueries, groundingChunks, groundingSupports } }] }
 * Voice questions: the gpt-6 models take no audio, so the recording is turned into text first (gpt-transcribe).
 * Which questions it answers: config/chatRouting (chatRouting.ts: openaiPro, openaiFast, openaiShare, openaiUids).
 */
import OpenAI, { toFile } from 'openai';

let client: OpenAI | null = null;
export const openaiReady = () => Boolean(process.env.OPENAI_API_KEY);
const oa = () => (client ||= new OpenAI({ maxRetries: 0 }));

export const OPENAI_TRANSCRIBE_MODEL = 'gpt-transcribe';

/** Added to the prompt for OpenAI models (the test's two slips: an area guessed from a screenshot, a language missed). */
export const OPENAI_RULES = `

[OPENAI ANSWER RULES]
- Answer in the language of the player's question (or the language they ask for), never another one.
- From a screenshot, name an area, town or region only when something on screen shows it (a sign, a landmark you can
  identify, the map, a quest name). Otherwise say what you can see and that you're not sure where it is, and ask, or
  give the answer for the likely places, each named as a guess.
- Use the hidden tags exactly as described above: they are read by the app and never shown to the player. Write each
  one whole, with its closing tag (<qc-place>…</qc-place>, <qc-points>…</qc-points>), after your answer text. When a
  screenshot is attached and on-screen pointers are asked for above, always add the <qc-points> block for the things
  your answer refers to that you can see.
- Don't put links or source citations in the answer text: the app lists the sources under the answer.`;

/** OpenAI's inline citations ("([site](https://…?utm_source=openai))"): the app lists sources under the answer. */
export function stripInlineCitations(text: string): string {
  return String(text || '')
    .replace(/\s*\(\[[^\]]*\]\(https?:\/\/[^)\s]*\)(?:\s*,?\s*\[[^\]]*\]\(https?:\/\/[^)\s]*\))*\)/g, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]*utm_source=openai[^)\s]*)\)/g, '$1')
    .replace(/[ \t]+([.,;:!?])/g, '$1');
}

type GPart = { text?: string; inlineData?: { mimeType: string; data: string } };
type GContent = { role?: string; parts: GPart[] };

/** A voice recording as text (gpt-transcribe). '' when it can't be read. */
export async function transcribe(part: { mimeType: string; data: string }, signal?: AbortSignal): Promise<{ text: string; seconds: number }> {
  const ext = /mp4|m4a/.test(part.mimeType) ? 'm4a' : /ogg/.test(part.mimeType) ? 'ogg' : /wav/.test(part.mimeType) ? 'wav' : /mpeg|mp3/.test(part.mimeType) ? 'mp3' : 'webm';
  const buf = Buffer.from(part.data, 'base64');
  const r: any = await oa().audio.transcriptions.create({ model: OPENAI_TRANSCRIBE_MODEL, file: await toFile(buf, `question.${ext}`, { type: part.mimeType }) }, { signal });
  // A rough length for the cost log: webm/opus voice is about 4 KB a second.
  return { text: String(r?.text || '').trim(), seconds: Math.max(1, Math.round(buf.length / 4000)) };
}

/** Gemini contents -> OpenAI Responses input (screenshots as images, voice as its transcript). */
async function toInput(contents: GContent[], signal?: AbortSignal, cache?: { text?: string; seconds?: number }): Promise<{ input: any[]; heard: string; audioSeconds: number }> {
  let heard = '', audioSeconds = 0;
  const input: any[] = [];
  for (const c of contents) {
    if (c.role === 'model') {
      input.push({ role: 'assistant', content: c.parts.map((p) => p.text || '').join('\n') || ' ' });
      continue;
    }
    const content: any[] = [];
    for (const p of c.parts) {
      if (p.inlineData && /^image\//.test(p.inlineData.mimeType)) {
        content.push({ type: 'input_image', image_url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`, detail: 'high' });
      } else if (p.inlineData && /^audio\//.test(p.inlineData.mimeType)) {
        let t: { text: string; seconds: number };
        if (cache && typeof cache.text === 'string') t = { text: cache.text, seconds: 0 };
        else {
          t = await transcribe(p.inlineData, signal);
          audioSeconds += t.seconds;
          if (cache) { cache.text = t.text; cache.seconds = t.seconds; }
        }
        heard = t.text;
        content.push({ type: 'input_text', text: t.text ? `[The player asked this out loud; what they said:] ${t.text}` : '[The player sent a voice question that could not be made out.]' });
      } else if (p.text) {
        content.push({ type: 'input_text', text: p.text });
      }
    }
    input.push({ role: 'user', content: content.length ? content : [{ type: 'input_text', text: ' ' }] });
  }
  return { input, heard, audioSeconds };
}

export type OpenAIAnswerOpts = {
  model: string;
  system: string;
  contents: GContent[];
  withSearch: boolean;
  /** 'low' as in the test (Pro thinks low on Gemini too). */
  effort?: 'low' | 'medium' | 'high';
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /** The request's voice transcript, kept between its calls (a retry doesn't transcribe again). */
  heard?: { text?: string; seconds?: number };
  /** Shown as it's written (the website): called with the whole reply so far after each piece. */
  onText?: (all: string) => void;
};

/** One answer from OpenAI, shaped like a Gemini response (see the top of this file). Throws on an API error. */
export async function openaiAnswer(o: OpenAIAnswerOpts): Promise<any> {
  const { input, heard, audioSeconds } = await toInput(o.contents, o.signal, o.heard);
  const req: any = {
    model: o.model,
    instructions: `${o.system}${OPENAI_RULES}`,
    input,
    max_output_tokens: o.maxOutputTokens || 16000,
    // Nothing kept at OpenAI past its abuse checks (no 30-day stored response): each answer stands alone.
    store: false,
    reasoning: { effort: o.effort || 'low' },
    ...(o.withSearch ? { tools: [{ type: 'web_search' }] } : {}),
  };
  let r: any;
  if (o.onText) {
    // Streamed: the pieces as they come, then the finished response (the same object a plain call returns).
    let all = '';
    const stream: any = await oa().responses.create({ ...req, stream: true }, { signal: o.signal });
    for await (const ev of stream) {
      if (ev?.type === 'response.output_text.delta' && ev.delta) {
        all += String(ev.delta);
        o.onText(stripInlineCitations(all));
      } else if (ev?.type === 'response.completed' || ev?.type === 'response.incomplete') {
        r = ev.response;
      } else if (ev?.type === 'response.failed' || ev?.type === 'error') {
        const err: any = new Error(String(ev?.response?.error?.message || ev?.message || 'OpenAI stream failed'));
        err.status = 500;
        throw err;
      }
    }
    if (!r) { const err: any = new Error('OpenAI stream ended early'); err.status = 502; throw err; }
  } else {
    r = await oa().responses.create(req, { signal: o.signal });
  }
  const out: any[] = Array.isArray(r?.output) ? r.output : [];
  const queries: string[] = [];
  for (const it of out) if (it?.type === 'web_search_call') queries.push(String(it?.action?.query || it?.action?.queries?.[0] || 'search'));
  // output_text is the SDK's shortcut on a plain reply; a streamed reply's final response only has the parts.
  const raw = typeof r?.output_text === 'string' && r.output_text
    ? r.output_text
    : out.filter((x) => x?.type === 'message').flatMap((x) => (x.content || []).filter((c: any) => c?.type === 'output_text').map((c: any) => String(c.text || ''))).join('');
  // A local test can keep the raw replies (never on Cloud Run).
  if (process.env.QC_OPENAI_RAW && !process.env.K_SERVICE) {
    try { (await import('node:fs')).appendFileSync(process.env.QC_OPENAI_RAW, JSON.stringify({ at: Date.now(), model: o.model, status: r?.status, raw, types: out.map((x) => x?.type) }) + '\n'); } catch {}
  }
  const text = stripInlineCitations(raw);
  // Cited pages: the sources line under the answer, and the parts of the answer a page backs up (fact reports).
  const chunks: { web: { uri: string; title: string } }[] = [];
  const supports: { segment: { text: string } }[] = [];
  for (const it of out) {
    if (it?.type !== 'message') continue;
    for (const c of it.content || []) {
      for (const a of c?.annotations || []) {
        if (a?.type !== 'url_citation' || !a.url) continue;
        if (!chunks.some((x) => x.web.uri === a.url)) chunks.push({ web: { uri: String(a.url), title: String(a.title || '') } });
        const seg = typeof a.start_index === 'number' && typeof a.end_index === 'number' ? String(c.text || '').slice(a.start_index, a.end_index) : '';
        if (seg) supports.push({ segment: { text: seg } });
      }
    }
  }
  const u = r?.usage || {};
  const reasoning = Number(u.output_tokens_details?.reasoning_tokens || 0);
  return {
    text,
    model: o.model,
    heard,
    audioSeconds,
    status: r?.status,
    usageMetadata: {
      promptTokenCount: Number(u.input_tokens || 0),
      // OpenAI's output count includes the reasoning: split as Gemini reports it (answer + thoughts).
      candidatesTokenCount: Math.max(0, Number(u.output_tokens || 0) - reasoning),
      thoughtsTokenCount: reasoning,
      cachedContentTokenCount: Number(u.input_tokens_details?.cached_tokens || 0),
    },
    candidates: [{
      finishReason: r?.status === 'incomplete' ? String(r?.incomplete_details?.reason || 'MAX_TOKENS').toUpperCase() : 'STOP',
      groundingMetadata: { webSearchQueries: queries, groundingChunks: chunks, groundingSupports: supports },
    }],
  };
}

/** Errors worth handing straight to the Gemini backup (overloaded, rate limit, server or network trouble). */
export function openaiUnavailable(e: any): boolean {
  const s = Number(e?.status || 0);
  return s === 429 || s >= 500 || /ECONN|ETIMEDOUT|fetch failed|socket|network|timed out|timeout/i.test(String(e?.message || '')) || e?.name === 'APIConnectionTimeoutError';
}
