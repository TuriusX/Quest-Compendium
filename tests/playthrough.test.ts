// Run: npm run test:sync   (or: npx tsx tests/playthrough.test.ts)
import assert from "node:assert/strict";
import { addEntries, editEntry, removeEntry, clearPlaythrough, mergePlaythrough, playthroughForRequest, emptyPlaythrough, PLAY_MAX, PLAY_CONTEXT_MAX } from "../src/utils/playthrough";
import { extractDone } from "../src/utils/progressMemory";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("entries: newest first, no repeats, at most PLAY_MAX of each kind", () => {
  let p = addEntries(emptyPlaythrough(), [{ kind: "choice", text: "Sided with the druids", source: "answer" }], 1);
  p = addEntries(p, [{ kind: "choice", text: "sided with the  Druids!", source: "answer" }], 2);
  assert.equal(p.entries.length, 1);
  for (let i = 0; i < 30; i++) p = addEntries(p, [{ kind: "found", text: `Item number ${i}`, source: "guide" }], 10 + i);
  assert.equal(p.entries.filter((e) => e.kind === "found").length, PLAY_MAX);
  assert.equal(p.entries.filter((e) => e.kind === "choice").length, 1, "guide ticks never push out choices");
  assert.equal(p.entries[0].text, "Item number 29");
});
test("edit, delete and clear", () => {
  let p = addEntries(emptyPlaythrough(), [{ kind: "choice", text: "Spared the goblin", source: "answer" }], 1);
  const id = p.entries[0].id;
  p = editEntry(p, id, "Killed the goblin", 2);
  assert.equal(p.entries[0].text, "Killed the goblin");
  assert.equal(p.entries[0].source, "you");
  p = removeEntry(p, id, 3);
  assert.equal(p.entries.length, 0);
  assert.ok(p.deleted[id]);
  const c = clearPlaythrough(addEntries(p, [{ kind: "found", text: "Moonlantern", source: "answer" }], 4), 5);
  assert.equal(c.entries.length, 0);
  assert.equal(c.clearedAt, 5);
});
test("merging two computers' copies: union by id, deletions and clears win", () => {
  const now = Date.now();
  const a = addEntries(emptyPlaythrough(), [{ kind: "choice", text: "Joined the Harpers", source: "answer" }], now - 5000);
  const b = addEntries(emptyPlaythrough(), [{ kind: "found", text: "Blood of Lathander", source: "answer" }], now - 4000);
  const m = mergePlaythrough(a, b);
  assert.equal(m.entries.length, 2);
  const del = removeEntry(m, a.entries[0].id, now - 3000);
  assert.equal(mergePlaythrough(del, a).entries.length, 1, "a deleted entry stays deleted");
  const cleared = clearPlaythrough(m, now - 2000);
  assert.equal(mergePlaythrough(a, cleared).entries.length, 0, "a clear drops everything noted before it");
});
test("what a question sends: choices first, notes as plain words, never over the limit", () => {
  let p = addEntries(emptyPlaythrough(), [{ kind: "found", text: "Moonlantern", source: "answer" }, { kind: "choice", text: "Sided with the tieflings", source: "answer" }], 1);
  const r = playthroughForRequest(p, "<p><strong>Insight:</strong> Lae'zel   is in camp</p>")!;
  assert.deepEqual(r.choices, ["Sided with the tieflings"]);
  assert.deepEqual(r.found, ["Moonlantern"]);
  assert.equal(r.notes, "Insight: Lae'zel is in camp");
  assert.equal(playthroughForRequest({ ...p, notesInAnswers: false }, "secret")!.notes, "");
  for (let i = 0; i < 20; i++) p = addEntries(p, [{ kind: "choice", text: "A long choice the player made in this game, number " + i + " ".repeat(40) + "x", source: "you" }], 10 + i);
  const big = playthroughForRequest(p, "n".repeat(5000))!;
  assert.ok([...big.choices, ...big.found].join(" | ").length + big.notes.length <= PLAY_CONTEXT_MAX + 60);
  assert.equal(playthroughForRequest(emptyPlaythrough(), ""), null);
});
test("<qc-done> objects: choices and key items, apart from finished things", () => {
  const r = extractDone('Go left.\n<qc-done>["Defend the gate", {"choice": "Sided with the tieflings"}, {"found": "Moonlantern"}, {"found": "x"}]</qc-done>');
  assert.equal(r.text, "Go left.");
  assert.deepEqual(r.done, ["Defend the gate"]);
  assert.deepEqual(r.remember, [{ kind: "choice", text: "Sided with the tieflings" }, { kind: "found", text: "Moonlantern" }]);
});
console.log(`\n${passed} tests passed`);
