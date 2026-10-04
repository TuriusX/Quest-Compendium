// Run: npm run test:sync   (or: npx tsx tests/questPolish.test.ts)
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { sharpenAction, PRECISE_ACTIONS } from "../answerBar";
import { extractSteps, STEPS_RULES } from "../steps";
import { formatShortcut } from "../src/utils/shortcut";
import { storyPhrase } from "../src/utils/placeName";
import { buildTrackerPayload, mergeSameSpot, type TrackerGuideArea } from "../src/utils/trackerPayload";

const { formatAccelerator } = createRequire(import.meta.url)("../electron/accelerator.cjs");

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

test("a vague 'Climb…' becomes the game's own action when the answer says to Jump", () => {
  const answer = "Use Jump (Z) to get up the rock ledge right of the burning wreck; walking there says \"Can't reach destination\".";
  assert.deepEqual(sharpenAction("Climb the cliff path on the right to bypass the Intellect Devourers", answer),
    { text: "Jump up the cliff path on the right to bypass the Intellect Devourers", changed: true });
  assert.equal(sharpenAction("Climb up the ledge", answer).text, "Jump up the ledge");
  assert.equal(sharpenAction("Climb here", answer).text, "Jump up here"); // a marker label
  // The answer doesn't mention jumping: left alone. Already exact: left alone.
  assert.equal(sharpenAction("Climb the ladder to the deck", "Climb the ladder.").changed, false);
  assert.equal(sharpenAction("Jump (Z) onto the rock ledge", answer).changed, false);
});

test("steps are sharpened against their own answer, and the prompt asks for exact actions and spots", () => {
  const text = "Jump (Z) up the rock ledge right of the burning wreck to skip the fight.\n" +
    '<qc-steps>[{"kind":"choice","text":"Climb the cliff path on the right or enter the breach","detail":"Jump (Z) up the rock ledge right of the burning wreck to skip the fight."}]</qc-steps>';
  assert.equal(extractSteps(text).steps[0].text, "Jump up the cliff path on the right or enter the breach");
  assert.match(PRECISE_ACTIONS, /Jump \(Z\)/);
  assert.match(PRECISE_ACTIONS, /Can't reach destination/);
  assert.ok(STEPS_RULES.includes(PRECISE_ACTIONS));
});

test("shortcuts are shown the way people read them, not as Electron accelerators", () => {
  assert.equal(formatAccelerator("CmdOrCtrl+\\", "win32"), "Ctrl+\\");
  assert.equal(formatAccelerator("CommandOrControl+Space", "win32"), "Ctrl+Space");
  assert.equal(formatAccelerator("CmdOrCtrl+\\", "darwin"), "Cmd+\\");
  assert.equal(formatAccelerator("Super+g", "win32"), "Win+G");
  assert.equal(formatAccelerator("CmdOrCtrl++", "win32"), "Ctrl++");
  assert.equal(formatAccelerator("", "win32"), "");
  assert.equal(formatShortcut("CmdOrCtrl+Shift+S", { mac: false }), "Ctrl+Shift+S");
  assert.equal(formatShortcut("CmdOrCtrl+Shift+S", { spaced: true, mac: false }), "Ctrl + Shift + S");
  assert.equal(formatShortcut("CmdOrCtrl+\\", { mac: false }), "Ctrl+\\");
});

test("story beats read as quest-log phrases", () => {
  assert.equal(storyPhrase("The player is exploring the crash site of the Nautiloid."), "Exploring the crash site of the Nautiloid");
  assert.equal(storyPhrase("The player has just escaped the nautiloid"), "Escaped the nautiloid");
  assert.equal(storyPhrase("You are heading to Mt. Kolts"), "Heading to Mt. Kolts");
  assert.equal(storyPhrase("Exploring the Nautiloid crash site"), "Exploring the Nautiloid crash site"); // already fine
  assert.equal(storyPhrase("Early game: Terra, Edgar and Locke heading to Mt. Kolts"), "Early game: Terra, Edgar and Locke heading to Mt. Kolts");
  assert.equal(storyPhrase(""), "");
  // The tracker shows the phrase.
  const p = buildTrackerPayload({ id: "t", name: "BG3", messages: [], place: { name: "Ravaged Beach", confirmed: true, story: "The player is exploring the crash site of the Nautiloid." } } as any, null, null, null, undefined, { accent: "#a87ffb", gameKey: "g" })!;
  assert.equal(p.data.quest, "Exploring the crash site of the Nautiloid");
});

// BG3 Ravaged Beach as the guide has it: two items in one chest under the Scuffed Rock, and a secret about that cache.
const page = {
  key: "bg3", slug: "ravaged-beach", name: "Ravaged Beach", story: "", overview: "", enemies: [], shops: [], tips: [], sections: [],
  items: [
    { id: "x1", name: "Thieves' Tools", where: "Inside a wooden crate near the dock on the western side of the beach", missable: true },
    { id: "x2", name: "Harper's Map", where: "Inside an Ornate Chest concealed underneath the Scuffed Rock", missable: true },
    { id: "x3", name: "Harper's Notebook", where: "Inside an Ornate Chest concealed underneath the Scuffed Rock", missable: true },
  ],
  secrets: [{ id: "x4", text: "A Harper cache concealed beneath the Scuffed Rock along the western cliffs; jump down the ledges near the water, pass a passive Nature check to spot drag marks, and use a character with sufficient Strength to shove the boulder aside." }],
};
const area = (done: string[] = []): TrackerGuideArea => ({ key: "bg3", slug: "ravaged-beach", name: "Ravaged Beach", story: "", done: new Set(done), page: page as any });
const tab = { id: "t", name: "BG3", messages: [], place: { name: "Ravaged Beach", confirmed: true } } as any;
const opts = { accent: "#a87ffb", gameKey: "g" };

test("entries describing the same chest merge into one, listing what's inside (missable if any part is)", () => {
  const m = mergeSameSpot(page as any);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].ids, ["x2", "x3", "x4"]);
  assert.equal(m[0].label, "Harper cache under the Scuffed Rock: Harper's Map, Harper's Notebook");
  const p = buildTrackerPayload(tab, null, area(), null, undefined, opts)!;
  const miss = p.data.sections.find((s) => s.id === "missable")!;
  assert.deepEqual(miss.items.map((i) => [i.id, i.label, !!i.missable]), [
    ["g:ravaged-beach:x1", "Thieves' Tools", true],
    ["g:ravaged-beach:x2+x3+x4", "Harper cache under the Scuffed Rock: Harper's Map, Harper's Notebook", true],
  ]);
  // The secret no longer shows on its own under To collect.
  assert.equal(p.data.sections.some((s) => s.id === "collect"), false);
  // Its details keep the full description.
  assert.match(miss.items[1].detail?.full || "", /passive Nature check/);
});

test("the merged entry is done only when every part is (ticking it ticks them all, in the app)", () => {
  const some = buildTrackerPayload(tab, null, area(["x2"]), null, undefined, opts)!;
  assert.equal(some.data.sections[0].items.find((i) => i.id.includes("+"))!.done, false);
  const all = buildTrackerPayload(tab, null, area(["x2", "x3", "x4"]), null, undefined, opts)!;
  assert.equal(all.data.sections[0].items.find((i) => i.id.includes("+"))!.done, true);
});

test("conservative: different chests that merely share words stay apart", () => {
  const other = { ...page, items: [
    { id: "a", name: "Ring", where: "Inside an Ornate Chest in the Dank Crypt's west room" },
    { id: "b", name: "Sword", where: "Inside an Ornate Chest in the Dank Crypt's east room" },
  ], secrets: [] };
  assert.deepEqual(mergeSameSpot(other as any), []);
});

console.log(`\n${passed} tests passed`);
