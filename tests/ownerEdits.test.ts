// Run: npm run test:sync   (or: npx tsx tests/ownerEdits.test.ts)
import assert from "node:assert/strict";
import { getAt, setAt, applyEdit, EDIT_PATH } from "../scripts/guides/ownerEdits";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const page = () => ({
  overview: "Geralt travels to Fyke Isle. Using a magical lamp, he retraces the massacre.",
  items: [{ id: "x2", name: "Annabelle's Bones", where: "Alexander's Laboratory atop the tower" }],
  walkthrough: [{ id: "s3", title: "Clear the tower", text: "Climb the stairs." }],
  sections: [{ title: "Don't miss", entries: [{ id: "fl1", text: "The lamp" }] }],
  tips: ["Bring Aard.", "Save first."],
  info: { region: "Velen" },
});

test("paths reach fields by name, list id and position", () => {
  const p = page();
  assert.equal(getAt(p, "items/#x2/where"), "Alexander's Laboratory atop the tower");
  assert.equal(getAt(p, "walkthrough/#s3/text"), "Climb the stairs.");
  assert.equal(getAt(p, "sections/0/entries/#fl1/text"), "The lamp");
  assert.equal(getAt(p, "tips/1"), "Save first.");
  assert.equal(getAt(p, "info/region"), "Velen");
  assert.equal(getAt(p, "items/#nope/where"), undefined);
  assert.equal(setAt(p, "items/#x2", "x"), false); // never replaces a whole entry
  assert.equal(EDIT_PATH.test("items/#x2/where"), true);
  assert.equal(EDIT_PATH.test("__proto__/x"), false);
  assert.equal(EDIT_PATH.test("items/<b>"), false);
});

test("an edit replaces only its sentence; the rest of the field (rebuilt or not) stays", () => {
  const p = page();
  assert.equal(applyEdit(p, { path: "overview", before: "Geralt travels to Fyke Isle.", after: "Geralt rows to Fyke Isle." }), "applied");
  assert.equal(p.overview, "Geralt rows to Fyke Isle. Using a magical lamp, he retraces the massacre.");
  // A rebuild changed the other sentence: the edit still finds its own.
  const q = page(); q.overview = "Geralt travels to Fyke Isle. A new second sentence.";
  assert.equal(applyEdit(q, { path: "overview", before: "Geralt travels to Fyke Isle.", after: "Geralt rows to Fyke Isle." }), "applied");
  assert.equal(q.overview, "Geralt rows to Fyke Isle. A new second sentence.");
});

test("curly quotes on the page still find the data's straight ones", () => {
  const p = page();
  assert.equal(applyEdit(p, { path: "items/#x2/where", before: "Alexander’s Laboratory atop the tower", after: "The cellar under the tower" }), "applied");
  assert.equal(p.items[0].where, "The cellar under the tower");
});

test("kept when the page already says it; stale when it was rewritten or is gone", () => {
  const p = page(); p.tips[0] = "Bring Igni.";
  assert.equal(applyEdit(p, { path: "tips/0", before: "Bring Aard.", after: "Bring Igni." }), "kept");
  assert.equal(applyEdit(page(), { path: "tips/0", before: "Something else.", after: "New." }), "stale");
  assert.equal(applyEdit(page(), { path: "items/#gone/where", before: "x", after: "y" }), "stale");
});

test("append adds a checked sentence once, then keeps it", () => {
  const p: any = page();
  assert.equal(applyEdit(p, { path: "overview", op: "append", before: "", after: "The tower has five floors." }), "applied");
  assert.equal(p.overview, "Geralt travels to Fyke Isle. Using a magical lamp, he retraces the massacre. The tower has five floors.");
  assert.equal(applyEdit(p, { path: "overview", op: "append", before: "", after: "The tower has five floors." }), "kept");
  assert.equal(applyEdit(p, { path: "missing", op: "append", before: "", after: "x" }), "stale");
});

test("order puts named entries first, by id or heading, the rest after", () => {
  const p: any = { items: [{ id: "a" }, { id: "b" }, { id: "c" }], gameplay: [{ heading: "H1" }, { heading: "H2" }] };
  assert.equal(applyEdit(p, { path: "items", op: "order", before: "", after: "", ids: ["c", "a"] }), "applied");
  assert.deepEqual(p.items.map((x: any) => x.id), ["c", "a", "b"]);
  assert.equal(applyEdit(p, { path: "items", op: "order", before: "", after: "", ids: ["c", "a"] }), "kept");
  assert.equal(applyEdit(p, { path: "gameplay", op: "order", before: "", after: "", ids: ["H2", "H1"] }), "applied");
  assert.equal(applyEdit(p, { path: "items", op: "order", before: "", after: "", ids: ["gone", "nope"] }), "stale");
});

test("taking a sentence out leaves no stray space", () => {
  const p: any = page();
  assert.equal(applyEdit(p, { path: "overview", before: "Geralt travels to Fyke Isle.", after: "" }), "applied");
  assert.equal(p.overview, "Using a magical lamp, he retraces the massacre.");
});

console.log(`\n${passed} passed`);
