// Run: npm run test:sync   (or: npx tsx tests/runningGame.test.ts)
import assert from "node:assert/strict";
import { followRunning, isTabForGame, runningId, tabForGame, RESTART_GAP_MS } from "../src/utils/runningGame";

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

test("the shared resolver: an edition's name finds the guide's compendium; another guide's compendium doesn't match", () => {
  const er = tab("er", "Elden Ring", undefined, 1);
  const erKeyed = { ...tab("erk", "My tarnished", undefined, 2), guideKey: "elden-ring" };
  const night = { ...tab("nr", "Elden Ring", undefined, 3), guideKey: "elden-ring-nightreign" };
  const running = { name: "ELDEN RING - Deluxe Edition", appId: 0 };
  assert.equal(tabForGame([er], running), null, "the name alone doesn't say it");
  assert.equal(tabForGame([er], running, { key: "elden-ring", game: "Elden Ring" })?.id, "er");
  assert.equal(tabForGame([erKeyed, night], running, { key: "elden-ring", game: "Elden Ring" })?.id, "erk", "the guide picked on the compendium wins over its name");
});

test("an emulated game (no Steam app) matches its compendium by name", () => {
  assert.equal(tabForGame([tab("z", "The Legend of Zelda: Breath of the Wild")], { name: "The Legend of Zelda Breath of the Wild", appId: 0 })?.id, "z");
  assert.equal(runningId({ name: "Super Metroid", appId: 0 }), "name:supermetroid");
  assert.equal(runningId(BG3), "steam:1086940");
});

test("following the running game: switch when it starts, offer when there's no compendium, never back after a hand pick", () => {
  const o = (matchTabId: string | null, activeTabId: string, auto = true) => ({ matchTabId, activeTabId, auto });
  let r = followRunning({ id: null, goneAt: 0 }, "steam:1", 0, o("bg3", "notes"));
  assert.deepEqual(r.action, { kind: "switch", tabId: "bg3" });
  // The player picks another compendium by hand: the same game still running doesn't switch back.
  r = followRunning(r.state, "steam:1", 9000, o("bg3", "notes"));
  assert.deepEqual(r.action, { kind: "none" });
  // Steam's id blinks while launching: not a new start.
  r = followRunning(r.state, null, 10000, o(null, "notes"));
  r = followRunning(r.state, "steam:1", 12000, o("bg3", "notes"));
  assert.deepEqual(r.action, { kind: "none" });
  // A different game with no compendium: offered, not made.
  r = followRunning(r.state, "name:supermetroid", 20000, o(null, "notes"));
  assert.deepEqual(r.action, { kind: "offer" });
  // Back to the first game: switched again.
  r = followRunning(r.state, "steam:1", 30000, o("bg3", "notes"));
  assert.deepEqual(r.action, { kind: "switch", tabId: "bg3" });
  // Closed and started again after a while: a new start.
  r = followRunning(r.state, null, 40000, o(null, "notes"));
  r = followRunning(r.state, "steam:1", 40000 + RESTART_GAP_MS, o("bg3", "notes"));
  assert.deepEqual(r.action, { kind: "switch", tabId: "bg3" });
});

test("automatic switching off: nothing switches (the detection line's Switch stays); no compendium is still offered", () => {
  const st = { id: null, goneAt: 0 };
  assert.deepEqual(followRunning(st, "steam:1", 0, { matchTabId: "bg3", activeTabId: "x", auto: false }).action, { kind: "none" });
  assert.deepEqual(followRunning(st, "steam:1", 0, { matchTabId: null, activeTabId: "x", auto: false }).action, { kind: "offer" });
  assert.deepEqual(followRunning(st, "steam:1", 0, { matchTabId: "x", activeTabId: "x", auto: true }).action, { kind: "none" }, "already there");
});

console.log(`\n${passed} passed`);
