// Run: npm run test:sync   (or: npx tsx tests/compendium.test.ts)
import assert from "node:assert/strict";
import { queryEntity } from "../scripts/guides/compendium";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("demand: the thing a query is about, without the game's name and question words", () => {
  assert.equal(queryEntity("rdr2 thieves landing", "Red Dead Redemption 2"), "thieves landing");
  assert.equal(queryEntity("where is keira metz house witcher 3", "The Witcher 3: Wild Hunt - Complete Edition"), "keira metz house");
  assert.equal(queryEntity("beaver hollow rdr2", "Red Dead Redemption 2"), "beaver hollow");
  assert.equal(queryEntity("silty mug inn location", "Baldur's Gate 3"), "silty mug inn");
  assert.equal(queryEntity("elden ring", "ELDEN RING"), "");
});

console.log(`\n${passed} tests passed`);
