# Proposal: markers for screens that keep moving

*(Propose first.)* Nothing here is built yet. Written Nov 17, 2026. Tests so far cost $0.37.

## Why markers miss

Markers are placed on the screenshot taken when the question was asked. By the time they appear, the screen has moved on.
The server logs since Nov 10:

| Step | Median | Slowest 10% |
|---|---|---|
| The answer arrives | 19 s after the screenshot | 30 s or more |
| The marker check finishes | 4.6 s later | 9.5 s or more |

So markers usually go onto a picture that is **about 25 seconds old**. In a 2D game the tracker can catch up, because the
view only slides. In a 3D game the camera has turned, zoomed or walked by then, and today's tracker only understands
sliding.

**3D test.** I took my 18 hand-marked captures from 13 games (64 objects) and made a "later" view of each: the camera turned
up to 22°, zoomed and slid. That is a fair stand-in for 25 seconds of play, and it is kinder than real play, because there
is no walking through the world and no moving characters.

| How markers are placed | Right | On the wrong thing | Not shown |
|---|---|---|---|
| Today: the old screenshot lined up with the screen now | 31 of 51 (61%) | 4 (8%) | 16 (31%) |
| Found again on the screen now (Flash + a close-up of each from the screenshot) | 50 of 51 (98%) | 1 (2%) | 0 |
| The same, for things that had left the screen | – | 1 of 8 marked anyway* | – |

\* Run on the 10 views where some things had left the screen, with clean edges. On those views it also got all 27 things
still on screen right.

Without the close-ups, Flash marked 4 of 8 things that were no longer there (a similar tree, candle or bin). With them,
1 of 8. Flash-Lite was much worse: 13 of 51 on the wrong thing.

**Once markers are placed on a recent picture, today's tracker holds up.** It was right 98% of the time after a few seconds of
camera movement, and 94% through a 3-second camera turn. The weak point is the 25-second gap, not the tracker.

**What the check removes.** Since Nov 11 it removed 11 of 52 markers (21%), mostly in Baldur's Gate 3. Some of the removed
markers say nothing useful: "Loot this", "Open this", "Proceed here".

## The change

### 1. Place markers on the screen as it is now
- When the answer arrives, the app takes a fresh picture of the game's screen and finds each marked thing on it. It uses the
  answer's label and "which one" description, plus a close-up of each thing from the question's screenshot.
- This one call replaces today's marker check: the same job (confirm, then place), done on the current screen.
- Markers appear when it returns, about 3-4 s after the answer (today they turn solid after 4.6 s). They're tracked from
  that fresh picture, so the tracker only bridges a few seconds, where it is right 98% of the time.
- Things that are no longer on screen don't get a marker. They're listed under the answer as "Not on screen now", with
  their close-up, so the player knows what to look for.
- People and enemies keep the "is someone really there" check, now on the fresh picture.
- If the call fails or is rate-limited, markers fall back to today's behaviour.

### 2. Keep them while you play
- **Find again by itself.** When the tracker loses the view (the camera turned, the player walked), markers hide instead of
  ending. Once the screen holds still for about a second, the app finds them again on a fresh picture.
  - At most 3 times per answer, only within the marker lifetime, and only in the same game.
  - It stops after two finds in a row see none of the things (the player has left the area).
  - Black or white screens (doors, loading, battles) still end the markers, as today.
- **Find again on request.** A "Find again" button on the answer's marker chip, and a shortcut key, which the player can
  change in Settings. Up to 10 per answer.
- Both use the free area-check allowance (60 an hour per player), plus a daily cap for everyone in a config doc, so the
  cost can't run away.

### 3. Markers worth having
- **A close-up of each thing in the answer's marker list.** Taken from the screenshot (free, done on the computer), so the
  player can see what to look for even after the marker is gone. On the Steam Deck too.
- **No more vague labels.** "Loot this", "Open this", "Proceed here", "Use this", "Click here" and the like:
  - the server names the thing from the marker's own note or description ("Open: Iron Chest");
  - or it drops the marker if nothing says what it is and it isn't a quest, key or danger;
  - the instructions to the AI get the same rule. Free.
- **Edge arrows in 2D games.** A marker that scrolls off screen shows a small arrow at the screen's edge, pointing the
  way. Only while the camera is still being followed, so it never guesses. (This was the separate "edge arrows" item.)

## Cost

- **At answer time:** about $0.005 per answer with markers, against about $0.003 for today's check, so +$0.002.
- **Finding again by itself:** up to 3 × $0.005 per answer. **On request:** $0.005 each.
- **At today's volume** (about 2 answers with markers a day), well under $1 a month.
- **At 100 answers with markers a day:** $1-2 a day at most, with a daily cap in config ($2 suggested) that pauses
  finding again (never the first placement) once reached.
- **Speed:** markers appear about as fast as today's check turns them solid.

## Not included
- **Following moving characters frame by frame:** finding again once the screen settles covers it, without a new tracker.
- **A live overlay on the Steam Deck:** the Deck can't draw over games. It gets the close-ups and the label fixes.
- **AI tracking every frame:** too slow and too costly.
- **The web app:** it has no live screen, so it keeps today's check.

## Files
- **`locate.ts`:** a new `/api/refind`. Takes the fresh picture, the close-ups and the descriptions; returns places on the
  fresh picture or "not on screen"; runs the people check; keeps the removal records. Plus the daily cap.
- **`electron/main.cjs`:**
  - a fresh capture for the answer and for each find-again;
  - "lost" no longer ends the markers;
  - the shortcut key;
  - the caps.
- **`electron/pointerTracker.js`:**
  - a "lost" state (hidden, waiting to find again) next to "gone";
  - "the screen has settled";
  - restarting from a new picture;
  - edge positions for off-screen markers.
- **`electron/pointers.html`:**
  - drawing the found markers;
  - the hidden or lost state;
  - edge arrows.
- **`src/App.tsx`:**
  - finding on the current screen in place of the check;
  - Find again;
  - "Not on screen now".
- **`src/components/ScreenPointers.tsx`:**
  - the close-ups;
  - "Not on screen now";
  - the Find again button.
- **`answerBar.ts`, server marker parsing:** the vague-label fix, and the prompt rule.
- **`src/i18n.tsx`:** new strings in all 9 languages.
- **Deck repo:** close-ups in the marked screenshot's list.

## Testing
- **Unit tests:**
  - the reply parsing;
  - the vague-label fix;
  - the cap;
  - the tracker's lost, settled and restart states.
- **The 2D bench** (`tests/markers`, Final Fantasy VI footage): no change in accuracy.
- **The 3D test above**, rerun with the real `/api/refind` prompt (about $0.30).
- **You play** Baldur's Gate 3 and Elden Ring with a dev build before release. That's the real test, because the
  simulation has no walking or moving characters.
- **Screenshots before commit:**
  - markers found on the current screen;
  - "Not on screen now";
  - Find again;
  - edge arrows;
  - the close-ups.
- **Release:** a desktop release (the Store upload is yours), a server deploy, and a small Deck release for the close-ups.
  Release notes go to you first.

## Order
1, then 3's label fix and close-ups, then 2, then edge arrows. Each step is shown to you before the next.
