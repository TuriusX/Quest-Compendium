// Run: npm run test:sync   (or: npx tsx tests/claimCheck.test.ts)
// The owner's review of Elden Ring Limgrave and Yakuza: Like a Dragon chapter 1, as test cases for the rules.
import assert from "node:assert/strict";
import { isAutomatic, cleanEntryText, parseClaims, scoreClaims, pageRules, trusted, claimSlots } from "../scripts/guides/claimCheck";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const ev: any = { evidence: [{ id: "e1", text: "Gatekeeper Gostoc is found at the main gate of Stormveil Castle.", sources: ["x"], topic: "people" }, { id: "e2", text: "Merchant Kalé is in the Church of Elleh.", sources: ["y"], topic: "people" }], servicesComplete: false };

test("no checkbox for starting items or automatic rewards (\"¥1,500 starting funds\")", () => {
  assert.ok(isAutomatic({ name: "¥1,500", where: "your starting funds" }));
  assert.ok(isAutomatic({ name: "Club", how: "you start with it" }));
  assert.ok(!isAutomatic({ name: "Stormhawk Feather", where: "on a corpse by the Gatefront Ruins" }));
  const pr: any = { items: [{ id: "p1", name: "¥1,500", where: "your starting funds on December 31, 2000" }, { id: "p2", name: "Kiwami Gauntlets", where: "in a chest at Public Park 3, by the bench" }], secrets: [], walkthrough: [{ title: "a", text: "b", entries: ["p1", "p2"] }] };
  const r = pageRules(pr, ev);
  assert.deepEqual(pr.items.map((e: any) => e.id), ["p2"]);
  assert.deepEqual(pr.walkthrough[0].entries, ["p2"]);
  assert.equal(r.removed.length, 1);
});

test("garbled entry text is cleaned or dropped (\"how: how:\")", () => {
  assert.equal(cleanEntryText("how: how: open the chest behind the waterfall"), "open the chest behind the waterfall");
  assert.equal(cleanEntryText("E3: Talk to Kalé inside the church"), "Talk to Kalé inside the church");
  assert.equal(cleanEntryText("pick up the"), "");
  assert.equal(cleanEntryText("in the room with"), "");
});

test("every slot gets a verdict; 'supported' must cite real evidence; skipped slots are unsupported", () => {
  const page: any = { steps: [{ title: "The First Step", text: "You wake in the Stranded Graveyard. Then head on.", entries: ["x1"] }],
    entries: [{ id: "x1", name: "Patches' teleport trap chest", where: "Murkwater Cave" }, { id: "x2", name: "Hammer Talisman", where: "dropped by Recusant Henricus", lockout: "defeating Margit before exploring Stormhill locks you out of Recusant Henricus" }],
    choices: [], advice: [], services: ["Gatekeeper Gostoc: merchant (Limgrave)", "Merchant Kalé (Church of Elleh)"], fights: [] };
  const slots = claimSlots(page);
  assert.deepEqual(slots.map((x) => x.kind), ["sentence", "sentence", "placement", "location", "location", "missable", "merchant", "merchant"]);
  const byText = (re: RegExp) => slots.find((x) => re.test(x.text))!.id;
  const c = parseClaims(JSON.stringify([
    { id: byText(/Gostoc/), verdict: "supported", evidence: ["e99"] },
    { id: byText(/locks you out/), verdict: "supported", evidence: [] },
    { id: byText(/Kalé/), verdict: "supported", evidence: ["e2"] },
    { id: byText(/Then head on/), verdict: "general" },
    { id: byText(/Gostoc/).replace(/\d+/, "999"), verdict: "supported", evidence: ["e1"] },
  ]), slots, ev);
  const v = (re: RegExp) => c.find((x) => re.test(x.text))!.verdict;
  assert.equal(v(/Gostoc/), "unsupported", "a made-up evidence id");
  assert.equal(v(/locks you out/), "unsupported", "a lockout with no evidence line");
  assert.equal(v(/Kalé/), "supported");
  assert.equal(v(/Then head on/), "general");
  assert.equal(v(/teleport trap/), "unsupported", "a slot the checker skipped");
});

test("the review fails a page with more than 2 contradicted claims, or under 90% supported (general lines don't count)", () => {
  const s = (verdict: string, n = 1) => Array.from({ length: n }, (_, i) => ({ id: `K${i}`, label: "S1", kind: "sentence", text: "x", verdict, evidence: ["e1"] } as any));
  const ok = scoreClaims([...s("supported", 10), ...s("general", 5)]);
  assert.equal(ok.status, "passed");
  assert.equal(ok.total, 10);
  assert.equal(scoreClaims([...s("supported", 30), ...s("contradicted")]).status, "passed", "one contradiction (removed) in 31");
  const contra = scoreClaims([...s("supported", 30), ...s("contradicted", 3)]);
  assert.equal(contra.status, "failed");
  assert.match(contra.reason || "", /contradict/);
  assert.equal(scoreClaims([...s("supported", 8), ...s("unsupported", 3)]).status, "failed");
});

test("evidence only forums or videos back is dropped (the invented Henricus lockout)", () => {
  const p: any = { evidence: [
    { id: "e40", text: "Henricus stops invading if you defeat Margit", sources: ["youtube.com", "reddit.com", "steamcommunity.com"], topic: "items" },
    { id: "e39", text: "Hammer Talisman is dropped by Recusant Henricus", sources: ["ign.com", "youtube.com"], topic: "items" },
  ], sites: ["youtube.com", "ign.com"] };
  const t = trusted(p);
  assert.deepEqual(t.evidence.map((e: any) => e.id), ["e39"]);
  assert.deepEqual(t.evidence[0].sources, ["ign.com"]);
});

console.log(`\n${passed} passed`);
