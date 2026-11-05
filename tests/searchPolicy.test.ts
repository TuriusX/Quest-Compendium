// Run: npm run test:sync   (or: npx tsx tests/searchPolicy.test.ts)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withProRules, PRO_RULES, PROMPT_PERSONA_END, asksForSearch, stripSearchAsk, isNewRelease, searchMode, isBlankAnswer, wantsSpecifics, EXISTENCE_RULES } from "../searchPolicy";

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
  // The model working aloud after the line (seen Nov 3 2026): still a request, and never shown.
  assert.equal(asksForSearch("<qc-search/> direct search? Wait, I must reply with ONLY the line. Let's do a search!<qc-search/>"), true);
  assert.equal(stripSearchAsk("Go north. <qc-search/>"), "Go north.");
  assert.equal(stripSearchAsk("Go north."), "Go north.");
});

test("the prompt never lets the model deny that something exists", () => {
  assert.match(EXISTENCE_RULES, /Never say that a game, place, item, character or event doesn't exist/);
  assert.match(EXISTENCE_RULES, /ask the\s+player for a screenshot or a detail/);
});

test("with a screenshot, a question about specifics gets the search tool, covered by the guide or not", () => {
  const base = { newRelease: false, dated: true, type: "general" as const, covered: true };
  assert.equal(searchMode({ ...base, screenshot: true, specifics: wantsSpecifics("What are the hidden items in the mansion?") }), "offer");
  assert.equal(searchMode({ ...base, screenshot: true, specifics: wantsSpecifics("How do I open this door?") }), "offer");
  assert.equal(searchMode({ ...base, screenshot: true, specifics: wantsSpecifics("¿Dónde está la llave?") }), "offer");
  assert.equal(searchMode({ ...base, screenshot: false, specifics: wantsSpecifics("What are the hidden items in the mansion?") }), "ask");
  assert.equal(searchMode({ ...base, screenshot: true, specifics: wantsSpecifics("Who is Kefka?") }), "ask");
});

test("a blank answer: nothing readable once our tags are out; a short real answer isn't blank", () => {
  assert.equal(isBlankAnswer(""), true);
  assert.equal(isBlankAnswer("<qc-search/>"), true);
  assert.equal(isBlankAnswer('<qc-title now="no">Mansion</qc-title>\n```\n<qc-steps>[]</qc-steps>\n```'), true);
  assert.equal(isBlankAnswer("Yes."), false);
  assert.equal(isBlankAnswer("<qc-title>Mansion</qc-title>Go behind the bookcase."), false);
});

test("Pro's rules: near the start and at the very end; no rule to search when it can't", () => {
  const out = withProRules(`intro ${PROMPT_PERSONA_END}\n\nmiddle`, true);
  const rules = PRO_RULES(true);
  assert.ok(out.endsWith(rules));
  assert.ok(out.indexOf(rules) < out.indexOf("middle"));
  assert.ok(rules.includes("Google Search"));
  assert.ok(!PRO_RULES(false).includes("Google Search"));
  assert.ok(!PRO_RULES(true, false, false).includes("chose Pro") && PRO_RULES(true, false, false).includes("Google Search"), "Fast: the same rules without saying Pro");
  assert.ok(readFileSync("server.ts", "utf8").includes(PROMPT_PERSONA_END), "the answer prompt still has the line the rules follow");
  assert.ok(readFileSync("server.ts", "utf8").includes("3. MISSING IMAGE HANDLING:"), "the answer prompt still has the vision rule this replaces");
  assert.ok(withProRules("3. MISSING IMAGE HANDLING: say so\n4. next", true).includes("Otherwise don't mention screenshots"));
  const story = withProRules(`[STORY TIMING]\nleave it out\n\n[NEXT]\nkept`, true);
  assert.ok(!story.includes("old story rule") && story.includes("[NEXT]") && story.includes("rather than leaving it out"));
  assert.ok(readFileSync("server.ts", "utf8").replace(/\r+\n/g, "\n").includes("[STORY TIMING]\nWork out where"), "the answer prompt still has the story rule this replaces");
});

console.log(`\n${passed} tests passed`);
