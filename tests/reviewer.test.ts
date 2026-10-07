// Run: npm run test:sync   (or: npx tsx tests/reviewer.test.ts)
import assert from "node:assert/strict";
import { passMark, PASS, FLASH_QUICK_PASS } from "../scripts/guides/review";
import { isQuotaError } from "../scripts/guides/reviewerQuota";
import { normalizeLimits, LIMIT_DEFAULTS, pipelineRoom, playerSearchOk } from "../apiLimits";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("Flash reviewing a quick guide needs 80; everything else 75", () => {
  assert.equal(FLASH_QUICK_PASS, 80);
  assert.equal(PASS, 75);
  assert.equal(passMark("flash", "quick"), 80);
  assert.equal(passMark("flash", "mixed"), 75);
  assert.equal(passMark("flash", "careful"), 75);
  assert.equal(passMark("pro", "quick"), 75);
  assert.equal(passMark("pro", "careful"), 75);
});
test("limits: Pro 50,000 a day, searches 1,500 with 1,000 for the pipeline; Google's quota errors are recognised", () => {
  assert.deepEqual(normalizeLimits({}), LIMIT_DEFAULTS);
  assert.equal(LIMIT_DEFAULTS.proDaily, 50000);
  assert.equal(normalizeLimits({ searchDaily: 800, pipelineSearchDaily: 1000 }).pipelineSearchDaily, 800);
  const l = LIMIT_DEFAULTS;
  assert.equal(pipelineRoom(l, { day: "d", total: 400, pipeline: 300, players: 100 }), 700);
  assert.equal(pipelineRoom(l, { day: "d", total: 1450, pipeline: 950, players: 500 }), 50);
  assert.equal(pipelineRoom(l, { day: "d", total: 1000, pipeline: 1000, players: 0 }), 0);
  assert.ok(playerSearchOk(l, { day: "d", total: 1499, pipeline: 1000, players: 499 }));
  assert.ok(!playerSearchOk(l, { day: "d", total: 1500, pipeline: 1000, players: 500 }));
  assert.ok(isQuotaError(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')));
  assert.ok(!isQuotaError(new Error("the reviewer did not return a readable grade")));
});

console.log(`\n${passed} tests passed`);
