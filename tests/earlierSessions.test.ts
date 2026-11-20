// Earlier in sessions and the "looks done" line (src/utils/earlierSessions.ts, steps.ts). Run: npx tsx tests/earlierSessions.test.ts
import assert from "node:assert/strict";
import { earlierSessions, sessionDay, noteStale, cleanSessionNote, cleanNoteRequest, sessionNoteInput, SESSION_GAP_MS } from "../src/utils/earlierSessions";
import { extractLooksDone, extractTicked, objectiveRules } from "../steps";

const H = 60 * 60 * 1000;
const day = Date.UTC(2026, 10, 20, 18, 0, 0);
const item = (id: string, at: number, place?: string) => ({ id, text: `Step ${id}`, at, ...(place ? { place } : {}) });

// Two sessions a day apart; the newest first; grouped by place in the order reached.
{
  const passed = [item("a", day - 26 * H, "Cliff path"), item("b", day - 25.5 * H, "Cliff path"), item("c", day - H, "Lighthouse"), item("d", day - 0.5 * H, "Undercroft"), item("e", day - 0.4 * H, "Lighthouse")];
  const qs = [{ at: day - 26.2 * H, text: "Where do I start?" }, { at: day - 1.1 * H, text: "How do I get past the gate?" }];
  const s = earlierSessions(passed, qs);
  assert.equal(s.length, 2);
  assert.equal(s[0].count, 3);
  assert.deepEqual(s[0].places.map((p) => p.place), ["Lighthouse", "Undercroft"]);
  assert.deepEqual(s[0].places[0].items.map((i) => i.id), ["c", "e"]);
  assert.deepEqual(s[0].questions, ["How do I get past the gate?"]);
  assert.deepEqual(s[1].places, [{ place: "Cliff path", items: [{ id: "a", text: "Step a" }, { id: "b", text: "Step b" }] }]);
  assert.equal(s[1].key, String(day - 26.2 * H), "a session starts at its first activity (a question here)");
}

// Questions in between keep one session going; a long gap with no activity splits it.
{
  const passed = [item("a", day), item("b", day + 1.5 * H)];
  assert.equal(earlierSessions(passed, []).length, 2, "90 min without anything: two sessions");
  assert.equal(earlierSessions(passed, [{ at: day + 50 * 60 * 1000, text: "q" }]).length, 1, "a question in between: one");
  assert.equal(SESSION_GAP_MS, H);
}
assert.deepEqual(earlierSessions(undefined, [{ at: day, text: "q" }]), [], "no steps, no sessions");
assert.deepEqual(earlierSessions([item("x", day, "")], []).map((s) => s.places[0].place), [""], "no place: its own group");

// Day labels.
{
  const words = { today: "Today", yesterday: "Yesterday" };
  const now = new Date(2026, 10, 20, 21, 0).getTime();
  assert.equal(sessionDay(new Date(2026, 10, 20, 8, 0).getTime(), now, words), "Today");
  assert.equal(sessionDay(new Date(2026, 10, 19, 23, 0).getTime(), now, words), "Yesterday");
  assert.notEqual(sessionDay(new Date(2026, 10, 15, 12, 0).getTime(), now, words, "en-US"), "Yesterday");
}

// A note is made again only once the session grew by 2 steps.
assert.equal(noteStale(undefined, 1), true);
assert.equal(noteStale({ n: 3 }, 4), false);
assert.equal(noteStale({ n: 3 }, 5), true);

// The note as shown.
assert.equal(cleanSessionNote('"You got the **brass key** and rode the lift down."'), "You got the brass key and rode the lift down.");
assert.equal(cleanSessionNote("ok"), "");
assert.ok(cleanSessionNote("You did a lot. ".repeat(30)).length <= 201);

// The request, cleaned (sizes capped, empty steps dropped), and the model's input.
{
  assert.equal(cleanNoteRequest({ places: [] }), null);
  const r = cleanNoteRequest({ game: "Lighthouse", language: "English", places: [{ place: "Undercroft", items: [{ text: "Turn the winch" }, { text: "  " }] }], questions: ["How?"] })!;
  assert.deepEqual(r.places[0].items.map((i) => i.text), ["Turn the winch"]);
  const input = sessionNoteInput(r);
  assert.match(input, /Undercroft: Turn the winch/);
  assert.match(input, /Language: English/);
}

// "Looks done": only the objective's steps, always removed from the text, separate from <qc-ticked>.
{
  const o = { title: "Get past the gate", steps: [{ i: 1, text: "Pull the lever" }, { i: 2, text: "Turn the winch" }] };
  const r = extractLooksDone("The gate is open now; head to the cave.\n<qc-looks-done>[2, 7]</qc-looks-done>", o);
  assert.deepEqual(r, { text: "The gate is open now; head to the cave.", done: [2] });
  assert.deepEqual(extractLooksDone("x <qc-looks-done>nope</qc-looks-done>", o), { text: "x", done: [] });
  assert.deepEqual(extractLooksDone("plain", null), { text: "plain", done: [] });
  const both = "Done!\n<qc-ticked>[1]</qc-ticked>\n<qc-looks-done>[2]</qc-looks-done>";
  const t = extractTicked(both, o);
  assert.deepEqual(t.done, [1]);
  assert.deepEqual(extractLooksDone(t.text, o), { text: "Done!", done: [2] });
  const rules = objectiveRules(o);
  assert.match(rules, /<qc-looks-done>/);
  assert.match(rules, /never without a screenshot/);
}
console.log("earlierSessions: all passed");
