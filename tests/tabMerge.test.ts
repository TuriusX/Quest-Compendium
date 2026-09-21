// Run: npm run test:sync   (or: npx tsx tests/tabMerge.test.ts)
import assert from "node:assert/strict";
import {
  canonicalStringify, isLegacyWelcomeTab, mergeTabState, sanitizeTabsForCloud, UploadGovernor,
  type TabState,
} from "../src/hooks/tabMerge";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const tab = (id: string, o: any = {}): any => ({ id, name: "Game " + id, messages: [], notes: "", createdAt: 1000, lastActive: 2000, ...o });
const S = (tabs: any[], deleted: Record<string, number> = {}): TabState => ({ tabs, deleted });
const ids = (s: TabState) => s.tabs.map((t) => t.id);
const view = (s: TabState) => canonicalStringify(sanitizeTabsForCloud(s.tabs));
const FOUR = ["tab-1", "tab-2", "tab-3", "tab-4"].map((i) => tab(i));

// ---------------------------------------------------------------- basics
test("empty local adopts cloud tabs; nothing to upload", () => {
  const r = mergeTabState(S([]), S(FOUR));
  assert.deepEqual(ids(r.merged), ["tab-1", "tab-2", "tab-3", "tab-4"]);
  assert.equal(r.localChanged, true); assert.equal(r.cloudChanged, false);
});
test("empty cloud gets local tabs uploaded; local unchanged", () => {
  const r = mergeTabState(S(FOUR), S([]));
  assert.equal(r.localChanged, false); assert.equal(r.cloudChanged, true);
});
test("identical sides: nothing changes anywhere (this is what stops the write war)", () => {
  const r = mergeTabState(S(FOUR), S(JSON.parse(JSON.stringify(FOUR))));
  assert.equal(r.localChanged, false); assert.equal(r.cloudChanged, false);
});
test("disjoint tabs are unioned, in a deterministic order, and both sides need updating", () => {
  const r = mergeTabState(S([tab("b", { createdAt: 3000 })]), S([tab("a", { createdAt: 1000 })]));
  assert.deepEqual(ids(r.merged), ["a", "b"]);
  assert.equal(r.localChanged, true); assert.equal(r.cloudChanged, true);
});
test("same tab on both sides: newer lastActive wins (both directions)", () => {
  const older = tab("x", { lastActive: 2000, notes: "old" }), newer = tab("x", { lastActive: 5000, notes: "new" });
  assert.equal(mergeTabState(S([older]), S([newer])).merged.tabs[0].notes, "new");
  assert.equal(mergeTabState(S([newer]), S([older])).merged.tabs[0].notes, "new");
});

// ---------------------------------------------------------------- convergence properties
test("merge is symmetric: swapping which side is 'local' gives the same result", () => {
  const a = S([tab("1", { lastActive: 5, notes: "A" }), tab("2", { createdAt: 5 })], { gone: 9 });
  const b = S([tab("1", { lastActive: 5, notes: "B" }), tab("3", { createdAt: 7 })], { other: 4 });
  const ab = mergeTabState(a, b).merged, ba = mergeTabState(b, a).merged;
  assert.equal(view(ab), view(ba)); assert.equal(canonicalStringify(ab.deleted), canonicalStringify(ba.deleted));
});
test("merge is idempotent: merging the result again changes nothing", () => {
  const a = S([tab("1", { lastActive: 5 })]), b = S([tab("2", { createdAt: 7 })], { z: 3 });
  const m = mergeTabState(a, b).merged;
  const again = mergeTabState(m, m);
  assert.equal(again.localChanged, false); assert.equal(again.cloudChanged, false);
});

// ---------------------------------------------------------------- deletions
test("a deletion recorded in the cloud removes the tab on every device", () => {
  const r = mergeTabState(S([tab("x", { lastActive: 2000 }), tab("y")]), S([tab("y")], { x: 3000 }));
  assert.deepEqual(ids(r.merged), ["y"]);
  assert.equal(r.localChanged, true);           // local drops x
});
test("deleting locally uploads the tombstone and drops the tab from the cloud", () => {
  const r = mergeTabState(S([tab("y")], { x: 3000 }), S([tab("x", { lastActive: 2000 }), tab("y")]));
  assert.deepEqual(ids(r.merged), ["y"]);
  assert.equal(r.cloudChanged, true);
  assert.deepEqual(r.merged.deleted, { x: 3000 });
});
test("a tab edited AFTER it was deleted comes back", () => {
  const r = mergeTabState(S([tab("x", { lastActive: 9000 })]), S([], { x: 3000 }));
  assert.deepEqual(ids(r.merged), ["x"]);
});
test("tombstones from both sides are combined, newest wins", () => {
  const r = mergeTabState(S([], { a: 5, b: 1 }), S([], { a: 9, c: 2 }));
  assert.deepEqual(r.merged.deleted, { a: 9, b: 1, c: 2 });
});
test("a dead tab still lingering in the cloud does NOT trigger an upload by itself (no fight with old builds)", () => {
  const r = mergeTabState(S([tab("y")], { x: 3000 }), S([tab("x", { lastActive: 2000 }), tab("y")], { x: 3000 }));
  assert.equal(r.cloudChanged, false);
});
test("the legacy 'Welcome, Explorer' tab is ignored on both sides and never forces an upload", () => {
  const legacy = tab("guest-welcome-compendium", { name: "Welcome, Explorer" });
  assert.equal(isLegacyWelcomeTab(legacy), true);
  const r = mergeTabState(S([tab("a"), legacy]), S([tab("a"), legacy]));
  assert.deepEqual(ids(r.merged), ["a"]); assert.equal(r.cloudChanged, false);
});

// ---------------------------------------------------------------- local-only data is preserved and never causes uploads
test("heavy local-only data (audio, big images) is kept locally when the cloud copy wins", () => {
  const local = tab("x", { lastActive: 1, messages: [{ id: "m1", role: "assistant", text: "hi", audioBase64: "AAAA", timestamp: 1 }] });
  const cloud = tab("x", { lastActive: 9, messages: [{ id: "m1", role: "assistant", text: "hi (edited)", timestamp: 1 }] });
  const m = mergeTabState(S([local]), S([cloud])).merged.tabs[0];
  assert.equal((m.messages[0] as any).text, "hi (edited)"); assert.equal((m.messages[0] as any).audioBase64, "AAAA");
});
test("local audio/images never look like a difference from the sanitized cloud copy", () => {
  const rich = tab("x", { messages: [{ id: "m", role: "user", text: "q", audioBase64: "AAAA", imageUrl: "x".repeat(3000), timestamp: 1 }] });
  const r = mergeTabState(S([rich]), S(sanitizeTabsForCloud([rich])));
  assert.equal(r.cloudChanged, false); assert.equal(r.localChanged, false);
});
test("key order / undefined fields from Firestore don't look like differences", () => {
  const local = tab("x", { extra: undefined });
  const fromCloud = JSON.parse(JSON.stringify({ lastActive: 2000, createdAt: 1000, notes: "", messages: [], name: "Game x", id: "x" }));
  const r = mergeTabState(S([local]), S([fromCloud]));
  assert.equal(r.cloudChanged, false); assert.equal(r.localChanged, false);
});

// ---------------------------------------------------------------- YOUR SCENARIO
test("YOUR LOGS: web has 0 tabs, desktop and preview have 4, cloud has 4 -> nobody uploads anything", () => {
  const web = mergeTabState(S([]), S(FOUR));
  assert.equal(web.cloudChanged, false);                       // the old code uploaded 0 tabs here
  assert.deepEqual(ids(web.merged), ["tab-1", "tab-2", "tab-3", "tab-4"]);
  for (const c of [S(FOUR), S(FOUR)]) { const r = mergeTabState(c, S(FOUR)); assert.equal(r.cloudChanged, false); }
});

// ---------------------------------------------------------------- randomized multi-device simulation
class Rng { constructor(private s: number) {} next() { this.s = (this.s * 1664525 + 1013904223) >>> 0; return this.s / 2 ** 32; } int(n: number) { return Math.floor(this.next() * n); } }

function simulate(seed: number) {
  const rng = new Rng(seed);
  let clock = 9_000;
  let cloud: TabState = S([]);
  let writes = 0;
  const clients = ["web", "desktop", "preview"].map((name) => ({ name, local: S([]) as TabState }));
  const queue: number[] = [];           // pending snapshot deliveries (client index)
  let nextId = 1;
  const lastActivity = new Map<string, number>();   // ground truth: time of the latest create/edit of each tab
  const lastDelete = new Map<string, number>();     // ground truth: time of the latest deletion of each tab

  // What the app does after a snapshot or a local change: one transaction = read fresh cloud, merge, write only if different.
  const transaction = (i: number) => {
    const out = mergeTabState(clients[i].local, cloud);
    if (out.cloudChanged) {
      cloud = { tabs: sanitizeTabsForCloud(out.merged.tabs), deleted: out.merged.deleted };
      writes++;
      clients.forEach((_, j) => { if (j !== i) queue.push(j); });
    }
    if (out.localChanged) clients[i].local = out.merged;
  };
  const deliver = (i: number) => {          // snapshot arrives
    const out = mergeTabState(clients[i].local, cloud);
    if (out.localChanged) clients[i].local = out.merged;
    if (out.cloudChanged) transaction(i);
  };
  const drain = (limit = 2000) => { let n = 0; while (queue.length && n++ < limit) deliver(queue.splice(rng.int(queue.length), 1)[0]); return n < limit; };

  const ops = 25 + rng.int(25);
  for (let k = 0; k < ops; k++) {
    clock += 1 + rng.int(200);
    const i = rng.int(3), c = clients[i], r = rng.next();
    if (r < 0.35 || c.local.tabs.length === 0) {                      // create
      const id = "t" + nextId++;
      c.local = { ...c.local, tabs: [...c.local.tabs, tab(id, { createdAt: clock, lastActive: clock })] };
      lastActivity.set(id, clock);
    } else if (r < 0.75) {                                            // edit
      const t = c.local.tabs[rng.int(c.local.tabs.length)];
      c.local = { ...c.local, tabs: c.local.tabs.map((x) => (x.id === t.id ? { ...x, notes: "n" + clock, lastActive: clock } : x)) };
      lastActivity.set(t.id, clock);
    } else {                                                          // delete (tombstone)
      const t = c.local.tabs[rng.int(c.local.tabs.length)];
      c.local = { tabs: c.local.tabs.filter((x) => x.id !== t.id), deleted: { ...c.local.deleted, [t.id]: clock } };
      lastDelete.set(t.id, clock);
    }
    if (rng.next() < 0.7) transaction(i);                             // debounce fired (sometimes the device stays "offline" a while)
    if (rng.next() < 0.5) { if (!drain()) return { ok: false, why: "did not settle while running", writes }; }
  }
  // Everyone comes back online and syncs.
  for (let i = 0; i < 3; i++) transaction(i);
  if (!drain()) return { ok: false, why: "did not settle at the end", writes };
  for (let i = 0; i < 3; i++) transaction(i);
  if (!drain()) return { ok: false, why: "did not settle after final sync", writes };
  for (let i = 0; i < 3; i++) transaction(i);

  const views = clients.map((c) => view(c.local));
  const cloudView = view(cloud);
  const allSame = views.every((v) => v === cloudView);
  const tombs = clients.every((c) => canonicalStringify(c.local.deleted) === canonicalStringify(cloud.deleted));
  // Correctness: a tab must exist iff it was used after its last deletion, and hold its most recent edit.
  const expectedAlive = [...lastActivity.keys()].filter((id) => lastActivity.get(id)! > (lastDelete.get(id) ?? 0)).sort();
  const actualAlive = cloud.tabs.map((t) => t.id).sort();
  if (canonicalStringify(expectedAlive) !== canonicalStringify(actualAlive)) {
    return { ok: false, why: `wrong tabs alive: expected [${expectedAlive}] got [${actualAlive}]`, writes, ops };
  }
  for (const t of cloud.tabs) if (t.lastActive !== lastActivity.get(t.id)) return { ok: false, why: `tab ${t.id} lost its latest edit`, writes, ops };
  return { ok: allSame && tombs && queue.length === 0, why: allSame ? (tombs ? "" : "tombstones differ") : "views differ", writes, ops };
}

test("STRESS: 500 random 3-device histories (create/edit/delete, random delivery order) always converge and stop writing", () => {
  let worst = 0, failures: string[] = [];
  for (let seed = 1; seed <= 500; seed++) {
    const r: any = simulate(seed);
    worst = Math.max(worst, r.writes);
    if (!r.ok) failures.push(`seed ${seed}: ${r.why}`);
    else assert.ok(r.writes <= r.ops * 3 + 12, `seed ${seed}: ${r.writes} writes for ${r.ops} ops (too many)`);
  }
  assert.equal(failures.length, 0, failures.slice(0, 3).join("; "));
  console.log(`      (worst case: ${worst} cloud writes in a single history)`);
});

// ---------------------------------------------------------------- safety net
test("UploadGovernor: allows normal use, blocks a runaway loop, then recovers", () => {
  const g = new UploadGovernor(8, 10_000, 30_000);
  let t = 0;
  for (let i = 0; i < 8; i++) assert.equal(g.allow(t += 100), true);
  assert.equal(g.allow(t += 100), false);          // 9th in 10s: blocked
  assert.equal(g.allow(t += 20_000), false);       // still cooling down
  assert.equal(g.allow(t += 11_000), true);        // cooldown over
});
test("UploadGovernor: slow, normal editing is never blocked", () => {
  const g = new UploadGovernor(8, 10_000, 30_000);
  for (let i = 0; i < 200; i++) assert.equal(g.allow(i * 3_000), true);
});

console.log(`\n${passed} tests passed` + (process.exitCode ? " (WITH FAILURES)" : ""));
