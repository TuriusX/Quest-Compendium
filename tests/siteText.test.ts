// Run: npm run test:sync   (or: npx tsx tests/siteText.test.ts)
import assert from "node:assert/strict";
import { shortGame, relatedQuests, achFlags } from "../scripts/guides/siteText";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("game names for titles: no trademark signs or edition suffix", () => {
  assert.equal(shortGame("The Witcher 3: Wild Hunt - Complete Edition"), "The Witcher 3: Wild Hunt");
  assert.equal(shortGame("The Elder Scrolls V: Skyrim Special Edition"), "The Elder Scrolls V: Skyrim");
  assert.equal(shortGame("DRAGON QUEST® XI S: Echoes of an Elusive Age™ - Definitive Edition"), "DRAGON QUEST XI S: Echoes of an Elusive Age");
  assert.equal(shortGame("Sekiro: Shadows Die Twice - GOTY Edition"), "Sekiro: Shadows Die Twice");
  assert.equal(shortGame("Mass Effect 3 (Legendary Edition)"), "Mass Effect 3");
  assert.equal(shortGame("CHRONO TRIGGER®"), "CHRONO TRIGGER");
  assert.equal(shortGame("Baldur's Gate 3"), "Baldur's Gate 3");
  assert.equal(shortGame("ELDEN RING"), "ELDEN RING");
});

test("related quests: quoted names next to a quest word, once each", () => {
  const a: any = {
    name: "Mulbrydale", overview: "A small village.", tips: ["Take the contract \"Missing Brother\" from the notice board."],
    items: [
      { id: "x1", name: "In Beast's Clothing", where: "Awarded inside the lone cottage after the secondary quest \"Man's Best Friend\".", missable: true },
      { id: "x2", name: "Sword", where: "In a chest near the \"Old Mill\" sign" }, // not a quest
    ],
    secrets: [{ id: "s1", text: "Finishing \"Man's Best Friend\" quest unlocks the dog." }],
    enemies: [], shops: [], sections: [],
  };
  assert.deepEqual(relatedQuests(a), ["Man's Best Friend", "Missing Brother"]); // in page order: items, secrets, tips
  assert.deepEqual(relatedQuests({ ...a, tips: [], items: [], secrets: [] }), []);
});

test("achievement labels: the builder's own, plus what the text makes plain", () => {
  assert.deepEqual(achFlags({ desc: "Collect all Gwent cards.", missable: true }), ["missable", "collectible"]);
  assert.deepEqual(achFlags({ desc: "Kill 100 drowners." }), ["cumulative"]);
  assert.deepEqual(achFlags({ desc: "Finish the game on Death March difficulty." }), ["difficulty"]);
  assert.deepEqual(achFlags({ desc: "Win a match.", how: "Play an online co-op session." }), ["online"]);
  assert.deepEqual(achFlags({ desc: "Open the door.", how: "Known bug: may not unlock; reload the save." }), ["buggy"]);
  assert.deepEqual(achFlags({ desc: "Reach the Grove.", labels: ["collectible", "nonsense"] }), ["collectible"]);
  assert.deepEqual(achFlags({ desc: "Defeat the dragon." }), []);
});

console.log(`\n${passed} tests passed`);
