// Run: npm run test:sync   (or: npx tsx tests/questLogView.test.ts)
import assert from "node:assert/strict";
import { buildLogView, isGoalAnswer, objectiveForRequest, nextLogState, taskOf } from "../src/utils/questLogView";
import type { TrackerData } from "../src/utils/trackerPayload";
import { mergeTabState, sanitizeTabsForCloud } from "../src/hooks/tabMerge";
import { gameSpacesOn } from "../src/utils/learnedGames";

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
      { id: "g:sv:c3", label: "Golden Seed", tick: true, icon: "item" },
      { id: "g:sv:c4", label: "Smithing Stone", tick: true },
    ] },
  ],
};

const walk = {
  slug: "stormveil-castle",
  done: new Set(["walk:w1"]),
  steps: [
    { id: "w1", title: "Castle Approach", text: "After overcoming Margit, the Fell Omen at the castle entryway, you will reach the Stormveil Main Gate Site of Grace." },
    { id: "w2", title: "Southwestern Cliffs and Tombs", text: "Cross the narrow rock bridge beyond Zamor Ruins past Shabriri to reach the Giant-Conquering Hero's Grave, where you can rest." },
    { id: "w3", title: "Cross the Bridge and Claim the Bat", text: "Head across the river bridge west of Hello Work." },
    { id: "w4", title: "The Secluded Cell", text: "Returning to the upper castle grounds, locate Nepheli Loux inside an interior room." },
  ],
};

test("nothing set as Now: the guide fills in with its walkthrough's next step as a task (ticked like the walkthrough), never the area's description", () => {
  const v = buildLogView(tab(), guide, { ...opts, walk })!;
  assert.equal(v.now?.source, "guide");
  assert.equal(v.now?.id, "w:stormveil-castle:w2", "the walkthrough's own tick");
  assert.equal(v.now?.tick, true);
  assert.equal(v.now?.text, "Reach the Giant-Conquering Hero's Grave: cross the narrow rock bridge beyond Zamor Ruins past Shabriri");
  assert.equal(v.now?.sub, "Southwestern Cliffs and Tombs");
  assert.deepEqual(v.next.map((s) => s.text), ["Cross the Bridge and Claim the Bat: head across the river bridge west of Hello Work", "Locate Nepheli Loux inside an interior room"]);
  assert.ok(![v.now?.text, ...v.next.map((s) => s.text)].includes(guide.quest), "not the story line");
});

test("without a walkthrough: the guide's unticked entries, items as \"Get …\"", () => {
  const v = buildLogView(tab(), guide, { ...opts, labels: { logGetItem: "Get {item}" } })!;
  assert.equal(v.now?.source, "guide");
  assert.equal(v.now?.text, "Secluded Cell grace");
  assert.deepEqual(v.next.map((s) => s.text), ["Get Golden Seed", "Smithing Stone"]);
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

test("with the current tabs (game spaces off): Now, pins and hidden warnings live on the tab, go to the cloud with it, and the newer device wins", () => {
  assert.equal(gameSpacesOn(), false, "game spaces are off here (no flag, no VITE_GAME_SPACES)");
  const mine = { ...tab({ questLog: { now: "a1", pins: ["a1"], hidden: ["s:a1:2"] } }), notes: "", createdAt: 1, lastActive: 5000 };
  const cloud = sanitizeTabsForCloud([mine])[0] as any;
  assert.deepEqual(cloud.questLog, { now: "a1", pins: ["a1"], hidden: ["s:a1:2"] }, "kept in what's written to the account");
  const other = { ...mine, questLog: { now: "a1" }, lastActive: 4000 }; // another device, older
  const r = mergeTabState({ tabs: [mine], deleted: {} }, { tabs: [other], deleted: {} });
  assert.deepEqual(r.merged.tabs[0].questLog, mine.questLog, "this device's newer log is kept");
  assert.equal(r.cloudChanged, true, "and uploaded");
  // Next session: the same tab, from storage, gives the same log.
  const again = buildLogView(JSON.parse(JSON.stringify(r.merged.tabs[0])), null, opts)!;
  assert.equal(again.now?.id, "s:a1:0");
  assert.deepEqual(again.pins.map((p) => p.id), ["a1"]);
});

test("walkthrough steps as tasks (real guide sentences)", () => {
  const t = (title: string, text: string) => { const r = taskOf(title, text); return r.sub ? `${r.text} [${r.sub}]` : r.text; };
  assert.equal(t("Gatefront and Agheel Lake", "Rest at the Gatefront Site of Grace to meet Melina, who gives you Torrent."), "Meet Melina: rest at the Gatefront Site of Grace [Gatefront and Agheel Lake]");
  assert.equal(t("Castle Approach", "After overcoming Margit, the Fell Omen at the castle entryway, you will reach the Stormveil Main Gate Site of Grace."), "Reach the Stormveil Main Gate Site of Grace [Castle Approach]");
  assert.equal(t("East Limgrave", "Find D, Hunter of the Dead resting west of Summonwater Village, then search the ruins."), "Find D, Hunter of the Dead resting west of Summonwater Village [East Limgrave]");
  assert.equal(t("Waking on the Riverbank", "From the crash site (X: 230, Y: 208), head north along the sand to find Shadowheart unconscious at the shore."), "Find Shadowheart unconscious at the shore: head north along the sand [Waking on the Riverbank]");
  assert.equal(t("Coastal Cave", "You can also give the needle to Boc at the cave entrance."), "Give the needle to Boc at the cave entrance [Coastal Cave]");
  assert.equal(t("Battle the Street Thugs", "Immediately after Kasuga draws the weapon, you are forced into combat on the bridge."), "Battle the Street Thugs [You are forced into combat on the bridge]");
  assert.equal(t("Southern Peaks", "Head south to reach the Whiteridge Road Site of Grace and clear the Guardians' Garrison fort."), "Reach the Whiteridge Road Site of Grace: head south [Southern Peaks]");
});

console.log(`\n${passed} passed`);
