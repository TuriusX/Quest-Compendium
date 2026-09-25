/**
 * Sticky markers: keeps on-screen pointers attached to the things they point at while the game scrolls.
 *
 * Two layers, both running locally (no AI calls):
 *  1. Camera tracking. Each frame, a handful of textured background patches from the previous frame are found
 *     again in the new one; their median movement is the camera's movement. Every marker moves with the camera,
 *     including markers that are off-screen, so they're in the right place when you come back.
 *  2. Marker refinement. When a marker is on screen, the patch of the original screenshot around it is matched
 *     near its predicted spot and nudges it into place (this also handles small 3D camera moves).
 * A scene change (a new room, a cutscene, a battle, a fade to black) breaks camera tracking: that's when markers fade.
 *
 * Tuned on real FF6 footage (a town full of identical roofs, windows and barrels). Lessons from it:
 *  - never search the whole screen for one item's picture: it snaps onto an identical copy elsewhere;
 *  - to learn how far the camera moved since a screenshot, make the whole screen agree (many patches, one answer);
 *  - fine-tune each marker only within a few pixels, and never let a failed fine-tune hide a marker.
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
  const REGISTER_RADIUS = 110; // how far the camera may have moved between a screenshot and now (working px)
  const CUT_FRAMES = 4; // camera lost (or nothing left to track, e.g. a fade to black) this many frames: the scene changed
  const DARK = 10; // average brightness (0-255) of a screen that's gone black: a transition, never gameplay
  const BRIGHT = 245; // ... or gone white
  const GAP_MS = 300; // screen capture only sends frames when something changes: a gap this long needs a whole-screen check
  const WHOLE_CHECK_EVERY = 30; // frames between whole-screen checks while tracking (about half a second at 60 fps)

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

  /**
   * A light blur. Pixel art shrunk to the working size looks slightly different depending on where it lands on the
   * pixel grid; blurring a little first makes matches much steadier as the camera moves.
   */
  function soften(g, w, h) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        const l = g[o + (x > 0 ? x - 1 : x)];
        const r = g[o + (x < w - 1 ? x + 1 : x)];
        tmp[o + x] = (l + 2 * g[o + x] + r) * 0.25;
      }
    }
    for (let y = 0; y < h; y++) {
      const u = (y > 0 ? y - 1 : y) * w;
      const d = (y < h - 1 ? y + 1 : y) * w;
      const o = y * w;
      for (let x = 0; x < w; x++) out[o + x] = (tmp[u + x] + 2 * tmp[o + x] + tmp[d + x]) * 0.25;
    }
    return out;
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

  // ---- Whole-screen registration (phase correlation) -------------------------------------------------------

  /** In-place radix-2 FFT of complex arrays (re, im) of length n (a power of two). */
  function fft1(re, im, n, inverse) {
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = ((inverse ? 2 : -2) * Math.PI) / len;
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k;
          const b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci;
          const xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
  }

  function fft2(re, im, W2, H2, inverse) {
    const rr = new Float64Array(Math.max(W2, H2));
    const ri = new Float64Array(Math.max(W2, H2));
    for (let y = 0; y < H2; y++) {
      const o = y * W2;
      for (let x = 0; x < W2; x++) { rr[x] = re[o + x]; ri[x] = im[o + x]; }
      fft1(rr, ri, W2, inverse);
      for (let x = 0; x < W2; x++) { re[o + x] = rr[x]; im[o + x] = ri[x]; }
    }
    for (let x = 0; x < W2; x++) {
      for (let y = 0; y < H2; y++) { rr[y] = re[y * W2 + x]; ri[y] = im[y * W2 + x]; }
      fft1(rr, ri, H2, inverse);
      for (let y = 0; y < H2; y++) { re[y * W2 + x] = rr[y]; im[y * W2 + x] = ri[y]; }
    }
  }

  /** Windowed, zero-mean copy of a frame, padded to a power-of-two grid. */
  function prepPC(g, w, h, W2, H2) {
    let mean = 0;
    for (let i = 0; i < w * h; i++) mean += g[i];
    mean /= w * h;
    const re = new Float64Array(W2 * H2);
    for (let y = 0; y < h; y++) {
      const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (h - 1));
      for (let x = 0; x < w; x++) {
        const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (w - 1));
        re[y * W2 + x] = (g[y * w + x] - mean) * wx * wy;
      }
    }
    return re;
  }

  /**
   * How far the scene moved from `from` to `to` (working px), measured over the whole screen at once, so repeating
   * tiles can't fool it. Then double-checked with textured patches, most of which must agree. Returns null if the
   * two frames don't show the same place.
   */
  function registerFrames(rawFrom, rawTo, w, h, exclude) {
    const from = soften(rawFrom, w, h);
    const to = soften(rawTo, w, h);
    let W2 = 1;
    while (W2 < w) W2 <<= 1;
    let H2 = 1;
    while (H2 < h) H2 <<= 1;
    const aRe = prepPC(from, w, h, W2, H2);
    const aIm = new Float64Array(W2 * H2);
    const bRe = prepPC(to, w, h, W2, H2);
    const bIm = new Float64Array(W2 * H2);
    fft2(aRe, aIm, W2, H2, false);
    fft2(bRe, bIm, W2, H2, false);
    // Normalized cross-power spectrum
    for (let i = 0; i < aRe.length; i++) {
      const r = bRe[i] * aRe[i] + bIm[i] * aIm[i];
      const im = bIm[i] * aRe[i] - bRe[i] * aIm[i];
      const mag = Math.hypot(r, im) || 1;
      aRe[i] = r / mag;
      aIm[i] = im / mag;
    }
    fft2(aRe, aIm, W2, H2, true);
    let best = -Infinity;
    let bx = 0;
    let by = 0;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const v = aRe[y * W2 + x];
      if (v > best) { best = v; bx = x; by = y; }
    }
    let dx = bx > W2 / 2 ? bx - W2 : bx;
    let dy = by > H2 / 2 ? by - H2 : by;
    // Double-check with patches: most must agree on this movement (within a few px).
    const iiFrom = integral(from, w, h);
    const iiTo = integral(to, w, h);
    const patches = pickAnchors(from, w, h, iiFrom, exclude || []);
    const moves = [];
    for (const a of patches) {
      if (a.x + dx < 0 || a.x + dx > w - APATCH || a.y + dy < 0 || a.y + dy > h - APATCH) continue;
      const r = find(to, w, h, iiTo, a.tpl, a.x + dx, a.y + dy, 4);
      if (r.score >= ANCHOR_OK) moves.push({ dx: r.x - a.x, dy: r.y - a.y });
    }
    if (moves.length < 4) return null;
    dx = median(moves.map((m) => m.dx));
    dy = median(moves.map((m) => m.dy));
    return { dx, dy };
  }

  /**
   * @param {{ ref: Float32Array, w: number, h: number, points: {x:number,y:number,label?:string}[],
   *   exclude?: {x0:number,y0:number,x1:number,y1:number}[], selfVisible?: boolean, screenWidth?: number }} opts
   *   selfVisible: our markers appear in the captured frames (shown in recordings), so never match against the
   *   spots they cover; markers then follow the camera alone.
   */
  function createTracker(opts) {
    const { w, h } = opts;
    const ref = soften(opts.ref, w, h);
    const exclude = opts.exclude || [];
    const selfVisible = !!opts.selfVisible;
    const screenW = opts.screenWidth || 1920;
    // When our markers show up in the capture, their label floats above the item: match on the item and the
    // ground below it, not on the area our label covers.
    const TPL = selfVisible ? 24 : PATCH;
    const TPL_UP = selfVisible ? 6 : PATCH / 2;
    const makeMarker = (img, p, shift) => {
      const x = (p.x + (shift ? shift.x : 0)) * w;
      const y = (p.y + (shift ? shift.y : 0)) * h;
      const sx = p.x * w; // where the item is in `img`
      const sy = p.y * h;
      const x0 = Math.max(0, Math.min(w - TPL, Math.round(sx - TPL / 2)));
      const y0 = Math.max(0, Math.min(h - TPL, Math.round(sy - TPL_UP)));
      const tpl = cut(img, w, x0, y0, TPL);
      tpl.offX = sx - x0;
      tpl.offY = sy - y0;
      return {
        x, y, tpl, offX: sx - x0, offY: sy - y0, weak: tpl.std < MIN_STD, lost: 0, visible: false, score: 0, label: p.label || '',
        src: img, rx: p.x, ry: p.y, // the screenshot this marker was placed in, and where
        bx: x - camX * w, by: y - camY * h, // position relative to the camera
        cx: 0, cy: 0, // bounded correction from matching the item
      };
    };
    let camX = 0; // how far the camera has moved in total, in screen fractions
    let camY = 0;
    const markers = opts.points.map((p) => makeMarker(ref, p));
    const labels = () => markers.map((m) => m.label);
    // Markers added later (items found as the player walks): they're located anew in the next frames.
    const PENDING_TRIES = 10;
    let frameNo = 0;
    let prev = null; // previous frame + its integral image
    let anchors = [];
    // Camera tracking compares against a reference frame (not just the previous one), so tiny errors add up only
    // when the reference changes (every second or two), not 30 times a second.
    let keyRel = { x: 0, y: 0 }; // how far the scene has moved since the reference frame
    let keyWeak = 0; // frames in a row the reference frame didn't match well
    let prevWhole = null; // the last frame where the camera was tracked (for whole-screen checks)
    let sinceWhole = 0;
    let stepAnchors = []; // patches from the previous frame
    let cameraLost = 0;
    let started = false;
    let gone = false;

    /** Where our markers (dot + label) are drawn, in 0-1 screen fractions, for when they appear in captures. */
    function markerRects() {
      const aspect = w / h;
      return markers.map((m, i) => {
        const cx = m.x / w;
        const cy = m.y / h;
        const label = labels()[i] || '';
        const half = Math.max(36, (40 + 11 * label.length) / 2) / screenW;
        return { x0: cx - half, x1: cx + half, y0: cy - (84 / screenW) * aspect, y1: cy + (40 / screenW) * aspect };
      });
    }

    /** First frame: move every marker by how far the camera moved since the screenshot (whole-screen agreement). */
    function registerStart(frame) {
      const shift = registerFrames(ref, frame, w, h, exclude);
      if (!shift) return false;
      for (const m of markers) {
        m.x += shift.dx;
        m.y += shift.dy;
        m.bx += shift.dx;
        m.by += shift.dy;
      }
      return true;
    }

    function update(rawFrame, gapMs) {
      // A black or white screen is a transition (a door, stairs, a battle), never something to keep markers on.
      let sum = 0;
      for (let i = 0; i < rawFrame.length; i += 7) sum += rawFrame[i];
      const brightness = (sum * 7) / rawFrame.length;
      if (started && (brightness < DARK || brightness > BRIGHT)) gone = true;
      const frame = soften(rawFrame, w, h);
      const ii = integral(frame, w, h);
      // After a gap in the frames, or every so often while tracking, the whole screen must still line up with the
      // last tracked view. Patches alone can be fooled by look-alike tiles in a new room; the whole screen can't.
      if (started && !gone && prevWhole && (gapMs > GAP_MS || ++sinceWhole >= WHOLE_CHECK_EVERY)) {
        sinceWhole = 0;
        if (!registerFrames(prevWhole, frame, w, h, selfVisible ? exclude.concat(markerRects()) : exclude)) gone = true;
      }
      if (!started) {
        started = true;
        // If the screen can't be matched to the screenshot at all, it's a different scene: show nothing.
        if (!registerStart(frame)) gone = true;
      } else if (prev) {
        // 1a. Frame to frame: how far did the scene move since the previous frame? (reliable, but tiny errors add up)
        const stepMoves = [];
        for (const a of stepAnchors) {
          const r = find(frame, w, h, ii, a.tpl, a.x, a.y, CAMERA_RADIUS);
          if (r.score >= ANCHOR_OK) stepMoves.push({ dx: r.x - a.x, dy: r.y - a.y });
        }
        const stepOk = stepMoves.length >= Math.max(3, Math.ceil(stepAnchors.length * 0.35));
        const stepX = stepOk ? median(stepMoves.map((m) => m.dx)) : 0;
        const stepY = stepOk ? median(stepMoves.map((m) => m.dy)) : 0;
        // 1b. Against the reference frame: if most of its patches match strongly, use that (it doesn't drift).
        const guessX = keyRel.x + stepX;
        const guessY = keyRel.y + stepY;
        const keyMoves = [];
        let keyInView = 0;
        for (const a of anchors) {
          const px = a.x + guessX;
          const py = a.y + guessY;
          if (px < 0 || px > w - APATCH || py < 0 || py > h - APATCH) continue;
          keyInView++;
          const r = find(frame, w, h, ii, a.tpl, px, py, 3);
          if (r.score >= ANCHOR_OK) keyMoves.push({ dx: r.x - a.x, dy: r.y - a.y });
        }
        const keyOk = keyMoves.length >= Math.max(4, Math.ceil(keyInView * 0.5));
        const enough = stepOk || keyOk;
        if (enough) {
          cameraLost = 0;
          const relX = keyOk ? median(keyMoves.map((m) => m.dx)) : guessX;
          const relY = keyOk ? median(keyMoves.map((m) => m.dy)) : guessY;
          keyWeak = keyOk ? 0 : keyWeak + 1;
          const dx = relX - keyRel.x;
          const dy = relY - keyRel.y;
          keyRel = { x: relX, y: relY };
          camX += dx / w;
          camY += dy / h;
          // 2. Every marker rides on the camera (on-screen or not). The ones we can see get a small correction from
          //    matching their item, but that correction is bounded and doesn't accumulate: on repeating patterns
          //    (roof tiles, rows of barrels) tiny per-frame nudges would otherwise walk a marker off its item.
          for (const m of markers) {
            if (m.pending || m.dropped) continue;
            const camPX = m.bx + camX * w;
            const camPY = m.by + camY * h;
            const onScreen = camPX >= 0 && camPX <= w && camPY >= 0 && camPY <= h;
            if (onScreen && !m.weak) {
              const r = find(frame, w, h, ii, m.tpl, camPX + m.cx - m.offX, camPY + m.cy - m.offY, REFINE_RADIUS);
              m.score = r.score;
              const ex = r.x + m.offX - camPX;
              const ey = r.y + m.offY - camPY;
              if (r.score >= CONFIDENT && Math.abs(ex) <= AGREE && Math.abs(ey) <= AGREE) {
                m.cx += (ex - m.cx) * 0.25;
                m.cy += (ey - m.cy) * 0.25;
              }
              // No match (a character in front of it, a speech bubble...): keep following the camera.
            }
            m.x = camPX + m.cx;
            m.y = camPY + m.cy;
          }
        } else {
          // Keep the last good background to compare against: a flash or a character passing by recovers within
          // a few frames; a new room, a cutscene or a fade to black (nothing left to track) never does.
          cameraLost++;
          if (cameraLost >= CUT_FRAMES) gone = true;
        }

      }
      // Newly added markers: start where the camera movement puts them, then fine-tune nearby. If we don't know
      // how far the camera moved since their screenshot, the whole screen has to agree on it first.
      for (const m of markers) {
        if (!m.pending || gone) continue;
        if (!m.placed) {
          const shift = registerFrames(m.src, frame, w, h, exclude);
          if (!shift) {
            if (++m.tries >= PENDING_TRIES) {
              m.pending = false;
              m.dropped = true;
            }
            continue;
          }
          m.x = m.rx * w + shift.dx;
          m.y = m.ry * h + shift.dy;
          m.bx = m.x - camX * w;
          m.by = m.y - camY * h;
          m.placed = true;
        }
        const r = find(frame, w, h, ii, m.tpl, m.x - m.offX, m.y - m.offY, 8);
        if (r.score >= CONFIDENT && !m.weak) {
          m.x = r.x + m.offX;
          m.y = r.y + m.offY;
          m.bx = m.x - camX * w;
          m.by = m.y - camY * h;
          m.cx = 0;
          m.cy = 0;
          m.pending = false;
          m.tries = 0;
          m.lost = 0;
          m.score = r.score;
        } else if (++m.tries >= PENDING_TRIES) {
          m.pending = false;
          m.lost = 0; // no close match, but the camera says it's here: keep it
        }
      }
      markers.forEach((m) => {
        const onScreen = m.x >= 0 && m.x <= w && m.y >= 0 && m.y <= h;
        m.visible = !gone && !m.pending && !m.dropped && onScreen;
      });
      if (cameraLost === 0) {
        // Pick a new reference frame once the view has moved on (a quarter screen), or when too few of the
        // reference's patches are still in view. Only from frames where the camera was tracked, never from our markers.
        const avoid = selfVisible ? exclude.concat(markerRects()) : exclude;
        const inViewNow = anchors.filter((a) => a.x + keyRel.x >= 0 && a.x + keyRel.x <= w - APATCH && a.y + keyRel.y >= 0 && a.y + keyRel.y <= h - APATCH).length;
        if (!anchors.length || keyWeak >= 3 || Math.abs(keyRel.x) > w * 0.25 || Math.abs(keyRel.y) > h * 0.25 || inViewNow < 6) {
          anchors = pickAnchors(frame, w, h, ii, avoid);
          keyRel = { x: 0, y: 0 };
          keyWeak = 0;
        }
        stepAnchors = pickAnchors(frame, w, h, ii, avoid);
        prev = frame;
        prevWhole = frame;
      }
      return markers.map((m) => ({ x: m.x / w, y: m.y / h, visible: m.visible, score: m.score }));
    }

    /**
     * Add markers for things found later, located in `img` (grayscale at the working size).
     * `since`: the camera position (tracker.camera) when `img` was taken, so the markers start where the camera
     * movement since then puts them. Without it they're searched for across the whole frame.
     */
    function addMarkers(rawImg, points, since) {
      const img = soften(rawImg, w, h);
      const shift = since ? { x: camX - since.x, y: camY - since.y } : null;
      for (const p of points) {
        const m = makeMarker(img, p, shift);
        m.pending = true;
        m.placed = !!shift;
        m.tries = 0;
        markers.push(m);
      }
    }

    /**
     * Precision pass: some markers belong on a slightly different spot of their screenshot (the neighboring barrel).
     * Move them by the same amount on screen and re-learn what the item looks like at the corrected spot.
     */
    function moveMarkers(moves) {
      for (const mv of moves) {
        const m = markers[mv.index];
        if (!m || !Number.isFinite(mv.x) || !Number.isFinite(mv.y)) continue;
        const fresh = makeMarker(m.src, { x: mv.x, y: mv.y, label: m.label });
        m.x += (mv.x - m.rx) * w;
        m.y += (mv.y - m.ry) * h;
        m.bx += (mv.x - m.rx) * w;
        m.by += (mv.y - m.ry) * h;
        m.cx = 0;
        m.cy = 0;
        m.rx = mv.x;
        m.ry = mv.y;
        m.tpl = fresh.tpl;
        m.offX = fresh.offX;
        m.offY = fresh.offY;
        m.weak = fresh.weak;
        m.lost = 0;
      }
    }

    return {
      update,
      addMarkers,
      moveMarkers,
      /** Total camera movement since the markers appeared, in screen fractions. */
      get camera() {
        return { x: camX, y: camY };
      },
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
