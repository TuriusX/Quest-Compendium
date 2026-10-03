// Run: npm run test:sync   (or: npx tsx tests/questLog.test.ts)
import assert from "node:assert/strict";
import { buildTrackerPayload, type TrackerGuideArea } from "../src/utils/trackerPayload";
import { parseLocateMeReply, seenTextNamesArea } from "../locateMe";
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
test("an entry's details carry the full guide text (not the trimmed line); hidden achievements keep their secret", () => {
  const longWhere = "In the Dank Crypt, behind the false wall left of the sarcophagus: push the lever twice, then climb the broken stairs to the alcove.";
  const longHow = "Defeat the Nautiloid's commander after freeing Shadowheart, then make your way through the burning corridors to the helm before the ship crashes.";
  const a = area("overgrown-ruins", "Overgrown Ruins", 1);
  a.page = { ...a.page!, items: [{ id: "i1", name: "Ring", where: longWhere, notes: "Worth 300 gold.", missable: true }],
    sections: [{ title: "Don't miss", check: true, entries: [{ id: "m1", text: "Talk to Withers before leaving the crypt" }] }] };
  const guide: AchievementGuide = { key: "bg3", list: [
    { name: "Descent From Avernus", desc: "Escape the Nautiloid.", rarity: 30, icon: "", hidden: false, areaName: "Overgrown Ruins", how: longHow },
    { name: "Secret One", desc: "Hidden.", rarity: 5, icon: "", hidden: true, areaName: "Overgrown Ruins", how: "A spoiler" },
  ] };
  const p = buildTrackerPayload(tab, null, a, guide, undefined, opts)!;
  const items = p.data.sections.flatMap((s) => s.items);
  const ring = items.find((i) => i.id === "g:overgrown-ruins:i1")!;
  assert.equal(ring.detail?.where, longWhere);
  assert.equal(ring.detail?.notes, "Worth 300 gold.");
  // A missable checklist line says what it's in (the section), its text is the whole entry.
  const withers = items.find((i) => i.id === "g:overgrown-ruins:m1")!;
  assert.equal(withers.detail?.full, "Talk to Withers before leaving the crypt");
  assert.equal(withers.detail?.missable, "Don't miss");
  const descent = items.find((i) => i.id.startsWith("h:") && i.label === "Descent From Avernus")!;
  assert.ok(descent.where!.length <= 90); // the line on the tracker is trimmed…
  assert.equal(descent.detail?.how, longHow); // …its details are not
  assert.equal(items.find((i) => i.label === "Secret One")!.detail, undefined);
});
test("Locate me's reply: only an area from the list (exactly as listed), else unknown; read needs the text", () => {
  const names = areas.map((a) => a.name);
  assert.deepEqual(parseLocateMeReply('{"area":"emerald grove","story":"At the druid camp gates","evidence":"read","seenText":"Emerald Grove"}', names),
    { area: "Emerald Grove", story: "At the druid camp gates", evidence: "read", seenText: "Emerald Grove" });
  // "read" without any quoted text is a guess.
  assert.equal(parseLocateMeReply('{"area":"Emerald Grove","story":"x","evidence":"read","seenText":""}', names).evidence, "guessed");
  assert.deepEqual(parseLocateMeReply('{"area":"Baldur\'s Gate","story":"x","evidence":"read","seenText":"Baldur\'s Gate"}', names),
    { area: "unknown", story: "", evidence: "guessed", seenText: "" });
  // A fenced reply, an odd evidence word.
  assert.deepEqual(parseLocateMeReply('```json\n{"area":"Ravaged Beach","story":"","evidence":"certain","seenText":"Ravaged Beach"}\n```', names),
    { area: "Ravaged Beach", story: "", evidence: "guessed", seenText: "Ravaged Beach" });
  assert.deepEqual(parseLocateMeReply("not json", names), { area: "unknown", story: "", evidence: "guessed", seenText: "" });
});
test("Locate me's read check: the seen text must name that area, or one of its sub-locations in the guide", () => {
  const guideAreas = [
    { slug: "ravaged-beach", name: "Ravaged Beach", story: "" },
    { slug: "overgrown-ruins", name: "Overgrown Ruins", story: "" },
    { slug: "emerald-grove", name: "Emerald Grove", story: "" },
  ];
  const pages = {
    "overgrown-ruins": { key: "bg3", slug: "overgrown-ruins", name: "Overgrown Ruins", story: "", overview: "", tips: [], sections: [], secrets: [], enemies: [], shops: [],
      items: [{ id: "i1", name: "Ring", where: "Dank Crypt inside a heavy chest" }, { id: "i2", name: "Sword", where: "Dank Crypt sarcophagus" }] },
  };
  assert.equal(seenTextNamesArea("Ravaged Beach", "Ravaged Beach", guideAreas, pages), true); // the minimap label
  assert.equal(seenTextNamesArea("RAVAGED BEACH", "Ravaged Beach", guideAreas, pages), true);
  assert.equal(seenTextNamesArea("Overgrown Ruins - Dank Crypt", "Overgrown Ruins", guideAreas, pages), true);
  assert.equal(seenTextNamesArea("Dank Crypt", "Overgrown Ruins", guideAreas, pages), true); // a sub-location
  assert.equal(seenTextNamesArea("Emerald Grove", "Overgrown Ruins", guideAreas, pages), false); // another area's name
  assert.equal(seenTextNamesArea("Dank Crypt", "Emerald Grove", guideAreas, pages), false); // a sub-location elsewhere
  assert.equal(seenTextNamesArea("Waukeen's Rest", "Ravaged Beach", guideAreas, pages), false); // not in the guide here
  assert.equal(seenTextNamesArea("", "Ravaged Beach", guideAreas, pages), false);
});

console.log(`\n${passed} tests passed`);
