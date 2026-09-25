// Replay the sticky-marker tracker on real gameplay footage and score it against the true camera movement.
// Usage (after running prepare.py on a recording): node tests/markers/replay.cjs electron/pointerTracker.js [startFrame] [frames]
// Prints marker error in screen pixels, how often markers were hidden while on screen, and whether tracking gave up.
const fs = require('fs');
const loaded = require(require('path').resolve(process.argv[2] || 'electron/pointerTracker.js'));
// The tracker registers itself on globalThis when loaded as an ES module (this project's .js files are ES modules).
const T = loaded && loaded.createTracker ? loaded : globalThis.QCTracker;
const W = 384, H = 216, FRAME = W * H;
const DIR = process.env.MARKER_FOOTAGE || 'tests/markers/footage';
const bin = fs.readFileSync(`${DIR}/frames384.bin`);
const N = Math.floor(bin.length / FRAME);
const ref = JSON.parse(fs.readFileSync(`${DIR}/true_shifts.json`));
const frameAt = (k) => { const f = new Float32Array(FRAME); for (let i = 0, o = k * FRAME; i < FRAME; i++) f[i] = bin[o + i]; return f; };
const start = Number(process.argv[3] || 0), len = Number(process.argv[4] || 600);
// markers on textured spots of the start frame
const pts = [{ x: 0.41, y: 0.69, label: 'A' }, { x: 0.66, y: 0.35, label: 'B' }, { x: 0.2, y: 0.45, label: 'C' }];
const tr = T.createTracker({ ref: frameAt(start), w: W, h: H, points: pts });
let truthX = pts.map((p) => p.x), truthY = pts.map((p) => p.y);
let camErr = [], markErr = [], hiddenOn = 0, onTot = 0, goneAt = null, t0 = Date.now();
for (let k = start + 1; k < Math.min(N, start + len); k++) {
  truthX = truthX.map((x) => x + ref[k][0]); truthY = truthY.map((y) => y + ref[k][1]);
  const res = tr.update(frameAt(k));
  if (tr.gone && goneAt === null) goneAt = ((k - start) / 30).toFixed(1) + 's';
  res.forEach((r, i) => {
    const inView = truthX[i] > 0.03 && truthX[i] < 0.97 && truthY[i] > 0.03 && truthY[i] < 0.97;
    if (!inView) return; onTot++;
    if (!r.visible) { hiddenOn++; return; }
    markErr.push(Math.hypot((r.x - truthX[i]) * 2560, (r.y - truthY[i]) * 1440));
  });
}
markErr.sort((a, b) => a - b);
const q = (p) => markErr.length ? markErr[Math.floor(p * (markErr.length - 1))].toFixed(0) : '-';
console.log(`start ${start / 30}s, ${len / 30}s: marker error median ${q(0.5)}px, 90th ${q(0.9)}px, worst ${q(1)}px (on your 2560 screen) | hidden while on screen ${(100 * hiddenOn / Math.max(1, onTot)).toFixed(0)}% | gave up: ${goneAt ?? 'no'} | ${((Date.now() - t0) / len).toFixed(1)} ms/frame`);
