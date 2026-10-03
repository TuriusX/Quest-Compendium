// Run: npm run test:sync   (or: npx tsx tests/reviewer.test.ts)
import assert from "node:assert/strict";
import { passMark, PASS, FLASH_QUICK_PASS } from "../scripts/guides/review";
import { PRO_DAILY, PRO_CAREFUL_RESERVE, isQuotaError } from "../scripts/guides/reviewerQuota";

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
test("Pro: 250 a day, 200 kept for careful rebuilds; Google's quota errors are recognised", () => {
  assert.equal(PRO_DAILY, 250);
  assert.equal(PRO_CAREFUL_RESERVE, 200);
  assert.ok(isQuotaError(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')));
  assert.ok(!isQuotaError(new Error("the reviewer did not return a readable grade")));
});

console.log(`\n${passed} tests passed`);
