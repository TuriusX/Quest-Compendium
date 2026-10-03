// Run: npm run test:sync   (or: npx tsx tests/questLog.test.ts)
import assert from "node:assert/strict";
import { buildTrackerPayload, type TrackerGuideArea } from "../src/utils/trackerPayload";
import { parseLocateMeReply } from "../locateMe";
import type { AchievementGuide } from "../src/utils/achievementGuide";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const opts = { accent: "#a87ffb", gameKey: "g" };
const tab = { id: "t", name: "BG3", messages: [], place: { name: "Overgrown Ruins", confirmed: true } } as any;
const areas = [
  { name: "Ravaged Beach", story: "The crash site where the game begins" },
  { name: "Overgrown Ruins", story: "The crypt area near the crash site" },
  { name: "Emerald Grove", story: "The druid settlement and refugee camp" },
];
const area = (slug: string, name: string, index: number): TrackerGuideArea => ({
  key: "bg3", slug, name, story: areas[index].story, done: new Set(), areas, index,
  next: areas[index + 1] ? { slug: "next", name: areas[index + 1].name, story: areas[index + 1].story } : null,
  page: { key: "bg3", slug, name, story: "", overview: "", items: [{ id: "i1", name: "Ring", where: "Dank Crypt" }], secrets: [], enemies: [], shops: [], tips: [] },
});
const ach: AchievementGuide = {
  key: "bg3",
  list: [{ name: "Descent From Avernus", desc: "", rarity: 30, icon: "", hidden: false, areaName: "Overgrown Ruins" }],
  roadmap: { noReturn: [{ point: "Leaving the Overgrown Ruins", lost: "The crypt's loot" }] },
};

test("entry ids are stable per area (so a hidden entry stays hidden), whatever their position", () => {
  const p = buildTrackerPayload(tab, null, area("overgrown-ruins", "Overgrown Ruins", 1), ach, undefined, opts)!;
  const ids = p.data.sections.flatMap((s) => s.items.map((i) => i.id));
  assert.ok(ids.includes("g:overgrown-ruins:i1"));
  assert.ok(ids.includes("n:overgrown-ruins:leaving the overgrown ruins"));
  assert.ok(ids.includes("h:overgrown-ruins:Descent From Avernus"));
});
test("the guide's areas and the current position go to the tracker (for ‹ › and the area list)", () => {
  const p = buildTrackerPayload(tab, null, area("overgrown-ruins", "Overgrown Ruins", 1), null, undefined, opts)!;
  assert.deepEqual(p.data.areas, { names: ["Ravaged Beach", "Overgrown Ruins", "Emerald Grove"], index: 1 });
  assert.equal(p.data.next?.name, "Emerald Grove");
  // No guide: no area navigation.
  const q = buildTrackerPayload(tab, null, null, null, undefined, opts)!;
  assert.equal(q.data.areas, undefined);
});
test("Locate me's state and message reach the tracker", () => {
  const p = buildTrackerPayload(tab, null, area("overgrown-ruins", "Overgrown Ruins", 1), null, undefined, { ...opts, locating: true, notice: "Couldn't tell" })!;
  assert.equal(p.data.locating, true);
  assert.equal(p.data.notice, "Couldn't tell");
  const q = buildTrackerPayload(tab, null, null, null, undefined, opts)!;
  assert.equal(q.data.locating, undefined);
  assert.equal(q.data.notice, undefined);
});
test("Locate me's reply: only an area from the list (exactly as listed), else unknown", () => {
  const names = areas.map((a) => a.name);
  assert.deepEqual(parseLocateMeReply('{"area":"emerald grove","story":"At the druid camp gates","confidence":"high"}', names),
    { area: "Emerald Grove", story: "At the druid camp gates", confidence: "high" });
  assert.deepEqual(parseLocateMeReply('{"area":"Baldur\'s Gate","story":"x","confidence":"high"}', names), { area: "unknown", story: "", confidence: "low" });
  assert.deepEqual(parseLocateMeReply('{"area":"unknown","confidence":"high"}', names), { area: "unknown", story: "", confidence: "low" });
  // A fenced reply and an odd confidence word.
  assert.deepEqual(parseLocateMeReply('```json\n{"area":"Ravaged Beach","story":"","confidence":"certain"}\n```', names),
    { area: "Ravaged Beach", story: "", confidence: "low" });
  assert.deepEqual(parseLocateMeReply("not json", names), { area: "unknown", story: "", confidence: "low" });
});

console.log(`\n${passed} tests passed`);
