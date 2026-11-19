// Run: npx tsx tests/hintLevels.test.ts
// Hint levels (session companion step 2, Nov 18 2026): one hint answer carries the rule and the full answer, hidden.
import assert from "node:assert/strict";
import { extractHints, HINT_LEVELS_RULES, nextHintLevel, textWithHints } from "../src/utils/hintLevels";

const nudge = "Take a closer look at the walls around the sealed doors. The old builders left reminders.";
const raw = `${nudge}\n\n<qc-hints>{"rule": "Each door opens when the dials match the symbols painted on the wall beside it.", "answer": "Set the left dial to the sun, the middle to the moon and the right to the star, then pull the lever."}</qc-hints>`;

const r = extractHints(raw);
assert.equal(r.text, nudge, "the line is always removed from the text");
assert.ok(r.hints?.rule?.startsWith("Each door opens"));
assert.ok(r.hints?.answer?.includes("pull the lever"));

// In a code fence, too.
assert.equal(extractHints("Hint.\n```json\n<qc-hints>{\"rule\": \"A rule.\"}</qc-hints>\n```").text, "Hint.");

// Broken JSON: the line goes, no levels.
const broken = extractHints(`${nudge}\n<qc-hints>{rule: oops</qc-hints>`);
assert.equal(broken.text, nudge);
assert.equal(broken.hints, null);

// A level that only repeats the nudge isn't offered; nothing left: no levels.
const same = extractHints(`Look at the walls.\n<qc-hints>{"rule": "Look at the walls.", "answer": "Look at the walls!"}</qc-hints>`);
assert.equal(same.hints, null);

// Only an answer (no rule): the next level is the answer.
const onlyAnswer = extractHints(`Hmm.\n<qc-hints>{"answer": "Pull the left lever."}</qc-hints>`).hints;
assert.deepEqual(onlyAnswer, { answer: "Pull the left lever." });
assert.equal(nextHintLevel(onlyAnswer, 1), 3);

// Long levels are clipped at a sentence.
const long = extractHints(`Hint.\n<qc-hints>{"rule": "${"This is a sentence. ".repeat(40)}"}</qc-hints>`).hints!;
assert.ok(long.rule!.length <= 400 && long.rule!.endsWith("."));

// The order levels open in.
assert.equal(nextHintLevel(r.hints, 1), 2);
assert.equal(nextHintLevel(r.hints, 2), 3);
assert.equal(nextHintLevel(r.hints, 3), 0);
assert.equal(nextHintLevel(null, 1), 0);

// The card's text: the newest level first.
const L = { rule: "Bigger hint", answer: "The answer" };
assert.equal(textWithHints(nudge, r.hints, 1, L), nudge);
assert.ok(textWithHints(nudge, r.hints, 2, L).startsWith("Bigger hint: Each door"));
const all = textWithHints(nudge, r.hints, 3, L);
assert.ok(all.startsWith("The answer: Set the left dial"));
assert.ok(all.indexOf("Bigger hint:") < all.indexOf(nudge));

// The prompt asks for the line and keeps the nudge free of the levels.
assert.ok(HINT_LEVELS_RULES.includes("<qc-hints>"));
assert.ok(/must not say what "rule" or "answer" say/.test(HINT_LEVELS_RULES));

console.log("hintLevels: ok");
