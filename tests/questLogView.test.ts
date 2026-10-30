// Run: npm run test:sync   (or: npx tsx tests/questLogView.test.ts)
import assert from "node:assert/strict";
import { buildLogView, isGoalAnswer, objectiveForRequest, nextLogState } from "../src/utils/questLogView";
import type { TrackerData } from "../src/utils/trackerPayload";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const opts = { gameKey: "g", accent: "#a87ffb" };
const answer = (doneSteps: number[] = []) => ({
  id: "a1", role: "assistant", text: "You need both halves.", timestamp: 1, title: "Reach the Haligtree",
  steps: [
    { kind: "step", text: "Get the left half from Albus", label: "Left half from Albus", where: "Village of the Albinaurics" },
    { kind: "step", text: "Get the right half at Castle Sol" },
    { kind: "warning", text: "Burning the Erdtree turns Leyndell to ash", label: "Finish Leyndell first" },
    { kind: "step", text: "Use both halves on the Grand Lift of Rold" },
    { kind: "step", text: "Light the candles in Ordina" },
  ],
  doneSteps,
}) as any;
const tab = (extra: any = {}) => ({ id: "t", name: "Elden Ring", messages: [{ id: "q1", role: "user", text: "How do I get to the Haligtree?", timestamp: 0 }, answer()], ...extra }) as any;
const guide: TrackerData = {
  id: "", accent: "#a87ffb", quest: "Reach Godrick at the top of the castle", place: { name: "Stormveil Castle", sure: true },
  sections: [
    { id: "answer", title: "From your last answer", items: [{ id: "s:a1:0", label: "x", tick: true }] },
    { id: "missable", title: "Missable here", tone: "amber", items: [{ id: "g:sv:m1", label: "Talk to Gostoc", tick: true, detail: { missable: "He leaves after Godrick" } }] },
    { id: "collect", title: "To collect", items: [
      { id: "g:sv:c1", label: "Liftside Chamber grace", tick: true, done: true },
      { id: "g:sv:c2", label: "Secluded Cell grace", tick: true },
      { id: "g:sv:c3", label: "Golden Seed", tick: true },
      { id: "g:sv:c4", label: "Smithing Stone", tick: true },
    ] },
  ],
};

test("nothing set as Now: the guide fills in (its story beat, then unticked entries), marked as the guide's", () => {
  const v = buildLogView(tab(), guide, opts)!;
  assert.equal(v.now?.source, "guide");
  assert.equal(v.now?.text, "Reach Godrick at the top of the castle");
  assert.equal(v.now?.tick, false);
  assert.deepEqual(v.next.map((s) => s.text), ["Secluded Cell grace", "Golden Seed"]);
  assert.equal(v.watch?.text, "Talk to Gostoc", "the area's missable is the Watch out");
  assert.equal(v.invite, false, "something was asked");
  assert.ok(!v.more.some((x) => x.id === "answer"), "the answer's old section is gone; the guide's lists are behind Show more");
  assert.equal(v.bookmark, 4, "unticked entries here");
});

test("nothing asked yet: the log invites a question", () => {
  assert.equal(buildLogView({ ...tab(), messages: [] }, guide, opts)!.invite, true);
});

test("Set as Now: the answer's steps (warnings aside), Now the first unticked, Next the 2-3 after, its warning first in Watch out", () => {
  const v = buildLogView(tab({ messages: [tab().messages[0], answer([0])], questLog: { now: "a1" } }), guide, opts)!;
  assert.equal(v.now?.source, "question");
  assert.equal(v.now?.id, "s:a1:1", "the same tick ids as under the answer");
  assert.equal(v.now?.goal, "Reach the Haligtree");
  assert.deepEqual([v.now?.doneCount, v.now?.total], [1, 4]);
  assert.deepEqual(v.next.map((s) => s.id), ["s:a1:3", "s:a1:4"]);
  assert.equal(v.watch?.text, "Finish Leyndell first");
  assert.equal(v.bookmark, 3, "steps left on the goal");
});

test("labels with a where line; ✕ hides a warning for good, the next one shows", () => {
  const v = buildLogView(tab({ questLog: { now: "a1", hidden: ["s:a1:2"] } }), guide, opts)!;
  assert.equal(v.now?.text, "Left half from Albus");
  assert.equal(v.now?.sub, "Village of the Albinaurics");
  assert.equal(v.watch?.text, "Talk to Gostoc");
});

test("every step ticked: Done with the goal, no Now", () => {
  const v = buildLogView(tab({ messages: [answer([0, 1, 3, 4])], questLog: { now: "a1" } }), null, opts)!;
  assert.equal(v.now, null);
  assert.deepEqual(v.done, { goal: "Reach the Haligtree", msgId: "a1" });
});

test("loaded guide steps are Now when no question is set; pins list their answers' titles", () => {
  const v = buildLogView(tab({ questLog: { pins: ["a1", "gone"] } }), guide, { ...opts, loaded: { title: "Stranger: Duncan", items: [{ id: "quest:x:0", label: "Meet Duncan", tick: true, done: true }, { id: "quest:x:1", label: "Ride to the camp", tick: true }], warning: "Don't kill Duncan" } })!;
  assert.equal(v.now?.source, "loaded");
  assert.equal(v.now?.text, "Ride to the camp");
  assert.equal(v.watch?.text, "Don't kill Duncan");
  assert.deepEqual(v.pins, [{ id: "a1", title: "Reach the Haligtree" }], "a pin whose answer is gone is left out");
});

test("a goal is two things to do or more; a battle plan isn't one", () => {
  assert.equal(isGoalAnswer(answer()), true);
  assert.equal(isGoalAnswer({ ...answer(), combat: true }), false);
  assert.equal(isGoalAnswer({ ...answer(), steps: [{ kind: "step", text: "One thing" }] }), false);
});

test("what a newer question could tick: the objective's unticked steps", () => {
  const o = objectiveForRequest(tab({ messages: [answer([0])], questLog: { now: "a1" } }))!;
  assert.equal(o.title, "Reach the Haligtree");
  assert.deepEqual(o.steps.map((s) => s.i), [1, 3, 4]);
  assert.equal(objectiveForRequest(tab()), null);
});

test("the state stays small", () => {
  assert.equal(nextLogState({ now: "a1" }, { now: undefined }), undefined);
  assert.deepEqual(nextLogState(undefined, { pins: ["a1"] }), { pins: ["a1"] });
});

console.log(`\n${passed} passed`);
