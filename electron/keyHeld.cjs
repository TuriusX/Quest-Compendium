/**
 * The Quest Compendium button's key, WATCHED rather than claimed (owner, Nov 22 2026: default backslash, the key under
 * Backspace). A claimed key (a global shortcut) would stop the player typing it anywhere on the PC, so instead the key
 * is polled with Windows' GetAsyncKeyState: typing it works as always, and only a HOLD (holdMs) opens the quick menu,
 * which also means a paddle brushed by accident does nothing. Injected keys (Steam Input, a controller's app) show up
 * the same way (tested: an injected key held 700 ms read as down until it was let go).
 */
const VK = { Backslash: 0xdc, Scrolllock: 0x91, Insert: 0x2d };

let getAsync = null;
function api() {
  if (getAsync !== null) return getAsync;
  try {
    const koffi = require('koffi');
    getAsync = koffi.load('user32.dll').func('int16 __stdcall GetAsyncKeyState(int vKey)');
  } catch (err) {
    console.warn('[key-held] GetAsyncKeyState unavailable:', err && err.message);
    getAsync = false;
  }
  return getAsync;
}

/** The virtual-key code for a key name we can watch, or 0. */
const vkOf = (keys) => VK[keys] || 0;

/**
 * Watches one key. onPress() on each fresh press (the caller closes an open menu with it), onHold() once a press has
 * lasted holdMs, onShort() when a press ends sooner. Returns { stop }. Without the Windows call it watches nothing.
 */
function watchKey(keys, holdMs, { onPress, onHold, onShort }) {
  const vk = vkOf(keys);
  const f = api();
  if (!vk || !f) return { stop() {}, ok: false };
  f(vk); // the first read clears the "pressed since the last call" bit
  let downAt = 0;
  let fired = false;
  const iv = setInterval(() => {
    let down = false;
    try { down = (f(vk) & 0x8000) !== 0; } catch { return; }
    const t = Date.now();
    if (down && !downAt) {
      downAt = t;
      fired = false;
      if (onPress && onPress() === 'handled') fired = true; // the press closed the menu: no hold from it
    } else if (down && !fired && t - downAt >= holdMs) {
      fired = true;
      if (onHold) onHold();
    } else if (!down && downAt) {
      if (!fired && onShort) onShort();
      downAt = 0;
    }
  }, 30);
  return { stop() { clearInterval(iv); }, ok: true };
}

module.exports = { watchKey, vkOf };
