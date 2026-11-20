// Run: npx tsx tests/padQuestions.test.ts   (part of npm run test:sync)
// The controller's quick questions list (src/utils/quickQuestions.ts padQuestionList), fitted to the moment.
import assert from "node:assert/strict";
import { padQuestionList } from "../src/utils/quickQuestions";

assert.deepEqual(padQuestionList({}).slice(0, 3), ["next", "missable", "gear"], "before anything was asked: the starters");
assert.equal(padQuestionList({ combat: true })[2], "fight", "a fight on screen: help beating it among the first");
assert.deepEqual(padQuestionList({ asked: true, combat: true }).slice(0, 2), ["fight", "after"]);
assert.deepEqual(padQuestionList({ asked: true }).slice(0, 2), ["after", "missable"], "after an answer: what comes next");
assert.equal(padQuestionList({ goal: "Reach Stormveil Castle" })[0], "goal", "the quest log's Now goal first");
assert.equal(padQuestionList({ goal: "  " })[0], "next", "no goal, no goal question");
assert.ok(!padQuestionList({ asked: true }).includes("where"), "never 'show me where' (it needs the last screenshot)");
assert.ok(!(padQuestionList({}) as string[]).includes("hint"), "no hint questions (Nov 20 2026)");
const all = padQuestionList({ asked: true, goal: "x" });
assert.equal(new Set(all).size, all.length, "no question twice");
console.log("padQuestions: all passed");
