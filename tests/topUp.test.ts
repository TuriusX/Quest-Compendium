// Run: npm run test:sync   (or: npx tsx tests/topUp.test.ts)
import assert from "node:assert/strict";
import { topUp, topUpLine } from "../src/utils/answerModel";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const EN: Record<string, string> = { "model.pro": "Pro", "model.fast": "Fast", "topup.add": "+{n} {model}", "topup.max": "{model} at max {n}", "topup.line": "{parts} in {when}", "topup.hm": "{h}h {m}m", "topup.m": "{m}m" };
const t = (k: string, v: Record<string, string | number> = {}) => EN[k].replace(/\{(\w+)\}/g, (_, x) => String(v[x]));
const now = 1_000_000_000_000;
const at = (mins: number) => now + mins * 60_000;

test("top-up line: the day's amounts and the time to midnight; under an hour, minutes only", () => {
  assert.equal(topUpLine({ pro: 3, fast: 10, dailyPro: 8, dailyFast: 25, resetAt: at(13 * 60 + 20), rollover: true, bankCap: 100 }, t, now), "+8 Pro · +25 Fast in 13h 20m");
  assert.equal(topUpLine({ pro: 0, fast: 1, dailyPro: 2, dailyFast: 5, resetAt: at(45) }, t, now), "+2 Pro · +5 Fast in 45m");
  assert.equal(topUpLine({ pro: 0, fast: 0, dailyPro: 1, dailyFast: 3, resetAt: at(60) }, t, now), "+1 Pro · +3 Fast in 1h 0m");
});

test("Premium at the carry-over cap: says so; near the cap: only what fits", () => {
  assert.equal(topUpLine({ pro: 100, fast: 90, dailyPro: 8, dailyFast: 25, resetAt: at(125), rollover: true, bankCap: 100 }, t, now), "Pro at max 100 · +10 Fast in 2h 5m");
  const u = topUp({ pro: 97, fast: 100, dailyPro: 8, dailyFast: 25, resetAt: at(5), rollover: true, bankCap: 100 }, now)!;
  assert.deepEqual([u.pro, u.proMax, u.fast, u.fastMax], [3, false, 0, true]);
});

test("nothing known yet: no line", () => {
  assert.equal(topUpLine({ pro: 1, fast: 1, dailyPro: 0, dailyFast: 0, resetAt: at(5) }, t, now), "");
  assert.equal(topUpLine({ pro: 1, fast: 1, dailyPro: 2, dailyFast: 5 }, t, now), "");
});

console.log(`\n${passed} tests passed`);
