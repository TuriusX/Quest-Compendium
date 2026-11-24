// Run: npm run test:sync   (or: npx tsx tests/topUp.test.ts)
import assert from "node:assert/strict";
import { modelKind, topUp, topUpLine } from "../src/utils/answerModel";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const EN: Record<string, string> = { "model.pro": "Pro", "model.fast": "Fast", "topup.add": "+{n} {model}", "topup.max": "{model} at max {n}", "topup.line": "{parts} in {when}", "topup.back": "{n} {model}", "topup.backLine": "Back to {parts} in {when}", "topup.hm": "{h}h {m}m", "topup.m": "{m}m", "topup.addQ": "+{n} questions", "topup.backQ": "{n} questions", "topup.fullQ": "You're holding the most you can" };
// (One count of questions since Nov 22 2026: players never see Pro and Fast apart.)
const t = (k: string, v: Record<string, string | number> = {}) => EN[k].replace(/\{(\w+)\}/g, (_, x) => String(v[x]));
const now = 1_000_000_000_000;
const at = (mins: number) => now + mins * 60_000;

test("top-up line: the day's amounts and the time to midnight; under an hour, minutes only", () => {
  assert.equal(topUpLine({ pro: 3, fast: 10, dailyPro: 8, dailyFast: 25, resetAt: at(13 * 60 + 20), rollover: true, bankCap: 100 }, t, now), "+33 questions in 13h 20m");
  assert.equal(topUpLine({ pro: 0, fast: 1, dailyPro: 2, dailyFast: 5, resetAt: at(45) }, t, now), "Back to 7 questions in 45m");
  assert.equal(topUpLine({ pro: 0, fast: 0, dailyPro: 1, dailyFast: 3, resetAt: at(60) }, t, now), "Back to 4 questions in 1h 0m");
});

test("Premium at the carry-over cap: only what fits is added; nothing fits: says so", () => {
  assert.equal(topUpLine({ pro: 100, fast: 90, dailyPro: 8, dailyFast: 25, resetAt: at(125), rollover: true, bankCap: 100 }, t, now), "+10 questions in 2h 5m");
  const u = topUp({ pro: 97, fast: 100, dailyPro: 8, dailyFast: 25, resetAt: at(5), rollover: true, bankCap: 100 }, now)!;
  assert.deepEqual([u.pro, u.proMax, u.fast, u.fastMax], [3, false, 0, true]);
  assert.equal(topUpLine({ pro: 100, fast: 100, dailyPro: 8, dailyFast: 25, resetAt: at(5), rollover: true, bankCap: 100 }, t, now), "You're holding the most you can in 5m");
});

test("nothing known yet: no line", () => {
  assert.equal(topUpLine({ pro: 1, fast: 1, dailyPro: 0, dailyFast: 0, resetAt: at(5) }, t, now), "");
  assert.equal(topUpLine({ pro: 1, fast: 1, dailyPro: 2, dailyFast: 5 }, t, now), "");
});

test("an answer's grey line says Pro or Fast, never the model's name", () => {
  assert.equal(modelKind("Gemini 3.1 Pro"), "pro");
  assert.equal(modelKind("Gemini 3.8 Flash"), "fast");
  assert.equal(modelKind("Gemini Flash-Lite"), "fast");
  assert.equal(modelKind("Gemini 3.1 Flash Lite (Emergency Fallback)"), "fast");
  assert.equal(modelKind("Limit Reached"), "");
  assert.equal(modelKind("Offline / Unavailable"), "");
  assert.equal(modelKind(undefined), "");
});

test("free and guest days reset, never add: a free player with 1 Pro left still goes back to the day's 7, not 8", () => {
  const u = topUp({ pro: 1, fast: 4, dailyPro: 2, dailyFast: 5, resetAt: at(30) }, now)!;
  assert.equal(u.reset, true);
  assert.equal(topUpLine({ pro: 1, fast: 4, dailyPro: 2, dailyFast: 5, resetAt: at(30) }, t, now), "Back to 7 questions in 30m");
  assert.equal(topUp({ pro: 3, fast: 10, dailyPro: 8, dailyFast: 25, resetAt: at(5), rollover: true, bankCap: 100 }, now)!.reset, false);
});

console.log(`\n${passed} tests passed`);
