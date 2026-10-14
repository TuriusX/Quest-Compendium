// Run: npm run test:sync   (or: npx tsx tests/benchmarkPoints.test.ts)
import assert from "node:assert/strict";
import { negativePoint, positivePart, corePoints } from "../scripts/guides/benchmark";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
test("what an entity is not or doesn't do is never a core point", () => {
  assert.equal(negativePoint("Plays no role in the critical path and cannot become a companion"), true);
  assert.equal(negativePoint("Popper is not a companion"), true);
  assert.equal(negativePoint("Does not sell weapons"), true);
});
test("a conditional one stays: timing, missables, consequences", () => {
  assert.equal(negativePoint("Cannot be recruited after Act 1"), false);
  assert.equal(negativePoint("Won't join if you sided with the goblins"), false);
  assert.equal(negativePoint("Sells potions and scrolls at the Circus of the Last Days"), false);
});
test("Popper's point keeps its outcomes and loses the negative part", () => {
  const p = "Plays no role in the critical path and cannot become an ally or romance; his possible outcomes are remaining as an active vendor in the circus, packing up when the troupe leaves, or dying if attacked by the player.";
  assert.equal(positivePart(p), "His possible outcomes are remaining as an active vendor in the circus, packing up when the troupe leaves, or dying if attacked by the player.");
  const core = corePoints([{ point: p, kind: "story role and fates", core: true }, { point: "Is not a companion", kind: "other", core: true }, { point: "Extra thing here", kind: "other", core: false }]);
  assert.equal(core.length, 1);
  assert.match(core[0].point, /^His possible outcomes/);
});
console.log(`\n${passed} tests passed`);
