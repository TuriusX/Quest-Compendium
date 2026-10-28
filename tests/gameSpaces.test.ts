// Run: npx tsx tests/gameSpaces.test.ts
import assert from "node:assert/strict";
import { planMigration, suggestGame, type Resolve } from "../src/utils/gameSpaces";

let passed = 0;
const pending: Promise<void>[] = [];
function test(name: string, fn: () => Promise<void> | void) {
  pending.push((async () => {
    try { await fn(); passed++; console.log("PASS  " + name); }
    catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
  })());
}

const msg = (id: string, timestamp: number, text = "hi", role = "user") => ({ id, role, text, timestamp });
const tab = (id: string, o: any = {}): any => ({ id, name: "Tab " + id, messages: [], notes: "", createdAt: 1000, lastActive: 2000, ...o });
const steam = (name: string, appId: number) => ({ name, appId });
// A resolver like the guide index's: Witcher 3 by app or by name; Mass Effect LE holds two games.
const resolve: Resolve = (t) => {
  if (t.guideKey) return { id: t.guideKey, name: t.guideKey === "mass-effect-2" ? "Mass Effect 2" : t.guideKey, collectionPick: t.guideKey };
  if (t.activeSteamGame?.appId === 292030 || /^the witcher 3/i.test(t.name)) return { id: "the-witcher-3", name: "The Witcher 3: Wild Hunt" };
  if (t.activeSteamGame?.appId === 1328670) return { id: null, options: [{ id: "mass-effect-1", name: "Mass Effect 1" }, { id: "mass-effect-2", name: "Mass Effect 2" }] };
  if (t.activeSteamGame?.appId) return { id: `steam:${t.activeSteamGame.appId}`, name: t.activeSteamGame.name };
  if (t.activeSteamGame?.name) return { id: `name:${t.activeSteamGame.name.toLowerCase().replace(/\W/g, "")}`, name: t.activeSteamGame.name };
  return { id: null };
};
const catalog = [{ id: "the-witcher-3", name: "The Witcher 3: Wild Hunt" }, { id: "baldur-s-gate-3", name: "Baldur's Gate 3" }];

test("tabs for the same game become one game, one playthrough; nothing dropped", async () => {
  const a = tab("a", { name: "Witcher run", activeSteamGame: steam("The Witcher 3: Wild Hunt", 292030), createdAt: 100, lastActive: 500,
    messages: [msg("m1", 110), msg("m3", 300)], notes: "<p>Ciri is in Velen</p>", personalQuests: [{ id: "q1", title: "Find Ciri", completed: false, createdAt: 120 }],
    place: { name: "Velen", confirmed: true } });
  const b = tab("b", { name: "The Witcher 3 DLC", createdAt: 200, lastActive: 900,
    messages: [msg("m2", 210), msg("m4", 800)], notes: "<p>Hearts of Stone: Gaunter</p>", personalQuests: [{ id: "q9", title: "find ciri", completed: true, createdAt: 220 }],
    place: { name: "Oxenfurt", confirmed: false } });
  const p = await planMigration([a, b], {}, resolve, catalog);
  assert.equal(p.ok, true, p.problems.join("; "));
  assert.equal(p.games.length, 1);
  const g = p.games[0], pt = p.playthroughs[0];
  assert.equal(g.id, "the-witcher-3");
  assert.deepEqual(g.fromTabs, ["a", "b"]);
  assert.deepEqual(pt.messages.map((m) => m.id), ["m1", "m2", "m3", "m4"]);
  assert.equal(pt.messages[1].fromCompendium, "The Witcher 3 DLC");
  assert.match(g.notes, /From "Witcher run".*Ciri is in Velen.*From "The Witcher 3 DLC".*Gaunter/);
  assert.equal(pt.personalQuests.length, 1);
  assert.equal(pt.personalQuests[0].completed, true); // done in either copy stays done
  assert.equal(pt.place?.name, "Oxenfurt"); // from the most recently used tab
  assert.deepEqual(pt.legacyGames.sort(), ["The Witcher 3 DLC", "The Witcher 3: Wild Hunt"]); // both memory keys kept
  assert.deepEqual(p.merges, [{ gameId: "the-witcher-3", name: "The Witcher 3: Wild Hunt", tabs: ["Witcher run", "The Witcher 3 DLC"] }]);
  assert.deepEqual(p.tabMap, { a: "the-witcher-3", b: "the-witcher-3" });
});

test("one tab: its notes and messages as they are, no source tags", async () => {
  const a = tab("a", { activeSteamGame: steam("The Witcher 3: Wild Hunt", 292030), messages: [msg("m1", 1)], notes: "<p>x</p>" });
  const p = await planMigration([a], {}, resolve);
  assert.equal(p.games[0].notes, "<p>x</p>");
  assert.equal(p.playthroughs[0].messages[0].fromCompendium, undefined);
  assert.equal(p.merges.length, 0);
});

test("a tab with no recognizable game keeps everything, with a suggestion from its conversation", async () => {
  const t = tab("x", { name: "My notes", messages: [msg("m1", 1, "Is Shadowheart romanceable in Baldur's Gate 3?"), msg("m2", 2, "In Baldurs Gate 3 yes, from act 1", "assistant")], notes: "<p>camp</p>" });
  const p = await planMigration([t], {}, resolve, catalog);
  assert.equal(p.ok, true);
  assert.equal(p.games[0].id, "tab:x");
  assert.equal(p.games[0].kind, "unsorted");
  assert.equal(p.needsGame[0].suggestion?.id, "baldur-s-gate-3");
  assert.equal(p.needsGame[0].suggestion?.mentions, 2);
  assert.equal(p.playthroughs[0].messages.length, 2);
});

test("a collection tab with no pick asks which game, with the collection's games", async () => {
  const t = tab("le", { name: "ME", activeSteamGame: steam("Mass Effect Legendary Edition", 1328670), messages: [msg("m", 1)] });
  const p = await planMigration([t], {}, resolve);
  assert.deepEqual(p.needsGame[0].options?.map((o) => o.id), ["mass-effect-1", "mass-effect-2"]);
  const picked = await planMigration([{ ...t, guideKey: "mass-effect-2" }], {}, resolve);
  assert.equal(picked.games[0].id, "mass-effect-2");
  assert.equal(picked.games[0].collectionPick, "mass-effect-2");
});

test("deleted tabs stay deleted; one edited after its delete comes back; deleted messages stay gone", async () => {
  const gone = tab("g", { activeSteamGame: steam("Hades", 1145360), createdAt: 10, lastActive: 100, messages: [msg("m1", 50)] });
  const back = tab("r", { activeSteamGame: steam("Hollow Knight", 367520), lastActive: 900, messages: [msg("m2", 50), msg("m3", 60)] });
  const p = await planMigration([gone, back], { g: 500, r: 500, m3: 70 }, resolve);
  assert.deepEqual(p.games.map((g) => g.id), ["steam:367520"]);
  assert.deepEqual(p.playthroughs[0].messages.map((m) => m.id), ["m2"]);
  assert.deepEqual(p.skipped, [{ tabId: "g", tabName: "Tab g", why: "deleted" }]);
});

test("empty tabs with no game are left out; empty tabs with a game still make the game", async () => {
  const p = await planMigration([tab("e", { name: "New Compendium" }), tab("w", { activeSteamGame: steam("Hades", 1145360) }), tab("welcome", { name: "Welcome, Explorer", messages: [msg("w", 1)] })], {}, resolve);
  assert.deepEqual(p.games.map((g) => g.id), ["steam:1145360"]);
  assert.deepEqual(p.skipped.map((s) => s.why).sort(), ["empty", "welcome"]);
  assert.equal(p.ok, true);
});

test("a game found by its Steam name joins the same game found by its app", async () => {
  const a = tab("a", { activeSteamGame: steam("Hades", 1145360), messages: [msg("m1", 1)] });
  const b = tab("b", { activeSteamGame: { name: "Hades" }, messages: [msg("m2", 2)] });
  const p = await planMigration([a, b], {}, resolve);
  assert.deepEqual(p.games.map((g) => g.id), ["steam:1145360"]);
  assert.equal(p.playthroughs[0].messages.length, 2);
});

test("running it again with the saved map puts every tab in the same place", async () => {
  const tabs = [tab("a", { activeSteamGame: steam("Hades", 1145360), messages: [msg("m1", 1)] }), tab("x", { name: "Stuff", messages: [msg("m2", 2)] })];
  const first = await planMigration(tabs, {}, resolve);
  const again = await planMigration(tabs, {}, resolve, [], first.tabMap);
  assert.deepEqual(again.tabMap, first.tabMap);
  // A tab placed by the player ("Which game is this?") stays with that game though the resolver can't tell.
  const placed = await planMigration(tabs, {}, resolve, [], { ...first.tabMap, x: "the-witcher-3" });
  assert.equal(placed.tabMap.x, "the-witcher-3");
  assert.equal(placed.needsGame.length, 0);
});

test("suggestGame needs two mentions and ignores short names", () => {
  assert.equal(suggestGame(tab("t", { messages: [msg("m", 1, "witcher 3 once")] }), catalog), undefined);
  assert.equal(suggestGame(tab("t", { messages: [msg("m", 1, "The Witcher 3 then Witcher 3 again")] }), catalog)?.id, "the-witcher-3");
});

Promise.all(pending).then(() => console.log(`\n${passed} passed`));
