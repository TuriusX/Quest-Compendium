// Run by hand (it uses the real database, under a made-up game it deletes afterwards; no AI calls):
//   npx tsx tests/worthAreas.live.ts
// "Worth getting here" on demand (Nov 15 2026), owner's checks: name variants and other names of one place are one area
// with one pass (no duplicate list, no repeat spend); two players at once still one pass; an area with nothing sourced
// stays empty and is never tried again.
import assert from "node:assert/strict";
import { getFirestore } from "firebase-admin/firestore";
import "../scripts/guides/common";
import { areaRef, fillArea, worthStatus, type AliasJudge } from "../worthOnDemand";
import type { WorthEntry } from "../scripts/guides/records";

const GAME = "QC Alias Test Game";
const db = getFirestore();
let passes: string[] = [];
const entry = (name: string): WorthEntry => ({ type: "item", name, rank: 1, fields: { kind: "gear", why: "test" }, sources: ["example.org"] });
// The pass: counted; "Empty Hollow" has nothing a trusted source backs (an empty result).
const pass = async (_k: string, slug: string, _g: string, name: string) => {
  passes.push(slug);
  await new Promise((r) => setTimeout(r, 400));
  return { entries: /hollow/i.test(name) ? [] : [entry(`${name} sword`)], dropped: 0 };
};
// The name check: "Druid Grove" is another name for the Emerald Grove; nothing else is.
const judge: AliasJudge = async (_g, name, known) => (/druid grove/i.test(name) ? known.find((k) => /emerald grove/i.test(k)) || "" : "");
const deps = { pass: pass as any, judge, cards: false };

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

async function wipe(key: string) {
  const ref = db.collection("gameRecords").doc(key);
  for (const c of await ref.listCollections()) for (;;) { const s = await c.limit(300).get(); if (s.empty) break; const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }
  await ref.delete().catch(() => {});
  const wanted = await db.collection("worthWanted").where("key", "==", key).get();
  for (const d of wanted.docs) await d.ref.delete();
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const statsRef = db.collection("system").doc("worthOnDemand");
  const before = ((await statsRef.get()).data() as any)?.days?.[today] || null;
  const first = await areaRef(GAME, "Emerald Grove");
  assert.ok(first);
  const key = first!.key;
  await wipe(key);
  try {
    await test("variants of one name: one area, one pass", async () => {
      passes = [];
      for (const v of ["Emerald Grove", "The Emerald Grove", "emerald grove.", "Emerald Grove area", "The Emerald Grove, Druid Chamber"]) {
        const a = await areaRef(GAME, v);
        assert.equal(a!.slug, "emerald-grove", v);
        const r = await fillArea(a!, "", "night", deps);
        assert.equal(r.status, "ready", v);
      }
      assert.deepEqual(passes, ["emerald-grove"]);
    });
    await test("another name for the same place (Druid Grove): the same area, no second pass, remembered", async () => {
      passes = [];
      const a = await areaRef(GAME, "Druid Grove");
      assert.equal(a!.slug, "druid-grove", "before the check it's a new name");
      const r = await fillArea(a!, "", "night", deps);
      assert.equal(r.area.slug, "emerald-grove");
      assert.equal(r.status, "ready");
      assert.deepEqual(passes, [], "no second pass");
      const again = await areaRef(GAME, "The Druid Grove");
      assert.equal(again!.slug, "emerald-grove", "the alias is remembered: later reads go straight to the area");
      assert.equal(await worthStatus(again!), "ready");
    });
    await test("a different place is its own area", async () => {
      passes = [];
      const r = await fillArea((await areaRef(GAME, "Sunlit Plains"))!, "", "night", deps);
      assert.equal(r.area.slug, "sunlit-plains");
      assert.deepEqual(passes, ["sunlit-plains"]);
    });
    await test("two players at once: one pass", async () => {
      passes = [];
      const a = (await areaRef(GAME, "Ashen Keep"))!;
      const [x, y] = await Promise.all([fillArea(a, "", "night", deps), fillArea(a, "", "night", deps)]);
      assert.deepEqual(passes, ["ashen-keep"]);
      assert.ok([x.status, y.status].includes("ready"));
      assert.ok([x.status, y.status].every((s) => s === "ready" || s === "running"));
    });
    await test("nothing a trusted source backs: empty, shown as nothing, never tried again", async () => {
      passes = [];
      const a = (await areaRef(GAME, "Empty Hollow"))!;
      assert.equal((await fillArea(a, "", "night", deps)).status, "empty");
      assert.equal((await fillArea(a, "", "night", deps)).status, "empty");
      assert.equal(await worthStatus(a), "empty");
      assert.deepEqual(passes, ["empty-hollow"], "one pass only");
    });
  } finally {
    await wipe(key);
    // Today's counts as they were (these test fills aren't real ones).
    const days = ((await statsRef.get()).data() as any)?.days || {};
    if (before) days[today] = before; else delete days[today];
    await statsRef.update({ days });
  }
  console.log(`\n${passed} passed`);
  setTimeout(() => process.exit(process.exitCode || 0), 300);
})();
