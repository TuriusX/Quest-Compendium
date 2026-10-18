// Run: npm run test:sync   (or: npx tsx tests/guideResolve.test.ts)
import assert from "node:assert/strict";
import { baseGameKey, pickGuideKey } from "../guidesApi";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

// The guides as they are (key, Steam app id, game name), the editions found on 18 Oct 2026.
const G = (key: string, appId: number, game: string) => ({ key, appId, base: baseGameKey(game) });
const index = [
  G("the-witcher-3-wild-hunt-complete-edition", 292030, "The Witcher 3: Wild Hunt - Complete Edition"),
  G("mass-effect-1-legendary-edition", 1328670, "Mass Effect 1 (Legendary Edition)"),
  G("mass-effect-2-legendary-edition", 1328670, "Mass Effect 2 (Legendary Edition)"),
  G("kingdom-hearts-final-mix", 2552430, "KINGDOM HEARTS FINAL MIX"),
  G("kingdom-hearts-ii-final-mix", 2552430, "KINGDOM HEARTS II FINAL MIX"),
  G("dark-souls-remastered", 570940, "DARK SOULS: REMASTERED"),
  G("persona-5-royal", 1687950, "Persona 5 Royal"),
  G("final-fantasy-vii-remake-intergrade", 1462040, "FINAL FANTASY VII REMAKE INTERGRADE"),
  G("the-legend-of-zelda-breath-of-the-wild", 0, "The Legend of Zelda: Breath of the Wild"),
  G("elden-ring", 1245620, "ELDEN RING"),
];

test("Witcher 3: Steam's new name, by app id", () => assert.equal(pickGuideKey(index, ["The Witcher 3: Wild Hunt — Remastered"], 292030), "the-witcher-3-wild-hunt-complete-edition"));
test("Witcher 3: Steam's new name without an app id (the Deck sends names)", () => assert.equal(pickGuideKey(index, ["The Witcher 3: Wild Hunt — Remastered"]), "the-witcher-3-wild-hunt-complete-edition"));
test("Witcher 3: the old Steam name and GOTY", () => {
  assert.equal(pickGuideKey(index, ["The Witcher 3: Wild Hunt"]), "the-witcher-3-wild-hunt-complete-edition");
  assert.equal(pickGuideKey(index, ["The Witcher® 3: Wild Hunt - Game of the Year Edition"]), "the-witcher-3-wild-hunt-complete-edition");
});
test("Mass Effect LE: one Steam app, the compendium's name picks the game", () => {
  assert.equal(pickGuideKey(index, ["Mass Effect™ Legendary Edition", "Mass Effect 2"], 1328670), "mass-effect-2-legendary-edition");
  assert.equal(pickGuideKey(index, ["Mass Effect™ Legendary Edition", "Mass Effect 1 (Legendary Edition)"], 1328670), "mass-effect-1-legendary-edition");
});
test("Mass Effect LE: without a name that says which, no guide (never the wrong one)", () => assert.equal(pickGuideKey(index, ["Mass Effect™ Legendary Edition"], 1328670), null));
test("Kingdom Hearts collection: the compendium's name picks the game", () => {
  assert.equal(pickGuideKey(index, ["KINGDOM HEARTS -HD 1.5+2.5 ReMIX-", "Kingdom Hearts II Final Mix"], 2552430), "kingdom-hearts-ii-final-mix");
  assert.equal(pickGuideKey(index, ["KINGDOM HEARTS -HD 1.5+2.5 ReMIX-"], 2552430), null);
});
test("™ ® and dashes don't matter", () => assert.equal(pickGuideKey(index, ["ELDEN RING™"]), "elden-ring"));
test("Remastered and the original share a guide", () => {
  assert.equal(pickGuideKey(index, ["Dark Souls Remastered"]), "dark-souls-remastered");
  assert.equal(pickGuideKey(index, ["DARK SOULS"]), "dark-souls-remastered");
});
test("Royal and Remake are games of their own", () => {
  assert.equal(baseGameKey("Persona 5 Royal"), "persona-5-royal");
  assert.equal(baseGameKey("FINAL FANTASY VII REMAKE INTERGRADE"), "final-fantasy-vii-remake-intergrade");
  assert.equal(pickGuideKey(index, ["Persona 5"]), null);
});
test("A guide found by the app wins, if it is a guide", () => {
  assert.equal(pickGuideKey(index, ["anything"], 0, "elden-ring"), "elden-ring");
  assert.equal(pickGuideKey(index, ["ELDEN RING"], 0, "not-a-guide"), "elden-ring");
});
test("Typed names of games without Steam", () => assert.equal(pickGuideKey(index, ["The Legend of Zelda: Breath of the Wild (Nintendo Switch 2 Edition)"]), "the-legend-of-zelda-breath-of-the-wild"));
test("Editions stack", () => assert.equal(baseGameKey("Some Game: Remastered - GOTY Edition™"), "some-game"));
test("A different game in a series stays different", () => assert.equal(pickGuideKey(index, ["ELDEN RING NIGHTREIGN"]), null));

console.log(`\n${passed} passed`);
