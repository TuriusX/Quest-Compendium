// Run: npm run test:sync   (or: npx tsx tests/refind.test.ts)
// Markers v2 (locate.ts /api/refind): finding the marked things on the screen as it is now. The reply parsing, the
// outcomes kept for the Quality page, the people check on the fresh picture, refusals, and the rate limit.
import assert from "node:assert/strict";
import sharp from "sharp";
import { registerRefind, refindOutcomes, refindPrompt, parseRefindReply } from "../locate";
import { dailyCapOf, fitsCap, FIND_AGAIN_DAILY_DEFAULT, FIND_AGAIN_DOLLARS } from "../markerFindCap";

(async () => {
  // Outcomes: not seen now = off screen; seen but nobody there = no person.
  assert.deepEqual(refindOutcomes(3, [{ index: 0 }, { index: 2 }], new Set([2])), ["kept", "off screen", "no person"]);
  assert.deepEqual(refindOutcomes(2, [], new Set()), ["off screen", "off screen"]);

  // The reply: a different place marks nothing; the older bare list still works.
  assert.deepEqual(parseRefindReply('{"samePlace": false, "found": [{"i": 0, "y": 500, "x": 500}]}', 2), { found: [], samePlace: false });
  assert.deepEqual(parseRefindReply('{"samePlace": true, "found": [{"i": 1, "y": 250, "x": 500}]}', 2), { found: [{ index: 1, x: 0.5, y: 0.25 }], samePlace: true });
  assert.deepEqual(parseRefindReply('[{"i": 0, "y": 100, "x": 200}]', 2), { found: [{ index: 0, x: 0.2, y: 0.1 }], samePlace: null });
  assert.deepEqual(parseRefindReply("nonsense", 2), { found: [], samePlace: null });

  const prompt = refindPrompt([{ label: "Iron Chest", where: "left of the door", category: "key" }], "Elden Ring");
  assert.match(prompt, /0\. Iron Chest \(left of the door\) \[kind: key\]/);
  assert.match(prompt, /Elden Ring/);
  assert.match(prompt, /Leave out any that are no longer on screen/);

  // A fake server and AI: the first call finds items 0 and 2; the blind look says item 2 (an enemy) is nobody.
  const jpeg = "data:image/jpeg;base64," + (await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#335" } }).jpeg().toBuffer()).toString("base64");
  let handler: any = null;
  const app: any = { post: (_path: string, _auth: any, h: any) => (handler = h) };
  const calls: any[] = [];
  const replies = [
    JSON.stringify([{ i: 0, y: 250, x: 500 }, { i: 2, y: 900, x: 100 }, { i: 9, y: 1, x: 1 }]),
    JSON.stringify([{ i: 0, what: "an empty chair", character: false }]),
  ];
  const ai: any = { models: { generateContent: async (req: any) => (calls.push(req), { text: replies[calls.length - 1], usageMetadata: {} }) } };
  const checks: any[] = [];
  registerRefind(app, {
    requireAuth: () => {},
    getGeminiClient: () => ai,
    env: { LOCATE_PER_USER_HOURLY: "2" },
    onChecked: (game, checked, kept, details) => checks.push({ game, checked, kept, details }),
  });
  const call = async (body: any) => {
    let status = 200;
    let out: any;
    const res: any = { status: (s: number) => ((status = s), res), json: (j: any) => ((out = j), res) };
    await handler({ body, user: { uid: "u1" } }, res);
    return { status, out };
  };
  const items = [
    { crop: jpeg, label: "Iron Chest", where: "by the door", category: "key" },
    { crop: jpeg, label: "Lever", where: "", category: "action" },
    { crop: jpeg, label: "Knight", where: "on the bridge", category: "enemy" },
  ];

  const r1 = await call({ image: jpeg, items, game: "Elden Ring", appVersion: "0.8.0" });
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.out, { found: [{ index: 0, x: 0.5, y: 0.25 }], checked: 3 }, "the lever isn't on screen; nobody is where the knight was found");
  assert.equal(calls.length, 2, "one look plus the blind look at the knight");
  assert.equal(calls[0].contents[0].parts.filter((p: any) => p.inlineData).length, 4, "the screen now plus three close-ups");
  assert.equal(calls[1].contents[0].parts.filter((p: any) => p.inlineData).length, 1, "the blind look sees only the knight's spot");
  assert.deepEqual(checks[0].details.map((d: any) => `${d.label}: ${d.outcome}`), ["Lever: off screen", "Knight: no person"]);
  assert.equal(checks[0].kept, 1);

  // A marker with no close-up would shift the numbering: refused (the app falls back to the screenshot).
  const bad = await call({ image: jpeg, items: [items[0], { ...items[1], crop: "nope" }] });
  assert.equal(bad.status, 400);
  assert.equal((await call({ items })).status, 400, "no screen picture");

  // The hourly limit (2 here; the 400s above weren't counted).
  replies.push("[]");
  assert.equal((await call({ image: jpeg, items: [items[1]] })).status, 200);
  assert.equal((await call({ image: jpeg, items: [items[1]] })).status, 429);

  // Finding again (markers v2 step 3): paused once the daily cap is spent; the first placement never asks the cap.
  let capOk = true;
  let capAsked = 0;
  let h2: any = null;
  registerRefind({ post: (_p: string, _a: any, h: any) => (h2 = h) } as any, {
    requireAuth: () => {},
    getGeminiClient: () => ({ models: { generateContent: async () => ({ text: "[]", usageMetadata: {} }) } }) as any,
    findAgainAllowed: async () => (capAsked++, capOk),
  });
  const call2 = async (body: any) => {
    let status = 200;
    let out: any;
    const res: any = { status: (s: number) => ((status = s), res), json: (j: any) => ((out = j), res) };
    await h2({ body, user: { uid: "u2" } }, res);
    return { status, out };
  };
  assert.equal((await call2({ image: jpeg, items: [items[1]] })).status, 200);
  assert.equal(capAsked, 0, "the first placement isn't capped");
  assert.equal((await call2({ image: jpeg, items: [items[1]], again: true })).status, 200);
  capOk = false;
  const capped = await call2({ image: jpeg, items: [items[1]], again: true });
  assert.equal(capped.status, 429);
  assert.equal(capped.out.capped, true);
  assert.equal(capAsked, 2);

  // The cap's sums (markerFindCap.ts): $2 by default, a new day starts from zero, 0 turns finding again off.
  assert.equal(dailyCapOf({}), FIND_AGAIN_DAILY_DEFAULT);
  assert.equal(dailyCapOf({ findAgainDailyDollars: 0 }), 0);
  assert.equal(dailyCapOf({ findAgainDailyDollars: -1 }), FIND_AGAIN_DAILY_DEFAULT);
  assert.equal(fitsCap("2026-11-17", { day: "2026-11-17", dollars: 1.999 }, 2), false);
  assert.equal(fitsCap("2026-11-17", { day: "2026-11-17", dollars: 1.99 - FIND_AGAIN_DOLLARS }, 2), true);
  assert.equal(fitsCap("2026-11-18", { day: "2026-11-17", dollars: 5 }, 2), true, "a new day");
  assert.equal(fitsCap("2026-11-18", undefined, 0), false);

  console.log("refind: all passed");
  process.exit(0);
})();
