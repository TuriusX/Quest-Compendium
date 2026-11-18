/**
 * Pointing at the quick menu over the game (wheel.html) with either stick or the d-pad, all the same way (owner,
 * Nov 17 2026). The same rules as createRingPointer in src/utils/padStops.ts (the ring inside the panel);
 * tests/ringPoint.test.ts runs both on the same cases. Loaded by wheel.html as a plain script (window.qcRingPoint) and
 * by node tests (module.exports).
 */
(function (root) {
  'use strict';
  function ringIndex(x, y, n, deadzone) {
    if (n <= 0 || Math.hypot(x, y) < (deadzone === undefined ? 0.5 : deadzone)) return null;
    const deg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360; // 0 at the top, clockwise
    return Math.round(deg / (360 / n)) % n;
  }
  function createRingPointer(comboMs) {
    const ms = comboMs || 150;
    const sticks = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
    const at = { up: -Infinity, down: -Infinity, left: -Infinity, right: -Infinity };
    let last = '';
    return {
      reset() {
        last = '';
        sticks.left = { x: 0, y: 0 };
        sticks.right = { x: 0, y: 0 };
      },
      stick(which, x, y, n) {
        sticks[which === 'left' ? 'left' : 'right'] = { x, y };
        const l = sticks.left, r = sticks.right;
        const s = Math.hypot(l.x, l.y) >= Math.hypot(r.x, r.y) ? l : r;
        last = '';
        return ringIndex(s.x, s.y, n);
      },
      dpad(dir, t, n, current) {
        if (n <= 0) return current;
        at[dir] = t;
        const on = (d) => t - at[d] < ms;
        const x = dir === 'right' ? 1 : dir === 'left' ? -1 : on('right') && !on('left') ? 1 : on('left') && !on('right') ? -1 : 0;
        const y = dir === 'up' ? 1 : dir === 'down' ? -1 : on('up') && !on('down') ? 1 : on('down') && !on('up') ? -1 : 0;
        const key = `${x},${y}`;
        const p = (((Math.atan2(x, y) * 180) / Math.PI + 360) % 360) / (360 / n);
        const idx = Math.round(p) % n;
        const other = (p >= Math.round(p) ? idx + 1 : idx + n - 1) % n;
        const again = key === last;
        last = key;
        if (n > 8 && again && current === idx) return other;
        if (n > 8 && again && current === other) return idx;
        return idx;
      },
    };
  }
  const api = { ringIndex, createRingPointer };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.qcRingPoint = api;
})(typeof window !== 'undefined' ? window : globalThis);
