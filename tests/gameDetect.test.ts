// Run: npx tsx tests/gameDetect.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { classify, parseEmulatorTitle, EMULATORS, cleanTitle } = require("../electron/gameDetect.cjs");

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("PASS  " + name); }
  catch (e: any) { console.log("FAIL  " + name + "   -> " + String(e.message).split("\n")[0]); process.exitCode = 1; }
}
const emu = (id: string) => EMULATORS.find((e: any) => e.id === id);
const screen = [{ x: 0, y: 0, width: 2560, height: 1440 }];
const W = (s: string) => s.split("/").join(String.fromCharCode(92));
const full = { x: 0, y: 0, width: 2560, height: 1440 };
const small = { x: 100, y: 100, width: 1200, height: 800 };

test("emulator titles: the game, without the emulator, versions, renderers, FPS and codes", () => {
  const cases: [string, string, string | null][] = [
    ["dolphin", "Dolphin 2407 | JIT64 DC | Direct3D 11 | HLE | The Legend of Zelda: The Wind Waker (GZLE01)", "The Legend of Zelda: The Wind Waker"],
    ["ryujinx", "Ryujinx 1.1.1376 - The Legend of Zelda: Tears of the Kingdom v1.2.1 (0100F2C0115B6000) (64-bit)", "The Legend of Zelda: Tears of the Kingdom"],
    ["yuzu", "yuzu 1734 | The Legend of Zelda: Breath of the Wild | 1.6.0 | NVIDIA GeForce RTX 3080", "The Legend of Zelda: Breath of the Wild"],
    ["yuzu", "sudachi 1.0.11 | Super Mario Odyssey | 1.3.0 | AMD Radeon RX 7900", "Super Mario Odyssey"],
    ["rpcs3", "FPS: 60.00 | Vulkan | 0.0.29-15570 Alpha | Demon's Souls [BLUS30443]", "Demon's Souls"],
    ["cemu", "Cemu 2.0 - [Online] FPS: 60.00 [TitleId: 00050000-101c9500] The Legend of Zelda Breath of the Wild [EU v208]", "The Legend of Zelda Breath of the Wild"],
    ["ppsspp", "PPSSPP v1.17.1 - ULUS10336 : Crisis Core: Final Fantasy VII", "Crisis Core: Final Fantasy VII"],
    ["pcsx2", "Shadow of the Colossus [SCUS-97472]", "Shadow of the Colossus"],
    ["duckstation", "Final Fantasy VII (USA) (Disc 1)", "Final Fantasy VII"],
    ["mgba", "mGBA - Pokemon - Emerald Version (USA, Europe)", "Pokemon - Emerald Version"],
    ["dolphin", "Dolphin 2407", null],
    ["retroarch", "RetroArch Snes9x 1.62.3 a2d6a9a", null],
  ];
  for (const [id, title, want] of cases) assert.equal(parseEmulatorTitle(title, emu(id)), want, title);
});

test("names with numbers keep them", () => {
  assert.equal(cleanTitle("Kingdom Hearts HD 2.5 ReMIX"), "Kingdom Hearts HD 2.5 ReMIX");
  assert.equal(cleanTitle("Persona 5 Royal"), "Persona 5 Royal");
});

test("launcher folders: the deepest installed folder wins, sure for Steam/Epic/GOG/Xbox, not for other installs", () => {
  const installed = [
    { dir: W("D:/GOG Games/Fallout"), name: "Fallout", source: "gog", sure: true },
    { dir: W("C:/Program Files/Epic Games/Hades"), name: "Hades", source: "epic", storeId: "abc", sure: true },
    { dir: W("C:/Games/Rockstar Games"), name: "Rockstar Games Launcher", source: "rockstar", sure: false },
    { dir: W("C:/Games/Rockstar Games/Red Dead Redemption 2"), name: "Red Dead Redemption 2", source: "rockstar", sure: false },
  ];
  const gog = classify({ path: W("D:/GOG Games/Fallout/DOSBOX/dosbox.exe"), title: "DOSBox", rect: small }, installed, screen);
  assert.deepEqual([gog.source, gog.name, gog.sure], ["gog", "Fallout", true]);
  const epic = classify({ path: W("C:/Program Files/Epic Games/Hades/x64/Hades.exe"), title: "Hades", rect: small }, installed, screen);
  assert.deepEqual([epic.source, epic.storeId, epic.sure], ["epic", "abc", true]);
  const rdr = classify({ path: W("C:/Games/Rockstar Games/Red Dead Redemption 2/RDR2.exe"), title: "Red Dead Redemption 2", rect: full }, installed, screen);
  assert.deepEqual([rdr.name, rdr.sure], ["Red Dead Redemption 2", false]);
});

test("Battle.net by program name; emulators by program; unknown only when it fills the screen", () => {
  assert.equal(classify({ path: W("C:/Program Files (x86)/Diablo IV/Diablo IV.exe"), title: "Diablo IV" }, [], screen).name, "Diablo IV");
  const dol = classify({ path: W("C:/Emu/Dolphin-x64/Dolphin.exe"), title: "Dolphin 2407 | JIT64 DC | Super Mario Sunshine (GMSE01)", rect: small }, [], screen);
  assert.deepEqual([dol.source, dol.emulator, dol.name, dol.key], ["emulator", "Dolphin", "Super Mario Sunshine", "dolphin|supermariosunshine"]);
  assert.equal(classify({ path: W("C:/Games/Celeste/Celeste.exe"), title: "Celeste", rect: small }, [], screen), null);
  const unk = classify({ path: W("C:/Games/Celeste/Celeste.exe"), title: "Celeste", rect: full }, [], screen);
  assert.deepEqual([unk.source, unk.name, unk.key], ["unknown", "Celeste", "celeste.exe|celeste"]);
});

test("never games: browsers, Discord, launchers, Windows, Quest Compendium", () => {
  for (const p of ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Users/x/AppData/Local/Discord/app-1.0/Discord.exe", "C:/Program Files (x86)/Steam/steam.exe", "C:/Windows/explorer.exe", "C:/Windows/System32/notepad.exe", "C:/Users/x/AppData/Local/Programs/Quest Compendium/Quest Compendium.exe"]) {
    assert.equal(classify({ path: W(p), title: "x", rect: full }, [], screen), null, p);
  }
});

console.log(`\n${passed} passed`);
