/**
 * Shortcuts as people read them: Electron accelerators ("CmdOrCtrl+\", "CommandOrControl+Shift+S", "Super+G") become
 * "Ctrl+\", "Ctrl+Shift+S", "Win+G" on Windows and Linux ("Cmd", "Option" on a Mac). Used wherever the desktop app shows
 * a shortcut it registered (the objectives tracker's hint); the app's own pages use the same rules (prettyShortcut).
 */
function formatAccelerator(accelerator, platform = process.platform) {
  const acc = typeof accelerator === 'string' ? accelerator.trim() : '';
  if (!acc) return '';
  const mac = platform === 'darwin';
  // "Plus" is the + key itself; split on the separators, not on a trailing "+" key ("Ctrl++").
  const parts = acc.endsWith('++') ? [...acc.slice(0, -2).split('+'), '+'] : acc.split('+');
  return parts
    .filter((k) => k !== '')
    .map((k) => {
      if (/^(commandorcontrol|cmdorctrl)$/i.test(k)) return mac ? 'Cmd' : 'Ctrl';
      if (/^(command|cmd)$/i.test(k)) return 'Cmd';
      if (/^(super|meta)$/i.test(k)) return mac ? 'Cmd' : 'Win';
      if (/^(control|ctrl)$/i.test(k)) return 'Ctrl';
      if (/^(option|alt|altgr)$/i.test(k)) return mac ? 'Option' : 'Alt';
      if (/^shift$/i.test(k)) return 'Shift';
      if (/^plus$/i.test(k)) return '+';
      if (/^(escape|esc)$/i.test(k)) return 'Esc';
      return k.length === 1 ? k.toUpperCase() : k;
    })
    .join('+');
}

module.exports = { formatAccelerator };
