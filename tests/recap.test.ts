// Run: npx tsx tests/recap.test.ts
// "Where was I?" (session companion step 1, Nov 18 2026): the recap built from what the app keeps, no AI.
import assert from "node:assert/strict";
import { agoText, buildRecap, recapCard, RECAP_GAP_MS } from "../src/utils/recap";

const S: Record<string, string> = {
  "recap.yesterday": "yesterday", "recap.days": "{n} days ago", "recap.weeks": "{n} weeks ago", "recap.lastPlayed": "Last played {when}.",
  "recap.lastAsked": "You last asked: “{q}”", "recap.choice": "Your playthrough: {text}", "recap.question": "Where was I?",
};
const tr = (k: string, v: Record<string, string | number> = {}) => (S[k] || k).replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ""));
const DAY = 24 * 3600 * 1000;
const now = 1_800_000_000_000;

assert.equal(agoText(DAY - 1, tr), "");
assert.equal(agoText(DAY + 5, tr), "yesterday");
assert.equal(agoText(3 * DAY, tr), "3 days ago");
assert.equal(agoText(20 * DAY, tr), "2 weeks ago");
assert.equal(RECAP_GAP_MS, DAY);

const tab: any = {
  id: "t1", name: "Baldur's Gate 3", lastActive: now - 3 * DAY,
  place: { name: "Blighted Village", story: "Act 1", confirmed: true },
  questLog: { now: "a1" },
  messages: [
    { id: "u1", role: "user", text: "How do I get into the windmill?" },
    { id: "a1", role: "assistant", text: "...", title: "Save the Grove", doneSteps: [0],
      steps: [{ kind: "step", text: "Talk to Zevlor", label: "Talk to Zevlor" }, { kind: "warning", text: "Lute is missable", label: "Lute is missable" },
        { kind: "step", text: "Get into the windmill", label: "Get into the windmill" }, { kind: "step", text: "Find the Underdark", label: "Find the Underdark" }] },
    { id: "u2", role: "user", text: "Please analyze this game screenshot." },
    { id: "a2", role: "assistant", text: "..." },
  ],
};
const play: any = { entries: [{ id: "p", kind: "found", text: "Spidersilk Lute" }, { id: "q", kind: "choice", text: "Sided with the druids" }] };

const r = buildRecap(tab, play, now, tr, ["Please analyze this game screenshot."])!;
assert.equal(r.title, "Save the Grove");
assert.equal(r.place, "Blighted Village · Act 1");
assert.equal(r.ago, "3 days ago");
assert.deepEqual(r.steps, ["Get into the windmill", "Find the Underdark"], "ticked steps and warnings left out");
assert.equal(r.lastAsked, "How do I get into the windmill?", "the app's own stand-in wording skipped");
assert.equal(r.choice, "Sided with the druids");

const c = recapCard(r, tr, "recap-1");
assert.equal(c.question, "Where was I?");
assert.equal(c.text, "Last played 3 days ago. You last asked: “How do I get into the windmill?” Your playthrough: Sided with the druids");
assert.equal(c.steps.length, 2);

// No Now: the newest titled answer; nothing at all: null.
const noNow = buildRecap({ ...tab, questLog: {} }, null, now, tr)!;
assert.equal(noNow.title, "Save the Grove");
assert.equal(buildRecap({ ...tab, place: undefined, messages: [] }, null, now, tr), null);
// Only a place: the place is the title.
assert.equal(buildRecap({ ...tab, messages: [] }, null, now, tr)!.title, "Blighted Village · Act 1");

console.log("recap: ok");
