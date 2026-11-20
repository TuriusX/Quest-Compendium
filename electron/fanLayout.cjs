/**
 * The quick menu as a fan from the orb (owner, Nov 19 2026: "the radial wheel flares out from the orb in whatever
 * corner of the screen it is on inward ... it would look much better than in the middle of the screen blocking what
 * you are doing"). Pure maths, shared by wheel.html (a plain script: window.qcFan), wheel.cjs and the tests
 * (tests/fanLayout.test.cjs).
 *
 * With the orb on, the quick menu opens as a quarter circle with the orb at its hub, flaring toward the screen's centre
 * from the orb's corner (Settings → Pop-up answers → corner). The first 5 items (the most used, in the menu's order) sit
 * on the inner ring; the rest on a second, outer ring. Nothing is dropped.
 *
 * Coordinates are screen pixels relative to the hub (y down). Along a ring, t runs from 0 (along the screen's top or
 * bottom edge) to 1 (along its side), a little in from both edges.
 *
 * The hard rule (owner, Nov 19 2026: "I just don't want to click those shortcuts and it start asking questions to the
 * app again like it was before"): opening the menu never does anything by itself; only an explicit pick does.
 * releasePicks() is the one place a let-go of the shortcut may pick, and only what's pointed at right then.
 */
(function (root) {
  'use strict';
  const SPAN = Math.PI / 2;
  const EDGE = 0.05; // of the span, kept clear at each screen edge
  const INNER = 5; // items on the inner ring (owner, Nov 19 2026: about 5, the most used)
  const TOL = 0.35; // pointing this far (of the span) past either end still points at that end's item
  const AIM_DEAD = 36; // px the mouse moves (from where it was) before it points
  const STICK_DEAD = 0.5;

  const cornerOf = (c) => (['tr', 'tl', 'br', 'bl'].includes(c) ? c : 'tr');
  /** Toward the screen's centre from a corner: hx horizontally (-1 left), vy vertically (-1 up). */
  function dirs(corner) {
    const c = cornerOf(corner);
    return { hx: c === 'tr' || c === 'br' ? -1 : 1, vy: c === 'bl' || c === 'br' ? -1 : 1 };
  }
  /** How many items go on each ring: the first 5 inside, the rest outside. */
  function split(n) {
    const k = Math.max(0, Math.min(Math.floor(n) || 0, INNER));
    return { inner: k, outer: Math.max(0, (Math.floor(n) || 0) - k) };
  }
  const ts = (n) => (n <= 1 ? [0.5] : Array.from({ length: n }, (_, i) => EDGE + ((1 - 2 * EDGE) * i) / (n - 1)));
  /** A ring's radius: at least minR, and wide enough that its items (size + gap apart) don't touch. */
  function radius(n, size, gap, minR) {
    if (n <= 1) return minR;
    const step = (SPAN * (1 - 2 * EDGE)) / (n - 1);
    return Math.max(minR, (size + gap) / (2 * Math.sin(step / 2)));
  }

  /**
   * The fan for n items from a corner, at a card size's scale (Small 0.85 / Medium 1 / Large 1.3): each item's centre
   * and size, the rings' radii, how far it reaches, and where the caption (the pointed item's name) goes.
   */
  function layout(n, corner, scale) {
    const s = Number(scale) > 0 ? Number(scale) : 1;
    const d = dirs(corner);
    const { inner, outer } = split(n);
    const size1 = Math.round(54 * s), size2 = Math.round(46 * s);
    const r1 = Math.round(radius(inner, size1, 8 * s, 112 * s));
    const r2 = outer ? Math.round(radius(outer, size2, 8 * s, r1 + (size1 + size2) / 2 + 16 * s)) : 0;
    const items = [];
    const put = (t, R, ring, i, size) => {
      const a = t * SPAN;
      items.push({ i, ring, t, x: Math.round(d.hx * Math.cos(a) * R), y: Math.round(d.vy * Math.sin(a) * R), size });
    };
    ts(inner).forEach((t, i) => put(t, r1, 0, i, size1));
    if (outer) ts(outer).forEach((t, j) => put(t, r2, 1, inner + j, size2));
    const reach = Math.round(outer ? r2 + size2 / 2 : r1 + size1 / 2);
    // The caption sits on the fan's middle line, just past its edge, growing away from the hub.
    const c = (reach + 30 * s) * Math.SQRT1_2;
    const caption = { x: Math.round(d.hx * c), y: Math.round(d.vy * c), w: Math.round(270 * s), h: Math.round(74 * s) };
    return { corner: cornerOf(corner), scale: s, hx: d.hx, vy: d.vy, inner, outer, r1, r2, reach, items, caption };
  }

  /** Where along the fan a direction points (t; below 0 or above 1 outside it), and how far (px or stick units). */
  function along(dx, dy, L) {
    const u = dx * L.hx, v = dy * L.vy; // in the fan's own frame: u toward the centre horizontally, v vertically
    return { t: Math.atan2(v, u) / SPAN, dist: Math.hypot(dx, dy) };
  }
  function nearest(L, ring, t) {
    let best = null, bd = Infinity;
    for (const it of L.items) {
      if (it.ring !== ring) continue;
      const dd = Math.abs(it.t - t);
      if (dd < bd) { bd = dd; best = it.i; }
    }
    return best;
  }
  /** Pointing back toward the corner (away from the fan) points at nothing. */
  const inSpan = (t) => t >= -TOL && t <= 1 + TOL;

  /**
   * The mouse, as an offset (dx, dy) from where it was when the shortcut opened the menu (or from the hub): the item
   * it points at, or null (not far enough, or away from the fan). Past the middle of the two rings it's the outer one.
   */
  function aimAt(dx, dy, L) {
    const { t, dist } = along(dx, dy, L);
    if (dist < AIM_DEAD || !inSpan(t) || !L.items.length) return null;
    const ring = L.outer && dist >= (L.r1 + L.r2) / 2 ? 1 : 0;
    return nearest(L, L.inner ? ring : 1, t);
  }
  /**
   * A stick (x right, y up, -1..1) on a ring (0 inner, 1 outer; the shoulder buttons switch): the item it points at,
   * or null (let go, or pointing away from the fan).
   */
  function stickAt(x, y, L, ring) {
    const { t, dist } = along(x, -y, L);
    if (dist < STICK_DEAD || !inSpan(t) || !L.items.length) return null;
    const r = ring === 1 && L.outer ? 1 : 0;
    return nearest(L, L.inner ? r : 1, t);
  }
  /** The same direction on the other ring (the shoulder buttons): the nearest item there, or null with one ring. */
  function otherRing(L, i) {
    const it = L.items[i];
    if (!it || !L.outer) return null;
    return nearest(L, it.ring ? 0 : 1, it.t);
  }

  /** Whether the mouse (dx, dy from the hub) is over the fan: its quarter out to its edge (with a margin), or the hub. */
  function inFan(dx, dy, L, margin) {
    const m = margin === undefined ? 24 * L.scale : margin;
    const { t, dist } = along(dx, dy, L);
    if (dist <= 64 * L.scale) return true;
    return dist <= L.reach + m && t >= -0.12 && t <= 1.12;
  }

  /**
   * Letting go of the shortcut's keys (hold, point, let go): it picks only when the mouse pointed at an item when the
   * keys came up, after a real hold (a quick tap leaves the menu open), outside the questions list and listening.
   * Nothing pointed at: nothing happens (owner, Nov 19 2026: opening never asks anything by itself).
   */
  function releasePicks(s) {
    return !!(s && s.aimed && Number.isInteger(s.sel) && s.sel >= 0 && !s.inList && !s.listening && s.heldMs >= (s.tapMs || 250));
  }

  /**
   * The fan's window: around the hub (a screen point), big enough for the fan, its caption and the quick questions
   * list, kept on the screen's work area. Returns its bounds and the hub inside it.
   */
  function windowFor(hub, L, area) {
    const s = L.scale;
    const back = Math.round(64 * s); // room behind the hub, toward the corner (the hub's glow)
    let U = 0, V = 0;
    for (const it of L.items) { U = Math.max(U, Math.abs(it.x) + it.size / 2); V = Math.max(V, Math.abs(it.y) + it.size / 2); }
    U = Math.max(U, Math.abs(L.caption.x) + L.caption.w, Math.round(460 * s));
    V = Math.max(V, Math.abs(L.caption.y) + L.caption.h, Math.round(600 * s));
    const width = Math.round(back + U + 16), height = Math.round(back + V + 16);
    let x = Math.round(L.hx < 0 ? hub.x + back - width : hub.x - back);
    let y = Math.round(L.vy < 0 ? hub.y + back - height : hub.y - back);
    if (area) {
      x = Math.max(area.x, Math.min(x, area.x + area.width - width));
      y = Math.max(area.y, Math.min(y, area.y + area.height - height));
    }
    return { x, y, width, height, hub: { x: Math.round(hub.x - x), y: Math.round(hub.y - y) } };
  }

  const api = { split, layout, aimAt, stickAt, otherRing, inFan, releasePicks, windowFor, INNER, AIM_DEAD };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.qcFan = api;
})(typeof window !== 'undefined' ? window : globalThis);
