// Run: npm run test:sync   (or: npx tsx tests/guideMatch.test.ts)
import assert from "node:assert/strict";
import { matchGuideArea } from "../src/utils/guideMatch";
import { buildTrackerPayload } from "../src/utils/trackerPayload";
import type { GuideAreaInfo, GuidePage } from "../src/utils/guideApi";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const page = (slug: string, name: string, extra: Partial<GuidePage> = {}): GuidePage => ({
  key: "g", slug, name, story: "", overview: "", items: [], secrets: [], enemies: [], shops: [], tips: [], sections: [], ...extra,
});

// FINAL FANTASY VI (the guide's own area names and story beats; Duncan's Cabin isn't one of its areas).
const ff6: GuideAreaInfo[] = [
  { slug: "narshe", name: "Narshe", story: "The game begins as Terra and two Imperial soldiers march on Narshe" },
  { slug: "figaro-castle", name: "Figaro Castle", story: "Terra and Locke meet King Edgar" },
  { slug: "south-figaro", name: "South Figaro", story: "After emerging from the cave to purchase supplies and gather information on the Empire" },
  { slug: "mt-kolts", name: "Mt. Kolts", story: "While traversing the mountain route, where the party defeats Vargas and Sabin joins" },
  { slug: "returners-hideout", name: "Returners' Hideout", story: "The party meets Banon and the Returners" },
];
// Baldur's Gate 3 (real "where" text from the Overgrown Ruins and Emerald Grove pages).
const bg3: GuideAreaInfo[] = [
  { slug: "nautiloid", name: "Nautiloid", story: "Escaping the mind flayer ship" },
  { slug: "ravaged-beach", name: "Ravaged Beach", story: "The crash site where the game begins" },
  { slug: "overgrown-ruins", name: "Overgrown Ruins", story: "The crypt area near the crash site" },
  { slug: "emerald-grove", name: "Emerald Grove", story: "The druid settlement and refugee camp" },
];
const bg3Pages: Record<string, GuidePage> = {
  "ravaged-beach": page("ravaged-beach", "Ravaged Beach", { items: [{ id: "i1", name: "Thieves' Tools", where: "Inside a wooden crate near the dock" }] }),
  "overgrown-ruins": page("overgrown-ruins", "Overgrown Ruins", {
    items: [
      { id: "i1", name: "Shortsword", where: "Dank Crypt inside the central trapped sarcophagus" },
      { id: "i2", name: "Ring", where: "Dank Crypt inside a heavy chest in the hidden inner sanctum where Withers awakens" },
    ],
  }),
  "emerald-grove": page("emerald-grove", "Emerald Grove", {
    items: [
      { id: "i1", name: "Idol", where: "Emerald Grove, resting on the main stone altar inside the Hidden Vault beneath the Enclave Library" },
      // A passing mention of the crypt elsewhere: fewer mentions than the Overgrown Ruins, so it doesn't win.
      { id: "i2", name: "Note", where: "Carried by a tiefling who fled the Dank Crypt" },
    ],
  }),
};

test("a place that is an area by name wins (no fallback)", () => {
  assert.deepEqual(matchGuideArea(ff6, "South Figaro, Relic Shop", undefined), { index: 2, via: "name" });
});
test("FF6 Duncan's Cabin, (a) sub-location: the area whose entries are 'where' Duncan's Cabin", () => {
  const pages: Record<string, GuidePage> = {
    "mt-kolts": page("mt-kolts", "Mt. Kolts", { items: [{ id: "i1", name: "Tent", where: "Duncan's Cabin, on the table by the door" }] }),
    "south-figaro": page("south-figaro", "South Figaro", { items: [{ id: "i1", name: "Potion", where: "Item shop" }] }),
  };
  assert.deepEqual(matchGuideArea(ff6, "Duncan's Cabin", undefined, pages), { index: 3, via: "sub" });
  // Section headings and shop names count too.
  const byHeading = { "south-figaro": page("south-figaro", "South Figaro", { sections: [{ title: "Duncan's Cabin", check: true, entries: [] }] }) };
  assert.deepEqual(matchGuideArea(ff6, "Duncan's Cabin", undefined, byHeading), { index: 2, via: "sub" });
});
test("FF6 Duncan's Cabin, (b) story beat: the area the saved story beat names", () => {
  // The real saved progress: not an area by name, no page mentions it as a sub-location.
  const m = matchGuideArea(ff6, "Duncan's Cabin", "Early game: Terra, Edgar and Locke heading to Mt. Kolts", {});
  assert.deepEqual(m, { index: 3, via: "story" });
});
test("BG3 Dank Crypt, (a) sub-location: the Overgrown Ruins (most mentions), not the area that names it once", () => {
  assert.deepEqual(matchGuideArea(bg3, "Dank Crypt", undefined, bg3Pages), { index: 2, via: "sub" });
  assert.deepEqual(matchGuideArea(bg3, "Hidden Vault", undefined, bg3Pages), { index: 3, via: "sub" });
});
test("BG3, (b) story beat: the area with the same story beat comes before an area it names", () => {
  assert.deepEqual(matchGuideArea(bg3, "Druid camp", "The druid settlement and refugee camp", bg3Pages), { index: 3, via: "story" });
  assert.deepEqual(matchGuideArea(bg3, "Crash site cliffs", "Act 1: heading for the Emerald Grove", {}), { index: 3, via: "story" });
});
test("nothing fits: no area (the tracker then says there's nothing to track yet)", () => {
  assert.equal(matchGuideArea(bg3, "Baldur's Gate lower city", "Act 3", bg3Pages), null);
  assert.equal(matchGuideArea(ff6, "", "", {}), null);
});
test("the tracker says when the area is the closest match", () => {
  const area = { key: "ff6", slug: "mt-kolts", name: "Mt. Kolts", story: "", page: null, done: new Set<string>() };
  const tab = { id: "t", name: "FF6", messages: [], place: { name: "Duncan's Cabin", confirmed: true } } as any;
  const opts = { accent: "#a87ffb", gameKey: "g" };
  const closest = buildTrackerPayload(tab, null, { ...area, via: "story" }, null, { closest: "From the guide: {area} (closest match)" }, opts)!;
  assert.equal(closest.data.source, "From the guide: Mt. Kolts (closest match)");
  assert.equal(closest.data.place?.name, "Duncan's Cabin");
  const exact = buildTrackerPayload({ ...tab, place: { name: "Mt. Kolts", confirmed: true } }, null, { ...area, via: "name" }, null, undefined, opts)!;
  assert.equal(exact.data.source, undefined);
});

console.log(`\n${passed} tests passed`);
