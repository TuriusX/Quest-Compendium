// Run: npx tsx tests/drawnAnswer.test.ts
// Drawn answers (owner, Nov 18 2026): the decision, the day's cap, the pixel check against the original and the AI
// check, with a fake model (no AI calls, no cost).
import assert from "node:assert/strict";
import sharp from "sharp";
import { compare, drawnFor, STROKES_MAX, ALTERED_MAX, type DrawnBudget, type DrawnStore } from "../drawnAnswer";

// A plain "screenshot": a grey-green gradient.
const W = 320, H = 180;
const raw = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; raw[i] = 60 + x / 8; raw[i + 1] = 80 + y / 6; raw[i + 2] = 60; }
const orig = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
// The same with a purple route line and a circle drawn on it.
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><polyline points="20,160 120,120 200,60 290,40" fill="none" stroke="#c040ff" stroke-width="6"/><circle cx="290" cy="40" r="14" fill="none" stroke="#c040ff" stroke-width="5"/></svg>`);
const drawn = await sharp(orig).composite([{ input: svg }]).png().toBuffer();
// The scene changed: a different background with the same line.
const swapped = await sharp({ create: { width: W, height: H, channels: 3, background: "#d8d0c0" } }).composite([{ input: svg }]).png().toBuffer();

{
  const c = await compare(orig, drawn);
  assert.ok(c.strokes > 0.01 && c.strokes < STROKES_MAX, `strokes ${c.strokes}`);
  assert.ok(c.altered < 0.02, `altered ${c.altered}`);
  const s = await compare(orig, swapped);
  assert.ok(s.strokes > STROKES_MAX || s.altered > ALTERED_MAX, `swapped: ${JSON.stringify(s)}`);
  // A different size back (the model sometimes returns another resolution): still lines up.
  const bigger = await sharp(drawn).resize(W * 2, H * 2).png().toBuffer();
  assert.ok((await compare(orig, bigger)).altered < 0.05);
}

// A fake model: replies by the call's label in the prompt.
type Reply = { decide?: any; image?: Buffer | null; check?: any };
function fakeAi(r: Reply) {
  const calls: string[] = [];
  return {
    calls,
    models: {
      async generateContent(req: any) {
        const text = req.contents[0].parts.map((p: any) => p.text || "").join(" ");
        const usage = { promptTokenCount: 1000, candidatesTokenCount: 100 };
        if (/flash-image/.test(req.model)) {
          calls.push("draw");
          return { usageMetadata: { promptTokenCount: 1300, candidatesTokenCount: 1290 }, candidates: [{ content: { parts: r.image ? [{ inlineData: { data: r.image.toString("base64") } }] : [] } }] };
        }
        if (/Would a DRAWN picture/.test(text)) { calls.push("decide"); return { usageMetadata: usage, text: JSON.stringify(r.decide) }; }
        calls.push("check");
        return { usageMetadata: usage, text: JSON.stringify(r.check) };
      },
    },
  };
}
function budget(limit: number) {
  let used = 0;
  const b: DrawnBudget & { used: () => number } = {
    async reserve(d) { if (used + d > limit) return false; used += d; return true; },
    async settle(reserved, spent) { used = used - reserved + spent; },
    used: () => used,
  };
  return b;
}
const shot = `data:image/jpeg;base64,${orig.toString("base64")}`;
const base = { game: "Red Dead Redemption 2", gameKey: "rdr2", question: "How do I get to Blackwater?", answer: "Take the road east from Manzanita Post to Blackwater.", wiki: {} };
const DRAW = { on: "screen", confidence: "high", isMap: true, place: "", draw: "a route from the player east along the road to Blackwater", why: "a map is open" };

// 1. Drawn on the screenshot, checks pass: shown, the cost settles against the day's cap, nothing saved.
{
  const ai = fakeAi({ decide: DRAW, image: drawn, check: { sameScene: true, clear: true, agrees: true, what: "the route to Blackwater" } });
  const b = budget(3);
  const saved: string[][] = [];
  const store: DrawnStore = { async get() { return null; }, async set(k) { saved.push(k); } };
  const r = await drawnFor(ai as any, { ...base, image: shot, budget: b, store });
  assert.equal(r.drawn?.on, "screen");
  assert.match(r.drawn!.url, /^data:image\/jpeg;base64,/);
  assert.equal(r.drawn!.alt, "the route to Blackwater");
  assert.deepEqual(ai.calls, ["decide", "draw", "check"]);
  assert.ok(b.used() > 0.07 && b.used() < 0.12, `settled ${b.used()}`);
  assert.equal(saved.length, 0, "a player's screen is never saved");
  // The picture keeps the original's shape.
  const m = await sharp(Buffer.from(r.drawn!.url.split(",")[1], "base64")).metadata();
  assert.equal(m.width, W); assert.equal(m.height, H);
}

// 2. Most answers: no drawing, no image call.
{
  const ai = fakeAi({ decide: { on: "none", confidence: "high", draw: "" } });
  const r = await drawnFor(ai as any, { ...base, image: shot, budget: budget(3) });
  assert.equal(r.drawn, null);
  assert.deepEqual(ai.calls, ["decide"]);
}

// 3. Not highly sure: none. "screen" without a screenshot: none.
{
  assert.equal((await drawnFor(fakeAi({ decide: { ...DRAW, confidence: "medium" } }) as any, { ...base, image: shot, budget: budget(3) })).drawn, null);
  const ai = fakeAi({ decide: DRAW, image: drawn });
  assert.equal((await drawnFor(ai as any, { ...base, budget: budget(3) })).decided, "none");
  assert.ok(!ai.calls.includes("draw"));
}

// 4. The scene was changed: thrown away before the AI check.
{
  const ai = fakeAi({ decide: DRAW, image: swapped, check: { sameScene: true, clear: true, agrees: true } });
  const r = await drawnFor(ai as any, { ...base, image: shot, budget: budget(3) });
  assert.equal(r.drawn, null);
  assert.equal(r.failed, "scene changed");
  assert.ok(!ai.calls.includes("check"));
}

// 5. The AI check says it's a tangle: nothing shown.
{
  const r = await drawnFor(fakeAi({ decide: DRAW, image: drawn, check: { sameScene: true, clear: false, agrees: true } }) as any, { ...base, image: shot, budget: budget(3) });
  assert.equal(r.drawn, null);
  assert.equal(r.failed, "check");
}

// 6. The day's money is used up: no image call.
{
  const ai = fakeAi({ decide: DRAW, image: drawn });
  const r = await drawnFor(ai as any, { ...base, image: shot, budget: budget(0.05) });
  assert.equal(r.failed, "cap");
  assert.ok(!ai.calls.includes("draw"));
}

// 7. An illustration: no picture to draw on, checked, saved for the next player; a repeat reuses it.
{
  const illus = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#334" } }).png().toBuffer();
  const ai = fakeAi({ decide: { on: "illustration", confidence: "high", draw: "three pillars: Snake, Snake, Whale", isMap: false }, image: illus, check: { sameScene: true, clear: true, agrees: true, what: "the pillars' order" } });
  const m = new Map<string, any>();
  const store: DrawnStore = { async get(keys) { return keys.map((k) => m.get(k)).find(Boolean) || null; }, async set(keys, d) { for (const k of keys) m.set(k, d); } };
  const q = { ...base, game: "Skyrim", gameKey: "skyrim", question: "What's the pillar order in Bleak Falls Barrow?", answer: "Snake, Snake, Whale." };
  const r = await drawnFor(ai as any, { ...q, budget: budget(3), store });
  assert.equal(r.drawn?.on, "illustration");
  assert.equal(m.size, 2);
  const ai2 = fakeAi({ decide: { on: "illustration", confidence: "high", draw: "three pillars: Snake, Snake, Whale" } });
  const r2 = await drawnFor(ai2 as any, { ...q, budget: budget(3), store });
  assert.equal(r2.cached, true);
  assert.deepEqual(ai2.calls, ["decide"]);
}

console.log("drawnAnswer: ok");

// 8. No screenshot and nothing to draw in the question: no look at all.
{
  const { mightDraw } = await import("../drawnAnswer");
  assert.equal(mightDraw("Is the Moonveil good for a strength build?"), false);
  assert.equal(mightDraw("Who is Ranni?"), false);
  assert.equal(mightDraw("How do I get to Blackwater?"), true);
  assert.equal(mightDraw("What's the pillar order in Bleak Falls Barrow?"), true);
  assert.equal(mightDraw("Where is the Golden Claw?"), true);
  assert.equal(mightDraw("¿Dónde está la Garra Dorada?"), true);
  const ai = fakeAi({ decide: DRAW });
  const r = await drawnFor(ai as any, { ...base, question: "Is the Moonveil good for a strength build?", budget: budget(3) });
  assert.equal(r.decided, "none");
  assert.deepEqual(ai.calls, []);
  assert.equal(r.cost, 0);
}
console.log("drawnAnswer: skip check ok");
