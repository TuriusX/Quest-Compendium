/**
 * AI cost log. Every Gemini call logs one line with its token counts and an estimated cost, e.g.
 *   [usage] chat gemini-3.8-flash in=6120 (image 1088) out=880 thinking=410 searches=1 ≈ $0.0094 (+$0.014 search)
 * so the cost of each feature (and each question) can be read straight from the server logs.
 *
 * Rates: Google's Gemini API price list (ai.google.dev/gemini-api/docs/pricing, Sept 2026), per million tokens.
 * Gemini 3.8 Flash is at introductory prices through Dec 31, 2026; they double on Jan 1, 2027 ($1.50 / $7.50).
 * Output includes thinking. Search grounding: 5,000 free searches a month across the Gemini 3 family, then $14 per
 * 1,000 searches (one question can run several). Unknown models log tokens without a price.
 */
const RATES: Record<string, { input: number; output: number }> = {
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.1-pro-preview': { input: 2.0, output: 12.0 },
  'gemini-3.1-flash-tts-preview': { input: 0.5, output: 20.0 }, // audio output (rate from the project's billing report)
  'gemini-3.8-flash-tts': { input: 0.5, output: 9.0 }, // audio output, per Google's price list
  // gemini-3.8-flash-lite-tts: priced below Flash TTS; logged without an estimate until its rate is confirmed
};
const SEARCH_COST = 14 / 1000; // after the monthly free allowance
/**
 * What the pipeline counts a search as: billed in full (no free allowance assumed, since the project's credits ran out
 * and the free 5,000 are shared with players). PIPELINE_SEARCH_DOLLARS overrides it.
 */
export const SEARCH_DOLLARS = Number.isFinite(Number(process.env.PIPELINE_SEARCH_DOLLARS)) && process.env.PIPELINE_SEARCH_DOLLARS ? Number(process.env.PIPELINE_SEARCH_DOLLARS) : SEARCH_COST;
/** Prompts over 200k tokens are billed at a higher rate on Pro (input and output). */
const LONG_PROMPT = 200_000;
const LONG_RATES: Record<string, { input: number; output: number }> = {
  'gemini-3.1-pro-preview': { input: 4.0, output: 18.0 },
};
export const BANNER_IMAGE_COST = 0.0336; // one 1K image from the Flash-Lite image model

/** Estimated cost of one response in dollars (tokens only, searches excluded), or null for a model without a known rate. */
export function estimateCost(model: string, response: any): number | null {
  const u = response?.usageMetadata;
  if (!u || !RATES[model]) return null;
  const input = Number(u.promptTokenCount ?? 0);
  const rate = (input > LONG_PROMPT && LONG_RATES[model]) || RATES[model];
  const out = Number(u.candidatesTokenCount ?? 0) + Number(u.thoughtsTokenCount ?? 0);
  return (input * rate.input + out * rate.output) / 1_000_000;
}

/** One response's usage as billed: tokens (thinking included) and searches, with their cost (searches at SEARCH_DOLLARS). */
export function billedUsage(model: string, response: any) {
  const u = response?.usageMetadata || {};
  const q = response?.candidates?.[0]?.groundingMetadata?.webSearchQueries;
  const searches = Array.isArray(q) ? q.length : 0;
  const tokens = estimateCost(model, response);
  return {
    input: Number(u.promptTokenCount ?? 0), output: Number(u.candidatesTokenCount ?? 0), thinking: Number(u.thoughtsTokenCount ?? 0),
    searches, tokenDollars: tokens ?? 0, searchDollars: searches * SEARCH_DOLLARS, priced: tokens !== null,
  };
}

export function logUsage(feature: string, model: string, response: any): void {
  const u = response?.usageMetadata;
  if (!u) return;
  const input = Number(u.promptTokenCount ?? 0);
  const answer = Number(u.candidatesTokenCount ?? 0);
  const thinking = Number(u.thoughtsTokenCount ?? 0);
  const image = Array.isArray(u.promptTokensDetails)
    ? u.promptTokensDetails.filter((d: any) => String(d?.modality).toUpperCase() === 'IMAGE').reduce((a: number, d: any) => a + Number(d?.tokenCount ?? 0), 0)
    : 0;
  const searches = Array.isArray(response?.candidates?.[0]?.groundingMetadata?.webSearchQueries)
    ? response.candidates[0].groundingMetadata.webSearchQueries.length
    : 0;
  const rate = RATES[model];
  const cost = rate ? (input * rate.input + (answer + thinking) * rate.output) / 1_000_000 : null;
  console.log(
    `[usage] ${feature} ${model} in=${input}${image ? ` (image ${image})` : ''} out=${answer} thinking=${thinking}` +
      (searches ? ` searches=${searches}` : '') +
      (cost !== null ? ` ≈ $${cost.toFixed(4)}` : '') +
      (searches ? ` (+$${(searches * SEARCH_COST).toFixed(3)} search once past the free 5,000/month)` : ''),
  );
}

/** Banner art is billed per image rather than per token. */
export function logBanner(ok: boolean): void {
  console.log(`[usage] banner gemini-3.1-flash-lite-image ${ok ? `1 image ≈ $${BANNER_IMAGE_COST.toFixed(4)}` : 'failed (not billed)'}`);
}
