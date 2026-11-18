# Controller mode, wheel first (proposal, Nov 17 2026)

From Noah's first real-controller test of 0.8.0 (Xbox pad). Four changes, built as one step and shown with
screenshots before committing.

## 1. Never take focus from the game

**Today:** an answer to Help me here, Screenshot and ask or Speak slides the panel in. The panel takes focus, so a player
who asked and went back to playing loses control of the game.

**Change:** the panel never comes in by itself in controller mode. Instead, the answer shows on an **answer card**:

- a new small window over the game, in the top-right corner of the game's screen (about 380 px wide);
- it is `focusable: false` and only ever shown with `showInactive`, the same as the markers overlay and the pin, so the
  game keeps focus and every button press keeps going to the game;
- it shows the question, then the answer's first lines (about 8), with "More in the panel" if it's longer;
- markers still draw over the game the same way;
- the answer is read aloud if that's on, as now;
- while it's waiting, the card shows "Thinking…", so the player knows the question was heard;
- the card fades out after 60 s, or when the next question is asked. It is also put away when the wheel opens, and the
  wheel's first item then becomes **Open this answer**, which opens the panel at that answer.

The panel takes focus only when the player picks it from the wheel. That covers Open the panel, Open this answer, Type,
Switch game and Settings. I'll also check every other path in controller mode that brings a window forward (Speak,
markers, find again, the pin, game detection), so none of them take focus.

## 2. The default open combo: hold L3 + R3

**Today:** the default is holding View + Menu. On Windows, that also opens the multitasking view and Game Bar.

**Change:** hold L3 + R3 (both sticks clicked in) for a second.

- **Default:** the preset `hold-ls-rs` already exists and is what Noah uses now. It becomes the default, and it goes to
  the top of the list in Settings.
- **Migration:** once, players on `hold-view-menu` (or the old `back+start`) are moved to L3 + R3. A note in the panel
  says so and points to Settings.
  - This also moves anyone who picked View + Menu on purpose. They can pick it again, and the migration won't run a
    second time.
- **Can still be changed:** every preset, and custom combos, stay in Settings.
- **L3 / R3 alone:** the app only reads the controller, it never holds buttons back, so the game always sees L3 and R3.
  Only both held together for a full second opens the wheel. Two in-app actions that waited on a lone L3 / R3 are
  changed so they don't fire as part of the combo:
  - R3 switching Pro / Fast inside the panel;
  - L3 as a quick-menu shortcut.
  - **Caveat:** the game also sees the held pair. A few games do something on L3 + R3 together (for example a melee
    attack or a camera reset). A player who hits that can switch to holding the Xbox / PS button.
- **Texts that name the combo:** these now name the combo the player actually has, not "View + Menu":
  - the Settings text;
  - the first-time guide;
  - the prompt bar;
  - the tour pages (tour.7b, tour.7c, tour2.hideB);
  - all 9 languages.

## 3. Both sticks and the d-pad point at the wheel

**Today:** the right stick points straight at an item. The left stick and the d-pad only step one item at a time
around the ring, which feels broken.

**Change:** all three point.

- **Sticks:** the left stick is sent to the wheel as a direction, the same as the right. Whichever stick is pushed
  further wins.
- **D-pad:** up, down, left and right point at the item in that direction, and two arrows together point at a diagonal.
  With more than 8 items, pressing the same direction again moves to the neighbouring item.
- **Both wheels:** this applies to the wheel over the game and to the ring inside the panel.

## 4. The wheel is the main thing

The flow in controller mode:

1. **Hold L3 + R3 anywhere:** the wheel opens over whatever is in front, the game or the panel. It never hides the
   panel or toggles it.
2. **The wheel's items:**
   - Open this answer (only while a recent answer is waiting);
   - Help me here;
   - Screenshot and ask;
   - Speak;
   - Find markers again;
   - Open the panel, or **Back to the game** when the panel is up;
   - Quest log;
   - Type a question;
   - Pro / Fast;
   - Switch game;
   - Settings.
3. **A picks the item; B, or the combo again, closes the wheel.** Focus goes back to whatever had it before, usually
   the game, once the button is let go.
4. **Asking items** (Help me here, Screenshot and ask, Speak): the wheel closes at once and the game keeps focus. The
   answer arrives on the answer card (1).
5. **Panel items** (Open the panel, Open this answer, Type, Quest log, Switch game, Settings): the panel comes in and
   takes focus. This is the only way it does in controller mode.
6. **Leaving the panel:** B inside the panel still only goes back a level and never hides it. The way back to the game
   is the wheel's **Back to the game**.
7. **Hold the combo past the wheel to talk:** keep holding to ask out loud and let go to send, as now. The answer
   arrives on the card.

**Keyboard and mouse don't change:** Ctrl+Space still shows and hides the panel as before. All of the above applies
only to the controller.

## 5. Quick questions on the wheel (added by Noah while building)

A **Quick questions** item on the wheel opens a list in place of the ring. Up and down move through it, with either
stick or the d-pad. A asks, and the answer arrives on the card. B goes back to the ring.

The list fits the moment:
- **Help me with: (the quest log's Now goal)** comes first when there is one.
- Then the quick questions in the order the chips would show them: help with a fight first while one is on screen,
  and "What's after that?" once something has been asked.
- Then the rest.

The same list is used by the panel's own quick menu (src/utils/quickQuestions.ts `padQuestionList`).

## Not changing

- How answers are written, the markers, the prompt bar inside the panel, and the keyboard.
- Steam Deck (its own plugin).

## Testing

- A dev harness drives the combo and the wheel (global.__qcDev), and a game stand-in window checks that focus never
  leaves it.
- Unit tests for the combo default and migration, and for pointing with either stick or the d-pad.
- Screenshots of the card, the wheel over the panel, and Settings before committing.
- Noah re-tests on his Xbox pad before release.
