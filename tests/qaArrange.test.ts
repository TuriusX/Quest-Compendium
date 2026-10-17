// Run: npm run test:sync   (or: npx tsx tests/qaArrange.test.ts)
import assert from "node:assert/strict";
import { gameplayHeads, gameplayHeadFor, GAMEPLAY_HEADS } from "../scripts/guides/qaArrange";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("a person's gameplay parts are about a person; a place's about getting there", () => {
  const person = gameplayHeads("person");
  for (const h of ["Where to find them", "Recruitment", "Romance", "Quest steps", "Fate"]) assert.ok(person.includes(h), h);
  assert.ok(!person.includes("How to reach it"));
  assert.ok(gameplayHeads("place").includes("How to reach it"));
  assert.ok(!gameplayHeads("place").includes("Romance"));
  assert.deepEqual(gameplayHeads("unknown kind"), person);
  // Every kind's headings are in the shared list (older pages' parts keep an order).
  for (const k of ["person", "place", "boss", "thing"]) for (const h of gameplayHeads(k)) assert.ok(GAMEPLAY_HEADS.includes(h));
});

test("a person's grave or whereabouts never lands under \"How to reach it\"", () => {
  assert.equal(gameplayHeadFor("person", "How to reach it"), "Where to find them");
  assert.equal(gameplayHeadFor("person", " how to reach it "), "Where to find them");
  assert.equal(gameplayHeadFor("person", "Grave location"), "Fate");
  assert.equal(gameplayHeadFor("person", "Possible fates"), "Fate");
  assert.equal(gameplayHeadFor("person", "romance"), "Romance");
});

test("each kind keeps its own words; a heading that fits none is refused", () => {
  assert.equal(gameplayHeadFor("place", "Where to find them"), "How to reach it");
  assert.equal(gameplayHeadFor("place", "How to reach it"), "How to reach it");
  assert.equal(gameplayHeadFor("boss", "How to reach it"), "Where to find it");
  assert.equal(gameplayHeadFor("place", "Romance"), null);
  assert.equal(gameplayHeadFor("place", "Fate"), null);
  assert.equal(gameplayHeadFor("thing", "Lore"), null);
});

console.log(`\n${passed} tests passed`);
