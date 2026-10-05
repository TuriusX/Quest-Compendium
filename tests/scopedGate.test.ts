// Run: npm run test:sync   (or: npx tsx tests/scopedGate.test.ts)
import assert from "node:assert/strict";
import { regressions, changesOf } from "../scripts/guides/scopedGate";
import { parseFightLines } from "../scripts/guides/fights";
import { billedUsage, SEARCH_DOLLARS } from "../usage";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const page = (slug: string, extra: any = {}) => ({
  name: slug, status: "published", verified: false, story: "Act 1", overview: "A village.",
  items: [{ id: "i1", name: "Silver Key", where: "In the chest", missable: true }],
  secrets: [{ id: "s1", text: "A hidden lever behind the altar." }], sections: [], fights: [], ...extra,
});
const live = new Map([["village", page("village")], ["cave", page("cave")]]);
const order = ["village", "cave"];
const stagedOf = (patch: Record<string, any>) =>
  new Map([...live].map(([k, p]) => [k, { ...p, status: "draft", staged: "copy", ...(patch[k] || {}) }]));

test("a fights pass that only adds fights has no regressions and lists each fight", () => {
  const staged = stagedOf({ cave: { fights: [{ id: "f1", name: "Cave Troll", tactics: "Fire arrows" }], fightsChecked: true } });
  assert.deepEqual(regressions("fights", live, staged, order, order), []);
  const c = changesOf("fights", live, staged);
  assert.equal(c.length, 1);
  assert.equal(c[0].name, "Cave Troll");
  assert.match(c[0].text, /tactics: Fire arrows/);
});

test("a change outside the pass's fields, a lost page or a new order is a regression", () => {
  const staged = stagedOf({ village: { overview: "Something else." } });
  staged.delete("cave");
  const r = regressions("fights", live, staged, order, ["village"]);
  assert.ok(r.some((x) => /village: "overview" changed/.test(x)));
  assert.ok(r.some((x) => /cave: page missing/.test(x)));
  assert.deepEqual(regressions("fights", live, stagedOf({}), order, ["cave", "village"]), ["the page order changed"]);
});

test("a missables pass may rewrite entries but not lose or rename them", () => {
  const ok = stagedOf({ village: { items: [{ id: "i1", name: "Silver Key", where: "From the well, the chest by the altar", how: "Open it", lockout: "Gone after Act 1", missable: true }] } });
  assert.deepEqual(regressions("missables", live, ok, order, order), []);
  const c = changesOf("missables", live, ok);
  assert.equal(c.length, 1);
  assert.match(c[0].before || "", /where In the chest/);
  const lost = stagedOf({ village: { items: [] } });
  assert.ok(regressions("missables", live, lost, order, order).some((x) => /item "Silver Key" lost/.test(x)));
  const renamed = stagedOf({ village: { items: [{ id: "i1", name: "Gold Key", where: "x", missable: true }] } });
  assert.ok(regressions("missables", live, renamed, order, order).some((x) => /renamed/.test(x)));
});

test("a summary box replacing an existing one is a regression; a new one is a change", () => {
  const withInfo = new Map([...live].map(([k, p]) => [k, { ...p, info: k === "cave" ? { region: "North" } : undefined }]));
  const staged = new Map([...withInfo].map(([k, p]) => [k, { ...p, info: { region: "South" } }]));
  assert.ok(regressions("info", withInfo, staged, order, order).some((x) => /cave: existing summary box replaced/.test(x)));
  assert.equal(changesOf("info", withInfo, staged).length, 2);
});

test("a correction may add a fight beside existing ones but not lose one", () => {
  const withFight = new Map([...live].map(([k, p]) => [k, { ...p, fights: [{ id: "f1", name: "Old Boss" }] }]));
  const added = new Map([...withFight].map(([k, p]) => [k, { ...p, fights: [...p.fights, { id: "f-gate", name: "Gate Battle" }] }]));
  assert.deepEqual(regressions("correction", withFight, added, order, order), []);
  assert.deepEqual(changesOf("correction", withFight, added).map((c) => c.name), ["Gate Battle", "Gate Battle"]);
  const lost = new Map([...withFight].map(([k, p]) => [k, { ...p, fights: [] }]));
  assert.ok(regressions("correction", withFight, lost, order, order).some((x) => /key fight "Old Boss" lost/.test(x)));
});

test("FIGHT lines leave blank fields out (Firestore refuses undefined)", () => {
  const [f] = parseFightLines("FIGHT: The Caretaker | The Caretaker | Shovel heals him | none | Yrden | none");
  assert.ok(!("rewards" in f) && !("weaknesses" in f));
  assert.ok(!Object.values(f).some((v) => v === undefined));
});

test("billed usage prices thinking as output and every search", () => {
  const u = billedUsage("gemini-3.8-flash", {
    usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 100_000, thoughtsTokenCount: 100_000 },
    candidates: [{ groundingMetadata: { webSearchQueries: ["a", "b", "c"] } }],
  });
  assert.equal(u.searches, 3);
  assert.ok(Math.abs(u.tokenDollars - (0.75 + 0.2 * 3.75)) < 1e-9);
  assert.ok(Math.abs(u.searchDollars - 3 * SEARCH_DOLLARS) < 1e-9);
  const long = billedUsage("gemini-3.1-pro-preview", { usageMetadata: { promptTokenCount: 250_000, candidatesTokenCount: 0 } });
  assert.ok(Math.abs(long.tokenDollars - 1.0) < 1e-9); // 250k at the long-prompt $4 rate
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
setTimeout(() => process.exit(process.exitCode || 0), 100);
