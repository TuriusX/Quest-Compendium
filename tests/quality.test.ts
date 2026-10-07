// Run: npm run test:sync   (or: npx tsx tests/quality.test.ts)
import assert from "node:assert/strict";
import { questionType } from "../src/utils/questionType";
import { normalizeRouting, route, ROUTING_DEFAULTS } from "../chatRouting";
import { guideGroundingForPrompt, extractGuideRefs } from "../guidesApi";
import { tallyBy } from "../answerFeedback";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("question types from quick questions and from the words", () => {
  assert.equal(questionType("I'm stuck", "stuck"), "puzzle");
  assert.equal(questionType("x", "where"), "location");
  assert.equal(questionType("x", "leave"), "missable");
  assert.equal(questionType("Where is the Scuffed Rock?"), "location");
  assert.equal(questionType("¿Dónde está el cofre?"), "location");
  assert.equal(questionType("How do I solve the sun puzzle?"), "puzzle");
  assert.equal(questionType("How do I beat this boss?"), "fight");
  assert.equal(questionType("Should I side with the druids or the tieflings?"), "choice");
  assert.equal(questionType("Is there anything missable here?"), "missable");
  assert.equal(questionType("Where is the missable chest?"), "missable");
  assert.equal(questionType("どこに行けばいい？"), "location");
  assert.equal(questionType("How do I get down to the water ledges?"), "location");
  assert.equal(questionType("Tell me about Karlach"), "general");
});

test("routing: the defaults change nothing", () => {
  const r = normalizeRouting({});
  assert.deepEqual(r, ROUTING_DEFAULTS);
  assert.deepEqual(route(r, { premium: true, type: "location", image: true }), { answer: "default", markers: false });
  assert.deepEqual(route(r, { premium: false, type: "location", image: true }), { answer: "default", markers: false });
});

test("routing: Premium on Pro; free players' chosen kinds on Pro, the rest with the Pro marker step", () => {
  const r = normalizeRouting({ premiumPro: true, freeProTypes: ["location", "puzzle", "bogus"], freeProMarkers: true, playerProDaily: "30" });
  assert.deepEqual(r.freeProTypes, ["location", "puzzle"]);
  assert.equal(r.playerProDaily, 30);
  assert.deepEqual(route(r, { premium: true, type: "general", image: true }), { answer: "pro", markers: false });
  assert.deepEqual(route(r, { premium: false, type: "puzzle", image: true }), { answer: "pro", markers: false });
  assert.deepEqual(route(r, { premium: false, type: "fight", image: true }), { answer: "default", markers: true });
  assert.deepEqual(route(r, { premium: false, type: "fight", image: false }), { answer: "default", markers: false });
});

const page: any = {
  key: "baldur-s-gate-3", slug: "ravaged-beach", name: "Ravaged Beach", verified: true, flagship: true, overview: "",
  items: [{ id: "i1", name: "Harper's Map", where: "Ornate chest under the Scuffed Rock", how: "Pass a Nature check, move the rock" }],
  secrets: [], enemies: [], shops: [], tips: [], sections: [], fights: [{ id: "f1", name: "Intellect Devourers", enemies: "three Intellect Devourers" }],
  walkthrough: [{ id: "w1", title: "The crash site", text: "Wake on the beach." }],
};

test("grounding: tagged verified entries, the same size as the plain notes", () => {
  const g = guideGroundingForPrompt(page);
  assert.match(g.text, /VERIFIED GUIDE ENTRIES FOR Ravaged Beach/);
  assert.match(g.text, /\[g1\] Item: Harper's Map; where: Ornate chest/);
  assert.match(g.text, /Prefer these over your own knowledge/);
  assert.equal(g.refs.g1.entry, "i1");
  const big = { ...page, items: Array.from({ length: 60 }, (_, i) => ({ id: "x" + i, name: "Item " + i, where: "a long description of where it is ".repeat(4) })) };
  const gb = guideGroundingForPrompt(big);
  assert.ok(gb.text.length < 2400 + 900, "body kept within the budget");
  assert.ok(Object.keys(gb.refs).every((t) => gb.text.includes(`[${t}]`)), "only tags that made it in");
});

test("grounding: the answer's <qc-guide> line becomes the badge's links, and the tags never show", () => {
  const g = guideGroundingForPrompt(page);
  const r = extractGuideRefs("Look under the Scuffed Rock [g1].\n<qc-guide>[\"g1\",\"g9\"]</qc-guide>", g.refs);
  assert.equal(r.text, "Look under the Scuffed Rock.");
  assert.equal(r.used.length, 1);
  assert.equal(r.used[0].name, "Harper's Map");
  assert.equal(extractGuideRefs("No guide used.", g.refs).used.length, 0);
});

test("feedback tallies: 👍 rate per group", () => {
  const t = tallyBy([{ vote: "up", qtype: "fight" }, { vote: "down", qtype: "fight" }, { vote: "up", qtype: "fight" }, { vote: "up", qtype: "location" }] as any, (r) => r.qtype);
  assert.deepEqual(t[0], { key: "fight", up: 2, down: 1, rate: 67 });
  assert.equal(t[1].rate, 100);
});

console.log(`\n${passed} passed`);
