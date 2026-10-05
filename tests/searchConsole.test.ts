// Run: npm run test:sync   (or: npx tsx tests/searchConsole.test.ts)
import assert from "node:assert/strict";
import { pageRefOf, summarise, isStriking, HIGH_IMPRESSIONS } from "../scripts/pipeline/searchConsole";
import { parseQueryFixLines, applyQueryFixes } from "../scripts/guides/queryRepair";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("site URLs as guide pages (any language), game pages and the rest", () => {
  assert.deepEqual(pageRefOf("https://questcompendium.com/guides/baldur-s-gate-3/ravaged-beach/"), { lang: "en", key: "baldur-s-gate-3", slug: "ravaged-beach" });
  assert.deepEqual(pageRefOf("https://questcompendium.com/es/guides/baldur-s-gate-3/ravaged-beach/index.html"), { lang: "es", key: "baldur-s-gate-3", slug: "ravaged-beach" });
  assert.deepEqual(pageRefOf("https://questcompendium.com/guides/baldur-s-gate-3/"), { lang: "en", key: "baldur-s-gate-3" });
  assert.deepEqual(pageRefOf("https://questcompendium.com/guides/baldur-s-gate-3/achievements/"), { lang: "en", key: "baldur-s-gate-3" });
  assert.equal(pageRefOf("https://questcompendium.com/"), null);
  assert.equal(pageRefOf("not a url"), null);
});

test("rows summed per page across languages, queries by impressions, weighted position", () => {
  const rows = [
    { query: "bg3 thieves tools location", page: "https://questcompendium.com/guides/baldur-s-gate-3/ravaged-beach/", clicks: 3, impressions: 100, ctr: 0.03, position: 8 },
    { query: "bg3 thieves tools location", page: "https://questcompendium.com/es/guides/baldur-s-gate-3/ravaged-beach/", clicks: 1, impressions: 100, ctr: 0.01, position: 12 },
    { query: "harper cache bg3", page: "https://questcompendium.com/guides/baldur-s-gate-3/ravaged-beach/", clicks: 5, impressions: 50, ctr: 0.1, position: 4 },
    { query: "hogwarts legacy guide", page: "https://questcompendium.com/", clicks: 0, impressions: 40, ctr: 0, position: 30 },
  ];
  const s = summarise(rows);
  assert.equal(s.totals.impressions, 290);
  assert.equal(s.totals.clicks, 9);
  assert.equal(s.pages.length, 1);
  const p = s.pages[0];
  assert.equal(p.impressions, 250);
  assert.equal(p.position, 8.8); // (8*100 + 12*100 + 4*50) / 250
  assert.deepEqual(p.queries.map((q) => [q.query, q.impressions, q.position]), [["bg3 thieves tools location", 200, 10], ["harper cache bg3", 50, 4]]);
  assert.equal(s.offGuide.length, 1); // the home page query: a game without a guide, maybe
  assert.equal(s.queries[0].query, "bg3 thieves tools location");
});

test("pages ranking 5-20 with high impressions go first", () => {
  assert.equal(isStriking({ position: 8.8, impressions: HIGH_IMPRESSIONS }), true);
  assert.equal(isStriking({ position: 3, impressions: 5000 }), false);
  assert.equal(isStriking({ position: 25, impressions: 5000 }), false);
  assert.equal(isStriking({ position: 12, impressions: HIGH_IMPRESSIONS - 1 }), false);
});

test("the repair: a vague entry rewritten, a missing answer added, a clearer title; unknown ids ignored", () => {
  const page = { name: "Ravaged Beach", items: [{ id: "x1", name: "Thieves' Tools", where: "On the beach", missable: false, sources: ["old"] }], secrets: [{ id: "s1", text: "A cache" }] };
  const parsed = parseQueryFixLines([
    "ITEM: x1 | Thieves' Tools | From the Ravaged Beach waypoint, walk south to the Nautiloid wreck; in the chest beside the dead mind flayer | open the chest | ",
    "ITEM: new | Harper's Map | From the Roadside Cliffs waypoint, west to the cliff edge; the Ornate Chest under the Scuffed Rock | drag the Scuffed Rock aside | lost once you leave for Act 2",
    "ITEM: x9 | Not on the page | anywhere | x |",
    "TITLE: Ravaged Beach – Baldur's Gate 3: Thieves' Tools, Harper Cache",
    "DESCRIPTION: Where to find Thieves' Tools and the Harper cache on the Ravaged Beach in Baldur's Gate 3, step by step.",
  ].join("\n"), new Set(["x1", "s1"]));
  assert.equal(parsed.changes.length, 2);
  const out = applyQueryFixes(page, parsed, ["bg3.wiki"]);
  assert.match(out.items[0].where, /^From the Ravaged Beach waypoint/);
  assert.equal(out.items[0].how, "open the chest");
  assert.equal(out.items[0].updatedFrom, "search queries");
  assert.equal(out.items[1].name, "Harper's Map");
  assert.equal(out.items[1].missable, true);
  assert.equal(out.items[1].lockout, "lost once you leave for Act 2");
  assert.ok(!["x1", "s1"].includes(out.items[1].id));
  assert.equal(out.seoTitle, "Ravaged Beach – Baldur's Gate 3: Thieves' Tools, Harper Cache");
  assert.match(out.seoDescription!, /step by step/);
});

console.log(`\n${passed} tests passed`);
