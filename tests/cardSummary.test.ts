// Run: npx tsx tests/cardSummary.test.ts
// Pop-up summaries (Nov 19 2026): the summarizer's reply comes out as plain spoken text; the answer's own call is never
// told about summaries.
import assert from "node:assert/strict";
import { cleanSummary, summaryInput } from "../src/utils/cardSummary";

assert.equal(cleanSummary("Take the key from the chest, then go through the **north gate** [g4]."), "Take the key from the chest, then go through the north gate.");
assert.equal(cleanSummary("Summary: Use [fire](https://x.y) on it [cite: 2]."), "Use fire on it.");
assert.equal(cleanSummary("  "), "");

// Long: cut at a sentence, at most 380 characters (Nov 21 2026: room for a must-get item).
const long = cleanSummary("Do this first. ".repeat(40));
assert.ok(long.length <= 380 && long.endsWith("."));

// A hint says so; the answer is the input.
assert.ok(summaryInput("Where?", "North.", true).startsWith("This answer is a hint"));
assert.ok(summaryInput("Where?", "North.").includes("Answer:\nNorth."));

// The answer's prompt code no longer mentions the summary.
import fs from "node:fs";
const server = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
assert.ok(!/CARD_SUMMARY_RULES|extractSummary/.test(server));

console.log("cardSummary: ok");
