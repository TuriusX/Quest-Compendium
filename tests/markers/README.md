# Sticky-marker test bench

Checks the on-screen marker tracker (`electron/pointerTracker.js`) against **real gameplay footage** instead of
simulations. Simulated test worlds are too clean: real games have animated water, walking NPCs, speech bubbles,
repeating tiles and capture artifacts, and those are exactly what break trackers.

1. Record 30-60 s of walking around a game with Quest Compendium's markers off (Game Bar: Win+Alt+R, or OBS).
2. `python tests/markers/prepare.py path/to/recording.mp4` (needs ffmpeg, numpy and opencv-python).
3. `node tests/markers/replay.cjs electron/pointerTracker.js 0 1800` (start frame, number of frames at 30 fps).

It reports marker error in screen pixels (median / 90th percentile / worst), how often markers were hidden while
their spot was on screen, and whether tracking gave up. On the South Figaro recording used to tune the tracker
(Sept 2026, 60 s of walking), the current tracker scores: median 1 px, 90th percentile 4 px, worst 5 px, never
hidden, never gave up.
