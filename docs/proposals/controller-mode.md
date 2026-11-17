# Proposal: controller mode, rebuilt

*(Propose first.)* Nothing here is built yet. Written Nov 17, 2026. The desktop app only; the Steam Deck plugin is
already made for a controller.

## What's wrong today

I drove today's controller mode with simulated button presses in the dev app (screenshot: `scratchpad/marker-shots/pad-today.png`).

- **It's the mouse layout with a focus ring.** The d-pad walks every clickable thing on screen, small icons included.
  From the question box, one press of Up went to "Hide the chat (keep the quest log)". Three more reached "Change" and
  "Help me here", then it stuck on "Detach" for three presses. Right then walked "Put the quest log away", the game
  switcher, "Pro 1", "Sign in", "Hide everything (Esc)", "More".
- **The first press is swallowed** (it only wakes controller mode), and it put the focus on the whole quest log,
  not the question box.
- **A 13-item legend** runs across the bottom, over the question box and the quick-question row.
- **Secret buttons:**
  - L3 takes a screenshot and asks;
  - R3 switches Pro / Fast;
  - View opens the quest log;
  - Menu opens the keyboard;
  - Y tapped is quick questions, but held it's talk.
- **B goes back, and with nothing left to close it hides the whole app,** which makes it easy to lose the app.
- **Answers can't be used from the controller** except by walking to small buttons: markers, read aloud, copy, vote, report.
- **Typing is letter by letter** on a grid.
- **Settings and other dialogs** are walked control by control.
- **Xbox button names only.** PlayStation and Switch players see A/B/X/Y.
- **A stray question.** During my test, a screenshot question went out while I was only moving the focus. I haven't
  found what sent it yet; step 1 starts there.

## Playing and asking at once (Noah, Nov 17: the old way fought the game)
The player is holding the game's controller. Every press the app uses is a press the game may also see. So:
- **Opening.**
  - Today's default (hold View + Menu) presses two buttons most games use (map, pause menu).
  - Offer the Xbox / PS button (Guide) as the open button where Windows allows it. Games never see that button, but
    Game Bar may also want it, so it stays a choice.
  - Otherwise keep a hold the game is least likely to act on.
- **While open.** The panel takes focus from the game when it opens, so games that respect focus stop reading the pad.
  That's already done. Nothing else in the app reacts to the pad while the panel is closed, except the open combo and
  the quest log chords you switch on.
- **Closing.** Focus goes back to the game only once every button is let go, so the B that closed the panel never
  becomes a dodge or a cancel in the game.
- **Asking in one motion.** Keep holding the open combo and it starts listening; let go and it asks. No moving through
  the panel at all for the most common case.
- **Games that read the pad in the background anyway** can't be blocked without a driver. The quick-ask path above
  keeps those presses to a minimum.

## The idea

Like Baldur's Gate 3: the moment a controller is touched, the app becomes a controller app. It doesn't put a cursor on
a mouse screen; the same screen rearranges for a pad. Touch the mouse or keyboard and it changes back. Nothing is lost
either way.

### 1. Switching, both ways, at once
- **Into controller mode:** any button, or a stick past its dead zone.
  - The first press already does its job.
  - The focus starts on the Ask bar, or on the newest answer if one just arrived.
- **Back to the mouse layout:** moving the mouse or pressing a key. Where you were is kept for next time.

### 2. A layout made for a pad
- **The bumpers switch the three main panels:** LB ◂ **Quest log · Ask · Guide** ▸ RB, like a game's menu tabs.
  - The triggers page through what's open.
  - The game switcher goes in the menu (5).
- **No small icon buttons.**
  - Detach, Hide the chat, More and the like move into the Actions menu (4) or the quick menu (5).
  - Rows get taller and the text a little bigger.
- **Button glyphs sit on the actions themselves** (Ⓧ on the microphone, Ⓨ on the quick-question row), so there's no
  legend to read.

### 3. Stops, not every button
The d-pad moves between things that matter:
- each answer (as one card);
- its marker checklist;
- the quest log's steps;
- the quick questions;
- the Ask bar.

Up from the Ask bar goes to the newest answer, then older ones. Inside a card, Right goes into its checklist.

### 4. Prompts for what's in focus, and an Actions menu
- **A small prompt bar in the corner** shows only the 3–5 buttons that do something for the focused thing:
  - on an answer: Ⓐ Open · Ⓧ Read aloud · Ⓨ Actions · RT Page;
  - on a checklist item: Ⓐ Tick · Ⓨ Actions.
- **Ⓨ opens an Actions menu for the focused thing**, a short vertical list with everything the mouse version has:
  - Show markers and Find again;
  - Read aloud, Copy, 👍 / 👎, Report;
  - Add to playthrough notes;
  - Track on screen.

### 5. A quick menu instead of secret buttons
Menu (Start) opens a radial menu, picked with the right stick and released or A to choose:
- **Help me here**;
- **Screenshot and ask**;
- **Speak**;
- **Find markers again**;
- **Quest log on screen**;
- **Pro / Fast**;
- **Switch game**;
- **Settings**;
- **Hide the app**.

This replaces L3, R3 and View as hidden shortcuts. Those three can stay as shortcuts for people who know them, and
the menu shows them.

### 6. Asking without typing first
- **Ⓧ Speak**, by holding X to talk.
- **Ⓨ Quick questions** on the Ask bar.
- **Ⓐ Type**, with a better keyboard:
  - bigger keys;
  - word suggestions from the current game's names (its guide and recent answers, free);
  - LT / RT to move the cursor;
  - X to delete a word.

### 7. Back is always back
B closes the open menu or dialog, then steps out of a card. It never hides the app. Hiding stays on the show/hide
button combo and goes in the quick menu.

### 8. Your controller's buttons
- **Button styles:** Xbox, PlayStation, Nintendo and Steam Deck.
- **Picked automatically** when the controller says what it is. It can only say that while the panel has focus,
  because the system-level reader can't tell, so there's also a choice in Settings.

### 9. Dialogs and Settings
Settings get tabs on the bumpers, toggles on A and sliders on left / right; B closes. The other dialogs follow the
same rules.

### 10. First time
One screen showing the layout the first time a controller is used: the panels, the quick menu, Actions and Back.

## Not included
- **The Steam Deck plugin:** it's already controller-first.
- **Remapping every button:** later, if players ask. The show/hide combo and talk button stay changeable as today.
- **PlayStation controllers without Steam Input or DS4Windows:** the system-level reader only sees Xbox-style
  controllers. Reading them directly would be its own project.

## Cost
No AI cost. It's app work only.

## Order (each step shown to you, with screenshots, before the next)
1. **Switching, stops and Back.**
   - the stray question;
   - closing that waits for every button to be let go;
   - the instant switch (1);
   - stops (3);
   - Back never hiding the app (7).

   Then the open button (Guide) and asking in one motion, from the section above.
2. **Prompts and actions.** The prompt bar and the Actions menu (4).
3. **The quick menu** (5).
4. **The layout and button styles.** The controller layout (2) and button styles (8).
5. **The keyboard** (6).
6. **Dialogs, Settings and first time** (9, 10).

## Testing
- **Unit tests:** stops and moving between them, the mode switch, and button styles.
- **Screenshots:** from the dev app driven by simulated presses (the setup used above), for every step.
- **You:** a real controller pass in Baldur's Gate 3 or Elden Ring before release.
