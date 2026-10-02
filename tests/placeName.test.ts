// Run: npm run test:sync   (or: npx tsx tests/placeName.test.ts)
import assert from "node:assert/strict";
import { nameKey, placeKey, samePlace } from "../src/utils/placeName";
import { tipMatches } from "../src/utils/achievementGuide";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("place: English, with extra detail on either side", () => {
  assert.equal(samePlace("South Figaro", "South Figaro, Relic Shop"), true);
  assert.equal(samePlace("Returners' Hideout", "returners hideout"), true);
  assert.equal(samePlace("South Figaro", "Figaro Castle"), false);
});
test("place: Japanese names keep their letters and match", () => {
  assert.equal(placeKey("サウスフィガロ"), "サウスフィガロ");
  assert.equal(samePlace("サウスフィガロ", "サウスフィガロ、レリック屋"), true);
  assert.equal(samePlace("サウスフィガロ", "フィガロ城"), false);
});
test("place: Russian names keep their letters and match", () => {
  assert.equal(samePlace("Южный Фигаро", "южный фигаро, лавка реликвий"), true);
  assert.equal(samePlace("Южный Фигаро", "Замок Фигаро"), false);
});
test("place: an empty or punctuation-only name never matches", () => {
  assert.equal(samePlace("", ""), false);
  assert.equal(samePlace("…", "!!"), false);
});
test("achievement names in Japanese and Russian don't all match each other", () => {
  assert.notEqual(nameKey("伝説の剣"), "");
  assert.equal(tipMatches({ name: "伝説の剣" } as any, "伝説の剣"), true);
  assert.equal(tipMatches({ name: "伝説の剣" } as any, "最強の盾"), false);
  assert.equal(tipMatches({ name: "Легенда" } as any, "Победа"), false);
  assert.equal(tipMatches({ name: "Победа", englishName: "Victory" } as any, "Victory"), true);
});

console.log(`\n${passed} tests passed`);
