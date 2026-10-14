// Run: npm run test:sync   (or: npx tsx tests/guideSteps.test.ts)
import assert from "node:assert/strict";
import { findQuest, findWalkStep, stepLabel, stepParts, questSection, walkSection, normName } from "../src/utils/guideSteps";
import { buildTrackerPayload } from "../src/utils/trackerPayload";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const ents = [
  { slug: "who-is-not-without-sin", name: "Who Is Not Without Sin", quest: true },
  { slug: "a-fisher-of-fish", name: "A Fisher of Fish", quest: true },
  { slug: "a-fisher-of-men", name: "A Fisher of Men", quest: true },
  { slug: "arthur-morgan", name: "Arthur Morgan" },
  { slug: "jack", name: "Jack", quest: true },
];

test("a quest named in the answer, by whole words and longest name first; never a non-quest or a too-short name", () => {
  assert.deepEqual(findQuest(ents, ["Next up is “Who Is Not Without Sin” at the Valentine church."]), { slug: "who-is-not-without-sin", name: "Who Is Not Without Sin" });
  assert.equal(findQuest(ents, ["A Fisher of Fish, part one: catch 13 fish"])?.slug, "a-fisher-of-fish");
  assert.equal(findQuest(ents, ["Arthur Morgan rides to Valentine"]), null);
  assert.equal(findQuest(ents, ["Jack is missing"]), null, "names under 8 letters don't count");
  assert.equal(findQuest(ents, ["a fisher of fisherman's tales"]), null, "whole words only");
});

test("a walkthrough step of the current area named in the answer's title", () => {
  const page = { walkthrough: [{ id: "w1", title: "Arrive at Colter" }, { id: "w3", title: "Clear Adler Ranch" }] };
  assert.equal(findWalkStep(page, "Clear Adler Ranch")?.id, "w3");
  assert.equal(findWalkStep(page, "Clear Adler Ranch with Sadie")?.id, "w3");
  assert.equal(findWalkStep(page, "Go fishing"), null);
});

test("quest steps read as things to do", () => {
  assert.equal(stepLabel("The player returns to Gill Landing to meet Gill at his cabin"), "Return to Gill Landing to meet Gill at his cabin");
  assert.equal(stepLabel("The player catches the fish."), "Catch the fish");
  assert.equal(stepLabel("The player carries the body to the doctor"), "Carry the body to the doctor");
  assert.equal(stepLabel("Mail each fish to Jeremy Gill"), "Mail each fish to Jeremy Gill");
  assert.ok(stepLabel("The player " + "rides very far ".repeat(10)).length <= 70);
});

test("a long quest step is split at its first clause: a short label and the rest as the dim line", () => {
  assert.deepEqual(stepParts("After all 13 fish are mailed, Gill sends an invitation letter to the post office"), { label: "After all 13 fish are mailed", rest: "Gill sends an invitation letter to the post office" });
  assert.deepEqual(stepParts("The player meets Gill"), { label: "Meet Gill" });
  assert.equal(stepParts("The player takes each caught fish to any post office and mails it to Jeremy Gill").label, "Take each caught fish to any post office and mail it to Jeremy Gill");
});

test("a quest section: the part being played, its steps ticked from the guide's ticks, missables as a line", () => {
  const q = {
    missables: ["The Electric Lantern"],
    parts: [
      { id: "p1", name: "Part I", where: "Gill Landing", steps: [{ id: "s1", text: "The player catches 13 fish" }, { id: "s2", text: "The player mails them" }] },
      { id: "p2", name: "Part II", steps: [{ id: "s3", text: "The player meets Gill" }] },
    ],
  };
  const first = questSection({ key: "rdr2", slug: "fish", name: "A Fisher of Fish" }, q, new Set(["s1"]))!;
  assert.equal(first.title, "A Fisher of Fish · Part 1 of 2");
  assert.deepEqual(first.items.map((i) => [i.id, i.done]), [["q:fish:s1", true], ["q:fish:s2", false]]);
  assert.equal(first.items[0].where, "Gill Landing");
  assert.equal(first.warning, "Missable: The Electric Lantern");
  const second = questSection({ key: "rdr2", slug: "fish", name: "A Fisher of Fish" }, q, new Set(["s1", "s2"]))!;
  assert.equal(second.title, "A Fisher of Fish · Part 2 of 2");
  assert.equal(second.items[0].label, "Meet Gill");
});

test("a walkthrough section: from the step on, titles as labels, a real missable warning gets ⚠ (not 'don't worry')", () => {
  const page = { walkthrough: [
    { id: "w1", title: "Arrive at Colter", text: "Look around. More text." },
    { id: "w2", title: "Scavenge the graves", text: "Inspect the grave.", warn: "Do not worry about missing Davey's grave now, it remains." },
    { id: "w3", title: "Clear Adler Ranch", text: "Fight the O'Driscoll.", warn: "The Adler Ranch letters are missable once you leave Colter." },
  ] };
  const s = walkSection({ slug: "chapter-1", name: "Outlaws from the West", from: "w2" }, page, new Set(["walk:w2"]))!;
  assert.deepEqual(s.items.map((i) => i.id), ["w:chapter-1:w2", "w:chapter-1:w3"]);
  assert.equal(s.items[0].done, true);
  assert.equal(s.items[0].missable, undefined);
  assert.equal(s.items[1].missable, true);
  assert.equal(s.items[1].detail?.missable, "The Adler Ranch letters are missable once you leave Colter.");
  assert.equal(s.items[1].where, "Fight the O'Driscoll.");
});

test("on the tracker: loaded steps replace the answer's objectives; the offer shows only while nothing is loaded", () => {
  const tab = { id: "t", name: "RDR2", messages: [], place: { name: "Valentine", confirmed: true } } as any;
  const msg = { id: "m1", role: "assistant", text: "A", timestamp: 0, place: { name: "Valentine", sure: true, options: [] }, steps: [{ kind: "step", text: "Ride to the church" }] } as any;
  const opts = { accent: "#a87ffb", gameKey: "g" };
  const offered = buildTrackerPayload(tab, msg, null, null, undefined, { ...opts, offer: { name: "Who Is Not Without Sin", count: 6 } })!;
  assert.deepEqual(offered.data.offer, { name: "Who Is Not Without Sin", n: 6 });
  assert.deepEqual(offered.data.sections.map((s) => s.id), ["answer"]);
  const loaded = buildTrackerPayload(tab, msg, null, null, undefined, { ...opts, offer: { name: "x", count: 1 }, guideSteps: { title: "Who Is Not Without Sin", items: [{ id: "q:w:s1", label: "Go to church", tick: true }], warning: "Missable: a hat" } })!;
  assert.deepEqual(loaded.data.sections.map((s) => s.id), ["guide"]);
  assert.equal(loaded.data.offer, undefined);
  assert.equal(loaded.data.warning, "Missable: a hat");
});

test("names compare without quotes, case or punctuation", () => {
  assert.equal(normName("“Who Is Not Without Sin”"), normName("who is not without sin"));
  assert.equal(normName("O’Driscoll's Den"), normName("ODriscolls den"));
});

console.log(`\n${passed} tests passed`);
