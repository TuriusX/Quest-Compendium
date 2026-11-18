/**
 * Controller mode step 4 (owner, Nov 17 2026): the buttons as the player's own controller names them. The app reads
 * every controller as Xbox-style buttons (a = bottom face button, b = right, x = left, y = top), so a PlayStation
 * player saw "A" where their controller says ✕, and a Switch Pro player saw "A" on the button marked B.
 *
 *   styleFromId(id)  the style from a controller's name as the browser reports it (vendor 054c = Sony, 057e =
 *                    Nintendo, 28de = Valve), or null when it can't tell (Steam Input and XInput look like Xbox)
 *   glyph(b, style)  what to print for button b: its text, and its colours
 */
export type PadStyle = 'xbox' | 'playstation' | 'nintendo' | 'deck';
export const PAD_STYLES: PadStyle[] = ['xbox', 'playstation', 'nintendo', 'deck'];

export function styleFromId(id: string): PadStyle | null {
  const s = String(id || '').toLowerCase();
  if (!s) return null;
  if (/054c|playstation|dualsense|dualshock|ps[345] controller/.test(s)) return 'playstation';
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return 'nintendo';
  if (/28de.*(1205|1102)|steam deck/.test(s)) return 'deck';
  if (/xbox|xinput|045e/.test(s)) return 'xbox';
  return null;
}

/**
 * The open combo's preset (electron/padCombo.cjs) from what's saved: the default (nothing saved) is holding L3 + R3
 * (owner, Nov 17 2026: View + Menu also opens Windows' multitasking view and Game Bar); older values map onto presets.
 */
export function padPreset(v?: string): string {
  if (!v || v === 'ls+rs') return 'hold-ls-rs';
  if (v === 'back+start') return 'hold-view-menu';
  if (v === 'lb+rb+back') return 'custom';
  return v;
}

/** The open combo as the app names it ("Hold L3 + R3"), from the Settings label without its "(1 second)"; '' when off. */
export function padComboLabel(toggle: string | undefined, custom: { buttons?: string[] } | undefined, t: (key: string) => string): string {
  const p = padPreset(toggle);
  if (p === 'off') return '';
  if (p === 'custom') return (custom?.buttons || []).map((b) => t(`set.pad.btn.${b}`)).join(' + ');
  return t(`set.pad.preset.${p}`).replace(/\s*[(（][^()（）]*[)）]\s*$/, '');
}

type G = { text: string; bg: string; fg: string; round: boolean };
const FACE = (text: string, bg: string, fg = '#0b0a10'): G => ({ text, bg, fg, round: true });
const BAR = (text: string): G => ({ text, bg: '#3f3f46', fg: '#f4f4f5', round: false });

/** Button names the app uses: a b x y (positions, Xbox-style), lb rb lt rt, view menu, ls rs (stick clicks). */
export function glyph(button: string, style: PadStyle = 'xbox'): G {
  const b = button === 'l3' ? 'ls' : button === 'r3' ? 'rs' : button;
  if (style === 'playstation') {
    const ps: Record<string, G> = {
      a: FACE('✕', '#7ea6e0'), b: FACE('○', '#e5484d', '#fff'), x: FACE('□', '#d58bd0'), y: FACE('△', '#3fbfa0'),
      lb: BAR('L1'), rb: BAR('R1'), lt: BAR('L2'), rt: BAR('R2'), view: BAR('Create'), menu: BAR('Options'), ls: BAR('L3'), rs: BAR('R3'),
    };
    return ps[b] || BAR(b.toUpperCase());
  }
  if (style === 'nintendo') {
    // Same positions, other letters: the bottom button is B, the right one A.
    const ns: Record<string, G> = {
      a: FACE('B', '#d4d4d8'), b: FACE('A', '#d4d4d8'), x: FACE('Y', '#d4d4d8'), y: FACE('X', '#d4d4d8'),
      lb: BAR('L'), rb: BAR('R'), lt: BAR('ZL'), rt: BAR('ZR'), view: BAR('−'), menu: BAR('+'), ls: BAR('LS'), rs: BAR('RS'),
    };
    return ns[b] || BAR(b.toUpperCase());
  }
  if (style === 'deck') {
    const ds: Record<string, G> = {
      a: FACE('A', '#3f3f46', '#f4f4f5'), b: FACE('B', '#3f3f46', '#f4f4f5'), x: FACE('X', '#3f3f46', '#f4f4f5'), y: FACE('Y', '#3f3f46', '#f4f4f5'),
      lb: BAR('L1'), rb: BAR('R1'), lt: BAR('L2'), rt: BAR('R2'), view: BAR('⧉'), menu: BAR('☰'), ls: BAR('L3'), rs: BAR('R3'),
    };
    return ds[b] || BAR(b.toUpperCase());
  }
  const xs: Record<string, G> = {
    a: FACE('A', '#6cc24a'), b: FACE('B', '#e5484d', '#fff'), x: FACE('X', '#3e8ef7', '#fff'), y: FACE('Y', '#f5c518'),
    lb: BAR('LB'), rb: BAR('RB'), lt: BAR('LT'), rt: BAR('RT'), view: BAR('View'), menu: BAR('Menu'), ls: BAR('LS'), rs: BAR('RS'),
  };
  return xs[b] || BAR(b.toUpperCase());
}
