// Run: npm run test:sync   (or: npx tsx tests/corrections.test.ts)
import assert from "node:assert/strict";
import { extractCorrections, isPushback, matchGuideEntry, playerHash, groupId } from "../corrections";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

// BG3, Ravaged Beach: the entries the Scuffed Rock confusion was about.
const page = {
  items: [
    { id: "x1", name: "Thieves' Tools", where: "Inside a wooden crate near the dock on the western side of the beach" },
    { id: "x2", name: "Harper's Map", where: "Inside an Ornate Chest concealed underneath the Scuffed Rock" },
  ],
  secrets: [{ id: "x4", text: "A Harper cache concealed beneath the Scuffed Rock along the western cliffs; jump down the ledges near the water, pass a passive Nature check to spot drag marks, and use a character with sufficient Strength to shove the boulder aside." }],
  sections: [{ title: "Don't miss", check: true, entries: [{ id: "m1", text: "Loot the Harper cache before leaving the beach" }] }],
};

test("the <qc-correction> line is read and always removed from the answer", () => {
  const answer = "You're right, my mistake. The Scuffed Rock is the boulder by the fallen log.\n\n" +
    '<qc-correction>{"entry": "A Harper cache concealed beneath the Scuffed Rock", "guide": "along the western cliffs", "claim": "The Scuffed Rock is the boulder next to the fallen log at the bottom of the first cliff path", "field": "where"}</qc-correction>';
  const r = extractCorrections(answer);
  assert.equal(r.text.includes("qc-correction"), false);
  assert.equal(r.corrections.length, 1);
  assert.equal(r.corrections[0].field, "where");
  assert.match(r.corrections[0].claim, /fallen log/);
  // Broken or empty lines are dropped (and still removed).
  const bad = extractCorrections('Text <qc-correction>{not json}</qc-correction> <qc-correction>{"entry": "", "claim": "x"}</qc-correction>');
  assert.deepEqual(bad.corrections, []);
  assert.equal(bad.text.includes("<qc-"), false);
});

test("pushback is recognised (and ordinary questions aren't)", () => {
  for (const q of ["that's wrong", "It's not there", "actually it was right in front of me", "you're wrong about the rock", "nope, not there", "no está ahí", "das stimmt nicht"]) assert.equal(isPushback(q), true, q);
  for (const q of ["where is the scuffed rock?", "how do I open the chest", "what's in this area"]) assert.equal(isPushback(q), false, q);
});

test("a correction is matched to the guide entry by name, or by the start of a secret or checklist line", () => {
  assert.equal(matchGuideEntry(page as any, "Harper's Map")?.id, "x2");
  assert.equal(matchGuideEntry(page as any, "harpers map")?.id, "x2");
  assert.equal(matchGuideEntry(page as any, "A Harper cache concealed beneath the Scuffed Rock")?.id, "x4");
  assert.equal(matchGuideEntry(page as any, "A Harper cache concealed beneath the Scuffed Rock")?.kind, "secret");
  assert.equal(matchGuideEntry(page as any, "Loot the Harper cache before leaving")?.id, "m1");
  // A whole line copied from the guide notes, label and all (what the model did in the Scuffed Rock test).
  assert.equal(matchGuideEntry(page as any, "Secret: A Harper cache concealed beneath the Scuffed Rock along the western cliffs; jump down the ledges near the water, pass a passive Nature check to spot dra")?.id, "x4");
  assert.equal(matchGuideEntry(page as any, "Item: Harper's Map (Inside an Ornate Chest concealed underneath the Scuffed Rock) [missable]")?.id, "x2");
  assert.equal(matchGuideEntry(page as any, "Don't miss: Loot the Harper cache before leaving the beach")?.id, "m1");
  // Something the guide doesn't have: nothing is saved.
  assert.equal(matchGuideEntry(page as any, "Astarion"), null);
  assert.equal(matchGuideEntry(page as any, "ab"), null);
});

test("players are anonymised, and reports group by game, area and entry", () => {
  assert.equal(playerHash("uid-1"), playerHash("uid-1"));
  assert.notEqual(playerHash("uid-1"), playerHash("uid-2"));
  assert.equal(playerHash("uid-1").includes("uid"), false);
  assert.equal(groupId("baldur-s-gate-3", "ravaged-beach", "x4"), "baldur-s-gate-3__ravaged-beach__x4");
});

console.log(`\n${passed} tests passed`);
