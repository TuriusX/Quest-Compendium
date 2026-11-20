// Voice from the quick menu ends by itself (src/utils/voiceEnd.ts): run with npx tsx tests/voiceEnd.test.ts
import assert from 'node:assert/strict';
import { voiceEnd, rmsOf } from '../src/utils/voiceEnd';

/** Feeds levels every 50 ms (a function of time) until it says something other than 'listen'. */
function run(level: (t: number) => number, opts = {}) {
  const step = voiceEnd(opts);
  for (let t = 0; t <= 60000; t += 50) {
    const s = step(level(t), t);
    if (s !== 'listen') return { s, t };
  }
  return { s: 'listen', t: -1 };
}

// Quiet room, talks from 0.5 s to 2.5 s, then quiet: ends ~1.3 s after the last word.
let r = run((t) => (t >= 500 && t < 2500 ? 0.1 : 0.003));
assert.equal(r.s, 'end');
assert.ok(r.t >= 3700 && r.t <= 3900, `ended at ${r.t}`);

// Short pauses between words don't end it.
r = run((t) => (t >= 500 && t < 5000 && Math.floor(t / 700) % 2 === 0 ? 0.1 : 0.003));
assert.equal(r.s, 'end');
assert.ok(r.t > 5000, `ended mid-sentence at ${r.t}`);

// Nothing said: stops without sending after 8 s.
r = run(() => 0.004);
assert.deepEqual(r, { s: 'nothing', t: 8000 });

// A click (100 ms) isn't talking.
r = run((t) => (t >= 1000 && t < 1100 ? 0.3 : 0.003));
assert.equal(r.s, 'nothing');

// A noisy room (game sound at 0.03): the voice has to stand out; the noise alone is nothing.
r = run(() => 0.03);
assert.equal(r.s, 'nothing');
r = run((t) => (t >= 600 && t < 2000 ? 0.15 : 0.03));
assert.equal(r.s, 'end');

// Talking right from the start (the threshold is capped, so it still counts).
r = run((t) => (t < 3000 ? 0.12 : 0.003));
assert.equal(r.s, 'end');

// Talking non-stop: sent at the longest a question may be.
r = run(() => 0.2, { calibrateMs: 0 });
assert.equal(r.s, 'end');
assert.equal(r.t, 45000);

assert.equal(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
assert.equal(rmsOf(new Float32Array([])), 0);
console.log('voiceEnd: all passed');
