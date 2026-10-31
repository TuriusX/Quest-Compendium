// Run: npm run test:sync   (or: npx tsx tests/missingFacts.test.ts)
import assert from "node:assert/strict";
import { extractMissing, notOnPage, saveMissingFacts, APP_MISSING_PER_DAY } from "../missingFacts";
import { guideGroundingForPrompt, guideNotesForPrompt, GUIDE_REFERENCE } from "../guidesApi";

let passed = 0;
const results: Promise<void>[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  results.push((async () => {
    try { await fn(); passed++; console.log("PASS  " + name); }
    catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
  })());
}

// FF6, South Figaro: the page lists the Elixir in the clock, not the mansion's relics.
const page: any = {
  key: "final-fantasy-vi", slug: "south-figaro", name: "South Figaro", verified: false, overview: "A port town.",
  items: [{ id: "i1", name: "Elixir", where: "grandfather clock inside the storeroom behind the affluent resident's mansion" }],
  secrets: [{ id: "s1", text: "Speaking to the quiet mercenary in the Cafe registers the name Shadow." }],
  enemies: [], shops: [], tips: [], sections: [], fights: [],
};

const answer = `Go behind the bookcase upstairs.\n\n<qc-missing>[{"name": "Hyper Wrist", "fact": "In a chest in the mansion's hidden cells."}, {"name": "Hermes Sandals", "fact": "In the other chest in the hidden cells."}, {"name": "Elixir", "fact": "In the clock."}]</qc-missing>`;

test("the <qc-missing> line comes out of the answer, with each thing and its fact", () => {
  const r = extractMissing(answer);
  assert.equal(r.text, "Go behind the bookcase upstairs.");
  assert.deepEqual(r.missing.map((m) => m.name), ["Hyper Wrist", "Hermes Sandals", "Elixir"]);
});

test("a broken line is dropped but still removed from the text", () => {
  const r = extractMissing("Answer.\n<qc-missing>[{name: Hyper Wrist}</qc-missing>");
  assert.equal(r.text, "Answer.");
  assert.equal(r.missing.length, 0);
});

test("names the page already has are not sent", () => {
  assert.deepEqual(notOnPage(page, extractMissing(answer).missing).map((m) => m.name), ["Hyper Wrist", "Hermes Sandals"]);
});

// A small stand-in for Firestore: contributions, the day's counter, transactions.
function fakeDb(existing: any[] = []) {
  const contributions = [...existing];
  const days: Record<string, any> = {};
  const db: any = {
    collection: (name: string) => ({
      where: (f1: string, _o: string, v1: any) => ({ where: (f2: string, _o2: string, v2: any) => ({
        get: async () => ({ docs: contributions.filter((c) => c[f1] === v1 && c[f2] === v2).map((c) => ({ data: () => c })) }),
      }) }),
      doc: (id: string) => ({ id, name }),
      add: async (x: any) => { contributions.push(x); return { id: String(contributions.length) }; },
    }),
    runTransaction: async (fn: any) => fn({
      get: async (ref: any) => ({ data: () => days[ref.id] }),
      set: (ref: any, v: any) => { days[ref.id] = { queued: (Number(days[ref.id]?.queued) || 0) + 1, at: v.at }; },
    }),
  };
  return { db, contributions, days };
}

test("an app answer's missing things are queued for the page as \"missing\" items (source app, no player id)", async () => {
  process.env.QC_COUNT_LOCAL = "1";
  const { db, contributions } = fakeDb();
  const n = await saveMissingFacts({ page, missing: extractMissing(answer).missing, uid: "player-1", language: "Spanish" }, db);
  assert.equal(n, 2);
  assert.deepEqual(contributions.map((c) => [c.key, c.slug, c.kind, c.source, c.status, c.uid, c.lang, c.label]), [
    ["final-fantasy-vi", "south-figaro", "missing", "app", "pending", "app", "es", "Missing: Hyper Wrist"],
    ["final-fantasy-vi", "south-figaro", "missing", "app", "pending", "app", "es", "Missing: Hermes Sandals"],
  ]);
});

test("one already waiting for the page isn't queued again; test players and a full day queue nothing", async () => {
  process.env.QC_COUNT_LOCAL = "1";
  const waiting = { key: "final-fantasy-vi", slug: "south-figaro", kind: "missing", source: "app", name: "Hyper Wrist", label: "Missing: Hyper Wrist", at: Date.now() };
  const a = fakeDb([waiting]);
  assert.equal(await saveMissingFacts({ page, missing: extractMissing(answer).missing, uid: "player-1" }, a.db), 1);
  assert.equal(a.contributions.at(-1).name, "Hermes Sandals");
  const b = fakeDb();
  assert.equal(await saveMissingFacts({ page, missing: extractMissing(answer).missing, uid: "guest_test_1" }, b.db), 0);
  const c = fakeDb();
  for (let i = 0; i < APP_MISSING_PER_DAY; i++) await saveMissingFacts({ page, missing: [{ name: `Thing ${i}`, fact: "Somewhere." }], uid: "player-1" }, c.db);
  assert.equal(await saveMissingFacts({ page, missing: [{ name: "One more", fact: "Somewhere." }], uid: "player-1" }, c.db), 0);
});

test("the guide is reference, never a limit: both prompt blocks say so and no longer say to prefer the guide", () => {
  const grounding = guideGroundingForPrompt({ ...page, verified: true }).text;
  const notes = guideNotesForPrompt(page);
  for (const t of [grounding, notes]) {
    assert.ok(t.includes(GUIDE_REFERENCE));
    assert.ok(!/prefer these over your own knowledge|base the answer on it/i.test(t));
  }
  assert.match(GUIDE_REFERENCE, /never limit the answer/);
  assert.match(GUIDE_REFERENCE, /several more chests/);
});

Promise.all(results).then(() => console.log(`\n${passed} passed`));
