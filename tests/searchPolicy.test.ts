// Run: npm run test:sync   (or: npx tsx tests/searchPolicy.test.ts)
import assert from "node:assert/strict";
import { asksForSearch, isNewRelease, searchMode, EXISTENCE_RULES } from "../searchPolicy";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("new releases: after the model's cutoff, unreleased, or flagged new by our pipeline", () => {
  const cutoff = "2025-01-01";
  assert.equal(isNewRelease({ text: "Sep 18, 2026", time: Date.parse("2026-09-18"), source: "steam" }, cutoff), true);
  assert.equal(isNewRelease({ text: "Aug 3, 2023", time: Date.parse("2023-08-03"), source: "steam" }, cutoff), false);
  assert.equal(isNewRelease({ text: "Coming soon", time: null, source: "steam" }, cutoff), true);
  assert.equal(isNewRelease({ text: "1994-04-02 (first release)", time: Date.parse("1994-04-02"), source: "override" }, cutoff), false);
  assert.equal(isNewRelease({ text: "unknown", time: null, source: "unknown" }, cutoff), false);
  assert.equal(isNewRelease({ text: "unknown", time: null, source: "unknown", newRelease: true }, cutoff), true);
});

test("search mode: forced for new releases, offered when unfamiliar or uncovered exact data, else only when asked", () => {
  assert.equal(searchMode({ newRelease: true, dated: true, type: "general", covered: true }), "force");
  assert.equal(searchMode({ newRelease: false, dated: false, type: "general", covered: false }), "offer");
  assert.equal(searchMode({ newRelease: false, dated: true, type: "location", covered: false }), "offer");
  assert.equal(searchMode({ newRelease: false, dated: true, type: "location", covered: true }), "ask");
  assert.equal(searchMode({ newRelease: false, dated: true, type: "general", covered: false }), "ask");
});

test("the model asking to search is recognised only when that's the whole reply", () => {
  assert.equal(asksForSearch("<qc-search/>"), true);
  assert.equal(asksForSearch("  <qc-search />\n"), true);
  assert.equal(asksForSearch("Go north. <qc-search/>"), false);
  assert.equal(asksForSearch(""), false);
});

test("the prompt never lets the model deny that something exists", () => {
  assert.match(EXISTENCE_RULES, /Never say that a game, place, item, character or event doesn't exist/);
  assert.match(EXISTENCE_RULES, /ask the\s+player for a screenshot or a detail/);
});

console.log(`\n${passed} tests passed`);
