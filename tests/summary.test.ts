// Run: npm run test:sync   (or: npx tsx tests/summary.test.ts)
import assert from "node:assert/strict";
import { summarize, splitForDiscord, summaryText, DISCORD_LIMIT } from "../scripts/pipeline/summary";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const report = [
  "📊 Yesterday: 31 question(s)",
  "✅ queue fights **CONTROL Resonant**: passed (79); promoted, 6 page(s) live, 3 changed.",
  "⚠️ queue fights **Cyberpunk 2077**: failed (42); queued for review: rebuild with a different outline. (decide on /admin/reviews)",
  "⏳ queue missables **Baldur's Gate 3**: built up to its search cap; continues next run.",
  "⏸️ queue info **Red Dead Redemption 2**: blocked: a careful rebuild of this guide is staged; nothing searched.",
  "➖ queue missables **CONTROL Resonant**: skipped (no missables to write).",
  "⚠️ queue careful **Avowed**: the repair failed; trying again next run (see the job log).",
  "✅ achievements **PRAGMATA**: 35 achievements",
  "⚠️ translate **Baldur's Gate 3** → es: a featured guide. failed (see the job log)",
  "✅ translate **The Witcher 3** → es: a featured guide. 66 page translation(s)",
  "🌐 Website rebuilt.",
];

test("queue items are grouped by outcome, with names only for failures, blocks and errors", () => {
  const s = summarize(report);
  assert.ok(s.includes("🛠️ Repair queue: 1 passed, 1 failed review, 1 blocked, 1 waiting, 1 skipped, 1 error(s)."));
  assert.ok(s.some((l) => l.startsWith("⚠️ Failed review") && l.includes("Cyberpunk 2077 (fights, 42: rebuild with a different outline)")));
  assert.ok(s.some((l) => l.startsWith("⏸️ Blocked") && l.includes("Red Dead Redemption 2 (info)")));
  assert.ok(s.some((l) => l.startsWith("❌ Repair errors") && l.includes("Avowed")));
  assert.ok(!s.some((l) => l.includes("CONTROL Resonant")), "passed and skipped items aren't named");
  assert.ok(s.includes("⚠️ Translations: 1 done, 1 failed (Baldur's Gate 3 → es)."));
  assert.ok(s.includes("✅ Achievement guides: 1 done."));
  assert.equal(s[0], "📊 Yesterday: 31 question(s)");
  assert.equal(s[s.length - 1], "🌐 Website rebuilt.");
});

test("a long summary splits into messages under the limit, losing nothing", () => {
  const lines = Array.from({ length: 120 }, (_, i) => `• line ${i} ${"x".repeat(40)}`);
  const text = summaryText(lines, "🏁 Run finished.");
  const parts = splitForDiscord(text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= DISCORD_LIMIT));
  assert.equal(parts.join("\n"), text);
});

test("a single line longer than the limit is split at spaces, nothing cut", () => {
  const long = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");
  const parts = splitForDiscord(long);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= DISCORD_LIMIT));
  assert.equal(parts.join(" ").split(" ").length, 600);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
setTimeout(() => process.exit(process.exitCode || 0), 100);
