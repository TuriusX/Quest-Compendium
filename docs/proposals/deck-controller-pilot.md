# Pilot study: the Steam Deck as controller and companion screen for a PC game

Nov 20 2026. Asked for by Noah. Research and plan only; nothing is built yet.

## The idea

You play a game on your PC. The Steam Deck in your hands is the controller, and its screen is Quest Compendium:
ask by voice with the Deck's microphone, read the answer on the Deck, see the quest log, pictures and videos there.
The PC screen stays clear of the overlay.

## How it would work

**On the Deck: a standalone app** (added to Steam as a non-Steam game), not the Decky plugin.
- Steam treats it as a game and gives it the controller (sticks, triggers, buttons, back grips when bound). The Steam
  and Quick Access buttons stay Steam's, which is what we want.
- Full screen for answers, quest log, pictures and videos. Built from the desktop app's interface code.
- Microphone: the same "talk, it sends when you stop" voice the apps have now.
- A Decky plugin could also read the buttons (directly from the hardware, 250 times a second, with gyro), but Steam's
  menus react to the same presses unless the plugin grabs the controller away from Steam. Kept as the fallback.

**Between Deck and PC: your home network.**
- Controller state goes over Wi-Fi as small UDP packets, up to 250 a second, each carrying the whole state (a lost
  packet doesn't matter; the next one replaces it). If packets stop, the PC lets go of every button.
- Expected added lag: about 5-15 ms on ordinary home Wi-Fi, with occasional spikes (worse on mesh networks). Fine for
  most games; not for competitive shooters or rhythm games.
- Questions and answers use the same link plus the account sync the apps already share.

**On the PC: the desktop app.**
- Receives the controller state and feeds a virtual Xbox controller that the game sees as a real one.
- **Takes the screenshot.** The game is on the PC, so when you ask from the Deck, the PC captures the game and the
  answer goes back to the Deck. Markers and "looks done" work as they do today.
- Pairing: the desktop app shows a short code in Settings, you enter it on the Deck once. Only paired devices, only on
  your own network, encrypted.

**Switching between playing and asking.**
- The Deck's touchscreen always works Quest Compendium, so you can tap an answer or the quest log mid-game.
- A chord (for example both back grips held) flips the buttons between "play the game" and "use Quest Compendium".
  While it's on Quest Compendium, the PC's virtual controller rests in neutral.
- Voice needs no switch: a back grip could be "talk", so you ask without leaving the game.

## The hard part: the virtual controller on Windows

Windows has no official way for an ordinary app to create an Xbox controller. The options:

| Option | Works with games | Cost / licence | Catch |
|---|---|---|---|
| ViGEmBus | Yes, appears as an Xbox 360 pad | Free, open source | Retired in 2023 (no updates); still works and is still what Sunshine and others install. Needs a one-time driver install with admin rights. |
| libvirtualhid (Sunshine's team) | Yes | Core is free; the Windows driver needs a licence (terms and price unknown) | New, no releases listed yet. |
| VIIPER + usbip | Yes | Free (GPL server) | Needs its own driver installed once with admin rights. |
| Windows' built-in gamepad injection | Unknown | Free | Only for Store-packaged apps with a restricted permission Microsoft must approve; nobody has confirmed games see it. |

For a pilot, ViGEmBus is the obvious choice: free, proven, and many players already have it. For a public release
we'd need to settle on one we can ship long-term (ask LizardByte about libvirtualhid's licence; test Windows' built-in
route for the Store version).

## Risks

- **Driver install.** Players must approve a driver install once. Some won't.
- **Anti-cheat.** No blanket bans on virtual controllers were found, but some games (Call of Duty; Apex is being
  asked to) act against them. We'd say plainly: for single-player games; online games at your own risk.
- **Wi-Fi quality.** Lag spikes on weak or mesh Wi-Fi. A latency read-out in the app helps players judge.
- **Windows firewall.** The first run shows the "allow on private networks" prompt unless the installer adds the rule.
- **A third app to maintain** next to the desktop app and the Decky plugin.
- **Battery.** Rough estimate: 6-10 hours on the Deck OLED, 5-8 on the LCD.

## Others have done the controller half

Several small projects already forward a Deck's controls to a PC (Deck as Controller over Bluetooth or USB, Deckypad
and DeckController over Wi-Fi, all using the same driver approach). None is polished or widely used, and none has a
companion screen. So the controller part is known to work; the combination with Quest Compendium is the new thing.

## Proposed pilot, in three steps

1. **Does it feel good? (small)** A bare test app on the Deck that sends the controls, and a small receiver on the PC
   that drives a virtual controller. No Quest Compendium features yet. We measure the lag and you play a game with it
   for ten minutes. If it feels bad on your Wi-Fi, we stop here, having spent little.
   - Needs from Noah: install ViGEmBus on the PC (one driver install), and put one file on the Deck in Desktop Mode.
2. **The companion screen (medium).** Ask by voice from the Deck with the PC's screenshot, the answer and quest log on
   the Deck's screen, the switch chord, touch.
3. **Make it shippable (medium to large).** Pairing, the installer's driver and firewall steps, the driver decision for
   release, packaging for the Deck, the Store version.

Cost: no AI spend for steps 1-2 beyond normal questions while testing. A driver licence for release is the one
possible cost, unknown until we ask.

## Direction (Noah, Nov 20 2026)

A native SteamOS app that works paired with the desktop app or on its own, possibly sold on the Steam store, with the
Decky plugin kept in maintenance. Two checks added before the plugin could be retired:
- Can a native app run beside a game on the Deck and capture its screen (the plugin can)?
- Steam store rules: payments inside a Steam app (Steam's own purchase system and share), AI disclosure, fees.

Step 1's test tools are in pilot/deck-controller/ (built and tested on the PC with a pretend Deck).

Sources and details: the research report of Nov 20 2026 (drivers, existing projects, latency, Deck input, anti-cheat,
pairing, battery).
