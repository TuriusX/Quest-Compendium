// Run: npm run test:sync   (or: npx tsx tests/answerWeek.test.ts)
import assert from "node:assert/strict";
import { answerWeek } from "../scripts/pipeline/answerWeek";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

// Monday Nov 16 2026 (noon UTC): this week is Nov 9-15, the week before Nov 2-8 (Central days).
const monday = Date.parse("2026-11-16T12:00:00Z");
const day = (id: string, games: Record<string, any>) => ({ id, games });

test("the most-asked games this week: share that needed a search and missing facts sent, against the week before", () => {
  const lines = answerWeek([
    day("2026-11-10", { "final-fantasy-vi": { name: "FINAL FANTASY VI", q: 8, s: 2, m: 1 }, "elden-ring": { name: "ELDEN RING", q: 3, s: 3, m: 0 } }),
    day("2026-11-12", { "final-fantasy-vi": { q: 2, s: 1 } }),
    day("2026-11-03", { "final-fantasy-vi": { name: "FINAL FANTASY VI", q: 10, s: 5, m: 4 } }),
  ], monday);
  assert.match(lines[0], /2 most asked this week, vs the week before/);
  assert.equal(lines[1], "- FINAL FANTASY VI: 10 answers, 30% needed a search (vs 50%) · 1 missing fact sent (vs 4)");
  assert.equal(lines[2], "- ELDEN RING: 3 answers, 100% needed a search (vs –) · 0 missing facts sent (vs 0)");
  assert.equal(lines[3], "All games: 46% of 13 answers needed a search (vs 50%) · 1 missing facts sent (vs 4)");
});

test("at most 10 games; the first week says the week before wasn't counted; no questions, one line", () => {
  const games = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`g${i}`, { name: `Game ${i}`, q: i + 1, s: 0 }]));
  const first = answerWeek([day("2026-11-01", games)], Date.parse("2026-11-02T12:00:00Z"));
  assert.match(first[0], /10 most asked this week; the week before wasn't counted yet/);
  assert.equal(first.length, 12);
  assert.ok(first[1].startsWith("- Game 11: 12 answers, 0% needed a search · 0 missing facts sent"));
  assert.deepEqual(answerWeek([], monday), ["**Answers by game:** no questions this week."]);
});

console.log(`\n${passed} tests passed`);
