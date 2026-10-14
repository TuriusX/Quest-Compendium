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
  if (/^(enter|return)$/i.test(k)) return 'Enter';
  const arrow = ({ up: '↑', down: '↓', left: '←', right: '→' } as Record<string, string>)[k.toLowerCase()];
  if (arrow) return arrow;
  return k.length === 1 ? k.toUpperCase() : k;
}

/** Two accelerators for the same keys ("CmdOrCtrl+Shift+S" and "CommandOrControl+Shift+s")? */
export function sameShortcut(a?: string | null, b?: string | null): boolean {
  const norm = (x?: string | null) => shortcutKeys(x).map((k) => keyLabel(k, false).toLowerCase()).sort().join('+');
  return !!norm(a) && norm(a) === norm(b);
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
