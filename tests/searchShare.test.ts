// Run: npm run test:sync   (or: npx tsx tests/searchShare.test.ts)
import assert from "node:assert/strict";
import { pipelineShare, splitOf, PLAYER_MONTHLY } from "../searchGuard";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
test("the pipeline's share: 6,500 in October 2026, 4,800 from November", () => {
  assert.equal(pipelineShare("2026-10"), 6500);
  assert.equal(pipelineShare("2026-11"), 4800);
  assert.equal(pipelineShare("2027-03"), 4800);
});
test("players have their own 2,000", () => assert.equal(PLAYER_MONTHLY(), 2000));
test("a month counted before the split is all the pipeline's; a split month is read as it is", () => {
  assert.deepEqual(splitOf({ month: "2026-10", count: 5534 }), { month: "2026-10", count: 5534, pipeline: 5534, players: 0, flagship: 0 });
  assert.deepEqual(splitOf({ month: "2026-10", count: 5600, players: 30, flagship: 36 }), { month: "2026-10", count: 5600, pipeline: 5534, players: 30, flagship: 36 });
  assert.deepEqual(splitOf({ month: "2026-11", count: 100, pipeline: 70, players: 30, flagship: 0 }), { month: "2026-11", count: 100, pipeline: 70, players: 30, flagship: 0 });
});
console.log(`\n${passed} tests passed`);
