// Run: npm run test:sync   (or: npx tsx tests/runningGame.test.ts)
import assert from "node:assert/strict";
import { isTabForGame, tabForGame } from "../src/utils/runningGame";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const tab = (id: string, name: string, game?: any, lastActive = 0): any => ({ id, name, activeSteamGame: game ?? null, messages: [], notes: "", createdAt: 0, lastActive });
const BG3 = { name: "Baldur's Gate 3", appId: 1086940 };

test("same Steam app is the running game", () => assert.equal(isTabForGame(tab("a", "My run", { name: "BG3", appId: 1086940 }), BG3), true));
test("another Steam app is not, even with the same name", () => assert.equal(isTabForGame(tab("a", "Baldur's Gate 3", { name: "Baldur's Gate 3", appId: 1 }), BG3), false));
test("a compendium named after the game (no Steam app) matches loosely", () => assert.equal(isTabForGame(tab("a", "baldurs gate 3"), BG3), true));
test("Trails is not Baldur's Gate 3", () => assert.equal(isTabForGame(tab("a", "Trails through Daybreak", { name: "The Legend of Heroes: Trails through Daybreak", appId: 2138610 }), BG3), false));
test("an auto-detected game saved on a tab doesn't count as its game", () => assert.equal(isTabForGame(tab("a", "Other", { ...BG3, isAutoDetected: true }), BG3), false));
test("nothing running: no compendium", () => assert.equal(tabForGame([tab("a", "Baldur's Gate 3", BG3)], null), null));
test("several matches: the most recently used", () => assert.equal(tabForGame([tab("old", "Baldur's Gate 3", BG3, 1), tab("new", "Second run", BG3, 9)], BG3)?.id, "new"));

console.log(`\n${passed} passed`);
