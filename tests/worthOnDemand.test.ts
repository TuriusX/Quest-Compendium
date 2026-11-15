// Run: npm run test:sync   (or: npx tsx tests/worthOnDemand.test.ts)
// "Worth getting here" on demand (Nov 15 2026): any game, guide or not.
import assert from "node:assert/strict";
import { mainArea } from "../worthOnDemand";
import { freeLocatePrompt, parseFreeLocateReply, isConfident, seenTextNamesArea } from "../locateMe";
import { applyWorth, finish, type GameRecord } from "../scripts/guides/records";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("an area is the main place, without its detail", () => {
  assert.equal(mainArea("South Figaro, Relic Shop"), "South Figaro");
  assert.equal(mainArea("  Greenpath  "), "Greenpath");
  assert.equal(mainArea("サウスフィガロ、レリック屋"), "サウスフィガロ");
  assert.equal(mainArea('"Emerald Grove".'), "Emerald Grove");
});

test("Help me here without a guide: the model names the area, and a read must name it", () => {
  const p = freeLocatePrompt("Hollow Knight");
  assert.ok(p.includes("Which area of the game is the player in right now?"));
  assert.ok(!p.includes("Areas (name: story beat)"), "no list to pick from");
  assert.ok(p.includes("<the area's name, or unknown>"));
  const r = parseFreeLocateReply('{"area":"Greenpath","how":"read","confidence":"medium","evidence":"read","seenText":"GREENPATH","story":"Exploring"}');
  assert.equal(r.area, "Greenpath");
  assert.equal(isConfident(r), true, "a read is confident");
  assert.equal(seenTextNamesArea(r.seenText, r.area, [{ slug: "", name: r.area, story: "" }]), true);
  assert.equal(seenTextNamesArea("Dirtmouth", "Greenpath", [{ slug: "", name: "Greenpath", story: "" }]), false, "a read naming another place doesn't count");
  assert.equal(parseFreeLocateReply('{"area":"unknown"}').area, "unknown");
  assert.equal(isConfident(parseFreeLocateReply('{"area":"Greenpath","confidence":"low","evidence":"guessed"}')), false);
});

const rec = (over: Partial<GameRecord>): GameRecord => finish({
  id: "x", key: "g", type: "item", name: "Thing", place: "greenpath", placeName: "Greenpath", fields: {}, sources: [], tier: "C", status: "unconfirmed",
  origin: { from: "area", slug: "greenpath", entry: "x" }, ...over,
} as any);

test("an area with no records yet gets its list as records of its own", () => {
  const out = applyWorth([], { entries: [{ type: "item", name: "Mothwing Cloak", rank: 1, fields: { kind: "gear", why: "Dash." }, sources: ["fextralife.com"] }] }, { key: "hollow-knight", place: "greenpath", placeName: "Greenpath" });
  assert.equal(out.length, 1);
  assert.equal(out[0].key, "hollow-knight");
  assert.equal(out[0].place, "greenpath");
  assert.equal(out[0].fields.rank, "1");
  assert.equal(out[0].status, "unconfirmed");
  assert.ok(out[0].hash);
  assert.deepEqual(applyWorth([], { entries: [{ type: "item", name: "A", rank: 1, fields: {}, sources: [] }] }), [], "no records and no base: nothing");
});

test("guide text stands only when checked; otherwise the sourced line wins (and the record is re-hashed)", () => {
  const unchecked = rec({ id: "a", name: "Sorrow", fields: { why: "guide says so" } });
  const checked = rec({ id: "b", name: "Ring", status: "checked", tier: "A", fields: { why: "checked text" } });
  const out = applyWorth([unchecked, checked], { entries: [
    { type: "item", name: "Sorrow", rank: 1, fields: { why: "sourced why" }, sources: ["wiki"] },
    { type: "item", name: "Ring", rank: 2, fields: { why: "sourced why 2" }, sources: ["wiki"] },
  ] });
  const a = out.find((r) => r.id === "a")!, b = out.find((r) => r.id === "b")!;
  assert.equal(a.fields.why, "sourced why");
  assert.ok(a.sources.includes("wiki"));
  assert.notEqual(a.hash, unchecked.hash, "changed records get a new hash");
  assert.equal(b.fields.why, "checked text", "checked guide text stays");
  assert.equal(b.fields.rank, "2", "it still gets its rank");
});

console.log(`\n${passed} passed`);
setTimeout(() => process.exit(process.exitCode || 0), 50);
