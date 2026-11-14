// Run: npm run test:sync   (or: npx tsx tests/visualAnswers.test.ts)
import assert from "node:assert/strict";
import { shortCount, pickStart, topicKey, mapStore, visualFor, visualId } from "../visualAnswer";
import { statKind, pacificDay, visualStatsLine } from "../visualServer";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

// A stand-in model: replies with the next JSON in the list (no AI is called).
const fakeAi = (...replies: any[]) => ({ calls: 0, models: { generateContent: async function (this: any) { return { text: JSON.stringify(replies.shift() ?? {}) }; } } });

await test("source-quality numbers for the ranking prompt are short (owner, Nov 14 2026: no cheese filter; best match wins)", () => {
  assert.equal(shortCount(1234567), "1.2M");
  assert.equal(shortCount(34567), "35K");
  assert.equal(shortCount(812), "812");
});

await test("start time: a chapter when the watched moment falls inside it, else the watched moment", () => {
  assert.equal(pickStart(257, 350), 257); // BG3: the chapter that contains the button
  assert.equal(pickStart(206, 42), 42);   // Malenia: the watched start comes before that chapter
  assert.equal(pickStart(0, 98), 98);     // no chapters: where watching found it
  assert.equal(pickStart(60, 400), 400);  // far past the chapter: not that chapter
  assert.equal(pickStart(0, 0), 0);
});

await test("saved results are keyed by the question and the topic; the same thing asked again costs no search", async () => {
  const store = mapStore();
  const video = { kind: "video" as const, videoId: "abc", title: "t", channel: "c", seconds: 60, start: 0, why: "", thumb: "" };
  await store.set([topicKey("elden-ring", "q how do I beat Malenia?"), topicKey("elden-ring", "video Malenia, Blade of Miquella")], video);
  let searched = 0;
  const r = await visualFor(fakeAi({ kind: "video", confidence: "high", subject: "Malenia, Blade of Miquella", search: "x" }) as any, {
    game: "Elden Ring", gameKey: "elden-ring", question: "Malenia tips?", answer: "...", youtubeKey: "k", wiki: {}, store,
    beforeSearch: async () => { searched++; },
  });
  assert.equal(r.cached, true);
  assert.equal(visualId(r.visual), "abc");
  assert.equal(searched, 0);
});

await test("lore, builds and anything the model isn't highly sure of get nothing, and nothing is saved", async () => {
  const store = mapStore();
  for (const reply of [{ kind: "none", confidence: "high" }, { kind: "video", confidence: "medium", search: "x" }]) {
    const r = await visualFor(fakeAi(reply) as any, { game: "G", gameKey: "g", question: "Who are the Crones?", answer: "...", youtubeKey: "k", wiki: {}, store });
    assert.equal(r.visual.kind, "none");
    assert.equal(r.keys.length, 0);
  }
});

await test("the day's YouTube searches used up: no video, and nothing saved (looked for again later)", async () => {
  const m = new Map();
  const r = await visualFor(fakeAi({ kind: "video", confidence: "high", subject: "Path of Pain", search: "Hollow Knight Path of Pain" }) as any, {
    game: "Hollow Knight", gameKey: "hollow-knight", question: "How do I get through the Path of Pain?", answer: "...", youtubeKey: "k", wiki: {},
    store: mapStore(m), beforeSearch: async () => { const { YouTubeQuotaOut } = await import("../visualAnswer"); throw new YouTubeQuotaOut("used up"); },
  });
  assert.equal(r.visual.kind, "none");
  assert.equal(r.quotaOut, true);
  assert.equal(m.size, 0);
});

await test("/stats kinds and the YouTube day", () => {
  assert.equal(statKind({ kind: "picture", source: "ours", url: "u", alt: "", why: "" }), "ours");
  assert.equal(statKind({ kind: "picture", source: "wiki", url: "u", alt: "", why: "" }), "wiki");
  assert.equal(statKind({ kind: "none", why: "" }), "none");
  // 07:30 UTC on Nov 15 is still Nov 14 in California (YouTube's quota day).
  assert.equal(pacificDay(Date.parse("2026-11-15T07:30:00Z")), "2026-11-14");
});

await test("/stats: visuals by kind, cost per answer, plays and today's YouTube searches", () => {
  const line = visualStatsLine({ days: [
    { answers: 6, shown_video: 2, shown_ours: 1, shown_wiki: 1, shown_none: 2, cached: 1, cost: 0.05, played: 2, opened: 1, wrong: 0 },
    { answers: 4, shown_video: 1, shown_none: 3, cost: 0.01, quotaOut: 2 },
  ], searchesToday: 37, searchLimit: 100 }, "last 7 days");
  assert.match(line, /10 answer\(s\) looked at, 5 got one \(50%\)/);
  assert.match(line, /Video 3 · our picture 1 · wiki picture 1 · nothing 5 · saved one reused 1/);
  assert.match(line, /Cost: \$0\.06 \(\$0\.0060 per answer\) · played 2 · pictures opened 1/);
  assert.match(line, /YouTube searches today: 37 of 100 · 2 answer\(s\) got no video/);
});

console.log(`\n${passed} passed`);
