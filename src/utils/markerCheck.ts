import type { ScreenPoint } from '../types';

/** One marker the precision pass found: its index in the answer's list and the exact spot (0-1 of the screenshot). */
export type CheckFound = { index: number; x: number; y: number };

/** Markers that moved less than this (a fraction of the screen) stay where they are. */
const MOVE_MIN = 0.004;

/**
 * What the precision pass means for an answer's markers.
 * - `checked`: how many markers the server looked at (the first N). Only those can be removed; older servers checked 5.
 * - `done`: the ticked markers (indexes), carried over to the new numbering instead of being cleared.
 */
export function settleCheck(points: ScreenPoint[], found: CheckFound[], checked: number, done: number[] = []) {
  const removed = points.map((_, i) => i).filter((i) => i < checked && !found.some((f) => f.index === i));
  const moves = found.filter((f) => points[f.index] && !removed.includes(f.index) && Math.hypot(f.x - points[f.index].x, f.y - points[f.index].y) > MOVE_MIN);
  const newIndex = new Map<number, number>();
  const kept: ScreenPoint[] = [];
  points.forEach((p, i) => {
    if (removed.includes(i)) return;
    const mv = moves.find((m) => m.index === i);
    newIndex.set(i, kept.length);
    kept.push(mv ? { ...p, x: mv.x, y: mv.y } : p);
  });
  const keptDone = done.filter((i) => newIndex.has(i)).map((i) => newIndex.get(i)!);
  // Described in words instead of a marker: what it is and where the answer said it is.
  const removedLabels = removed.map((i) => (points[i].where ? `${points[i].label} (${points[i].where})` : points[i].label));
  return { kept, removed, moves, done: keptDone, removedLabels };
}
