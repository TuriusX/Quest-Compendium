// Run: npx tsx tests/answerFind.test.ts
import assert from "node:assert/strict";
import { qaPair, logWithout, searchAnswers, savedAnswers, recentAnswers } from "../src/utils/answerFind";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const u = (id: string, text: string, at = 0): any => ({ id, role: "user", text, timestamp: at });
const a = (id: string, text: string, at = 0, title = ""): any => ({ id, role: "assistant", text, timestamp: at, ...(title ? { title } : {}) });
const tab = (id: string, name: string, messages: any[], pins: string[] = [], lastActive = 0): any => ({ id, name, activeSteamGame: null, messages, notes: "", createdAt: 0, lastActive, questLog: pins.length ? { pins } : undefined });

const er = tab("er", "Elden Ring", [
  u("q1", "Where is the Nagakiba?", 1), a("a1", "Join **Yura's** quest; he drops the Nagakiba after the duel.", 2, "Nagakiba"),
  u("q2", "how do I get to Caelid", 3), a("a2", "Head east from Limgrave past the Dragonbarrow road. Watch for the Bell Bearing Hunter.", 4),
  u("q3", "best talisman for bleed?", 5), a("a3", "Lord of Blood's Exultation.", 6), a("a3b", "Or the Rotten Winged Sword Insignia.", 7),
], ["a2"], 10);
const hk = tab("hk", "Hollow Knight", [u("h1", "where is the mantis claw", 8), a("h2", "In the Mantis Village, Fungal Wastes.", 9)], [], 20);

test("a delete takes the answer and its question", () => assert.deepEqual(qaPair(er.messages, "a1"), ["q1", "a1"]));
test("a question answered twice: deleting one answer keeps the question for the other", () => {
  assert.deepEqual(qaPair(er.messages, "a3"), ["a3"]);
  assert.deepEqual(qaPair(er.messages, "a3b"), ["a3b"]);
});
test("an unknown id deletes nothing", () => assert.deepEqual(qaPair(er.messages, "zz"), []));
test("the quest log forgets it: Now, Saved, Earlier steps and closed offers", () => {
  const out = logWithout({ now: "a1", pins: ["a1", "a2"], passed: [{ id: "s", text: "x", msgId: "a1", at: 1 }, { id: "t", text: "y", at: 1 }], hidden: ["offer:a1", "w:1"] }, ["q1", "a1"]);
  assert.deepEqual(out, { now: undefined, pins: ["a2"], passed: [{ id: "t", text: "y", at: 1 }], hidden: ["w:1"] });
  assert.equal(logWithout({ pins: ["a2"] }, ["a1"]), null);
});
test("search: every word, in any order, accents and case ignored", () => {
  assert.deepEqual(searchAnswers([er, hk], "NAGAKIBA yura").map((f) => f.answerId), ["a1"]);
  assert.deepEqual(searchAnswers([er, hk], "bell hunter").map((f) => f.answerId), ["a2"]);
  assert.deepEqual(searchAnswers([er, hk], "lórd exultation").map((f) => f.answerId), ["a3"]);
  assert.deepEqual(searchAnswers([er, hk], "nagakiba mantis"), []);
});
test("search: the question and title count more; one game only with tabId", () => {
  const r = searchAnswers([er, hk], "mantis");
  assert.equal(r[0].answerId, "h2");
  assert.equal(r[0].game, "Hollow Knight");
  assert.deepEqual(searchAnswers([er, hk], "mantis", { tabId: "er" }), []);
});
test("search: a match only in the answer's text shows the words around it", () => {
  const r = searchAnswers([er], "dragonbarrow")[0];
  assert.match(r.snippet, /Dragonbarrow road/);
  assert.equal(r.question, "how do I get to Caelid");
  assert.equal(r.saved, true);
});
test("nothing typed: Saved first, then the latest others", () => {
  assert.deepEqual(savedAnswers([er, hk]).map((f) => f.answerId), ["a2"]);
  assert.deepEqual(recentAnswers([er, hk]).map((f) => f.answerId), ["h2", "a3b", "a3", "a1"]);
  assert.deepEqual(searchAnswers([er], "   "), []);
});
test("the title falls back to the answer's first sentence, without markdown", () => {
  assert.equal(searchAnswers([er], "talisman")[0].title, "Lord of Blood's Exultation.");
  assert.match(searchAnswers([er], "yura")[0].snippet, /^Join Yura.s quest/);
});
console.log(`\n${passed} tests passed`);
