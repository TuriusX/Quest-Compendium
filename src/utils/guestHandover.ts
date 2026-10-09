/**
 * A guest who signs in keeps what they did as a guest: their conversations (tabs, with the quest log's steps and personal
 * quests), where they are in each game and what they've done (settings.gameProgress / gameDone), and their guide ticks.
 *
 * At sign-in (any way: popup, redirect, the desktop app's browser sign-in) the guest's data is put aside in
 * localStorage (qc_guest_handover) before the guest session ends; when the account's cloud copy first loads
 * (hooks/useCloudSync.ts), it's merged in and uploaded with the account, then cleared. Merging never drops anything the
 * account already had: tabs are added by id, places and done lists are combined, ticks are unioned.
 */
import type { AppSettings, GameTab } from '../types';
import type { DoneItem } from './progressMemory';
import { DONE_MAX } from './progressMemory';
import { exportAllDone } from './guideProgress';

const KEY = 'qc_guest_handover';
const MAX_AGE = 7 * 86_400_000;
const WELCOME = (t: GameTab) => !t || t.id === 'guest-welcome-compendium' || t.name === 'Welcome, Explorer';

export type GuestHandover = {
  tabs: GameTab[];
  gameProgress?: AppSettings['gameProgress'];
  gameDone?: AppSettings['gameDone'];
  guideDone?: Record<string, string[]>;
  at: number;
};

/** Conversations: the account's, plus the guest's ones it doesn't have yet (by id). */
export function mergeHandoverTabs(tabs: GameTab[], h: GuestHandover | null): GameTab[] {
  if (!h?.tabs?.length) return tabs;
  const have = new Set(tabs.map((t) => t.id));
  return [...tabs, ...h.tabs.filter((t) => !WELCOME(t) && !have.has(t.id))];
}

/** Ticks per guide page ("key:slug" -> ids), unioned. */
export function unionDone(a: Record<string, string[]> | undefined, b: Record<string, string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const src of [a || {}, b || {}]) {
    for (const [k, ids] of Object.entries(src)) {
      if (!Array.isArray(ids)) continue;
      out[k] = [...new Set([...(out[k] || []), ...ids.map(String)])];
    }
  }
  return out;
}

/**
 * Settings: where the player is (the guest's newer place wins for a game both have), what they've done (combined, most
 * recent first, no repeats), and guide ticks (unioned).
 */
export function mergeHandoverSettings(settings: AppSettings, h: GuestHandover | null): AppSettings {
  if (!h) return settings;
  const out: AppSettings = { ...settings };
  if (h.gameProgress && Object.keys(h.gameProgress).length) out.gameProgress = { ...(settings.gameProgress || {}), ...h.gameProgress };
  if (h.gameDone && Object.keys(h.gameDone).length) {
    const done: Record<string, DoneItem[]> = { ...(settings.gameDone || {}) };
    for (const [game, items] of Object.entries(h.gameDone)) {
      const seen = new Set<string>();
      done[game] = [...(items || []), ...(done[game] || [])]
        .sort((x, y) => (y?.at || 0) - (x?.at || 0))
        .filter((x) => {
          const k = `${x?.kind}:${String(x?.text || '').toLowerCase()}`;
          if (!x || seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, DONE_MAX);
    }
    out.gameDone = done;
  }
  if (h.guideDone && Object.keys(h.guideDone).length) out.guideDone = unionDone(settings.guideDone, h.guideDone);
  return out;
}

/** Put the guest's data aside (only while a guest session is on). Call it before the guest session is removed. */
export function saveGuestHandover(): void {
  try {
    if (!localStorage.getItem('quest_guest_session')) return;
    const tabs = JSON.parse(localStorage.getItem('quest_guest_tabs') || '[]');
    const settings = JSON.parse(localStorage.getItem('quest_compendium_settings') || '{}');
    const h: GuestHandover = {
      tabs: Array.isArray(tabs) ? tabs.filter((t: GameTab) => !WELCOME(t)) : [],
      gameProgress: settings?.gameProgress,
      gameDone: settings?.gameDone,
      guideDone: exportAllDone(),
      at: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    /* nothing to keep */
  }
}

export function readGuestHandover(): GuestHandover | null {
  try {
    const h = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!h || typeof h !== 'object' || !(Date.now() - Number(h.at) < MAX_AGE)) return null;
    return { ...h, tabs: Array.isArray(h.tabs) ? h.tabs : [] };
  } catch {
    return null;
  }
}

/** Merged into the account: the guest's copy goes. */
export function clearGuestHandover(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem('quest_guest_tabs');
  } catch {
    /* ignore */
  }
}
