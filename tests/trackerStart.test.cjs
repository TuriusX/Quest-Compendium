// Run: node tests/trackerStart.test.cjs
// The marker tracker's start: it keeps trying to match the answer's screenshot for a moment (a passing menu or effect
// doesn't end the markers), and reports `unplaced` when the scene really changed.
const assert = require('node:assert/strict');
const loaded = require('../electron/pointerTracker.js');
const T = loaded && loaded.createTracker ? loaded : globalThis.QCTracker;

const W = 384, H = 216;
// A textured "scene": smooth random blobs, so patches are distinctive.
function scene(seed, shiftX = 0) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const blobs = Array.from({ length: 140 }, () => ({ x: rnd() * (W + 80) - 40, y: rnd() * H, r: 4 + rnd() * 14, v: 40 + rnd() * 180 }));
  const g = new Float32Array(W * H).fill(110);
  for (const b of blobs) {
    for (let y = Math.max(0, Math.floor(b.y - b.r)); y < Math.min(H, b.y + b.r); y++)
      for (let x = Math.max(0, Math.floor(b.x - b.r + shiftX)); x < Math.min(W, b.x + b.r + shiftX); x++)
        if ((x - shiftX - b.x) ** 2 + (y - b.y) ** 2 < b.r * b.r) g[y * W + x] = b.v;
  }
  return g;
}
const points = [{ x: 0.3, y: 0.4, label: 'A' }, { x: 0.7, y: 0.6, label: 'B' }];

// Same scene: placed on the first frame.
{
  const tr = T.createTracker({ ref: scene(1), w: W, h: H, points });
  const r = tr.update(scene(1), 0);
  assert.equal(tr.gone, false);
  assert.equal(tr.unplaced, false);
  assert.ok(r.some((m) => m.visible));
}

// A few unrelated frames first (a menu closing), then the scene: still placed.
{
  const tr = T.createTracker({ ref: scene(1), w: W, h: H, points });
  for (let i = 0; i < 5; i++) {
    const r = tr.update(scene(99 + i), 0);
    assert.equal(tr.gone, false, 'keeps trying');
    assert.ok(r.every((m) => !m.visible), 'nothing shown while trying');
  }
  tr.update(scene(1, 6), 0); // the camera moved a little meanwhile
  assert.equal(tr.gone, false);
  assert.equal(tr.unplaced, false);
}

// A different scene for good: gives up after the tries, and says the markers couldn't be placed.
{
  const tr = T.createTracker({ ref: scene(1), w: W, h: H, points });
  let frames = 0;
  while (!tr.gone && frames < 100) tr.update(scene(500 + frames++), 0);
  assert.equal(tr.gone, true);
  assert.equal(tr.unplaced, true);
  assert.ok(frames >= 20 && frames <= 30, `gave up after ${frames} frames`);
}

console.log('trackerStart: all passed');
