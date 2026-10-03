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
 *            it. Called before the panel moves or hides, while it still has focus.
 *            1. ask normally (SetForegroundWindow)
 *            2. if Windows refuses: attach our input thread to the foreground window's thread (or the game's, when
 *               the foreground window is ours) for that one SetForegroundWindow call, and detach right after
 *            3. last resort: release focus (blur) so Windows hands it to the window underneath
 *            No synthetic key presses here (an Alt tap reaches the game: in Baldur's Gate 3 it highlights items).
 * other():   the focused window if it isn't one of ours (the game), else null; recorded before the overlay opens.
 * describe(): a window for the logs: its title, process name and handle.
 *
 * Note: an earlier version kept the game's input thread attached (AttachThreadInput), which could leave Windows'
 * input state tangled after repeated use. Step 2 only attaches around a single call and always detaches.
 *
 * Logs go to the desktop app's console as "[focus] …". Elsewhere than Windows, both functions do nothing.
 */

function createFocusHelper() {
  const noop = { available: false, take: () => null, restore: () => {}, other: () => null, describe: () => '' };
  if (process.platform !== 'win32') return noop;
  let api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    api = {
      GetForegroundWindow: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hWnd, _Out_ uint32 *lpdwProcessId)'),
      SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(uintptr_t hWnd)'),
      IsWindow: user32.func('int __stdcall IsWindow(uintptr_t hWnd)'),
      keybd_event: user32.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)'),
      AttachThreadInput: user32.func('int __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, int fAttach)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(uintptr_t hWnd, _Out_ uint16 *lpString, int nMaxCount)'),
      GetCurrentThreadId: kernel32.func('uint32 __stdcall GetCurrentThreadId()'),
      OpenProcess: kernel32.func('uintptr_t __stdcall OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)'),
      QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(uintptr_t hProcess, uint32 dwFlags, _Out_ uint16 *lpExeName, _Inout_ uint32 *lpdwSize)'),
      CloseHandle: kernel32.func('int __stdcall CloseHandle(uintptr_t hObject)'),
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

  function threadOf(hwnd) {
    if (!hwnd) return 0;
    const pid = [0];
    return api.GetWindowThreadProcessId(hwnd, pid) || 0;
  }

  /** "Baldur's Gate 3 [bg3_dx11.exe] #17500494" for the logs (or "none"). */
  function describe(hwnd) {
    if (!hwnd) return 'none';
    let title = '', exe = '?';
    try {
      const buf = new Uint16Array(256);
      const n = api.GetWindowTextW(hwnd, buf, 256);
      title = String.fromCharCode(...buf.slice(0, Math.max(0, n)));
    } catch { /* no title */ }
    try {
      const pid = pidOf(hwnd);
      const h = pid ? asNum(api.OpenProcess(0x1000, 0, pid)) : 0; // PROCESS_QUERY_LIMITED_INFORMATION
      if (h) {
        const buf = new Uint16Array(520);
        const size = [520];
        if (api.QueryFullProcessImageNameW(h, 0, buf, size)) exe = String.fromCharCode(...buf.slice(0, size[0])).split('\\').pop();
        api.CloseHandle(h);
      }
    } catch { /* no process name */ }
    return `"${title}" [${exe}] #${hwnd}`;
  }

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

    /** The focused window if it belongs to another app (the game), else null. */
    other() {
      try {
        const fg = foreground();
        return fg && !isOurs(fg) ? fg : null;
      } catch {
        return null;
      }
    },

    /** A window for the logs: its title, process name and handle. */
    describe,

    /** Hand focus back to `previous` if our app still has it (called before the panel moves or hides). */
    restore(win, previous) {
      try {
        if (!win || win.isDestroyed()) return;
        const fg = foreground();
        const exists = !!previous && !!api.IsWindow(previous);
        console.log(`[focus] hide: recorded ${describe(previous)} (${previous ? (exists ? 'still exists' : 'gone') : 'nothing recorded'}); foreground before: ${describe(fg)}`);
        if (fg && !isOurs(fg)) {
          console.log('[focus] restore: skipped (something else already has focus)');
          return;
        }
        const done = (how) => {
          const after = foreground();
          console.log(`[focus] restore: ${how}; foreground after: ${describe(after)}`);
        };
        if (exists) {
          // 1. Ask normally, while the panel still has focus (Windows lets the foreground app pass it on).
          api.SetForegroundWindow(previous);
          if (foreground() === previous) return done('ok (direct)');
          // 2. Refused: attach our input thread to the foreground window's thread (the game's when the foreground
          //    window is ours, since that's this very thread) for this one call, then detach.
          const me = api.GetCurrentThreadId();
          const now = foreground();
          const target = now && !isOurs(now) ? threadOf(now) : threadOf(previous);
          let attached = false;
          try {
            if (target && target !== me) attached = !!api.AttachThreadInput(me, target, 1);
            api.SetForegroundWindow(previous);
          } finally {
            if (attached) api.AttachThreadInput(me, target, 0);
          }
          if (foreground() === previous) return done(`ok (attached to ${now && !isOurs(now) ? 'the foreground' : "the game's"} thread)`);
          console.log(`[focus] restore: SetForegroundWindow refused (attach ${attached ? 'ok' : 'failed'})`);
        }
        // 3. Release focus so Windows returns it to the window underneath (the game).
        win.blur();
        const after = foreground();
        done(after && !isOurs(after) ? 'ok (blur)' : 'FAILED, click the game to continue');
      } catch (err) {
        console.warn('[focus] restore failed:', err && err.message);
      }
    },
  };
}

module.exports = { createFocusHelper };
