/**
 * Detection beyond Steam (games-not-tabs phase 2, owner Oct 27 2026; behind the qc-game-spaces flag: the app turns it
 * on with set-detect-beyond-steam). Steam's RunningAppId still comes first (main.cjs); when Steam runs nothing, the
 * focused program is looked at every few seconds and, when it's a game, reported to the app as 'program-detected'.
 * The program list and window titles never leave this computer: only what the app then matches to a game does.
 *
 * What a program is, most reliable first:
 *   installed  its folder is a game a launcher installed: Steam libraries, Epic manifests, GOG, Xbox / Game Pass
 *              (XboxGames, MicrosoftGame.config): sure. Other installers (EA, Ubisoft, Rockstar, standalone, from
 *              Windows' list of installed programs): a name to confirm once
 *   battlenet  Blizzard's games by program name: sure
 *   emulator   RetroArch, Dolphin, Ryujinx and the yuzu forks, PCSX2, RPCS3, Cemu, DuckStation, PPSSPP, Xenia and
 *              more: the game read from the window title, to confirm once
 *   unknown    any other program filling the screen (fullscreen or borderless): "Which game is this?" once
 * The app remembers each answer per player (learned detection): `key` names the program (an emulator's: the emulator
 * and the game in its title), so the same program is never asked about again.
 *
 * Pure parts (classify, parseEmulatorTitle, cleanTitle) are tested in tests/gameDetect.test.ts.
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const loose = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const EMULATORS = [
  { id: 'retroarch', name: 'RetroArch', exe: /^retroarch\.exe$/i },
  { id: 'dolphin', name: 'Dolphin', exe: /^dolphin(qt2?)?\.exe$/i },
  { id: 'ryujinx', name: 'Ryujinx', exe: /^ryujinx(\.ava)?\.exe$/i },
  { id: 'yuzu', name: 'yuzu', exe: /^(yuzu|suyu|sudachi|citron|torzu|eden)\.exe$/i, names: ['yuzu', 'suyu', 'sudachi', 'citron', 'torzu', 'eden'] },
  { id: 'pcsx2', name: 'PCSX2', exe: /^pcsx2[\w-]*\.exe$/i },
  { id: 'rpcs3', name: 'RPCS3', exe: /^rpcs3\.exe$/i },
  { id: 'cemu', name: 'Cemu', exe: /^cemu\.exe$/i },
  { id: 'duckstation', name: 'DuckStation', exe: /^duckstation[\w-]*\.exe$/i },
  { id: 'ppsspp', name: 'PPSSPP', exe: /^ppsspp(windows)?(64)?\.exe$/i },
  { id: 'xenia', name: 'Xenia', exe: /^xenia[\w-]*\.exe$/i },
  { id: 'citra', name: 'Citra', exe: /^(citra(-qt)?|lime3ds(-gui)?|azahar|mandarine)\.exe$/i, names: ['citra', 'lime3ds', 'azahar', 'mandarine'] },
  { id: 'mgba', name: 'mGBA', exe: /^mgba\.exe$/i },
  { id: 'melonds', name: 'melonDS', exe: /^melonds\.exe$/i },
  { id: 'xemu', name: 'xemu', exe: /^xemu\.exe$/i },
  { id: 'vita3k', name: 'Vita3K', exe: /^vita3k\.exe$/i },
  { id: 'shadps4', name: 'shadPS4', exe: /^shadps4\.exe$/i },
  { id: 'flycast', name: 'Flycast', exe: /^flycast\.exe$/i },
  { id: 'redream', name: 'redream', exe: /^redream\.exe$/i },
  { id: 'project64', name: 'Project64', exe: /^project64\.exe$/i },
  { id: 'snes9x', name: 'Snes9x', exe: /^snes9x(-x64)?\.exe$/i },
  { id: 'mesen', name: 'Mesen', exe: /^mesen\.exe$/i },
  { id: 'bsnes', name: 'bsnes', exe: /^bsnes\.exe$/i },
  { id: 'mame', name: 'MAME', exe: /^mame(64)?\.exe$/i },
  { id: 'dosbox', name: 'DOSBox', exe: /^dosbox(-x)?\.exe$/i },
  { id: 'scummvm', name: 'ScummVM', exe: /^scummvm\.exe$/i },
];

/** Blizzard's games (Battle.net): program name → game. */
const BATTLENET = {
  'diablo iv.exe': 'Diablo IV', 'diablo iii64.exe': 'Diablo III', 'd2r.exe': 'Diablo II: Resurrected', 'diabloimmortal.exe': 'Diablo Immortal',
  'overwatch.exe': 'Overwatch 2', 'wow.exe': 'World of Warcraft', 'wowclassic.exe': 'World of Warcraft Classic', 'hearthstone.exe': 'Hearthstone',
  'sc2_x64.exe': 'StarCraft II', 'starcraft.exe': 'StarCraft: Remastered', 'heroesofthestorm_x64.exe': 'Heroes of the Storm', 'warcraft iii.exe': 'Warcraft III: Reforged',
};

/** Never games: browsers, chat, launchers, recorders, players, tools, Windows itself (and Quest Compendium). */
const NOT_GAMES = new Set(('chrome msedge firefox opera opera_gx brave vivaldi arc discord discordptb discordcanary obs64 obs32 explorer steam steamwebhelper ' +
  'epicgameslauncher galaxyclient battle.net eadesktop origin upc ubisoftconnect xboxpcapp gamebar gamebarftserver spotify vlc mpc-hc64 mpc-hc ' +
  'potplayermini64 potplayermini code devenv notepad notepad++ windowsterminal cmd powershell pwsh taskmgr electron teams ms-teams slack zoom ' +
  'whatsapp telegram msiafterburner rtss wallpaper32 wallpaper64 livelywpf mspaint photoshop excel winword powerpnt outlook ' +
  'onenote applicationframehost systemsettings searchhost startmenuexperiencehost shellexperiencehost lockapp playnite.desktopapp ' +
  'playnite.fullscreenapp launchbox bigbox steamvr vrmonitor parsecd moonlight sunshine').split(' ').concat(['quest compendium', 'nvidia app', 'nvidia share', 'nvidia overlay']));

/** A window title as a game name: bracketed codes, regions, versions and "Disc 1" gone. */
function cleanTitle(s) {
  return String(s || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:[^()]*\b(?:usa|europe|japan|world|en|fr|de|es|it|rev|disc|disk|beta|demo|proto|v\d)[^()]*|[A-Z0-9-]{4,}|\d+-bit)\)/gi, ' ')
    .replace(/\b(?:fps|vps|speed|frames?|frame time)\s*:?\s*[\d.]+\s*(?:%|ms)?/gi, ' ')
    .replace(/\bv\d+(?:\.\d+)+[\w-]*|\b\d+\.\d+\.\d+[\w-]*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:·|–—-]+|[\s:·|–—-]+$/g, '')
    .trim();
}

const NOISE = /^(?:fps|vps|speed|frames?|jit\d*|vulkan|opengl|gl\d|direct3d|d3d\d*|dx\d+|metal|software|hle|lle|nvidia|geforce|amd|radeon|intel|x64|x86|online|offline|paused|running|cpu|gpu|recompiler|interpreter|cached interpreter|game list|ready|loading|no game|alpha|beta|nightly|dev|debug|release)\b/i;

/** The game in an emulator's window title, or null (no game loaded). */
function parseEmulatorTitle(title, emu) {
  const names = [emu.name, emu.id, ...(emu.names || [])].map(loose);
  const parts = String(title || '').split(/\s+(?:\|\|?|—|–|-|::|·|:)\s+/);
  const keep = [];
  for (const raw of parts) {
    const seg = cleanTitle(raw);
    const l = loose(seg);
    if (!l || !/\p{L}{2,}/u.test(seg)) continue;
    if (names.some((n) => n && (l === n || l.startsWith(n) || l.endsWith(n)))) continue;
    if (NOISE.test(seg)) continue;
    if (/^[A-Z]{4}[-_]?\d{5}$/.test(seg) || /^[0-9A-F]{16}$/i.test(seg)) continue; // PS / Switch game codes
    keep.push(seg);
  }
  const name = keep.join(' - ').trim();
  return name.length >= 2 ? name : null;
}

/** Covers a whole display (fullscreen or borderless): at least 95% of one screen's width and height. */
function fillsScreen(rect, displays) {
  if (!rect) return false;
  return (displays || []).some((d) => rect.width >= d.width * 0.95 && rect.height >= d.height * 0.95 &&
    rect.x <= d.x + d.width * 0.05 && rect.y <= d.y + d.height * 0.05);
}

/**
 * What the focused program is (see the top), or null when it isn't a game. `win` = { path, title, rect };
 * `installed` = [{ dir, name, source, storeId?, sure }] (scanInstalled); `displays` = [{ x, y, width, height }].
 */
function classify(win, installed, displays) {
  const full = String(win?.path || '');
  if (!full) return null;
  const exe = path.win32.basename(full).toLowerCase();
  const dir = path.win32.dirname(full).toLowerCase();
  if (NOT_GAMES.has(exe.replace(/\.exe$/, '')) || /^[a-z]:\\windows\\/.test(dir)) return null;
  const title = String(win.title || '').trim();
  const key = `${exe}|${path.win32.basename(dir)}`;
  if (BATTLENET[exe]) return { source: 'battlenet', name: BATTLENET[exe], sure: true, key, exe, title };
  // The deepest installed folder holding the program (a DOSBox inside a GOG game's folder is that game).
  let best = null;
  for (const g of installed || []) {
    const d = String(g.dir || '').toLowerCase().replace(/[\\/]+$/, '');
    if (d && (dir === d || dir.startsWith(d + '\\')) && (!best || d.length > best.dir.length)) best = { ...g, dir: d };
  }
  if (best) return { source: best.source, name: best.name, storeId: best.storeId, sure: !!best.sure, key, exe, title };
  const emu = EMULATORS.find((e) => e.exe.test(exe));
  if (emu) {
    const name = parseEmulatorTitle(title, emu);
    return { source: 'emulator', emulator: emu.name, name, sure: false, key: `${emu.id}|${loose(name)}`, exe, title };
  }
  if (!fillsScreen(win.rect, displays)) return null;
  return { source: 'unknown', name: cleanTitle(title) || null, sure: false, key, exe, title };
}

// ---- What launchers installed (read from disk and the registry; refreshed every 10 minutes) ----------------------

const regQuery = (key) => new Promise((resolve) => exec(`reg query "${key}" /s`, { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (e, out) => resolve(e ? '' : out)));

/** `reg query /s` output as { key: { value: data } }. */
function parseReg(out) {
  const keys = {};
  let cur = null;
  for (const line of String(out).split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) { cur = keys[line.trim()] = {}; continue; }
    const m = cur && line.match(/^\s{4}(.+?)\s{4}REG_\w+\s{4}(.*)$/);
    if (m) cur[m[1]] = m[2].trim();
  }
  return keys;
}

/** Steam's library folders: every game in steamapps/common, with its app id (run outside Steam it's still that game). */
async function steamGames() {
  // Where Steam is (HKCU SteamPath, e.g. "c:/steam"), else its usual folders.
  const own = (await new Promise((resolve) => exec('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { windowsHide: true }, (e, out) => resolve(e ? '' : out))))
    .match(/SteamPath\s+REG_SZ\s+(.+)/)?.[1]?.trim().replace(/\//g, '\\');
  const roots = [...new Set([own, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean))];
  const libs = new Set();
  for (const r of roots) {
    try {
      const vdf = fs.readFileSync(path.join(r, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      libs.add(r);
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
    } catch {}
  }
  const out = [];
  for (const lib of libs) {
    const apps = path.join(lib, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch {}
    for (const f of files) {
      try {
        const acf = fs.readFileSync(path.join(apps, f), 'utf8');
        const name = acf.match(/"name"\s+"([^"]+)"/)?.[1];
        const dir = acf.match(/"installdir"\s+"([^"]+)"/)?.[1];
        const appId = acf.match(/"appid"\s+"(\d+)"/)?.[1];
        if (/redistributable|^proton\b|steam linux runtime|^steamvr$|dedicated server|\bsdk\b/i.test(name || '')) continue; // tools, not games
        if (name && dir) out.push({ dir: path.join(apps, 'common', dir), name, source: 'steam', storeId: appId, sure: true });
      } catch {}
    }
  }
  return out;
}

function epicGames() {
  const dir = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.item')); } catch {}
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const cats = (j.AppCategories || []).map(String);
      if (cats.length && !cats.includes('games')) continue; // Unreal Engine, plugins
      if (j.InstallLocation && j.DisplayName) out.push({ dir: j.InstallLocation, name: j.DisplayName, source: 'epic', storeId: j.CatalogItemId || j.AppName, sure: true });
    } catch {}
  }
  return out;
}

async function gogGames() {
  const keys = parseReg(await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games'));
  return Object.values(keys).filter((v) => v.path && v.gameName).map((v) => ({ dir: v.path, name: v.gameName, source: 'gog', storeId: v.gameID, sure: true }));
}

/** Xbox / Game Pass: XboxGames folders on every drive (the name from MicrosoftGame.config, else the folder). */
function xboxGames() {
  const out = [];
  for (const letter of 'CDEFGHIJ') {
    const root = `${letter}:\\XboxGames`;
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const d of dirs) {
      const content = path.join(root, d, 'Content');
      if (!fs.existsSync(content)) continue; // GameSave and other folders that aren't games
      let name = d;
      try {
        const cfg = fs.readFileSync(path.join(content, 'MicrosoftGame.config'), 'utf8');
        const m = cfg.match(/DefaultDisplayName="([^"]+)"/);
        if (m && !/^ms-resource:/i.test(m[1])) name = m[1];
      } catch {}
      out.push({ dir: path.join(root, d), name, source: 'xbox', storeId: d, sure: true });
    }
  }
  return out;
}

/** Windows' list of installed programs: EA, Ubisoft, Rockstar and standalone installs (a name to confirm once). */
async function otherInstalls() {
  const out = [];
  for (const k of ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall']) {
    for (const v of Object.values(parseReg(await regQuery(k)))) {
      const dir = String(v.InstallLocation || '').replace(/^"|"$/g, '');
      if (!dir || !v.DisplayName || /^[a-z]:\\?$/i.test(dir) || /\\windows\\|\\microsoft\\|\\common files\\/i.test(dir)) continue;
      const pub = String(v.Publisher || '');
      const source = /electronic arts|^ea\b/i.test(pub) ? 'ea' : /ubisoft/i.test(pub) || /^Uplay Install/i.test(String(v.DisplayName)) ? 'ubisoft' : /rockstar/i.test(pub) ? 'rockstar' : 'installed';
      out.push({ dir, name: String(v.DisplayName).replace(/\s*\(remove only\)$/i, ''), source, sure: false });
    }
  }
  return out;
}

/** Everything launchers installed (each source on its own: one failing doesn't stop the others). */
async function scanInstalled() {
  if (process.platform !== 'win32') return [];
  const parts = await Promise.all([
    steamGames().catch(() => []),
    Promise.resolve().then(epicGames).catch(() => []),
    gogGames().catch(() => []),
    Promise.resolve().then(xboxGames).catch(() => []),
    otherInstalls().catch(() => []),
  ]);
  return parts.flat();
}

module.exports = { EMULATORS, BATTLENET, classify, parseEmulatorTitle, cleanTitle, fillsScreen, scanInstalled, parseReg };
