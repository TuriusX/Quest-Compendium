# Proposal: markers you can rely on

*(Propose first.)* Nothing here is built yet. Written Nov 10, 2026.

## Why

Markers are okay but not dependable. The problems players can hit today:

- **They jump or vanish.** The check that confirms each marker runs after the markers are already on screen. When it moves or
  removes one, the player sees it happen, and a removal also clears the boxes they ticked.
- **Fight markers 6-8 are never checked.** The check only looks at the first 5.
- **They sometimes never appear, with no message.** The overlay lines markers up against the screenshot the question was asked
  with, which can be up to 3 minutes old by the time the answer arrives. If the screen has changed too much, the markers
  silently don't show.
- **They go too soon.**
  - The next question wipes them, even when it is about the same scene.
  - If the tracker can't follow the camera from the start, they last a fixed 8 seconds whatever the lifetime setting says.
- **The wrong screen on two monitors.** The screenshot and the markers use the screen under the mouse, not the game's.
- **Steam Deck markers are never checked**, so wrong ones stay.
- **We can't learn from mistakes.** Nothing records which markers the check removed or why, and the "marker off" reason
  is offered even on answers that had no markers.
- **A dormant overlay bug.** Adding markers while they're being tracked would break the drawing, because of a variable
  that's out of scope. It's harmless today only because nothing adds markers later.
- **Settings text.** It says "up to 2 minutes" whatever the lifetime is set to.

The numbers from the last 30 days are small. The check looked at 87 markers and removed 14 (16%); in Baldur's Gate 3 it
removed 8 of 35. Only 5 answers got a vote. So this proposal fixes what the code shows is fragile, and adds the record we need
to see what goes wrong.

## What the test showed (Nov 10, $0.092)

I expected boxes to place markers more accurately than centre points, and tested it.

**The test:**
- 18 of your own game captures from 13 games, with 64 objects whose true outline I marked by hand.
- Each model was asked to mark the named objects, once as centre points (today's format) and once as boxes.

**Results:**

| Model | Points on target | Boxes on target | Small objects (points) |
|---|---|---|---|
| Gemini 3.8 Flash (all 18 scenes) | 64 of 64 | 63 of 64 | 25 of 25 |
| Gemini 3.1 Pro (5 scenes, budget) | 17 of 17 | 17 of 17 | 4 of 4 |

**What it means:**
- When a model is told *what* to mark, it already puts the marker on it, small things included, so **boxes are dropped from
  this proposal.**
- The 16% the check removes must come from the answer choosing *what* to mark: something that isn't there, the wrong one of
  several, or a guess.
- That's what part 5 below measures.

**What this test doesn't cover:** cluttered scenes with many similar objects, or answers marking things nobody named.

Files: the scratchpad `markertest` folder, with `truth.json` (the hand-marked outlines) and the results for each model.

## The change

### 1. Checked before they're shown, no jumps
- Markers first appear dimmed with a small "checking" ring. When the check returns (usually 2-4 s), they turn solid or fade
  out. They never move suddenly.
- Moved markers slide as today, but while they're still dimmed.
- All markers are checked, fight markers 6-8 included. The check takes up to 8 crops in one call, so it's still one call.
- A removal no longer clears ticks. Ticks are kept by marker label, not position in the list.
- If the check fails or is rate-limited, the markers go solid as today. Nothing is lost.

### 2. Never silently missing
- When the answer arrives, line the markers up against the **current** screen, not the screenshot the question was asked with.
- If they still can't be lined up (the player has moved on), the chat shows one line, "The scene changed, so the markers
  couldn't be placed", with **Show on the screenshot**. That opens the existing screenshot card with the numbered markers.

### 3. Last as long as the setting says
- The next question keeps the markers while the scene still matches, and replaces them only when its answer brings new ones.
- If tracking can't start, the markers stay for the lifetime setting instead of a fixed 8 seconds. They don't move with the
  camera then, so the chip says "Markers won't follow the camera here".
- Fight markers keep today's behaviour: they go when the fight ends or the next question is sent.

### 4. The game's screen, and the Deck
- **Screenshots and markers on the game's screen.**
  - Desktop already knows the game window from game detection, so use its screen.
  - Fall back to the screen under the mouse when no game is detected.
- **Steam Deck:** run the same check before drawing the numbered badges on the screenshot, and leave out the ones it
  removes.

### 5. Learn what goes wrong (no screenshots stored)
- `markerStats` already counts removals. It will also keep, for each removed marker:
  - the game,
  - the label,
  - the kind (item, character, door…),
  - whether it was a guide marker,
  - whether the check said "not there" or "different spot",
  - the app version.

  It keeps the last 200, so your Quality page can show which kinds and games go wrong.
- Votes record the app version. The "Marker off" reason only shows when the answer had markers.
- Players' screenshots are still never stored.

### 6. Small fixes in the same release
- The overlay variable bug.
- The Settings text follows the lifetime.
- Remove a dead quest-log path for markers that nothing uses.

## Cost

- **Desktop:** no new AI calls. The check already runs after every answer with markers; it now checks up to 8 instead of 5,
  about $0.0003 more on those answers.
- **Deck:** the check would add about $0.001 per answer with markers. At today's Deck volume that's well under $1 a month.
- **Speed:** markers turn solid 2-4 seconds after the answer. Today they appear at once and can jump later.

## Not included
- **Boxes:** the test shows no gain.
- **Following moving characters, and camera zoom or turns:** the tracker only follows the camera sliding. That's a bigger
  piece of work for later, and edge arrows (the separate item 2) build on the same tracker.
- **Free players after the beta:** today they would get Flash-Lite markers with no check. That's a separate decision for
  when the beta ends.

## Files
- `src/App.tsx`:
  - check before solid,
  - ticks kept by label,
  - the "scene changed" line,
  - the next question not wiping markers.
- `src/components/ScreenPointers.tsx`: Show on the screenshot.
- `locate.ts`: up to 8 crops, removal details into `markerStats`.
- `electron/main.cjs`:
  - the game's screen,
  - lining up against the current screen,
  - the lifetime when not sticky,
  - keeping markers across questions.
- `electron/pointers.html`:
  - the dimmed "checking" state,
  - the fixed variable,
  - the "won't follow the camera" note.
- `electron/pointerTracker.js`: register against a fresh frame.
- `answerFeedback.ts`: store the app version.
- `ChatArea.tsx`: the "Marker off" reason only with markers.
- `reviewQueue.ts`: the removals list on the Quality page.
- `src/i18n.tsx`: new strings in every language.
- The Deck repo:
  - `main.py` (call the check),
  - `MarkedShot.tsx`.

## Testing
- **Unit tests** for:
  - parsing markers from the answer,
  - the check's reply,
  - ticks kept across a removal,
  - the not-sticky lifetime.
- **The tracker bench** (`tests/markers`): rerun it, to show lining up against the current frame keeps the 1 px median.
- **Screenshots before commit**, from the dev app with a throwaway profile:
  - markers checking, then solid,
  - one removed,
  - the "scene changed" line with Show on the screenshot,
  - two monitors.
- **Release:** a desktop release (Store upload by you) and a Deck release. Release notes go to you first.
