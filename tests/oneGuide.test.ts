// Run: npm run test:sync   (or: npx tsx tests/oneGuide.test.ts)
import assert from "node:assert/strict";
import { guideTarget, absolutize } from "../src/utils/guideSite";
import { answerPicture, stepPicture, withPictures, type GuidePicture } from "../src/utils/guidePictures";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const BASE = "https://questcompendium.com/guides/the-witcher-3/fyke-isle/";

test("guide links open in the app: the front page, a page, an entry, any language", () => {
  assert.deepEqual(guideTarget("/guides/the-witcher-3/", BASE), { key: "the-witcher-3" });
  assert.deepEqual(guideTarget("../keira-metz/", BASE), { key: "the-witcher-3", slug: "keira-metz" });
  assert.deepEqual(guideTarget("#e-sword", BASE), { key: "the-witcher-3", slug: "fyke-isle", anchor: "e-sword" });
  assert.deepEqual(guideTarget("/de/guides/the-witcher-3/achievements/", BASE), { key: "the-witcher-3", slug: "achievements" });
});

test("other pages and other sites open in the browser; odd schemes do nothing", () => {
  assert.deepEqual(guideTarget("/pricing/", BASE), { external: "https://questcompendium.com/pricing/" });
  assert.deepEqual(guideTarget("https://example.com/x", BASE), { external: "https://example.com/x" });
  assert.equal(guideTarget("javascript:alert(1)", BASE), null);
});

test("root-relative addresses point at the website; full ones are left alone", () => {
  const html = '<img src="/img/g/a/w300.webp" srcset="/img/g/a/w300.webp 300w, /img/g/a/w600.webp 600w"><a href="//x.com/">x</a><a href="https://y.com/">y</a>';
  assert.equal(absolutize(html), '<img src="https://questcompendium.com/img/g/a/w300.webp" srcset="https://questcompendium.com/img/g/a/w300.webp 300w, https://questcompendium.com/img/g/a/w600.webp 600w"><a href="//x.com/">x</a><a href="https://y.com/">y</a>');
});

const pic = (p: Partial<GuidePicture>): GuidePicture => ({ kind: "area", slug: "fyke-isle", page: true, step: false, answer: false, thumb: "t", w300: "w", w600: "w6", big: "b", alt: "a", caption: "", ...p });

test("answers: the entry's own picture, else its page's, only with App answer on", () => {
  const pics = [pic({ answer: true, big: "page" }), pic({ kind: "entry", id: "sword", answer: true, big: "sword" }), pic({ kind: "entry", id: "key", answer: false, big: "key" })];
  assert.equal(answerPicture(pics, "fyke-isle", "sword")?.big, "sword");
  assert.equal(answerPicture(pics, "fyke-isle", "key")?.big, "page");
  assert.equal(answerPicture([pic({ answer: false })], "fyke-isle"), null);
});

test("quest log: only the target's own picture with Quest log / step on, never the page's", () => {
  const pics = [pic({ step: true, big: "page" }), pic({ kind: "entry", id: "lever", step: true, thumb: "lever-t", alt: "The lever" }), pic({ kind: "step", id: "s2", step: true, thumb: "s2-t" }), pic({ kind: "entry", id: "off", step: false })];
  assert.equal(stepPicture(pics, "fyke-isle", "off", "entry"), null);
  const payload: any = { data: { sections: [{ id: "collect", items: [{ id: "g:fyke-isle:lever+chest", label: "Lever" }, { id: "w:fyke-isle:s2", label: "Step 2" }, { id: "g:fyke-isle:other", label: "Other" }, { id: "a:0", label: "From an answer" }] }] } };
  const out: any = withPictures(payload, pics);
  assert.deepEqual(out.data.sections[0].items.map((o: any) => o.pic || ""), ["lever-t", "s2-t", "", ""]);
  assert.equal(out.data.sections[0].items[0].picAlt, "The lever");
  assert.equal(withPictures(payload, [pic({ step: false })]), payload);
});

console.log(`\n${passed} passed`);
