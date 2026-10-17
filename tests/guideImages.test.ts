// Run: npm run test:sync   (or: npx tsx tests/guideImages.test.ts)
import assert from "node:assert/strict";
import sharp from "sharp";
import { cleanCrop, makeSizes, searchTargets, defaultPlacement, SOURCE_RANK, type ImageTarget } from "../guideImages";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}

const T = (kind: ImageTarget["kind"], name: string, label: string, area?: string, id?: string): ImageTarget => ({ kind, slug: "fyke-isle", name, label, ...(area ? { area } : {}), ...(id ? { id } : {}) });
const list: ImageTarget[] = [
  T("area", "Fyke Isle", "Area"),
  T("step", "Unlock the Secret Staircase", "Step 4", "Fyke Isle", "w4"),
  T("entry", "Pulling a wall lever near the bed", "Secret", "Fyke Isle", "s1"),
  T("entity", "Keira Metz", "Character"),
  T("entry", "Annabelle's Bones", "Item", "Fyke Isle", "i1"),
];

await test("crop: kept inside the picture", () => assert.deepEqual(cleanCrop({ x: -10, y: 20, w: 5000, h: 300 }, 1920, 1080), { left: 0, top: 20, width: 1920, height: 300 }));
await test("crop: the whole picture is no crop", () => assert.equal(cleanCrop({ x: 0, y: 0, w: 1920, h: 1080 }, 1920, 1080), null));
await test("crop: a sliver is no crop", () => assert.equal(cleanCrop({ x: 10, y: 10, w: 8, h: 400 }, 1920, 1080), null));
await test("sizes: cropped once, scaled down, never up", async () => {
  const png = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 40, g: 60, b: 90 } } }).png().toBuffer();
  const { files, width, height } = await makeSizes(png, { left: 100, top: 100, width: 800, height: 600 });
  assert.equal(width, 800); assert.equal(height, 600);
  assert.equal((await sharp(files["w1280.webp"]).metadata()).width, 800);
  assert.equal((await sharp(files["w300.avif"]).metadata()).width, 300);
  assert.equal((await sharp(files["thumb.webp"]).metadata()).width, 160);
});
await test("search: a name that starts with it comes first", () => assert.equal(searchTargets(list, "keira")[0].name, "Keira Metz"));
await test("search: words can match the area", () => assert.ok(searchTargets(list, "fyke lever").some((t) => t.id === "s1")));
await test("search: apostrophes don't matter", () => assert.equal(searchTargets(list, "annabelles")[0].id, "i1"));
await test("search: empty shows pages only", () => assert.deepEqual(searchTargets(list, "").map((t) => t.kind), ["area", "entity"]));
await test("placement: a page picture shows on its page, not on a step", () => assert.deepEqual(defaultPlacement("area"), { page: true, answer: true, step: false }));
await test("placement: a step's picture has no page of its own, and quest log/step starts off", () => assert.deepEqual(defaultPlacement("step"), { page: false, answer: true, step: false }));
await test("rank: the owner's capture wins", () => assert.ok(SOURCE_RANK.mine < SOURCE_RANK.press && SOURCE_RANK.press < SOURCE_RANK.igdb && SOURCE_RANK.wiki < SOURCE_RANK.steam));

console.log(`\n${passed} passed`);
