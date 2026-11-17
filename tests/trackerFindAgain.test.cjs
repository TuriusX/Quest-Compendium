// Run: node tests/trackerFindAgain.test.cjs   (part of npm run test:sync)
// Markers v2 step 3 (electron/pointerTracker.js): why the markers ended ('screen' for a black or white screen, which
// still ends them; 'lost' when the view changed, which finds them again), and markers that are in the answer's list
// but weren't found on this screen (`skip`: never shown).
const assert = require('node:assert/strict');
const M = require('../electron/pointerTracker.js');
const T = M.createTracker ? M : globalThis.QCTracker;

const w = 96;
const h = 54;
// A textured scene (smooth blobs, so patches can be matched), and the same scene shifted by (dx, dy).
const scene = (seed, dx = 0, dy = 0) => {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x - dx, Y = y - dy;
    g[y * w + x] = 128 + 50 * Math.sin(X * 0.31 + seed) * Math.cos(Y * 0.27 + seed * 2) + 40 * Math.sin((X + Y) * 0.13 + seed * 3);
  }
  return g;
};
const flat = (v) => new Float32Array(w * h).fill(v);
// Somewhere else entirely: blotchy random texture (seeded), nothing like the first view.
const elsewhere = () => {
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const c = Array.from({ length: 12 * 7 }, () => 40 + 180 * rnd());
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = c[Math.floor(y / 8) * 12 + Math.floor(x / 8)] + 20 * rnd();
  return g;
};
const points = [{ x: 0.3, y: 0.4, label: 'Chest' }, { x: 0.7, y: 0.6, label: 'Lever' }];

// The same view: tracked, both shown; a black screen then ends them with 'screen'.
let t = T.createTracker({ ref: scene(1), w, h, points });
let r;
for (let i = 0; i < 5; i++) r = t.update(scene(1), 33);
assert.ok(r.every((m) => m.visible), 'both markers shown on the same view');
for (let i = 0; i < 3; i++) t.update(flat(2), 33);
assert.equal(t.gone, true);
assert.equal(t.goneWhy, 'screen', 'a black screen still ends the markers');

// A different view (the camera turned away): 'lost', so the page finds them again.
t = T.createTracker({ ref: scene(1), w, h, points });
for (let i = 0; i < 5; i++) t.update(scene(1), 33);
for (let i = 0; i < 8 && !t.gone; i++) t.update(elsewhere(), 33);
assert.equal(t.gone, true);
assert.equal(t.goneWhy, 'lost', 'a changed view is "lost", not the end');

// A marker in the list but not found on this screen: tracked along, never shown.
t = T.createTracker({ ref: scene(1), w, h, points: [points[0], { ...points[1], skip: true }] });
for (let i = 0; i < 5; i++) r = t.update(scene(1), 33);
assert.equal(r[0].visible, true);
assert.equal(r[1].visible, false, 'a skipped marker is never shown');
assert.equal(t.gone, false, 'a skipped marker never ends the others');

// Edge arrows (step 4): a marker the camera panned off screen is "off" (the page points at it from the edge); on a
// view that's lost it never is (no guessing).
t = T.createTracker({ ref: scene(1), w, h, points: [{ x: 0.9, y: 0.5, label: 'Chest' }, { x: 0.4, y: 0.5, label: 'Lever' }] });
for (let i = 0; i < 5; i++) r = t.update(scene(1), 33);
for (let dx = 2; dx <= 16; dx += 2) r = t.update(scene(1, dx, 0), 33);
assert.equal(t.gone, false, 'a pan is followed');
assert.equal(r[0].visible, false, 'the chest scrolled off the right edge');
assert.equal(r[0].off, true, 'and is pointed at from the edge');
assert.ok(r[0].x > 1, 'on the right: the scene moved right');
assert.equal(r[1].off, false, 'the lever is still on screen');
// A lost view: no arrows (a fresh tracker, as in the "lost" case above; these tiny test pictures can't stand in for
// a real pan followed by a scene change, which the 2D bench covers on real footage).
t = T.createTracker({ ref: scene(1), w, h, points: [{ x: 0.9, y: 0.5, label: 'Chest' }] });
for (let i = 0; i < 5; i++) t.update(scene(1), 33);
for (let i = 0; i < 8 && !t.gone; i++) r = t.update(elsewhere(), 33);
assert.equal(t.goneWhy, 'lost');
assert.ok(r.every((m) => !m.off), 'no arrows once the view is lost');

console.log('trackerFindAgain: all passed');
