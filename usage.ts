/**
 * AI cost log. Every Gemini call logs one line with its token counts and an estimated cost, e.g.
 *   [usage] chat gemini-3.1-pro-preview in=3120 (image 1088) out=412 thinking=380 ≈ $0.0156
 * so the cost of each feature (and each question) can be read straight from the server logs.
 *
 * Rates are per million tokens, taken from the project's own Google Cloud billing report (Sept 2026). They're
 * estimates for the log only; Google's price list is the authority. Unknown models log tokens without a price.
 */
const RATES: Record<string, { input: number; output: number }> = {
  'gemini-3.1-pro-preview': { input: 2.0, output: 12.0 }, // thinking is billed as output
  'gemini-3.8-flash': { input: 0.5, output: 3.75 },
  'gemini-3.1-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.1-flash-tts-preview': { input: 0.5, output: 20.0 }, // audio output
};

export function logUsage(feature: string, model: string, response: any): void {
  const u = response?.usageMetadata;
  if (!u) return;
  const input = Number(u.promptTokenCount ?? 0);
  const answer = Number(u.candidatesTokenCount ?? 0);
  const thinking = Number(u.thoughtsTokenCount ?? 0);
  const image = Array.isArray(u.promptTokensDetails)
    ? u.promptTokensDetails.filter((d: any) => String(d?.modality).toUpperCase() === 'IMAGE').reduce((a: number, d: any) => a + Number(d?.tokenCount ?? 0), 0)
    : 0;
  const rate = RATES[model];
  const cost = rate ? (input * rate.input + (answer + thinking) * rate.output) / 1_000_000 : null;
  console.log(
    `[usage] ${feature} ${model} in=${input}${image ? ` (image ${image})` : ''} out=${answer} thinking=${thinking}` +
      (cost !== null ? ` ≈ $${cost.toFixed(4)}` : ''),
  );
}
