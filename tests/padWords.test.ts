// Run: npx tsx tests/padWords.test.ts   (part of npm run test:sync)
// Controller mode step 5 (src/utils/padWords.ts): the on-screen keyboard's word suggestions and editing.
import assert from "node:assert/strict";
import { applySuggestion, buildVocab, deleteWord, suggest } from "../src/utils/padWords";

const v = buildVocab([
  "You're in Stormveil Castle. Find the Claw Talisman before you fight Margit the Fell Omen.",
  "Head to Stormveil Castle by the main gate, then climb the rampart tower.",
]);
assert.deepEqual(suggest(v, "how do I get into stor", 22).slice(0, 2), ["Stormveil Castle", "Stormveil"], "the place name first, as one suggestion");
assert.ok(suggest(v, "where is the cl", 15).includes("Claw Talisman"));
assert.ok(suggest(v, "how do I beat mar", 17).includes("Margit the Fell Omen"), "names joined by the");
assert.deepEqual(suggest(v, "", 0), [], "nothing typed: nothing suggested");
assert.deepEqual(suggest(buildVocab(["Stormveil Castle\nHelp me here"]), "sto", 3)[0], "Stormveil Castle", "a name never runs onto the next line");
assert.ok(suggest(v, "wh", 2).includes("where"), "common question words before any answer");
assert.equal(suggest(v, "where", 5).includes("where"), false, "not the word already typed");

assert.deepEqual(applySuggestion("how do I get into stor", 22, "Stormveil Castle"), { text: "how do I get into Stormveil Castle ", caret: 35 });
assert.deepEqual(applySuggestion("into stor castle", 9, "Stormveil"), { text: "into Stormveil castle", caret: 15 }, "in the middle: replaces the word, keeps the rest");
assert.deepEqual(deleteWord("where is the claw ", 18), { text: "where is the ", caret: 13 });
assert.deepEqual(deleteWord("where is", 8), { text: "where ", caret: 6 });
assert.deepEqual(deleteWord("", 0), { text: "", caret: 0 });

console.log("padWords: all passed");
