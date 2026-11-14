/**
 * Which screen a question's screenshot (and so its markers) is taken from: the one showing most of the game's window.
 * The screen under the mouse is only the fallback (no game detected, or its window can't be found), because with two
 * monitors the mouse is often on the other one (on the chat, a browser, Discord).
 *
 * `gameRect` is in the same units as the displays' bounds (DIP; main.cjs converts the window's physical pixels).
 */
function pickCaptureDisplay(displays, gameRect, cursorDisplay) {
  if (!gameRect || !(gameRect.width >= 200) || !(gameRect.height >= 150)) return cursorDisplay;
  let best = null;
  let bestArea = 0;
  for (const d of displays || []) {
    const b = d.bounds;
    const w = Math.min(b.x + b.width, gameRect.x + gameRect.width) - Math.max(b.x, gameRect.x);
    const h = Math.min(b.y + b.height, gameRect.y + gameRect.height) - Math.max(b.y, gameRect.y);
    const area = w > 0 && h > 0 ? w * h : 0;
    if (area > bestArea) {
      best = d;
      bestArea = area;
    }
  }
  return best || cursorDisplay;
}

module.exports = { pickCaptureDisplay };
