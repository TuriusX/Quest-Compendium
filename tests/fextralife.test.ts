// Run: npm run test:sync   (or: npx tsx tests/fextralife.test.ts)
import assert from "node:assert/strict";
import { fextralifeGuesses } from "../scripts/guides/suggestImages";
import { BLOCKED, trustedSites } from "../scripts/guides/claimCheck";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("Fextralife counts as a source again (owner, Oct 19 2026); Fandom still doesn't", () => {
  assert.equal(BLOCKED.test("fextralife.com"), false);
  assert.equal(BLOCKED.test("eldenring.wiki.fextralife.com"), false);
  assert.equal(BLOCKED.test("witcher.fandom.com"), true);
  assert.deepEqual(trustedSites(["eldenring.wiki.fextralife.com", "witcher.fandom.com", "ign.com"]), ["eldenring.wiki.fextralife.com", "ign.com"]);
});

test("the game's Fextralife wiki is guessed from its name", () => {
  assert.ok(fextralifeGuesses("ELDEN RING").includes("eldenring.wiki.fextralife.com"));
  assert.ok(fextralifeGuesses("The Witcher 3: Wild Hunt - Complete Edition").includes("thewitcher3.wiki.fextralife.com"));
  assert.ok(fextralifeGuesses("Red Dead Redemption 2").includes("reddeadredemption2.wiki.fextralife.com"));
  assert.ok(fextralifeGuesses("Baldur's Gate 3").includes("baldursgate3.wiki.fextralife.com"));
  assert.ok(fextralifeGuesses("The Elder Scrolls V: Skyrim Special Edition").includes("skyrim.wiki.fextralife.com"));
});

console.log(`\n${passed} passed`);
