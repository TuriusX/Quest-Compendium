/**
 * Convergent tab merging for cloud sync. Pure logic (no Firebase, no React) so it can be unit-tested.
 *
 * Why this exists: the old merge treated a per-device "deleted tab ids" list (kept in localStorage) as a global fact and
 * used it to purge tabs from the SHARED cloud document. Two devices with different lists then overwrote each other forever
 * (a write war: one device uploads 0 tabs, the other uploads 4, repeat).
 *
 * Rules that make this safe:
 *  1. Deletions are timestamped "tombstones" stored IN the cloud document (`deletedTabs`), shared by every device.
 *  2. A tab is alive unless a tombstone exists that is at least as new as the tab's last activity (editing a tab after
 *     it was deleted brings it back).
 *  3. For a tab present on both sides, the one with the newer lastActive wins. Ties are broken deterministically, so the
 *     result is the same no matter which device runs the merge.
 *  4. Tabs are ordered deterministically (createdAt, then id).
 *  5. A device uploads ONLY if the merged result differs from what the cloud already holds, so once every device agrees,
 *     nobody writes anymore.
 */
import type { GameTab } from '../types';

// ---------- small helpers (moved here from useCloudSync.ts, which re-exports them) ----------

/** Deterministic JSON with sorted keys; ignores undefined. Stable across local objects and Firestore-returned objects. */
export function canonicalStringify(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => (item === undefined ? 'null' : canonicalStringify(item))).join(',') + ']';
  }
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalStringify(obj[key])).join(',') + '}';
}

/** Firestore rejects `undefined`; a JSON round trip removes it. */
export function removeUndefinedFields<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj));
}

export function isLegacyWelcomeTab(tab: GameTab): boolean {
  if (!tab) return false;
  return tab.id === 'guest-welcome-compendium' || tab.name === 'Welcome, Explorer';
}

function sanitizeTab(tab: GameTab): GameTab {
  const t: GameTab = { ...tab };
  if (t.messages) {
    t.messages = t.messages.map(msg => {
      const m: any = { ...msg };
      if (m.audioBase64) delete m.audioBase64;
      if (m.imageUrl && m.imageUrl.length > 2000) delete m.imageUrl;
      if (m.bannerImageUrl && m.bannerImageUrl.length > 2000) delete m.bannerImageUrl;
      return m;
    });
  }
  if (t.activeSteamGame) {
    const g: any = { ...t.activeSteamGame };
    if (g.achievements) delete g.achievements;
    if (g.patchNotes) delete g.patchNotes;
    t.activeSteamGame = g;
  }
  return t;
}

/** What gets written to Firestore: heavy local-only data stripped, legacy welcome tab removed. */
export function sanitizeTabsForCloud(tabs: GameTab[]): GameTab[] {
  const list = Array.isArray(tabs) ? tabs : [];
  return removeUndefinedFields(list.filter(t => t && t.id && !isLegacyWelcomeTab(t)).map(sanitizeTab));
}

// ---------- tombstones ----------

/** tabId -> time (ms) it was deleted */
export type Tombstones = Record<string, number>;

const TOMBSTONE_KEY = 'quest_tab_tombstones';
const LEGACY_DELETED_KEY = 'quest_deleted_tab_ids';
const TOMBSTONE_MAX_COUNT = 500;

export function cleanTombstones(raw: any): Tombstones {
  const out: Tombstones = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, ts] of Object.entries(raw)) {
      if (typeof ts === 'number' && isFinite(ts) && ts > 0) out[id] = ts;
    }
  }
  return out;
}

/** Keep the newest N. Deterministic (ties by id) so every device computes the same result. */
function capTombstones(t: Tombstones): Tombstones {
  const entries = Object.entries(t);
  if (entries.length <= TOMBSTONE_MAX_COUNT) return t;
  entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return Object.fromEntries(entries.slice(0, TOMBSTONE_MAX_COUNT));
}

export function readTombstones(): Tombstones {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(TOMBSTONE_KEY) : null;
    return raw ? cleanTombstones(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeTombstones(t: Tombstones): void {
  try {
    if (typeof window !== 'undefined') localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(capTombstones(cleanTombstones(t))));
  } catch { /* storage unavailable */ }
}

/** Call when the user deletes a tab. */
export function recordTombstone(tabId: string, now: number = Date.now()): void {
  const t = readTombstones();
  t[tabId] = now;
  writeTombstones(t);
}

/** The old per-device list must never influence sync again (it caused the write war). */
export function dropLegacyDeletedList(): void {
  try {
    if (typeof window !== 'undefined') localStorage.removeItem(LEGACY_DELETED_KEY);
  } catch { /* ignore */ }
}

// ---------- merge ----------

export interface TabState {
  tabs: GameTab[];
  deleted: Tombstones;
}

export interface MergeOutcome {
  merged: TabState;
  /** merged differs from what this device currently has: apply it locally */
  localChanged: boolean;
  /** merged differs from what the cloud currently has: upload it */
  cloudChanged: boolean;
  reason: string;
}

const tabTime = (t: GameTab): number => t.lastActive || t.createdAt || 0;

const byOrder = (a: GameTab, b: GameTab): number =>
  (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** > 0 if `a` should win over `b`. Deterministic and symmetric. */
function compareVersions(a: GameTab, b: GameTab): number {
  const d = tabTime(a) - tabTime(b);
  if (d !== 0) return d;
  const sa = canonicalStringify(sanitizeTab(a));
  const sb = canonicalStringify(sanitizeTab(b));
  return sa === sb ? 0 : sa > sb ? 1 : -1;
}

/** Cloud copy won, but keep this device's heavy local-only extras (audio, full images, achievements). */
function enrichFromLocal(cloudTab: GameTab, localTab: GameTab): GameTab {
  const out: GameTab = { ...cloudTab };
  if (localTab.messages && out.messages) {
    const localMsgs = new Map(localTab.messages.map(m => [m.id, m]));
    out.messages = out.messages.map(cm => {
      const lm: any = localMsgs.get(cm.id);
      if (!lm) return cm;
      return {
        ...cm,
        audioBase64: lm.audioBase64 || (cm as any).audioBase64,
        imageUrl: cm.imageUrl && cm.imageUrl.length > 0 ? cm.imageUrl : lm.imageUrl,
        bannerImageUrl: cm.bannerImageUrl && cm.bannerImageUrl.length > 0 ? cm.bannerImageUrl : lm.bannerImageUrl,
      };
    });
  }
  if (localTab.activeSteamGame && out.activeSteamGame && localTab.activeSteamGame.appId === out.activeSteamGame.appId) {
    out.activeSteamGame = {
      ...out.activeSteamGame,
      achievements: localTab.activeSteamGame.achievements || out.activeSteamGame.achievements,
      patchNotes: localTab.activeSteamGame.patchNotes || out.activeSteamGame.patchNotes,
    };
  }
  return out;
}

function isAlive(tab: GameTab, deleted: Tombstones): boolean {
  const ts = deleted[tab.id];
  return ts === undefined || tabTime(tab) > ts;
}

const view = (tabs: GameTab[]): string => canonicalStringify(sanitizeTabsForCloud(tabs).sort(byOrder));

export function mergeTabState(local: TabState, cloud: TabState): MergeOutcome {
  // 1. Tombstones: union, newest wins.
  const union: Tombstones = { ...cloud.deleted };
  for (const [id, ts] of Object.entries(local.deleted)) union[id] = Math.max(union[id] || 0, ts);
  const deleted = capTombstones(union);

  // 2. Newest version of each tab.
  const chosen = new Map<string, GameTab>();
  const localById = new Map<string, GameTab>();
  for (const t of local.tabs || []) if (t && t.id && !isLegacyWelcomeTab(t)) localById.set(t.id, t);
  const cloudById = new Map<string, GameTab>();
  for (const t of cloud.tabs || []) if (t && t.id && !isLegacyWelcomeTab(t)) cloudById.set(t.id, t);

  for (const id of new Set([...localById.keys(), ...cloudById.keys()])) {
    const l = localById.get(id);
    const c = cloudById.get(id);
    if (l && !c) chosen.set(id, l);
    else if (c && !l) chosen.set(id, c);
    else if (l && c) chosen.set(id, compareVersions(l, c) >= 0 ? l : enrichFromLocal(c, l));
  }

  // 3. Alive tabs, in a deterministic order.
  const mergedTabs = [...chosen.values()].filter(t => isAlive(t, deleted)).sort(byOrder);
  const merged: TabState = { tabs: mergedTabs, deleted };

  // 4. Change detection. Compare the SANITIZED views so heavy local-only data never looks like a difference.
  const mergedView = view(mergedTabs);
  const localChanged = mergedView !== view(local.tabs || []) || canonicalStringify(deleted) !== canonicalStringify(local.deleted);
  // Ignore dead entries still sitting in the cloud array; only a real difference in the live view (or tombstones) needs a write.
  const cloudLive = (cloud.tabs || []).filter(t => t && t.id && !isLegacyWelcomeTab(t) && isAlive(t, deleted));
  const cloudChanged = mergedView !== view(cloudLive) || canonicalStringify(deleted) !== canonicalStringify(cloud.deleted);

  return {
    merged,
    localChanged,
    cloudChanged,
    reason: `merged ${local.tabs?.length ?? 0} local + ${cloud.tabs?.length ?? 0} cloud tabs into ${mergedTabs.length}`,
  };
}

// ---------- safety net ----------

/** Last line of defence: if uploads ever run away again, stop instead of hammering Firestore. */
export class UploadGovernor {
  private stamps: number[] = [];
  private blockedUntil = 0;
  constructor(private maxUploads = 8, private windowMs = 10_000, private cooldownMs = 30_000) {}

  allow(now: number = Date.now()): boolean {
    if (now < this.blockedUntil) return false;
    this.stamps = this.stamps.filter(t => now - t < this.windowMs);
    if (this.stamps.length >= this.maxUploads) {
      this.blockedUntil = now + this.cooldownMs;
      return false;
    }
    this.stamps.push(now);
    return true;
  }
}
