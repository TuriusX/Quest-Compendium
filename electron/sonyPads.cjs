/**
 * PlayStation controllers (DualSense, DualSense Edge, DualShock 4), wired or Bluetooth, read directly (owner, Nov 18
 * 2026). Windows' XInput only sees Xbox-style pads, and Steam turns a DualSense into one only for the game it launched,
 * so the app never saw a PlayStation controller while a game had focus.
 *
 * A hidden window reads the controllers' HID input reports (Chromium's WebHID, built in: nothing to install). It has
 * its own session that may open Sony game controllers and nothing else, and it doesn't need focus. The reports come
 * here and are parsed (sonyPadParse.cjs) into the shape XInput gives; controller.cjs merges them with the Xbox pads, so
 * the quick menu combo, the wheel and the panel work the same with either.
 */
const { BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const { parseReport, isSonyPad } = require('./sonyPadParse.cjs');

const STALE_MS = 600; // a controller that sent nothing for this long is gone (they report many times a second)

function createSonyPads() {
  const pads = new Map(); // device key -> { state, at, kind }
  let win = null;
  let onKind = null;

  const ses = session.fromPartition('qc-sony-pads');
  // Only Sony game controllers, only for the hidden window's own session.
  ses.setPermissionCheckHandler((wc, permission) => permission === 'hid');
  ses.setDevicePermissionHandler((d) => d.deviceType === 'hid' && isSonyPad(Number(d.device && d.device.vendorId), Number(d.device && d.device.productId)));
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const d = (details.deviceList || []).find((x) => isSonyPad(Number(x.vendorId), Number(x.productId)));
    callback(d ? d.deviceId : '');
  });

  ipcMain.on('sony-pad-report', (event, r) => {
    if (!win || event.sender !== win.webContents || !r) return;
    const state = parseReport(r.kind, Number(r.reportId), r.data instanceof Uint8Array ? r.data : Uint8Array.from(r.data || []));
    if (!state) return;
    const had = pads.size > 0;
    pads.set(String(r.key), { state, at: Date.now(), kind: r.kind });
    if (!had && onKind) onKind('playstation');
  });
  ipcMain.on('sony-pad-log', (event, msg) => {
    if (win && event.sender === win.webContents) console.log('[sony-pads]', String(msg).slice(0, 200));
  });

  function start() {
    if (win && !win.isDestroyed()) return;
    win = new BrowserWindow({
      show: false, width: 200, height: 100, skipTaskbar: true,
      webPreferences: { partition: 'qc-sony-pads', preload: path.join(__dirname, 'sonyPadsPreload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    win.loadFile(path.join(__dirname, 'sonyPads.html'));
    win.on('closed', () => { win = null; });
  }

  return {
    start,
    /** The PlayStation controllers' states now (each like XInput's XINPUT_GAMEPAD). */
    states() {
      const now = Date.now();
      const out = [];
      for (const [k, p] of pads) {
        if (now - p.at > STALE_MS) pads.delete(k);
        else out.push(p.state);
      }
      return out;
    },
    connected: () => pads.size > 0,
    /** Told once a PlayStation controller starts sending (the app then shows its button names). */
    onKind(cb) { onKind = cb; },
  };
}

module.exports = { createSonyPads };
