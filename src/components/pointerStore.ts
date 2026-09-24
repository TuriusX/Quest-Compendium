/**
 * On-screen marker state shared by the chat: which answer's markers are showing right now, and the screenshots that
 * items found while walking were spotted in (kept in memory only; they're too big to sync).
 */
import { useSyncExternalStore } from 'react';

let activeId: string | null = null;
const areaRefs = new Map<string, { points: { x: number; y: number; label: string }[]; refImage: string; startIndex: number }[]>();
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

/** Whether this answer's markers are on screen right now. */
export function useMarkersActive(msgId: string): boolean {
  useSyncExternalStore(subscribe, () => version);
  return activeId === msgId;
}

export const markersActiveFor = (msgId: string): boolean => activeId === msgId;

export function setPointersActive(id: string, active: boolean): void {
  if (active) activeId = id;
  else if (activeId === id) activeId = null;
  changed();
}

/** Remember an area-check find, so its marker can come back when the markers are shown again. */
export function rememberAreaFind(msgId: string, find: { points: { x: number; y: number; label: string }[]; refImage: string; startIndex: number }): void {
  areaRefs.set(msgId, [...(areaRefs.get(msgId) ?? []), find]);
}

export const areaFindsFor = (msgId: string) => areaRefs.get(msgId) ?? [];
