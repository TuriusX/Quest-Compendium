/**
 * Focus handoff between the game and the overlay (Windows).
 *
 * Windows blocks background apps from taking focus unless the user just interacted with them. A keyboard
 * shortcut counts; a controller button read in the background does not. So when the controller chord opens
 * the overlay, we have to hand focus over ourselves, or the game keeps it and both react to the controller.
 *
 * take():    focus the overlay and remember which window (the game) had focus.
 *            1. ask normally (SetForegroundWindow)
 *            2. if Windows refuses: minimize + restore the overlay (a system activation Windows always allows)
 *            3. last resort: a single Alt tap, which Windows treats as permission to switch focus
 * restore(): give focus back to that window when the overlay hides, only if the overlay (our app) still has
 *            it. If Windows refuses, releasing focus (blur) lets Windows hand it back to the window underneath.
 *
 * Note: an earlier version briefly attached to the game's input thread (AttachThreadInput). That can leave
 * Windows' input state tangled after repeated use, so it is no longer used.
 *
 * Logs go to the desktop app's console as "[focus] …". Elsewhere than Windows, both functions do nothing.
 */

function createFocusHelper() {
  const noop = { available: false, take: () => null, restore: () => {} };
  if (process.platform !== 'win32') return noop;
  let api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    api = {
      GetForegroundWindow: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hWnd, _Out_ uint32 *lpdwProcessId)'),
      SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(uintptr_t hWnd)'),
      IsWindow: user32.func('int __stdcall IsWindow(uintptr_t hWnd)'),
      keybd_event: user32.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)'),
    };
  } catch (err) {
    console.warn('[focus] Windows focus helper unavailable:', err && err.message);
    return noop;
  }

  const VK_MENU = 0x12;
  const KEYEVENTF_KEYUP = 0x0002;
  const asNum = (v) => (typeof v === 'bigint' ? Number(v) : Number(v || 0));
  const foreground = () => asNum(api.GetForegroundWindow());

  function hwndOf(win) {
    const buf = win.getNativeWindowHandle();
    return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
  }

  function pidOf(hwnd) {
    if (!hwnd) return 0;
    const pid = [0];
    api.GetWindowThreadProcessId(hwnd, pid);
    return pid[0] || 0;
  }

  const isOurs = (hwnd) => !!hwnd && pidOf(hwnd) === process.pid;

  return {
    available: true,

    /** Focus `win`. Returns the non-overlay window that had focus before (to hand it back later), or null. */
    take(win) {
      try {
        if (!win || win.isDestroyed()) return null;
        const hwnd = hwndOf(win);
        const before = foreground();
        const previous = before && !isOurs(before) ? before : null;
        if (before === hwnd) return previous;

        api.SetForegroundWindow(hwnd);
        if (foreground() === hwnd) {
          console.log('[focus] take: ok (direct)');
          return previous;
        }

        // Windows refused. Minimizing and restoring our own window is a system activation it always allows.
        win.minimize();
        win.restore();
        win.focus();
        if (foreground() === hwnd) {
          console.log('[focus] take: ok (minimize/restore)');
          return previous;
        }

        // Last resort: a single Alt tap counts as permission to switch focus.
        api.keybd_event(VK_MENU, 0, 0, 0);
        api.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
        api.SetForegroundWindow(hwnd);
        console.log(foreground() === hwnd ? '[focus] take: ok (alt)' : '[focus] take: FAILED, game may still receive input');
        return previous;
      } catch (err) {
        console.warn('[focus] take failed:', err && err.message);
        return null;
      }
    },

    /** Hand focus back to `previous` if our app still has it. */
    restore(win, previous) {
      try {
        if (!win || win.isDestroyed()) return;
        const fg = foreground();
        if (fg && !isOurs(fg)) {
          console.log('[focus] restore: skipped (something else already has focus)');
          return;
        }
        if (previous && api.IsWindow(previous)) {
          api.SetForegroundWindow(previous);
          if (foreground() === previous) {
            console.log('[focus] restore: ok (direct)');
            return;
          }
        }
        // Refused, or we don't know the previous window: release focus so Windows returns it to the
        // window underneath (the game).
        win.blur();
        const after = foreground();
        console.log(after && !isOurs(after) ? '[focus] restore: ok (blur)' : '[focus] restore: FAILED, click the game to continue');
      } catch (err) {
        console.warn('[focus] restore failed:', err && err.message);
      }
    },
  };
}

module.exports = { createFocusHelper };
