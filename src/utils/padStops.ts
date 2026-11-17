/**
 * Controller mode, step 1 (owner, Nov 17 2026: the old controller mode walked every button on screen, small icons
 * included, and wandered onto "Close" and "Send"). The d-pad now moves between stops: the things that matter (each
 * answer, the quick questions, the Ask bar, the quest log's steps), in two zones side by side: the quest log on the
 * left and the conversation on the right.
 *
 * Pure geometry so it can be tested: the page gathers the stops and their boxes (ControllerLayer.tsx).
 *   up / down     the nearest stop above / below in the same zone (horizontal distance breaks ties)
 *   left / right  the next stop in the same row, else the nearest stop in the zone on that side
 */
export type Box = { left: number; top: number; right: number; bottom: number };
export type Stop = { id: number; zone: string; box: Box };
export type Dir = 'up' | 'down' | 'left' | 'right';

const cx = (b: Box) => (b.left + b.right) / 2;
const cy = (b: Box) => (b.top + b.bottom) / 2;

/** Two boxes share a row when they overlap vertically by at least half of the shorter one. */
export function sameRow(a: Box, b: Box): boolean {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return overlap >= Math.min(a.bottom - a.top, b.bottom - b.top) * 0.5;
}

/**
 * The stop to move to from `from` (a stop id) in direction `dir`, or null to stay. With no current stop, the first
 * stop of `fallbackZone` nearest the bottom (the Ask bar's end of the conversation).
 */
export function nextStop(stops: Stop[], from: number | null, dir: Dir, zoneOrder: string[] = ['log', 'main']): number | null {
  if (!stops.length) return null;
  const cur = stops.find((s) => s.id === from);
  if (!cur) return null;
  const a = cur.box;
  if (dir === 'up' || dir === 'down') {
    let best: Stop | null = null;
    let bestScore = Infinity;
    for (const s of stops) {
      if (s.id === cur.id || s.zone !== cur.zone || sameRow(a, s.box)) continue;
      const above = cy(s.box) < cy(a);
      if ((dir === 'up') !== above) continue;
      const gap = dir === 'up' ? Math.max(0, a.top - s.box.bottom) : Math.max(0, s.box.top - a.bottom);
      // Sideways distance: none for stops overlapping this one horizontally; then the left-most wins (into a row of
      // quick questions from the wide Ask bar, the first one).
      const side = Math.max(0, s.box.left - a.right, a.left - s.box.right);
      const score = gap + side * 0.3;
      if (score < bestScore || (score === bestScore && best && s.box.left < best.box.left)) {
        bestScore = score;
        best = s;
      }
    }
    return best ? best.id : null;
  }
  // Left / right: along the row first (quick questions side by side), then across to the other zone.
  const sign = dir === 'right' ? 1 : -1;
  let inRow: Stop | null = null;
  for (const s of stops) {
    if (s.id === cur.id || s.zone !== cur.zone || !sameRow(a, s.box)) continue;
    const d = (cx(s.box) - cx(a)) * sign;
    if (d <= 2) continue;
    if (!inRow || d < (cx(inRow.box) - cx(a)) * sign) inRow = s;
  }
  if (inRow) return inRow.id;
  const zi = zoneOrder.indexOf(cur.zone);
  const zone = zoneOrder[zi + sign];
  if (zi < 0 || !zone) return null;
  let best: Stop | null = null;
  for (const s of stops) {
    if (s.zone !== zone) continue;
    if (!best || Math.abs(cy(s.box) - cy(a)) < Math.abs(cy(best.box) - cy(a))) best = s;
  }
  return best ? best.id : null;
}
