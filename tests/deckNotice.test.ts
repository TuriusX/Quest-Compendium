// Run: npm run test:sync   (or: npx tsx tests/deckNotice.test.ts)
import assert from "node:assert/strict";
import { deckVersion, olderThan, DECK_UPDATE_NOTE } from "../deckNotice";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
test("the plugin's version from its User-Agent; anything else isn't the plugin", () => {
  assert.equal(deckVersion("QuestCompendiumDeck/0.13.0"), "0.13.0");
  assert.equal(deckVersion("QuestCompendiumDeck/0.13.0 (https://questcompendium.com; Steam Deck plugin)"), "0.13.0");
  assert.equal(deckVersion("Mozilla/5.0 Electron/30"), null);
  assert.equal(deckVersion(undefined), null);
});
test("older than the minimum: 0.13.0 and 0.9.2 yes; 0.14.0 and 0.14.1 no", () => {
  assert.equal(olderThan("0.13.0", "0.14.0"), true);
  assert.equal(olderThan("0.9.2", "0.14.0"), true);
  assert.equal(olderThan("0.14.0", "0.14.0"), false);
  assert.equal(olderThan("0.14.1", "0.14.0"), false);
  assert.equal(olderThan("0.14", "0.14.0"), false);
});
test("the note in all nine answer languages", () => {
  assert.equal(Object.keys(DECK_UPDATE_NOTE).length, 9);
  assert.equal(DECK_UPDATE_NOTE.English, "A new version of Quest Compendium for Steam Deck is out. Reinstall from the same link to update.");
});
console.log(`\n${passed} tests passed`);
