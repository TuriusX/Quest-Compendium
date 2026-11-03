/**
 * Showing an answer as it's written (owner, Nov 3 2026; the website's questions, siteAsk.ts). The model's reply comes in
 * pieces, with lines the player must never see in it (<qc-steps>, <qc-place>, the guide's [g12] tags) that are only taken out
 * once the whole reply is in. visiblePart says how much of the reply so far can be shown; the finished answer replaces it.
 */

/** What can be shown of a reply so far: nothing that is, or might be the start of, one of our lines. */
export function visiblePart(raw: string): string {
  const text = String(raw || '');
  // A reply opening with the search line is a request for a search, however it goes on (searchPolicy.ts asksForSearch).
  if (/^\s*<qc-search/i.test(text)) return '';
  let s = text
    .replace(/(?:```[a-z]*\s*)?<qc-[a-z-]+(?:\s[^>]*)?>[\s\S]*?<\/qc-[a-z-]+>(?:\s*```)?/gi, '')
    .replace(/<qc-[a-z-]+[^>]*\/>/gi, '')
    .replace(/[ \t]*\[g\d+\]/g, '')
    .replace(/[ \t]*\[\s*PerQueryResult\([^\]]*\]/g, '');
  const open = s.search(/<qc-/i);
  if (open >= 0) s = s.slice(0, open);
  return s
    .replace(/<(?:q(?:c(?:-[a-z-]*)?)?)?$/i, '')
    .replace(/[ \t]*\[(?:g\d*|\s*P[a-zA-Z]*(?:\([^\]]*)?)?$/, '')
    .replace(/`{1,3}[a-z]*\s*$/i, '');
}

/** The next thing to send, given what was shown and what can be shown now. */
export function nextPiece(shown: string, now: string): { add: string } | { replace: string } | null {
  if (now === shown) return null;
  return now.startsWith(shown) ? { add: now.slice(shown.length) } : { replace: now };
}

/** A streamed reply read to its end, as the one reply generateContent would have returned. Search details are added up. */
export async function collectStream(stream: AsyncIterable<any>, onText: (all: string) => void) {
  let text = '', usageMetadata: any, finishReason: any;
  const grounding: any = { webSearchQueries: [], groundingChunks: [], groundingSupports: [] };
  let grounded = false;
  for await (const c of stream) {
    const piece = String(c?.text || '');
    if (c?.usageMetadata) usageMetadata = c.usageMetadata;
    const cand = c?.candidates?.[0];
    if (cand?.finishReason) finishReason = cand.finishReason;
    const g = cand?.groundingMetadata;
    if (g) {
      grounded = true;
      for (const q of g.webSearchQueries || []) if (!grounding.webSearchQueries.includes(q)) grounding.webSearchQueries.push(q);
      grounding.groundingChunks.push(...(g.groundingChunks || []));
      grounding.groundingSupports.push(...(g.groundingSupports || []));
    }
    if (piece) {
      text += piece;
      onText(text);
    }
  }
  return { text, usageMetadata, candidates: [{ finishReason, ...(grounded ? { groundingMetadata: grounding } : {}) }] };
}
