/**
 * The companion app (owner, Nov 20 2026; electron/companion.cjs): Quest Compendium for SteamOS, the second screen for
 * a game played on a PC. The same page as the desktop panel, in its own layout: full screen, the conversation and the
 * quest log side by side, sign-in with a code (no browser in Game Mode), and no capture of this device's own screen
 * (the game is on the PC). `#companion` in the address gives the same layout in a browser, for working on it.
 */
export const isCompanion = (): boolean =>
  typeof window !== 'undefined' && (!!(window as any).qcCompanion || /(^|[#&])companion\b/.test(window.location.hash));

/** The address the sign-in code is typed at, as shown to the player (short, no protocol). */
export const LINK_ADDRESS = 'questcompendium.com/link';
