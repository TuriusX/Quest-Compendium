/**
 * Sticky markers: keeps on-screen pointers attached to the things they point at while the game scrolls.
 *
 * When the AI answers, we know where each thing was in the screenshot it saw. We cut a small patch of that
 * screenshot around each marker, then look for the same patch in live, low-resolution frames of the screen
 * (normalized cross-correlation, the classic template-matching score). Everything runs locally: no AI calls.
 *
 * - 2D games (camera scrolls): every marker moves together, so markers that are hard to match (grass, walls)
 *   follow the median movement of the ones that match well.
 * - 3D games: small camera moves work; each marker is matched on its own.
 * - Big scene changes (a new room, a cutscene): nothing matches anymore, so the tracker reports "gone".
 *
 * Works on grayscale Float32Array frames of a fixed working size. Loaded by pointers.html; also runs in Node
 * for tests (module.exports).
 */
(function (root) {
  'use strict';

  const PATCH = 28; // template size in working pixels
  const CONFIDENT = 0.6; // NCC score to trust a match
  const MIN_STD = 6; // below this, a patch is too uniform to match on its own
  const LOCAL_RADIUS = 22; // per-frame search radius around the predicted spot
  const AGREE = 10; // how far a match may disagree with the group's movement before we trust the group
  const LOST_FRAMES = 8; // hide a marker after this many frames without a good match
  const GONE_FRAMES = 20; // no marker matched for this long: the scene changed

  /** Summed-area tables of the frame and its square, for O(1) window mean/variance. */
  function integral(g, w, h) {
    const W = w + 1;
    const s = new Float64Array(W * (h + 1));
    const s2 = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      let row2 = 0;
      for (let x = 0; x < w; x++) {
        const v = g[y * w + x];
        row += v;
        row2 += v * v;
        s[(y + 1) * W + x + 1] = s[y * W + x + 1] + row;
        s2[(y + 1) * W + x + 1] = s2[y * W + x + 1] + row2;
      }
    }
    return { s, s2, W };
  }

  function windowStats(ii, x0, y0, n) {
    const { s, s2, W } = ii;
    const a = y0 * W + x0;
    const b = y0 * W + x0 + n;
    const c = (y0 + n) * W + x0;
    const d = (y0 + n) * W + x0 + n;
    const area = n * n;
    const sum = s[d] - s[b] - s[c] + s[a];
    const sum2 = s2[d] - s2[b] - s2[c] + s2[a];
    const mean = sum / area;
    const v = sum2 / area - mean * mean;
    return { mean, std: v > 0 ? Math.sqrt(v) : 0 };
  }

  /** Cut a PATCH x PATCH template centered on (cx, cy), kept inside the frame. */
  function makeTemplate(g, w, h, cx, cy) {
    const x0 = Math.max(0, Math.min(w - PATCH, Math.round(cx - PATCH / 2)));
    const y0 = Math.max(0, Math.min(h - PATCH, Math.round(cy - PATCH / 2)));
    const data = new Float32Array(PATCH * PATCH);
    let sum = 0;
    for (let y = 0; y < PATCH; y++) for (let x = 0; x < PATCH; x++) {
      const v = g[(y0 + y) * w + x0 + x];
      data[y * PATCH + x] = v;
      sum += v;
    }
    const mean = sum / data.length;
    let v2 = 0;
    for (let i = 0; i < data.length; i++) {
      data[i] -= mean; // store zero-mean
      v2 += data[i] * data[i];
    }
    const std = Math.sqrt(v2 / data.length);
    // Where the marker sits inside the patch (differs from the center near screen edges).
    return { data, std, offX: cx - x0, offY: cy - y0 };
  }

  /** NCC between a template and the frame window whose top-left is (x0, y0). step>1 samples every n-th pixel. */
  function ncc(g, w, ii, tpl, x0, y0, step) {
    const st = windowStats(ii, x0, y0, PATCH);
    if (st.std < 1e-6 || tpl.std < 1e-6) return 0;
    let acc = 0;
    let count = 0;
    for (let y = 0; y < PATCH; y += step) {
      const row = (y0 + y) * w + x0;
      const trow = y * PATCH;
      for (let x = 0; x < PATCH; x += step) {
        acc += tpl.data[trow + x] * (g[row + x] - st.mean);
        count++;
      }
    }
    return acc / (count * st.std * tpl.std);
  }

  /** Best match of a template for marker positions within `radius` of (px, py). Returns marker coordinates. */
  function search(g, w, h, ii, tpl, px, py, radius, step, sampleStep) {
    const baseX = Math.round(px - tpl.offX);
    const baseY = Math.round(py - tpl.offY);
    const xMin = Math.max(0, baseX - radius);
    const xMax = Math.min(w - PATCH, baseX + radius);
    const yMin = Math.max(0, baseY - radius);
    const yMax = Math.min(h - PATCH, baseY + radius);
    let best = -2;
    let bx = baseX;
    let by = baseY;
    for (let y = yMin; y <= yMax; y += step) {
      for (let x = xMin; x <= xMax; x += step) {
        const sc = ncc(g, w, ii, tpl, x, y, sampleStep);
        if (sc > best) {
          best = sc;
          bx = x;
          by = y;
        }
      }
    }
    return { x: bx + tpl.offX, y: by + tpl.offY, score: best };
  }

  const median = (arr) => {
    const a = [...arr].sort((p, q) => p - q);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  /**
   * @param {{ ref: Float32Array, w: number, h: number, points: {x:number,y:number}[] }} opts
   *   ref: the screenshot the AI saw, as grayscale at the working size; points: 0-1 fractions.
   */
  function createTracker(opts) {
    const { ref, w, h } = opts;
    const markers = opts.points.map((p) => {
      const x = p.x * w;
      const y = p.y * h;
      const tpl = makeTemplate(ref, w, h, x, y);
      return { x, y, tpl, weak: tpl.std < MIN_STD, lost: 0, visible: true, score: 0 };
    });
    let first = true;
    let noMatch = 0;
    let vx = 0;
    let vy = 0;

    function update(frame) {
      const ii = integral(frame, w, h);
      const matches = markers.map((m) => {
        if (m.weak) return null;
        if (first) {
          // The player may have moved while the AI was answering: look across the whole frame, coarse then fine.
          const coarse = search(frame, w, h, ii, m.tpl, m.x, m.y, Math.max(w, h), 2, 2);
          return search(frame, w, h, ii, m.tpl, coarse.x, coarse.y, 3, 1, 1);
        }
        return search(frame, w, h, ii, m.tpl, m.x + vx, m.y + vy, LOCAL_RADIUS, 1, 1);
      });

      const good = [];
      matches.forEach((r, i) => {
        if (r && r.score >= CONFIDENT) good.push({ i, dx: r.x - markers[i].x, dy: r.y - markers[i].y });
      });
      const mdx = good.length ? median(good.map((g) => g.dx)) : vx;
      const mdy = good.length ? median(good.map((g) => g.dy)) : vy;

      markers.forEach((m, i) => {
        const r = matches[i];
        const trusted =
          r && r.score >= CONFIDENT && (good.length < 2 || (Math.abs(r.x - m.x - mdx) <= AGREE && Math.abs(r.y - m.y - mdy) <= AGREE));
        if (trusted) {
          m.x = r.x;
          m.y = r.y;
          m.lost = 0;
          m.score = r.score;
        } else if (good.length) {
          // Follow the group (the camera scrolled; this spot is just hard to match on its own).
          m.x += mdx;
          m.y += mdy;
          m.lost = m.weak ? 0 : m.lost + 1;
        } else {
          m.lost++;
        }
        const inside = m.x >= 0 && m.x <= w && m.y >= 0 && m.y <= h;
        m.visible = inside && m.lost <= LOST_FRAMES;
      });

      if (good.length) {
        vx = mdx;
        vy = mdy;
        noMatch = 0;
      } else {
        noMatch++;
      }
      first = false;
      return markers.map((m) => ({ x: m.x / w, y: m.y / h, visible: m.visible, score: m.score }));
    }

    return {
      update,
      /** True once nothing has matched for a while (new room, cutscene, menu): time to fade out. */
      get gone() {
        return noMatch >= GONE_FRAMES || (markers.every((m) => m.weak) && noMatch >= 1);
      },
    };
  }

  /** RGBA pixels to grayscale. */
  function toGray(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    return g;
  }

  const api = { createTracker, toGray, PATCH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QCTracker = api;
})(typeof window !== 'undefined' ? window : globalThis);
