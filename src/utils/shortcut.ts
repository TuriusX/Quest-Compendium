/**
 * Shortcuts as people read them, everywhere the app shows one: Electron accelerators ("CmdOrCtrl+\",
 * "CommandOrControl+Shift+S", "Super+G") become "Ctrl+\", "Ctrl+Shift+S", "Win+G" ("Cmd", "Option" on a Mac). The
 * desktop app's main process has the same rules (electron/accelerator.cjs) for the objectives tracker's hint.
 */
const isMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');

/** One key of an accelerator, as shown. */
export function keyLabel(k: string, mac = isMac()): string {
  if (/^(commandorcontrol|cmdorctrl)$/i.test(k)) return mac ? 'Cmd' : 'Ctrl';
  if (/^(command|cmd)$/i.test(k)) return 'Cmd';
  if (/^(super|meta)$/i.test(k)) return mac ? 'Cmd' : 'Win';
  if (/^(control|ctrl)$/i.test(k)) return 'Ctrl';
  if (/^(option|alt|altgr)$/i.test(k)) return mac ? 'Option' : 'Alt';
  if (/^shift$/i.test(k)) return 'Shift';
  if (/^plus$/i.test(k)) return '+';
  if (/^(escape|esc)$/i.test(k)) return 'Esc';
  return k.length === 1 ? k.toUpperCase() : k;
}

/** The keys of an accelerator, split (a trailing "++" is the + key). */
export function shortcutKeys(accel?: string | null): string[] {
  const a = String(accel || '').trim();
  if (!a) return [];
  return (a.endsWith('++') ? [...a.slice(0, -2).split('+'), '+'] : a.split('+')).filter((k) => k !== '');
}

/** "CmdOrCtrl+Shift+S" -> "Ctrl+Shift+S" ({ spaced: true }: "Ctrl + Shift + S", for sentences). */
export function formatShortcut(accel?: string | null, opts: { spaced?: boolean; mac?: boolean } = {}): string {
  return shortcutKeys(accel).map((k) => keyLabel(k, opts.mac ?? isMac())).join(opts.spaced ? ' + ' : '+');
}
