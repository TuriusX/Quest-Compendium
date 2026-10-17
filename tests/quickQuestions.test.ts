// Run: npm run test:sync   (or: npx tsx tests/quickQuestions.test.ts)
import assert from "node:assert/strict";
import { QUICK_MAIN, QUICK_MORE, QUICK_HINTS, QUICK_PROMPTS, isQuickId, quickChips, quickLabelKey } from "../src/utils/quickQuestions";
import { SOURCE_STRINGS, HAND_WRITTEN } from "../src/i18n";
import { GENERATED } from "../src/locales.generated";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const ALL = [...QUICK_MAIN, ...QUICK_MORE, ...QUICK_HINTS, "after", "where"] as const;

test("the set and its order", () => {
  assert.deepEqual(QUICK_MAIN, ["next", "missable", "fight", "gear", "stuck"]);
  assert.deepEqual(QUICK_MORE, ["choice", "leave", "keep"]);
  assert.deepEqual(QUICK_HINTS, ["hint", "hintInstead"]);
  assert.equal(SOURCE_STRINGS["quick.next"], "What should I do next?");
  assert.equal(SOURCE_STRINGS[quickLabelKey("missable")], "Anything I can miss here?");
  assert.equal(SOURCE_STRINGS[quickLabelKey("fight")], "How do I beat this?");
  assert.equal(SOURCE_STRINGS[quickLabelKey("gear")], "Best gear for where I am");
  assert.equal(SOURCE_STRINGS["quick.hint"], "Just a hint, please, no spoilers");
  assert.ok(!("chat.follow1" in SOURCE_STRINGS), "'Explain that more simply' is gone");
});

test("the chips fit where the player is, and hints only with hint mode", () => {
  assert.deepEqual(quickChips({ asked: false }).shown, ["next", "missable", "gear"]);
  assert.deepEqual(quickChips({ asked: false, combat: true }).shown, ["next", "missable", "fight"]);
  assert.deepEqual(quickChips({ asked: true }).shown, ["after", "missable"]);
  assert.deepEqual(quickChips({ asked: true, canShowWhere: true }).shown, ["after", "where"]);
  assert.deepEqual(quickChips({ asked: true, combat: true, canShowWhere: true }).shown, ["fight", "after"]);
  for (const o of [{ asked: false }, { asked: true }, { asked: true, combat: true }]) {
    const { shown, extra } = quickChips(o);
    assert.ok(![...shown, ...extra].some((id) => id === "hint" || id === "hintInstead"), "no hint chips by default");
    assert.ok(!extra.some((id) => shown.includes(id)), "nothing twice");
  }
  assert.deepEqual(quickChips({ asked: true, hintMode: true }).extra.slice(0, 2), ["hintInstead", "hint"]);
  assert.deepEqual(quickChips({ asked: false, hintMode: true }).extra[0], "hint");
});

test("every quick question has a prompt for the AI", () => {
  for (const id of ALL) assert.ok(isQuickId(id) && QUICK_PROMPTS[id].length > 80, id);
  assert.ok(!isQuickId("toString") && !isQuickId("nope") && !isQuickId(undefined));
});

test("the hint prompts nudge without spoiling", () => {
  for (const id of ["hint", "hintInstead"] as const) {
    const p = QUICK_PROMPTS[id];
    assert.match(p, /never the solution/);
    assert.match(p, /no on-screen markers/);
    assert.match(p, /story spoilers/);
  }
});

test("every label is translated into all nine languages", () => {
  const langs = ["es", "pt", "de", "fr", "ru", "ja", "ko", "zh"];
  for (const key of [...ALL.map((id) => quickLabelKey(id)), "quick.more", "quick.less", "quick.label"]) {
    assert.ok(SOURCE_STRINGS[key], `en ${key}`);
    for (const l of langs) assert.ok((HAND_WRITTEN as any)[l]?.[key] || GENERATED[l]?.[key], `${l} ${key}`);
  }
});

console.log(`\n${passed} passed`);
