# Drawn answers (proposal, Nov 18 2026)

**Status (Nov 18 2026):** the test passed (section 2b); step 1 is built (not yet released).

**Noah's idea (Nov 18):** instead of finding pictures, the AI uses what it knows to draw on, or illustrate, the answer,
or a mix of both. For example, drawing on a picture of the in-game map.

**How it works:**
- The AI replies with drawing instructions: arrows, a route line, circles, numbered spots, short labels, all placed on
  the picture.
- The app draws them over a real picture, the player's own screenshot or their own map, as a clean overlay in the
  app's style.

**And AI-made images too (Noah, Nov 18):** "ai could generate an image too if it would be beneficial to giving the
player visual help. I do not want a ban on ai image generation necessarily." So the plan tests both ways side by side
(section D):
- the app's drawn overlay;
- Gemini's image models drawing on the screenshot or map, or making an illustration.

The better one, or a mix, wins.

## 1. Three canvases

**A. The player's screenshot (most answers already have one).**
- **Arrows:** "go this way", or "the path you want is behind this wall".
- **A route line:** along the path that's on screen.
- **Circles or areas:** "search around here", where an item or a hidden switch is.
- **Numbered order:** levers, plates, symbols, in the order to use them.
- **Short labels:** "jump here", "ledge", "weak spot".

These are the answer's own picture: in the conversation, and in the pop-up card's one picture slot. This grows out of
markers (points) into shapes. The live markers over the game stay as they are; drawings stay on the snapshot, because
a route line would drift as the camera moves.

**B. The in-game map (the most useful for "where do I go?").**
- When the screenshot is the game's own map, the AI marks where to go, draws a route from the player's icon, and
  circles points of interest on their actual map.
- When a question is about where to go and the screenshot isn't a map, the answer can offer: "Open your map and press
  Screenshot and ask (or Help me here) to see the route drawn on it."
- **Limits:**
  - The AI is reliable where it can read the map: place names on it, the player's icon, roads and landmarks.
  - For a spot with no name on the map (a hidden chest), it only knows roughly where it is. It draws an area with
    "about here", never a confident pin.
  - When it isn't sure, it draws nothing and says so in words.

**C. Diagrams drawn from what the AI knows (no picture needed).**
- **Puzzles:** a grid or a sequence (which symbols, in which order), lever and plate orders, a dial's positions.
- **Fights:** a boss's phases as a strip, which attack to dodge which way.
- **Routes:** a step chain with directions ("from the bonfire: north → bridge → left at the tower").

The AI gives the facts as a small structure, and the app draws a clean diagram in its own style. It's never an
illustration pretending to be the game.

**A mix:** a map with the route drawn on it, plus a small diagram of the puzzle at the end of the route.

**D. AI-made images (Gemini's image models: Nano Banana 2, Nano Banana Pro).**
- **Drawing on the real picture:** the screenshot or map goes in, and the same picture comes back with the route, arrows
  and circles drawn by the model, often in a more natural hand-drawn style than an overlay.
  - **Risk:** it can quietly change the scene (move a door, add a path).
  - **The test checks this:** does the picture still match the original apart from the drawing?
- **Illustrations:** a picture made from what the AI knows when there's no screenshot to draw on. For example, a sketch
  of a puzzle's solution, what a hidden switch looks like, or a boss's attack to dodge.
  - **Risk:** it can look like the game while being wrong.
  - **Shown labelled** "Illustration", never passed off as a screenshot.
- **Cost and speed:**
  - Roughly $0.05–0.08 an image with Nano Banana 2, more with Pro. That's 2–3 times a whole answer today ($0.025).
  - About 10–20 seconds to make one.
  - So images don't come with every answer, only when the information the player needs calls for one. The app decides
    by itself, from the kinds of questions the test shows them winning on (Noah, Nov 18).
  - There's no "Draw it for me" button (Noah: not a good idea).

## 2. Accuracy first: a test before building

Drawing in the wrong place is worse than words, so this needs a test before any building.

**What gets tested:**
- 10 in-game map screenshots with "where is X / where do I go" questions;
- 10 normal screenshots with "how do I get there / where is it here" questions;
- 5 puzzle questions, for diagrams.

Each question goes through three arms, and I judge every result by eye, side by side:
1. **Drawn overlay:** Pro and Fast give drawing instructions, and the app draws them.
2. **Image model drawing on the picture:** Nano Banana 2 on all 25, and Nano Banana Pro on 10 to compare.
3. **Illustration:** for the puzzle questions and the "where" questions without a map.

**Pictures:** Noah's own captures would be best (a few map screens from the games he plays). Otherwise, Steam store
screenshots that show the map, which are an allowed source.

**Cost:** about $0.30 for the overlays plus about $2.50 for the images, about $3 in all, with a hard stop at $4.

**Go or no-go:** build only if most drawings are right and the wrong ones can be caught (the AI says when it's unsure).
Otherwise drop it, like step pictures.

## 2b. Test results and Noah's additions (Nov 18)

**What the test found ($3.83 of the $4 stop):**
- Nano Banana 2 drawing on the picture won.
  - In-world views: about 7 of 9 good.
  - Maps: about 5 of 8 good.
  - Puzzle illustrations: excellent.
- App-drawn overlays were crude, and Nano Banana Pro was no better at twice the cost.

**Live drawing (no AI cost to test):**
- The app compares Nano Banana 2's picture with the original and keeps only the strokes, as a see-through layer.
- The layer can sit over the live game where the screen holds still: the in-game map, menus, skill trees, inventories and puzzles.
- In the 3D world, drawings are pinned to markers' found points, and they fade when the view changes too much.
- The same comparison measures how much of the scene changed. Most pictures changed under 5%; the two where the background was swapped changed about 50%, and those are thrown out.

**Pictures from the internet (Noah: OK):**
- When the player has no picture to draw on, the app draws on a wiki map or a picture of the place.
- The source is credited and linked.

**AI images popped up over the game (Noah):**
- An illustration or drawn picture shows over the screen when that helps the player, for example:
  - a puzzle's solution;
  - what the hidden switch or the item looks like;
  - a boss's tell and which way to dodge.
- It uses the pop-up card's picture slot. The order is: the drawn picture or illustration, then the answer's own picture, then a confirmed close-up, then none.
- The picture can be enlarged without taking focus.
- Illustrations are always labelled "Illustration".

## 3. If the test passes: steps

| Step | What | Size |
| --- | --- | --- |
| 1 | Drawings on the screenshot (A), in the answer and the pop-up card, with words-only as the fallback | Medium |
| 2 | Map mode (B): recognise a map screenshot, draw the route, and offer "open your map" | Medium |
| 3 | Diagrams (C) for puzzles and fights | Medium |
| 4 | Steam Deck: the drawn picture in the answer (the same drawing, drawn by the plugin) | Small |

**Running cost:** small. The drawing instructions come in the same answer (a few hundred more output tokens). Only a
"redraw on your map" is a separate, cheap question.
