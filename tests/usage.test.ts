// Run: npm run test:sync   (or: npx tsx tests/usage.test.ts)
import assert from "node:assert/strict";
import { estimateCost, worstCaseDollars, billedUsage, UNKNOWN_RATE, hasPrice, rateOn } from "../usage";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const r = (inTok: number, outTok: number) => ({ usageMetadata: { promptTokenCount: inTok, candidatesTokenCount: outTok } });

test("a model with no price on file is counted at the most expensive known rate, never as free", () => {
  assert.equal(hasPrice("gemini-9-mystery"), false);
  assert.ok(UNKNOWN_RATE.input >= 4 && UNKNOWN_RATE.output >= 20);
  assert.equal(estimateCost("gemini-9-mystery", r(1_000_000, 0)), UNKNOWN_RATE.input);
  assert.ok((estimateCost("gemini-9-mystery", r(1000, 1000)) || 0) >= (estimateCost("gemini-3.1-pro-preview", r(1000, 1000)) || 0));
  assert.ok(worstCaseDollars({ model: "gemini-9-mystery", contents: "x".repeat(4000), config: { maxOutputTokens: 1000 } }) > 0);
  const u = billedUsage("gemini-9-mystery", r(1000, 1000));
  assert.equal(u.priced, false);
  assert.ok(u.tokenDollars > 0);
});

test("priced models keep their own rates", () => {
  assert.equal(hasPrice("gemini-3.8-flash"), true);
  assert.equal(estimateCost("gemini-3.8-flash", r(1_000_000, 0)), 0.75);
});

test("announced price changes apply from their day: Flash and both voices double on Jan 1, 2027", () => {
  assert.deepEqual(rateOn("gemini-3.8-flash", "2026-12-31"), { input: 0.75, output: 3.75 });
  assert.deepEqual(rateOn("gemini-3.8-flash", "2027-01-01"), { input: 1.5, output: 7.5 });
  assert.deepEqual(rateOn("gemini-3.8-flash-tts", "2027-01-01"), { input: 1.0, output: 18.0 });
  assert.deepEqual(rateOn("gemini-3.8-flash-lite-tts", "2026-10-14"), { input: 0.5, output: 6.0 });
  assert.deepEqual(rateOn("gemini-3.8-flash-lite-tts", "2027-02-01"), { input: 1.0, output: 12.0 });
  assert.deepEqual(rateOn("gemini-3.1-pro-preview", "2027-06-01"), { input: 2.0, output: 12.0 });
  assert.equal(rateOn("gemini-9-mystery"), undefined);
});

console.log(`\n${passed} tests passed`);
