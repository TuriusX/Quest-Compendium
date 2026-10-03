// Run: npm run test:sync   (or: npx tsx tests/trackerPayload.test.ts)
import assert from "node:assert/strict";
import { buildTrackerPayload, type TrackerGuideArea } from "../src/utils/trackerPayload";
import type { AchievementGuide } from "../src/utils/achievementGuide";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const opts = { accent: "#a87ffb", gameKey: "g" };
const tab = (place?: any, messages: any[] = []) => ({ id: "t", name: "Game", messages, place }) as any;
const answer = (extra: any = {}) => ({ id: "m1", role: "assistant", text: "Answer", timestamp: 0, ...extra }) as any;
const area = (extra: Partial<TrackerGuideArea> = {}): TrackerGuideArea => ({
  key: "ff6", slug: "narshe", name: "Narshe", story: "Escape the mines", done: new Set<string>(),
  next: { slug: "figaro-castle", name: "Figaro Castle" },
  page: {
    key: "ff6", slug: "narshe", name: "Narshe", story: "Escape the mines", overview: "",
    items: [
      { id: "i1", name: "Elixir", where: "behind the waterfall" },
      { id: "i2", name: "Genji Glove", missable: true },
      { id: "i3", name: "Potion" },
    ],
    secrets: [{ id: "s1", text: "Hidden switch in the cave" }],
    enemies: [], shops: [], tips: [],
    sections: [
      { title: "Missable events", check: true, entries: [{ id: "e1", text: "Talk to the old man" }] },
      { title: "Notes", check: false, entries: [{ id: "x1", text: "Not a checklist" }] },
    ],
  },
  ...extra,
});
const ach: AchievementGuide = {
  key: "ff6",
  list: [
    { name: "Esper Hunter", desc: "", rarity: 10, icon: "", hidden: false, area: "narshe", how: "Defeat the Esper", missable: true },
    { name: "Secret One", desc: "", rarity: 2, icon: "", hidden: true, areaName: "Narshe", how: "Spoiler" },
    { name: "Elsewhere", desc: "", rarity: 50, icon: "", hidden: false, areaName: "Zozo" },
  ],
  roadmap: { noReturn: [{ point: "Leaving Narshe for good", lost: "The Genji Glove" }, { point: "The Floating Continent", lost: "Shadow" }] },
};

test("shows with no answers in the tab, just a known place and its guide", () => {
  const p = buildTrackerPayload(tab({ name: "Narshe", confirmed: true }), null, area(), ach, undefined, opts);
  assert.ok(p);
  assert.equal(p!.data.place?.name, "Narshe");
  assert.equal(p!.data.quest, "Escape the mines");
  assert.deepEqual(p!.data.sections.map((s) => s.id), ["missable", "noreturn", "collect", "ach"]);
  assert.equal(p!.data.next?.name, "Figaro Castle");
});
test("nothing to show without a place or an answer with markers", () => {
  assert.equal(buildTrackerPayload(tab(), answer({ text: "Hi" }), null, null, undefined, opts), null);
  assert.equal(buildTrackerPayload(tab(), null, null, null, undefined, opts), null);
});
test("missable: missable items and missable checklist sections; collect: the rest, in the guide's order", () => {
  const p = buildTrackerPayload(tab({ name: "Narshe", confirmed: true }), null, area(), null, undefined, opts)!;
  const miss = p.data.sections.find((s) => s.id === "missable")!;
  assert.deepEqual(miss.items.map((i) => i.label), ["Genji Glove", "Talk to the old man"]);
  assert.equal(miss.tone, "amber");
  const collect = p.data.sections.find((s) => s.id === "collect")!;
  assert.deepEqual(collect.items.map((i) => i.label), ["Elixir", "Potion", "Hidden switch in the cave"]);
  assert.equal(collect.items[0].id, "g:narshe:i1");
  assert.equal(collect.items[0].tick, true);
});
test("uncollected entries come first", () => {
  const p = buildTrackerPayload(tab({ name: "Narshe", confirmed: true }), null, area({ done: new Set(["i1"]) }), null, undefined, opts)!;
  const collect = p.data.sections.find((s) => s.id === "collect")!;
  assert.deepEqual(collect.items.map((i) => [i.label, !!i.done]), [["Potion", false], ["Hidden switch in the cave", false], ["Elixir", true]]);
});
test("point of no return: only the roadmap points for this area", () => {
  const p = buildTrackerPayload(tab({ name: "Narshe", confirmed: true }), null, area(), ach, undefined, opts)!;
  const nr = p.data.sections.find((s) => s.id === "noreturn")!;
  assert.deepEqual(nr.items.map((i) => [i.label, i.where]), [["Leaving Narshe for good", "The Genji Glove"]]);
  assert.equal(nr.items[0].tick, undefined);
});
test("achievements here: by area slug or name, done once unlocked on Steam, hidden ones keep their secret", () => {
  const p = buildTrackerPayload(tab({ name: "Narshe", confirmed: true }), null, area(), ach, undefined, { ...opts, achievements: [{ name: "Esper Hunter", unlocked: true } as any] })!;
  const a = p.data.sections.find((s) => s.id === "ach")!;
  assert.deepEqual(a.items.map((i) => i.label), ["Secret One", "Esper Hunter"]);
  assert.equal(a.items.find((i) => i.label === "Esper Hunter")!.done, true);
  assert.equal(a.items.find((i) => i.label === "Secret One")!.where, undefined);
});
test("the answer's markers and title count only while the answer is about the current place", () => {
  const here = answer({ title: "Find the Esper", place: { name: "Narshe", sure: true, options: [] }, points: [{ x: 1, y: 1, label: "Chest" }], donePoints: [0] });
  const p = buildTrackerPayload(tab({ name: "Narshe", confirmed: true }), here, area(), null, undefined, opts)!;
  assert.equal(p.data.quest, "Find the Esper");
  assert.deepEqual(p.data.sections[0].items.map((i) => [i.id, i.badge, !!i.done]), [["a:m1:0", 1, true]]);
  const elsewhere = answer({ title: "Board the airship", place: { name: "Zozo", sure: true, options: [] }, points: [{ x: 1, y: 1, label: "Chest" }] });
  const q = buildTrackerPayload(tab({ name: "Narshe", confirmed: true }), elsewhere, area(), null, undefined, opts)!;
  assert.equal(q.data.quest, "Escape the mines");
  assert.equal(q.data.sections.some((s) => s.id === "answer"), false);
  // Picked with "Track on screen": its markers show wherever it's about.
  const r = buildTrackerPayload(tab({ name: "Narshe", confirmed: true }), elsewhere, area(), null, undefined, { ...opts, pinned: true })!;
  assert.equal(r.data.sections[0].id, "answer");
});
test("no guide: falls back to the answer's markers, quest line and missable warning", () => {
  const msg = answer({ text: "Sorry about that.\nHead to the docks", place: { name: "Port", sure: false, options: [] }, points: [{ x: 1, y: 1, label: "Key", missable: true }] });
  const p = buildTrackerPayload(tab(), msg, null, null, { missable: "Missable: {list}" }, opts)!;
  assert.equal(p.data.quest, "Head to the docks");
  assert.equal(p.data.place?.name, "Port");
  assert.deepEqual(p.data.sections.map((s) => s.id), ["answer"]);
  assert.equal(p.data.warning, "Missable: Key");
  assert.equal(p.data.next, undefined);
});
test("the place's story beat becomes the quest line (and leaves the place line) when nothing better exists", () => {
  const p = buildTrackerPayload(tab({ name: "Ravaged Beach", confirmed: false, story: "Act 1: Waking on the beach" }), null, null, null, undefined, opts)!;
  assert.equal(p.data.quest, "Act 1: Waking on the beach");
  assert.equal(p.data.place?.story, undefined);
  assert.equal(p.data.sections.length, 0);
});

console.log(`\n${passed} tests passed`);
