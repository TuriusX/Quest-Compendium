// Run: npm run test:sync   (or: npx tsx tests/demandRank.test.ts)
import assert from "node:assert/strict";
import { rankByDemand, demandScore } from "../scripts/pipeline/demandReport";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
test("a question counts as 10 impressions", () => assert.equal(demandScore({ impressions: 33, questions: 20 }), 233));
test("complete guides stay first, the rest by demand, deferred ones left out", () => {
  const order = rankByDemand(["w3", "skyrim", "trails", "dos2", "wukong", "ds"], new Set(["w3"]), new Set(["wukong"]), {
    skyrim: { impressions: 572 }, trails: { impressions: 33, questions: 20 }, dos2: { impressions: 311 }, wukong: { impressions: 8 }, ds: { impressions: 342, questions: 1 },
  });
  assert.deepEqual(order, ["w3", "skyrim", "ds", "dos2", "trails"]);
});
console.log(`\n${passed} tests passed`);
