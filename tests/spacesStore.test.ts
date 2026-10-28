// Run: npx tsx tests/spacesStore.test.ts
import assert from "node:assert/strict";
import { applyTabs, assignGame, emptySpaces, importPlan, memoryKeyOf, newPlaythrough, playthroughsOf, splitMerged, switchPlaythrough, toTabs, type SpacesState } from "../src/utils/spacesStore";
import { planMigration } from "../src/utils/gameSpaces";

let passed = 0;
const pending: Promise<void>[] = [];
function test(name: string, fn: () => Promise<void> | void) {
  pending.push((async () => {
    try { await fn(); passed++; console.log("PASS  " + name); }
    catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
  })());
}
const msg = (id: string, timestamp: number, text = "hi"): any => ({ id, role: "user", text, timestamp });
const tab = (id: string, o: any = {}): any => ({ id, name: "Tab " + id, messages: [], notes: "", createdAt: 1000, lastActive: 2000, ...o });
const resolve = (t: any) => (t.activeSteamGame?.appId === 292030 || /witcher/i.test(t.name) ? { id: "the-witcher-3", name: "The Witcher 3: Wild Hunt" } : t.activeSteamGame?.appId ? { id: `steam:${t.activeSteamGame.appId}`, name: t.activeSteamGame.name } : { id: null });

async function migrated(): Promise<SpacesState> {
  const tabs = [
    tab("a", { name: "Witcher run", messages: [msg("m1", 10)], notes: "<p>Ciri</p>", place: { name: "Velen", confirmed: true } }),
    tab("b", { name: "Hades", activeSteamGame: { name: "Hades", appId: 1145360 }, messages: [msg("m2", 20)] }),
  ];
  const p = await planMigration(tabs, {}, resolve);
  return { ...emptySpaces(), games: p.games, playthroughs: p.playthroughs, tabMap: p.tabMap, migratedAt: 1 };
}

test("each game is one tab showing its current playthrough; the first keeps its old memory name", async () => {
  const s = await migrated();
  const tabs = toTabs(s);
  assert.deepEqual(tabs.map((t) => t.id).sort(), ["steam:1145360", "the-witcher-3"]);
  const w = tabs.find((t) => t.id === "the-witcher-3")!;
  assert.equal(w.messages.length, 1);
  assert.equal(w.notes, "<p>Ciri</p>");
  assert.equal(w.place?.name, "Velen");
  assert.equal(w.memoryKey, "Witcher run"); // the playthrough memory the old tab had is still read
  assert.deepEqual(w.playthrough, { id: "pt1", name: "Playthrough 1", count: 1 });
});

test("what the app changes goes back to the game or the playthrough; nothing else moves", async () => {
  const s = await migrated();
  const tabs = toTabs(s).map((t) => (t.id === "the-witcher-3" ? { ...t, notes: "<p>Ciri and Yen</p>", messages: [...t.messages, msg("m9", 99)], lastActive: 5000 } : t));
  const n = applyTabs(s, tabs, 5000);
  assert.equal(n.games.find((g) => g.id === "the-witcher-3")!.notes, "<p>Ciri and Yen</p>");
  assert.deepEqual(n.playthroughs.find((p) => p.gameId === "the-witcher-3")!.messages.map((m) => m.id), ["m1", "m9"]);
  assert.equal(n.playthroughs.find((p) => p.gameId === "steam:1145360"), s.playthroughs.find((p) => p.gameId === "steam:1145360")); // untouched
});

test("a new playthrough starts fresh (conversation, quest log, place, memory); notes stay; switching back shows the old one", async () => {
  let s = await migrated();
  s = newPlaythrough(s, "the-witcher-3", 6000);
  let w = toTabs(s).find((t) => t.id === "the-witcher-3")!;
  assert.equal(w.messages.length, 0);
  assert.equal(w.place, undefined);
  assert.equal(w.notes, "<p>Ciri</p>");
  assert.equal(w.memoryKey, "The Witcher 3: Wild Hunt~pt2");
  assert.deepEqual(w.playthrough, { id: "pt2", name: "Playthrough 2", count: 2 });
  // A message in playthrough 2 stays there.
  s = applyTabs(s, toTabs(s).map((t) => (t.id === "the-witcher-3" ? { ...t, messages: [msg("x", 7000)] } : t)), 7000);
  s = switchPlaythrough(s, "the-witcher-3", "pt1");
  w = toTabs(s).find((t) => t.id === "the-witcher-3")!;
  assert.deepEqual(w.messages.map((m) => m.id), ["m1"]);
  assert.deepEqual(playthroughsOf(s, "the-witcher-3").map((p) => p.messages.length), [1, 1]);
});

test("the app adding a game makes a space; adding one already here points at it; removing tombstones it", async () => {
  let s = await migrated();
  s = applyTabs(s, [...toTabs(s), tab("tab-new", { name: "Celeste", activeSteamGame: { name: "Celeste", appId: 504230 } })], 8000);
  assert.ok(s.games.some((g) => g.id === "tab-new" && g.name === "Celeste"));
  assert.equal(playthroughsOf(s, "tab-new").length, 1);
  s = applyTabs(s, [...toTabs(s), tab("tab-dup", { name: "Hades", activeSteamGame: { name: "Hades", appId: 1145360 } })], 9000);
  assert.equal(s.games.filter((g) => /hades/i.test(g.name)).length, 1);
  assert.equal(s.alias?.["tab-dup"], "steam:1145360");
  s = applyTabs(s, toTabs(s).filter((t) => t.id !== "tab-new"), 10000);
  assert.ok(!toTabs(s).some((t) => t.id === "tab-new"));
  assert.equal(s.deleted["tab-new"], 10000);
});

test("Which game is this?: a space becomes that game, or joins its existing space as another playthrough", async () => {
  const p = await planMigration([tab("x", { name: "My notes", messages: [msg("q", 1)] }), tab("w", { name: "Witcher run", messages: [msg("m", 2)] })], {}, resolve);
  let s: SpacesState = { ...emptySpaces(), games: p.games, playthroughs: p.playthroughs, tabMap: p.tabMap };
  const joined = assignGame(s, "tab:x", { id: "the-witcher-3", name: "The Witcher 3: Wild Hunt" });
  assert.equal(joined.games.length, 1);
  assert.deepEqual(playthroughsOf(joined, "the-witcher-3").map((x) => x.messages[0].id), ["m", "q"]);
  assert.equal(joined.tabMap.x, "the-witcher-3");
  const became = assignGame(s, "tab:x", { id: "baldur-s-gate-3", name: "Baldur's Gate 3", appId: 1086940 });
  assert.ok(became.games.some((g) => g.id === "baldur-s-gate-3" && g.kind === "game"));
  assert.equal(memoryKeyOf(became.games.find((g) => g.id === "baldur-s-gate-3")!, playthroughsOf(became, "baldur-s-gate-3")[0]), "My notes");
});

test("the migration on each device: twice changes nothing; an older app's new messages come in; deleted games stay deleted", async () => {
  const tabs = [tab("a", { name: "Witcher run", messages: [msg("m1", 10)], notes: "<p>Ciri</p>" }), tab("b", { name: "Hades", activeSteamGame: { name: "Hades", appId: 1145360 }, messages: [msg("m2", 20)] })];
  const s1 = importPlan(emptySpaces(), await planMigration(tabs, {}, resolve), 100);
  const s2 = importPlan(s1, await planMigration(tabs, {}, resolve, [], s1.tabMap), 200);
  assert.deepEqual(toTabs(s2).map((t) => [t.id, t.messages.length, t.notes]), toTabs(s1).map((t) => [t.id, t.messages.length, t.notes]));
  assert.equal(s2.migratedAt, 100);
  // An older app (still on tabs) adds a message to the Witcher tab: it comes into the game's first playthrough.
  const later = tabs.map((t) => (t.id === "a" ? { ...t, messages: [...t.messages, msg("m3", 300)], lastActive: 300 } : t));
  const s3 = importPlan(s2, await planMigration(later, {}, resolve, [], s2.tabMap), 400);
  assert.deepEqual(toTabs(s3).find((t) => t.id === "the-witcher-3")!.messages.map((m) => m.id), ["m1", "m3"]);
  // Deleted in the app: the old tab doesn't bring it back.
  const s4 = applyTabs(s3, toTabs(s3).filter((t) => t.id !== "steam:1145360"), 5000);
  const s5 = importPlan(s4, await planMigration(later, {}, resolve, [], s4.tabMap), 600);
  assert.ok(!toTabs(s5).some((t) => t.id === "steam:1145360"));
});

test("Keep separate: a merged game becomes one playthrough per compendium", async () => {
  const tabs = [tab("a", { name: "Witcher run", messages: [msg("m1", 10)], createdAt: 1 }), tab("b", { name: "Witcher DLC", messages: [msg("m2", 20), msg("m3", 30)], createdAt: 2 })];
  const s = importPlan(emptySpaces(), await planMigration(tabs, {}, resolve), 100);
  assert.equal(s.notice?.merges[0].tabs.length, 2);
  const split = splitMerged(s, "the-witcher-3");
  assert.deepEqual(playthroughsOf(split, "the-witcher-3").map((p) => [p.name, p.messages.map((m) => m.id).join(",")]), [["Witcher run", "m1"], ["Witcher DLC", "m2,m3"]]);
});

Promise.all(pending).then(() => console.log(`\n${passed} passed`));
