/**
 * The quick menu as a fan from the orb (owner, Nov 19 2026: "the radial wheel flares out from the orb in whatever
 * corner of the screen it is on inward ... it would look much better than in the middle of the screen blocking what
 * you are doing"). Pure maths, shared by wheel.html (a plain script: window.qcFan), wheel.cjs and the tests
 * (tests/fanLayout.test.cjs).
 *
 * With the orb on, the quick menu opens as a quarter circle with the orb at its hub, flaring toward the screen's centre
 * from the orb's corner (Settings → Pop-up answers → corner). The first 5 items (the most used, in the menu's order) sit
 * on the inner ring; the rest on a second, outer ring. Nothing is dropped.
 *   Kept small (owner, Nov 19 2026, after the first screenshots: "not reaching so far"): 44 px items on the inner ring
 * (Medium), reaching ~165 px from the orb. The outer ring (38 px items) is hidden until asked for: RB on a controller
 * (LB back; a deliberate bumper rather than a full stick push, which would misfire when pushing hard toward an inner
 * item), the small More button between the orb and the inner ring, Tab or stepping past the inner ring's last item
 * with the arrow keys / d-pad, or pointing past the inner ring while holding the shortcut. Opening the outer ring is
 * not an action.
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
   * and size, the rings' radii, how far it reaches (inner ring only, and with the outer ring open), the More button,
   * and where the caption (the pointed item's name) goes either way.
   */
  function layout(n, corner, scale) {
    const s = Number(scale) > 0 ? Number(scale) : 1;
    const d = dirs(corner);
    const { inner, outer } = split(n);
    const size1 = Math.round(44 * s), size2 = Math.round(38 * s);
    const r1 = Math.round(radius(inner, size1, 6 * s, 92 * s));
    const r2 = outer ? Math.round(radius(outer, size2, 6 * s, r1 + (size1 + size2) / 2 + 12 * s)) : 0;
    const items = [];
    const at = (t, R) => ({ x: Math.round(d.hx * Math.cos(t * SPAN) * R), y: Math.round(d.vy * Math.sin(t * SPAN) * R) });
    ts(inner).forEach((t, i) => items.push({ i, ring: 0, t, ...at(t, r1), size: size1 }));
    if (outer) ts(outer).forEach((t, j) => items.push({ i: inner + j, ring: 1, t, ...at(t, r2), size: size2 }));
    const reachInner = Math.round(r1 + size1 / 2);
    const reachAll = Math.round(outer ? r2 + size2 / 2 : reachInner);
    // The caption sits on the fan's middle line, just past its edge, growing away from the hub: then no item (all
    // within the reach) can be under it.
    const cap = (reach) => {
      const c = (reach + 24 * s) * Math.SQRT1_2;
      return { x: Math.round(d.hx * c), y: Math.round(d.vy * c), w: Math.round(250 * s), h: Math.round(70 * s) };
    };
    // More: a small button on the middle line between the orb and the inner ring (only with an outer ring).
    const more = outer ? { ...at(0.5, Math.round((24 * s + r1 - size1 / 2) / 2)), size: Math.round(28 * s) } : null;
    return {
      corner: cornerOf(corner), scale: s, hx: d.hx, vy: d.vy, inner, outer, r1, r2, reachInner, reachAll, items, more,
      caption: { inner: cap(reachInner), all: cap(reachAll) },
    };
  }
  /** The items on screen: the inner ring, and the outer one while it's open. */
  const visible = (L, outerOpen) => L.items.filter((it) => it.ring === 0 || (outerOpen && L.outer));

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
   * it points at, or null (not far enough, or away from the fan). Past the inner ring it's the outer one (the page
   * opens it: pointing past the inner ring asks for it).
   */
  function aimAt(dx, dy, L) {
    const { t, dist } = along(dx, dy, L);
    if (dist < AIM_DEAD || !inSpan(t) || !L.items.length) return null;
    const ring = L.outer && dist >= L.reachInner + 8 * L.scale ? 1 : 0;
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
  /** The same direction on the other ring: the nearest item there, or null with one ring. */
  function otherRing(L, i) {
    const it = L.items[i];
    if (!it || !L.outer) return null;
    return nearest(L, it.ring ? 0 : 1, it.t);
  }

  // ---- The outer ring, asked for (none of these picks anything) ---------------------------------------------------
  // Each takes and returns { sel, open } (sel: the pointed item, -1 for none; open: the outer ring is showing) and
  // returns ring: the ring the sticks point on.
  const ringOf = (L, s) => (s.open && L.items[s.sel] ? L.items[s.sel].ring : 0);
  /** RB (or 'lb'): the outer ring opens (or closes), the pointed item moving to the nearest one on it. */
  function bumper(L, s, button) {
    if (!L.outer) return { sel: s.sel, open: false, ring: 0 };
    const toOuter = button === 'rb';
    let sel = s.sel;
    const it = L.items[sel];
    if (it && it.ring !== (toOuter ? 1 : 0)) sel = otherRing(L, sel);
    return { sel, open: toOuter, ring: toOuter ? 1 : 0 };
  }
  /** More (the mouse) or Tab: the outer ring opens, or closes again (a pointed outer item moves to the inner ring). */
  function toggleOuter(L, s) {
    if (!L.outer) return { sel: s.sel, open: false, ring: 0 };
    const open = !s.open;
    let sel = s.sel;
    if (!open && L.items[sel] && L.items[sel].ring === 1) sel = otherRing(L, sel);
    return { sel, open, ring: open && L.items[sel] ? L.items[sel].ring : open ? 1 : 0 };
  }
  /**
   * A step (the arrow keys, the d-pad: d = 1 on, -1 back) through what's showing; from nothing, the first (or last).
   * Stepping on past the inner ring's last item opens the outer ring there.
   */
  function step(L, s, d) {
    const k = L.inner, n = L.items.length;
    if (!n) return { sel: -1, open: s.open, ring: 0 };
    let open = !!s.open && !!L.outer;
    const shown = open ? n : k;
    let sel;
    if (s.sel < 0 || s.sel >= shown) sel = d > 0 ? 0 : shown - 1;
    else if (!open && d > 0 && s.sel === k - 1 && L.outer) { open = true; sel = k; }
    else sel = (s.sel + d + shown) % shown;
    return { sel, open, ring: L.items[sel] ? L.items[sel].ring : 0 };
  }

  /** Whether the mouse (dx, dy from the hub) is over the fan: its quarter out to its edge (with a margin), or the hub. */
  function inFan(dx, dy, L, margin, outerOpen) {
    const m = margin === undefined || margin === null ? 24 * L.scale : margin;
    const { t, dist } = along(dx, dy, L);
    if (dist <= 48 * L.scale) return true;
    const reach = outerOpen === false ? L.reachInner : L.reachAll;
    return dist <= reach + m && t >= -0.12 && t <= 1.12;
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
   * The fan's window: around the hub (a screen point), big enough for the fan with its outer ring open, its caption and
   * the quick questions list, kept on the screen's work area. Returns its bounds and the hub inside it.
   */
  function windowFor(hub, L, area) {
    const s = L.scale;
    const back = Math.round(44 * s); // room behind the hub, toward the corner (the hub's glow)
    let U = 0, V = 0;
    for (const it of L.items) { U = Math.max(U, Math.abs(it.x) + it.size / 2); V = Math.max(V, Math.abs(it.y) + it.size / 2); }
    const c = L.caption.all;
    U = Math.max(U, Math.abs(c.x) + c.w, Math.round(440 * s));
    V = Math.max(V, Math.abs(c.y) + c.h, Math.round(560 * s));
    const width = Math.round(back + U + 16), height = Math.round(back + V + 16);
    let x = Math.round(L.hx < 0 ? hub.x + back - width : hub.x - back);
    let y = Math.round(L.vy < 0 ? hub.y + back - height : hub.y - back);
    if (area) {
      x = Math.max(area.x, Math.min(x, area.x + area.width - width));
      y = Math.max(area.y, Math.min(y, area.y + area.height - height));
    }
    return { x, y, width, height, hub: { x: Math.round(hub.x - x), y: Math.round(hub.y - y) } };
  }

  const api = { split, layout, visible, aimAt, stickAt, otherRing, bumper, toggleOuter, step, ringOf, inFan, releasePicks, windowFor, INNER, AIM_DEAD };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.qcFan = api;
})(typeof window !== 'undefined' ? window : globalThis);
