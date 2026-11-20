// Run: npx tsx tests/asideGame.test.ts
import assert from "node:assert/strict";
import { asideGameIn } from "../src/utils/asideGame";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const tab = (id: string, name: string, game?: string): any => ({ id, name, activeSteamGame: game ? { name: game, appId: 1 } : null, messages: [], notes: "", createdAt: 0, lastActive: 0 });
const tabs = [tab("er", "Elden Ring", "ELDEN RING"), tab("hk", "Hollow Knight"), tab("ctl", "Control"), tab("nr", "Elden Ring Nightreign"), tab("bg3", "My Durge run", "Baldur's Gate 3")];

test("a question about this game stays", () => assert.equal(asideGameIn("where is the Nagakiba?", tabs, "er"), null));
test("this game named stays", () => assert.equal(asideGameIn("best talisman in Elden Ring?", tabs, "er"), null));
test("another game named: a side question, filed in its compendium", () => assert.deepEqual(asideGameIn("in hollow knight, where is the mantis claw?", tabs, "er"), { name: "Hollow Knight", tabId: "hk" }));
test("the Steam name of a compendium counts", () => assert.equal(asideGameIn("Is Karlach romanceable in Baldur's Gate 3?", tabs, "er")?.tabId, "bg3"));
test("a longer game that contains this one's name is another game", () => assert.equal(asideGameIn("best class in Elden Ring Nightreign", tabs, "er")?.tabId, "nr"));
test("part of this game's own name isn't another game", () => assert.equal(asideGameIn("is this like Elden Ring?", tabs, "nr"), null));
test("one-word names only when said as a game", () => {
  assert.equal(asideGameIn("how do I control the camera", tabs, "er"), null);
  assert.equal(asideGameIn("Control the horse better?", tabs, "er"), null);
  assert.equal(asideGameIn("what's the best weapon in Control?", tabs, "er")?.tabId, "ctl");
});
test("no other compendiums: nothing", () => assert.equal(asideGameIn("in Hollow Knight where is the claw", [tab("er", "Elden Ring")], "er"), null));
console.log(`\n${passed} tests passed`);
