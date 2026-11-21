// Run: npx tsx tests/saveState.test.ts
// The save right now (Nov 21 2026): the record answers get, kept up to date after every answer.
import assert from "node:assert/strict";
import { parseSaveState, saveStateInput } from "../src/utils/saveState";
import { emptyPlaythrough, setState, editState, mergePlaythrough, clearPlaythrough, playthroughForRequest, cleanState } from "../src/utils/playthrough";

// The model's reply: JSON (with or without a fence), capped, junk dropped.
const r = parseSaveState('```json\n{"who":"The Dark Urge","party":"Shadowheart (in party)","story":"Act 1: after the crash","open":["Recruit Astarion","x","Find a healer"]}\n```');
assert.deepEqual(r, { who: "The Dark Urge", party: "Shadowheart (in party)", story: "Act 1: after the crash", open: ["Recruit Astarion", "Find a healer"] });
assert.equal(parseSaveState("no json here"), null);
assert.equal(parseSaveState('{"who":"","party":"","story":"","open":[]}'), null);

// The input names everything it read, and the guide's ticked steps.
const input = saveStateInput({ game: "Baldur's Gate 3", question: "I got Shadowheart, what next?", answer: "Head north…", place: "Ravaged Beach", steps: [{ title: "Free Shadowheart", done: true }, { title: "Meet Astarion", done: false }] });
assert.match(input, /Old record: \(none yet\)/);
assert.match(input, /\[ticked\] Free Shadowheart \| Meet Astarion/);
assert.match(input, /Where they are: Ravaged Beach/);

// Updates replace the record; a late update from an older answer never wins over a newer edit.
let p = setState(emptyPlaythrough(), { who: "The Dark Urge", party: "Shadowheart", story: "", open: [] }, 1000, 2000);
assert.equal(p.state?.party, "Shadowheart");
p = editState(p, { party: "Shadowheart, Astarion" }, 3000);
assert.equal(p.state?.edited, 3000);
const late = setState(p, { who: "x", party: "nobody", story: "", open: [] }, 2500, 4000);
assert.equal(late, p, "an answer asked before the edit doesn't overwrite it");
const after = setState(p, { who: "The Dark Urge", party: "Shadowheart, Astarion, Gale", story: "", open: [] }, 3500, 4000);
assert.equal(after.state?.party, "Shadowheart, Astarion, Gale");
assert.equal(after.state?.edited, 3000, "the edit mark stays, so the update keeps respecting it");

// Clearing every line removes the record (no undefined field for Firestore).
const gone = editState(editState(editState(p, { who: "" }), { party: "" }), { story: "", open: [] });
assert.equal("state" in gone, false);

// Merging two copies: the newer record wins; one from before "Clear this game" doesn't come back.
const a = setState(emptyPlaythrough(), { who: "A", party: "", story: "", open: [] }, 0, 5000);
const b = setState(emptyPlaythrough(), { who: "B", party: "", story: "", open: [] }, 0, 6000);
assert.equal(mergePlaythrough(a, b).state?.who, "B");
const cleared = clearPlaythrough(a, 7000);
assert.equal(mergePlaythrough(cleared, b).state, undefined);

// What a question sends: the record without its timestamps.
const req = playthroughForRequest(b);
assert.deepEqual(req?.state, { who: "B", party: "", story: "", open: [] });
assert.equal(cleanState({ who: "  ", open: ["ab"] }), null);

console.log("saveState: all passed");
