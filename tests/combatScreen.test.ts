// Run: npm run test:sync   (or: npx tsx tests/combatScreen.test.ts)
import assert from "node:assert/strict";
import { combatRules, MARKER_LIMIT, COMBAT_MARKER_LIMIT } from "../answerBar";
import { buildTrackerPayload, trackedMessage } from "../src/utils/trackerPayload";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const place = { name: "Emerald Grove", sure: true, options: [] };
const fight = { id: "m1", role: "assistant", text: "", timestamp: 1, combat: true, place,
  steps: [{ kind: "step", text: "Kill the goblin archer on the palisade first" }] } as any;
const tab = (messages: any[]) => ({ id: "t", name: "BG3", messages, place: { name: "Emerald Grove", confirmed: true } }) as any;
const build = (t: any, m: any, pinned = false) =>
  buildTrackerPayload(t, m, null, null, { secBattle: "Battle plan", nextTurn: "Next turn (asks a question)" }, { accent: "#a87ffb", gameKey: "g", pinned })!;

test("combat markers: every important enemy (up to 8) with threat tags, the top 2-3 ranked, positions with the action", () => {
  assert.equal(MARKER_LIMIT, 5);
  assert.equal(COMBAT_MARKER_LIMIT, 8);
  const r = combatRules(true);
  assert.match(r, /Mark up to 8/);
  assert.match(r, /every important enemy visible/);
  assert.match(r, /threat tag of 2-5 words/);
  assert.match(r, /"rank": 1, 2, 3 on the top 2-3 targets in kill order/);
  assert.match(r, /"Jump \(Z\) here" \/\s+"high ground \+2"/);
  assert.match(r, /Chokepoint/);
  assert.match(r, /when the fight is over \(no turn order, no End Turn button/);
});

test("the Battle plan has a Next turn button; normal steps don't", () => {
  assert.equal(build(tab([fight]), fight).data.sections[0].nextTurn, true);
  const calm = { ...fight, id: "m2", combat: undefined };
  assert.equal(build(tab([calm]), calm).data.sections[0].nextTurn, undefined);
});

test("a later screenshot with no fight turns the Battle plan back into normal steps", () => {
  const after = { id: "m2", role: "assistant", text: "", timestamp: 2, noFight: true, place, steps: [{ kind: "step", text: "Loot Za'Krug's body" }] } as any;
  const t = tab([fight, after]);
  // The latest answer: normal steps.
  const m = trackedMessage(t, null)!;
  assert.equal(m.id, "m2");
  const s = build(t, m).data.sections[0];
  assert.notEqual(s.title, "Battle plan");
  assert.equal(s.nextTurn, undefined);
  // A battle plan picked with "Track on screen" stops once the fight is over.
  assert.equal(trackedMessage(t, "m1")!.id, "m2");
  // ...but stays while the fight goes on.
  assert.equal(trackedMessage(tab([fight, { ...after, noFight: undefined }]), "m1")!.id, "m1");
});

console.log(`\n${passed} tests passed`);
