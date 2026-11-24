// Run: npx tsx tests/openaiRouting.test.ts
// The guide pipeline's OpenAI calls (scripts/guides/common.ts): which errors hand over to Gemini. (Players' questions
// no longer go to OpenAI at all: removed Nov 24 2026.)
import assert from "node:assert/strict";
import { openaiUnavailable } from "../openaiAnswer";

// Overloaded, rate-limited, server or network trouble: Gemini answers. A bad request isn't retried there.
assert.ok(openaiUnavailable({ status: 503 }));
assert.ok(openaiUnavailable({ status: 429 }));
assert.ok(openaiUnavailable({ message: "fetch failed" }));
assert.ok(!openaiUnavailable({ status: 400 }));

console.log("openaiRouting: ok");
