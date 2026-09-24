/**
 * Sticky markers: keeps on-screen pointers attached to the things they point at while the game scrolls.
 *
 * Two layers, both running locally (no AI calls):
 *  1. Camera tracking. Each frame, a handful of textured background patches from the previous frame are found
 *     again in the new one; their median movement is the camera's movement. Every marker moves with the camera,
 *     including markers that are off-screen, so they're in the right place when you come back.
 *  2. Marker refinement. When a marker is on screen, the patch of the original screenshot around it is matched
 *     near its predicted spot and nudges it into place (this also handles small 3D camera moves).
 * A scene change (a new room, a cutscene, a battle) breaks camera tracking for a moment: that's when markers fade.
 *
 * Positions are measured between pixels (sub-pixel peak fitting) so markers glide instead of stepping.
 * Works on grayscale Float32Array frames of a fixed working size. Loaded by pointers.html; runs in Node for tests.
 */
(function (root) {
  'use strict';

  const PATCH = 28; // marker template size (working pixels)
  const APATCH = 20; // camera anchor patch size
  const ANCHORS = 12; // camera anchors per frame
  const CONFIDENT = 0.6; // NCC score to trust a marker match
  const ANCHOR_OK = 0.72; // NCC score to trust an anchor match
  const MIN_STD = 6; // below this, a patch is too uniform to match
  const CAMERA_RADIUS = 26; // max camera movement between two frames (working px)
  const REFINE_RADIUS = 6; // marker search around its camera-predicted spot
  const AGREE = 6; // how far a marker match may disagree with the camera before we distrust it
  const LOST_FRAMES = 30; // on-screen marker hidden after this many frames with no match at all
  const CUT_FRAMES = 4; // camera lost this many frames in a row: the scene changed

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
    const b = a + n;
    const c = (y0 + n) * W + x0;
    const d = c + n;
    const area = n * n;
    const sum = s[d] - s[b] - s[c] + s[a];
    const mean = sum / area;
    const v = (s2[d] - s2[b] - s2[c] + s2[a]) / area - mean * mean;
    return { mean, std: v > 0 ? Math.sqrt(v) : 0 };
  }

  /** A zero-mean template of size n with its top-left at (x0, y0). */
  function cut(g, w, x0, y0, n) {
    const data = new Float32Array(n * n);
    let sum = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) sum += data[y * n + x] = g[(y0 + y) * w + x0 + x];
    const mean = sum / data.length;
    let v2 = 0;
    for (let i = 0; i < data.length; i++) {
      data[i] -= mean;
      v2 += data[i] * data[i];
    }
    return { data, n, std: Math.sqrt(v2 / data.length) };
  }

  function ncc(g, w, ii, tpl, x0, y0, step) {
    const n = tpl.n;
    const st = windowStats(ii, x0, y0, n);
    if (st.std < 1e-6 || tpl.std < 1e-6) return 0;
    let acc = 0;
    let count = 0;
    for (let y = 0; y < n; y += step) {
      const row = (y0 + y) * w + x0;
      const trow = y * n;
      for (let x = 0; x < n; x += step) {
        acc += tpl.data[trow + x] * (g[row + x] - st.mean);
        count++;
      }
    }
    return acc / (count * st.std * tpl.std);
  }

  /** Parabola through three scores: the peak's offset from the middle one (-0.5..0.5). */
  const subpixel = (l, c, r) => {
    const den = l - 2 * c + r;
    return den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den)) : 0;
  };

  /**
   * Best top-left position for `tpl` near (bx, by) within `radius`: coarse pass, fine pass, then sub-pixel fit.
   * Returns fractional top-left coordinates and the score.
   */
  function find(g, w, h, ii, tpl, bx, by, radius) {
    const n = tpl.n;
    const clampX = (x) => Math.max(0, Math.min(w - n, x));
    const clampY = (y) => Math.max(0, Math.min(h - n, y));
    let best = -2;
    let px = clampX(Math.round(bx));
    let py = clampY(Math.round(by));
    const coarse = radius > 4 ? 2 : 1;
    for (let y = clampY(Math.round(by) - radius); y <= clampY(Math.round(by) + radius); y += coarse) {
      for (let x = clampX(Math.round(bx) - radius); x <= clampX(Math.round(bx) + radius); x += coarse) {
        const sc = ncc(g, w, ii, tpl, x, y, coarse);
        if (sc > best) {
          best = sc;
          px = x;
          py = y;
        }
      }
    }
    if (coarse > 1) {
      const cx = px;
      const cy = py;
      best = -2;
      for (let y = clampY(cy - 1); y <= clampY(cy + 1); y++) {
        for (let x = clampX(cx - 1); x <= clampX(cx + 1); x++) {
          const sc = ncc(g, w, ii, tpl, x, y, 1);
          if (sc > best) {
            best = sc;
            px = x;
            py = y;
          }
        }
      }
    }
    let fx = px;
    let fy = py;
    if (px > 0 && px < w - n) fx += subpixel(ncc(g, w, ii, tpl, px - 1, py, 1), best, ncc(g, w, ii, tpl, px + 1, py, 1));
    if (py > 0 && py < h - n) fy += subpixel(ncc(g, w, ii, tpl, px, py - 1, 1), best, ncc(g, w, ii, tpl, px, py + 1, 1));
    return { x: fx, y: fy, score: best };
  }

  const median = (arr) => {
    const a = [...arr].sort((p, q) => p - q);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  /** Textured background patches spread over the frame (skipping excluded areas such as our own overlay). */
  function pickAnchors(g, w, h, ii, exclude) {
    const cols = 5;
    const rows = 4;
    const out = [];
    const x0 = Math.round(w * 0.06);
    const y0 = Math.round(h * 0.06);
    const cw = (w * 0.88) / cols;
    const ch = (h * 0.88) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // The most textured spot of a few candidates in this cell.
        let bestStd = 0;
        let bx = -1;
        let by = -1;
        for (const fx of [0.25, 0.5, 0.75]) for (const fy of [0.3, 0.7]) {
          const x = Math.round(x0 + (c + fx) * cw - APATCH / 2);
          const y = Math.round(y0 + (r + fy) * ch - APATCH / 2);
          if (x < 0 || y < 0 || x > w - APATCH || y > h - APATCH) continue;
          const cxn = (x + APATCH / 2) / w;
          const cyn = (y + APATCH / 2) / h;
          if (exclude.some((e) => cxn >= e.x0 && cxn <= e.x1 && cyn >= e.y0 && cyn <= e.y1)) continue;
          const st = windowStats(ii, x, y, APATCH).std;
          if (st > bestStd) {
            bestStd = st;
            bx = x;
            by = y;
          }
        }
        if (bx >= 0 && bestStd >= MIN_STD * 1.5) out.push({ x: bx, y: by, std: bestStd });
      }
    }
    out.sort((a, b) => b.std - a.std);
    return out.slice(0, ANCHORS).map((a) => ({ x: a.x, y: a.y, tpl: cut(g, w, a.x, a.y, APATCH) }));
  }

  /**
   * @param {{ ref: Float32Array, w: number, h: number, points: {x:number,y:number,label?:string}[],
   *   exclude?: {x0:number,y0:number,x1:number,y1:number}[], selfVisible?: boolean, screenWidth?: number }} opts
   *   selfVisible: our markers appear in the captured frames (shown in recordings), so never match against the
   *   spots they cover; markers then follow the camera alone.
   */
  function createTracker(opts) {
    const { ref, w, h } = opts;
    const exclude = opts.exclude || [];
    const selfVisible = !!opts.selfVisible;
    const screenW = opts.screenWidth || 1920;
    const markers = opts.points.map((p) => {
      const x = p.x * w;
      const y = p.y * h;
      const x0 = Math.max(0, Math.min(w - PATCH, Math.round(x - PATCH / 2)));
      const y0 = Math.max(0, Math.min(h - PATCH, Math.round(y - PATCH / 2)));
      const tpl = cut(ref, w, x0, y0, PATCH);
      return { x, y, tpl, offX: x - x0, offY: y - y0, weak: tpl.std < MIN_STD, lost: 0, visible: false, score: 0 };
    });
    let prev = null; // previous frame + its integral image
    let anchors = [];
    let cameraLost = 0;
    let started = false;
    let gone = false;

    /** Where our markers (dot + label) are drawn, in 0-1 screen fractions, for when they appear in captures. */
    function markerRects() {
      return markers.map((m, i) => {
        const cx = m.x / w;
        const cy = m.y / h;
        const label = (opts.points[i] && opts.points[i].label) || '';
        const labelW = (48 + 11 * label.length + 30) / screenW;
        const dot = 36 / screenW;
        const flip = cx > 0.75;
        return {
          x0: flip ? cx - dot - labelW : cx - dot,
          x1: flip ? cx + dot : cx + dot + labelW,
          y0: cy - (40 / screenW) * (w / h),
          y1: cy + (40 / screenW) * (w / h),
        };
      });
    }

    function locateAll(frame, ii) {
      // First frame: the player may have moved while the AI answered, so search the whole frame.
      const shifts = [];
      markers.forEach((m) => {
        if (m.weak) return;
        const r = find(frame, w, h, ii, m.tpl, m.x - m.offX, m.y - m.offY, Math.max(w, h));
        if (r.score >= CONFIDENT) shifts.push({ m, dx: r.x + m.offX - m.x, dy: r.y + m.offY - m.y, score: r.score });
      });
      if (!shifts.length) return false;
      const mdx = median(shifts.map((s) => s.dx));
      const mdy = median(shifts.map((s) => s.dy));
      markers.forEach((m) => {
        const own = shifts.find((s) => s.m === m && Math.abs(s.dx - mdx) <= AGREE * 2 && Math.abs(s.dy - mdy) <= AGREE * 2);
        m.x += own ? own.dx : mdx;
        m.y += own ? own.dy : mdy;
        m.score = own ? own.score : 0;
      });
      return true;
    }

    function update(frame) {
      const ii = integral(frame, w, h);
      if (!started) {
        started = true;
        if (!locateAll(frame, ii)) gone = true;
      } else if (prev) {
        // 1. How far did the camera move since the last frame?
        const moves = [];
        for (const a of anchors) {
          const r = find(frame, w, h, ii, a.tpl, a.x, a.y, CAMERA_RADIUS);
          if (r.score >= ANCHOR_OK) moves.push({ dx: r.x - a.x, dy: r.y - a.y });
        }
        const enough = moves.length >= Math.max(3, Math.ceil(anchors.length * 0.35));
        if (enough) {
          cameraLost = 0;
          const dx = median(moves.map((m) => m.dx));
          const dy = median(moves.map((m) => m.dy));
          // 2. Move every marker with the camera (on-screen or not), then fine-tune the ones we can see.
          for (const m of markers) {
            m.x += dx;
            m.y += dy;
            const onScreen = m.x >= 0 && m.x <= w && m.y >= 0 && m.y <= h;
            if (!onScreen || m.weak || selfVisible) {
              m.lost = 0;
              continue;
            }
            const r = find(frame, w, h, ii, m.tpl, m.x - m.offX, m.y - m.offY, REFINE_RADIUS);
            m.score = r.score;
            if (r.score >= CONFIDENT && Math.abs(r.x + m.offX - m.x) <= AGREE && Math.abs(r.y + m.offY - m.y) <= AGREE) {
              // Blend toward the match: steady, and still corrects any drift.
              m.x += (r.x + m.offX - m.x) * 0.5;
              m.y += (r.y + m.offY - m.y) * 0.5;
              m.lost = 0;
            } else {
              m.lost++; // maybe covered by a character or a menu: keep following the camera
            }
          }
        } else if (anchors.length >= 3) {
          // Keep the last good background to compare against: a flash or a character passing by recovers within
          // a few frames; a new room or a cutscene never does.
          cameraLost++;
          if (cameraLost >= CUT_FRAMES) gone = true;
        }
      }
      markers.forEach((m) => {
        const onScreen = m.x >= 0 && m.x <= w && m.y >= 0 && m.y <= h;
        m.visible = !gone && onScreen && m.lost <= LOST_FRAMES;
      });
      if (cameraLost === 0) {
        // Only learn the background from frames where the camera was tracked (and never from our own markers).
        anchors = pickAnchors(frame, w, h, ii, selfVisible ? exclude.concat(markerRects()) : exclude);
        prev = frame;
      }
      return markers.map((m) => ({ x: m.x / w, y: m.y / h, visible: m.visible, score: m.score }));
    }

    return {
      update,
      /** True after a scene change (camera tracking broke), or if nothing could be found at the start. */
      get gone() {
        return gone;
      },
    };
  }

  function toGray(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    return g;
  }

  const api = { createTracker, toGray, PATCH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QCTracker = api;
})(typeof window !== 'undefined' ? window : globalThis);
