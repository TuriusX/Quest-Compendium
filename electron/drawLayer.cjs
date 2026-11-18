/**
 * Drawn answers, step 2 (owner, Nov 18 2026): the answer's drawing laid over the live game, on screens that hold still
 * (the game's map, a menu, a skill tree, an inventory). The server lifts the strokes off the drawing (drawnAnswer.ts
 * strokeLayer): a see-through picture the size of the screenshot, so stretched over the screen it was taken of, it lines
 * up with the map underneath.
 *
 * It shows only while that screen still looks like the screenshot: checked before it appears (the drawing arrives some
 * seconds after the question; the map may be closed by then) and about once a second while it's up, on a small capture
 * of the screen compared block by block with the screenshot. The map closed, scrolled or zoomed: it fades away. At most
 * 3 minutes; a new drawing replaces it.
 *
 * Like the markers, the window is click-through, never takes focus, and is kept out of every screen capture (the app's
 * own screenshots and this check included).
 *
 *   show({ id, layer, ref })   layer: the strokes (PNG data URL); ref: the question's screenshot (data URL)
 *   hide()
 */
const { BrowserWindow, desktopCapturer, nativeImage } = require('electron');
const path = require('path');

const LIFETIME_MS = 3 * 60 * 1000;
const CHECK_MS = 1000;
// The comparison: 32 x 18 blocks; a block changed when its colour moved more than this (0-255, mean of the channels).
const GRID_W = 32, GRID_H = 18, BLOCK_DIFF = 22;
// Share of blocks changed that means "another screen" (the map closed, scrolled or zoomed). A map's own small motion
// (the player's icon, a blinking marker, drifting clouds) stays well under it.
const CHANGED_MAX = 0.2;

/** Mean colour of each block, from a picture: GRID_W x GRID_H x 3 numbers. */
function blocks(img) {
  const small = img.resize({ width: GRID_W * 4, height: GRID_H * 4, quality: 'good' });
  const bmp = small.toBitmap(); // BGRA
  const w = GRID_W * 4;
  const out = new Float32Array(GRID_W * GRID_H * 3);
  for (let gy = 0; gy < GRID_H; gy++) for (let gx = 0; gx < GRID_W; gx++) {
    let b = 0, g = 0, r = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = ((gy * 4 + y) * w + gx * 4 + x) * 4;
      b += bmp[i]; g += bmp[i + 1]; r += bmp[i + 2];
    }
    const k = (gy * GRID_W + gx) * 3;
    out[k] = r / 16; out[k + 1] = g / 16; out[k + 2] = b / 16;
  }
  return out;
}

/**
 * Share of blocks that changed between two pictures of the same screen, leaving out `skip` (blocks under our own
 * windows, like the panel, that the screenshot may not have had).
 */
function changedShare(a, b, skip) {
  let changed = 0, counted = 0;
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    if (skip && skip[i]) continue;
    counted++;
    const d = (Math.abs(a[i * 3] - b[i * 3]) + Math.abs(a[i * 3 + 1] - b[i * 3 + 1]) + Math.abs(a[i * 3 + 2] - b[i * 3 + 2])) / 3;
    if (d > BLOCK_DIFF) changed++;
  }
  return counted ? changed / counted : 1;
}

function createDrawLayer({ getDisplay, getSourceId, getCovered, log = () => {} }) {
  let win = null;
  let cur = null; // { id, ref (blocks), sourceId, display, timer, life, misses }

  async function screenNow(sourceId) {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: GRID_W * 8, height: GRID_H * 8 } });
      const s = sources.find((x) => x.id === sourceId);
      return s && s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail : null;
    } catch {
      return null;
    }
  }

  /** Blocks under our own windows now (the panel, the trackers), in the display's grid. */
  function skipMask(display) {
    const mask = new Uint8Array(GRID_W * GRID_H);
    const { x, y, width, height } = display.bounds;
    for (const r of (getCovered && getCovered()) || []) {
      const x0 = Math.floor(((r.x - x) / width) * GRID_W), x1 = Math.ceil(((r.x + r.width - x) / width) * GRID_W);
      const y0 = Math.floor(((r.y - y) / height) * GRID_H), y1 = Math.ceil(((r.y + r.height - y) / height) * GRID_H);
      for (let gy = Math.max(0, y0); gy < Math.min(GRID_H, y1); gy++) for (let gx = Math.max(0, x0); gx < Math.min(GRID_W, x1); gx++) mask[gy * GRID_W + gx] = 1;
    }
    return mask;
  }

  async function same(c) {
    const img = await screenNow(c.sourceId);
    if (!img) return null; // can't tell
    return changedShare(c.ref, blocks(img), skipMask(c.display));
  }

  function hide(why) {
    if (cur) {
      clearTimeout(cur.timer);
      clearTimeout(cur.life);
      if (why) log(`[drawn] layer off: ${why}`);
    }
    cur = null;
    const w = win;
    win = null;
    if (w && !w.isDestroyed()) {
      w.webContents.executeJavaScript('window.qcFade && window.qcFade(); 1').catch(() => {});
      setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, 400);
    }
  }

  async function show({ id, layer, ref } = {}) {
    hide();
    if (typeof layer !== 'string' || !layer.startsWith('data:image/png;base64,') || typeof ref !== 'string' || !ref.startsWith('data:image/')) return false;
    const sourceId = getSourceId();
    const display = getDisplay();
    if (!sourceId || !display) return false;
    const refImg = nativeImage.createFromDataURL(ref);
    if (refImg.isEmpty()) return false;
    const c = { id: String(id || ''), ref: blocks(refImg), sourceId, display, timer: null, life: null, misses: 0 };
    cur = c;
    // The screen must still be the one the question was about.
    const share = await same(c);
    if (cur !== c) return false;
    if (share === null || share > CHANGED_MAX) {
      log(`[drawn] layer not shown: the screen changed (${share === null ? 'no capture' : `${Math.round(share * 100)}% of it`})`);
      cur = null;
      return false;
    }
    const { x, y, width, height } = display.bounds;
    const w = new BrowserWindow({
      x, y, width, height, transparent: true, frame: false, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    win = w;
    w.setIgnoreMouseEvents(true);
    w.setAlwaysOnTop(true, 'screen-saver');
    // Kept out of every capture: the app's screenshots, and this layer's own check of the screen.
    w.setContentProtection(true);
    await w.loadFile(path.join(__dirname, 'drawLayer.html')).catch(() => {});
    if (cur !== c || w.isDestroyed()) { if (!w.isDestroyed()) w.destroy(); return false; }
    await w.webContents.executeJavaScript(`window.qcShow(${JSON.stringify(layer)}); 1`).catch(() => {});
    w.showInactive();
    log(`[drawn] layer on (${Math.round(share * 100)}% of the screen differs from the question's screenshot)`);
    c.life = setTimeout(() => { if (cur === c) hide('3 minutes'); }, LIFETIME_MS);
    const tick = async () => {
      if (cur !== c) return;
      const s = await same(c);
      if (cur !== c) return;
      // Two looks in a row on another screen (one could be a flash or a transition).
      if (s !== null && s > CHANGED_MAX) c.misses++;
      else c.misses = 0;
      if (c.misses >= 2) { hide(`the screen changed (${Math.round(s * 100)}%)`); return; }
      c.timer = setTimeout(tick, CHECK_MS);
    };
    c.timer = setTimeout(tick, CHECK_MS);
    return true;
  }

  return { show, hide, isShowing: () => !!cur && !!win };
}

module.exports = { createDrawLayer, changedShare, blocks, CHANGED_MAX };
