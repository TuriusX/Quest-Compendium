import assert from "node:assert/strict";
import { backedText, shouldLearn, learnFromAnswer } from "../answerLearn";

const fake = (reply: any) => {
  const prompts: string[] = [];
  return { prompts, models: { async generateContent(r: any) { prompts.push(r.contents[0].parts[0].text); return { usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 120 }, text: JSON.stringify(reply) }; } } };
};
const grounded = [
  "Dampé's Heart-Pounding Gravedigging Tour costs 10 Rupees a dig in the Kakariko graveyard.",
  "The Piece of Heart is the tour's top prize, found in a random patch.",
  "The Piece of Heart is the tour's top prize, found in a random patch.",
  "ok",
];

// 1. Only the backed text goes in, once each, short bits dropped.
assert.equal(backedText(grounded).split("\n").length, 2);

// 2. Worth a look only when it searched, something was backed, and the model reported no facts of its own.
assert.equal(shouldLearn({ searched: 2, grounded, reported: [] }), true);
assert.equal(shouldLearn({ searched: 0, grounded, reported: [] }), false);
assert.equal(shouldLearn({ searched: 2, grounded: ["short"], reported: [] }), false);
assert.equal(shouldLearn({ searched: 2, grounded, reported: [{ subject: "X", fact: "y", status: "verified" }] }), false);
assert.equal(shouldLearn({ searched: 2, grounded, reported: [{ subject: "X", status: "disputed" }] }), true);

// 3. Facts whose subject is in a backed sentence are kept; an invented subject and a bad kind are handled.
{
  const ai = fake([
    { subject: "Piece of Heart", kind: "item", fact: "Top prize of Dampé's gravedigging tour in Kakariko, in a random patch." },
    { subject: "Hookshot", kind: "item", fact: "Won by racing Dampé's ghost." },
    { subject: "Dampé's Heart-Pounding Gravedigging Tour", kind: "minigame", fact: "Costs 10 Rupees a dig." },
  ]);
  const r = await learnFromAnswer(ai as any, { game: "The Legend of Zelda: Ocarina of Time", grounded });
  assert.deepEqual(r.map((f) => f.subject), ["Piece of Heart", "Dampé's Heart-Pounding Gravedigging Tour"]);
  assert.equal(r[1].kind, "other");
  assert.ok(r.every((f) => f.status === "verified"));
  assert.match(ai.prompts[0], /Only facts about "The Legend of Zelda: Ocarina of Time"/);
}

// 4. Nothing usable: no facts, and no call at all without backed text.
{
  assert.deepEqual(await learnFromAnswer(fake("not json") as any, { game: "G", grounded }), []);
  const ai = fake([]);
  assert.deepEqual(await learnFromAnswer(ai as any, { game: "G", grounded: ["tiny"] }), []);
  assert.equal(ai.prompts.length, 0);
}

// 5. Two facts about the same thing become one entry.
{
  const r = await learnFromAnswer(fake([
    { subject: "Piece of Heart", kind: "item", fact: "Top prize of the tour." },
    { subject: "piece of heart", kind: "item", fact: "Found in a random patch." },
  ]) as any, { game: "G", grounded });
  assert.equal(r.length, 1);
  assert.equal(r[0].fact, "Top prize of the tour. Found in a random patch.");
}

console.log("answerLearn: ok");
