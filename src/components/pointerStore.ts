/**
 * Which answer's markers are on screen right now, and which markers the player switched off in each answer's list.
 * Kept in memory (switched-off markers reset when the app restarts).
 */
import { useSyncExternalStore } from 'react';

let activeId: string | null = null;
const hiddenByMsg = new Map<string, number[]>();
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version++;
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function usePointerUi(msgId: string): { active: boolean; hidden: number[] } {
  useSyncExternalStore(subscribe, () => version);
  return { active: activeId === msgId, hidden: hiddenByMsg.get(msgId) ?? [] };
}

export const hiddenFor = (msgId: string): number[] => hiddenByMsg.get(msgId) ?? [];

export function setPointersActive(id: string, active: boolean): void {
  if (active) activeId = id;
  else if (activeId === id) activeId = null;
  changed();
}

/** Switch one marker on or off, here and on screen. */
export function toggleMarker(msgId: string, index: number): void {
  const current = new Set(hiddenByMsg.get(msgId) ?? []);
  if (current.has(index)) current.delete(index);
  else current.add(index);
  const list = [...current].sort((a, b) => a - b);
  hiddenByMsg.set(msgId, list);
  (window as any).electronAPI?.setPointersHidden?.(msgId, list);
  changed();
}
