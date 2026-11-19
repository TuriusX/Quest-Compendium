// Run: npx tsx tests/openaiRouting.test.ts
// OpenAI answers (Nov 19 2026): which questions go to OpenAI (config/chatRouting), and which errors hand over to Gemini.
import assert from "node:assert/strict";
import { normalizeRouting, openaiModelFor } from "../chatRouting";
import { openaiUnavailable } from "../openaiAnswer";

// Off by default: Gemini as before.
let r = normalizeRouting({});
assert.equal(openaiModelFor(r, { pro: true, uid: "u1" }), "");
assert.equal(openaiModelFor(r, { pro: false, uid: "u1" }), "");

// Only gpt-… model names are taken.
r = normalizeRouting({ openaiPro: "gpt-6.2-sol", openaiFast: "rm -rf", openaiShare: 100 });
assert.equal(r.openaiFast, "");
assert.equal(openaiModelFor(r, { pro: true, uid: "u1" }), "gpt-6.2-sol");
assert.equal(openaiModelFor(r, { pro: false, uid: "u1" }), "");

// The owner's test: listed accounts only.
r = normalizeRouting({ openaiPro: "gpt-6.2-sol", openaiFast: "gpt-6-luna", openaiShare: 0, openaiUids: ["owner"] });
assert.equal(openaiModelFor(r, { pro: false, uid: "owner" }), "gpt-6-luna");
assert.equal(openaiModelFor(r, { pro: false, uid: "someone" }), "");
assert.equal(openaiModelFor(r, { pro: true, uid: "" }), "");

// A share: the same player always gets the same answer; roughly the share of players.
r = normalizeRouting({ openaiPro: "gpt-6.2-sol", openaiFast: "gpt-6-luna", openaiShare: 25 });
const ids = Array.from({ length: 4000 }, (_, i) => `player${i}`);
const on = ids.filter((id) => openaiModelFor(r, { pro: true, uid: id })).length;
assert.ok(on > 800 && on < 1200, String(on));
assert.equal(openaiModelFor(r, { pro: true, uid: "player7" }), openaiModelFor(r, { pro: true, uid: "player7" }));
assert.equal(normalizeRouting({ openaiShare: 250 }).openaiShare, 100);

// Overloaded, rate-limited, server or network trouble: Gemini answers. A bad request isn't retried there.
assert.ok(openaiUnavailable({ status: 503 }));
assert.ok(openaiUnavailable({ status: 429 }));
assert.ok(openaiUnavailable({ message: "fetch failed" }));
assert.ok(!openaiUnavailable({ status: 400 }));

console.log("openaiRouting: ok");
