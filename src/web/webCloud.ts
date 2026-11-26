/**
 * The new web app and the account (signed in only): the same game spaces as the desktop app and the old web app
 * (users/{uid}.tabs, src/hooks/useCloudSync.ts). A question asked here lands in that game's space, so it's in the
 * desktop app's conversation too, and the desktop's questions show here. Written the same safe way as the old app:
 * inside a transaction that reads the account's current copy and merges by tab and message (src/hooks/tabMerge.ts), so
 * another device's changes are never written over. Guests keep their games on this device only (webStore.ts).
 */
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cleanTombstones, mergeTabState, removeUndefinedFields, sanitizeTabsForCloud, type TabState } from '../hooks/tabMerge';
import type { ChatMessage, GameTab } from '../types';
import type { Game, Place, Turn } from './webApi';

const key = (s: string) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[™®©:'’.\-]/g, '').replace(/\s+/g, ' ').trim();

/** The account's game spaces, newest first (the desktop's and this app's). */
export async function cloudTabs(uid: string): Promise<GameTab[]> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const data: any = snap.exists() ? snap.data() : {};
    const deleted = cleanTombstones(data.deletedTabs);
    const tabs: GameTab[] = (Array.isArray(data.tabs) ? data.tabs : []).filter((t: any) => t && t.id && t.name && (deleted[t.id] === undefined || (t.lastActive || 0) > deleted[t.id]));
    return tabs.sort((a, b) => (b.lastActive || b.createdAt || 0) - (a.lastActive || a.createdAt || 0));
  } catch {
    return [];
  }
}

/** The space for this game: by name (the space's own, or the Steam game's), or none yet. */
export function tabFor(tabs: GameTab[], game: Game): GameTab | undefined {
  const k = key(game.name);
  return tabs.find((t) => key(t.name) === k || key(t.activeSteamGame?.name || '') === k)
    || (game.appId && game.appId < 900_000_000 ? tabs.find((t) => Number(t.activeSteamGame?.appId) === game.appId) : undefined);
}

/** A space's conversation as questions and answers (the last few). */
export function turnsOf(tab: GameTab, max = 20): Turn[] {
  const out: Turn[] = [];
  const msgs = (tab.messages || []).filter((m) => m && !m.aside && (m.role === 'user' || m.role === 'assistant'));
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== 'user') continue;
    const a = msgs[i + 1]?.role === 'assistant' ? msgs[i + 1] : undefined;
    const q = String(m.text || '').trim();
    out.push({
      id: `c-${m.id}`,
      q: q || 'About your screenshot',
      at: m.timestamp || 0,
      ...(a && typeof a.text === 'string' && a.modelUsed !== 'Limit Reached' ? { answer: a.text, sources: a.sourceLinks, visual: a.visual, guideRefs: (a as any).guideRefs } : {}),
      ...(a && a.modelUsed === 'Limit Reached' ? { problem: { text: String(a.text || '') } } : {}),
    });
  }
  return out.filter((t) => t.answer || t.problem).slice(-max);
}

export function placeOf(tab?: GameTab): Place | null {
  return tab?.place?.name ? { ...tab.place } : null;
}

/**
 * Adds one question and its answer to this game's space (made if there's none), with where the player is now. Returns
 * the space's id. Never throws: a failure only means this question stays on this device.
 */
/**
 * The account's spaces with one question and its answer added to this game's space (made if there's none), and where
 * the player is now: the same merge as the old app's upload (this one space is the newer copy; every other space stays
 * as it is). Pure, so it can be checked without the account.
 */
export function withTurn(cloud: TabState, game: Game, turn: Turn, place: Place | null, now = Date.now()): { tabs: GameTab[]; deleted: TabState['deleted']; changed: boolean; id: string } {
  const user: ChatMessage = { id: `w${turn.id}-q`, role: 'user', text: turn.voice ? '🎤 Voice question' : turn.q, timestamp: turn.at } as ChatMessage;
  const ai: ChatMessage = removeUndefinedFields({
    id: `w${turn.id}-a`, role: 'assistant', text: turn.answer, timestamp: Math.max(now, turn.at + 1), modelUsed: 'web',
    ...(turn.sources?.length ? { sourceLinks: turn.sources } : {}),
    ...(turn.visual ? { visual: turn.visual } : {}),
  }) as ChatMessage;
  const live = cloud.tabs.filter((t) => t && t.id && (cloud.deleted[t.id] === undefined || (t.lastActive || 0) > cloud.deleted[t.id]));
  const cur = tabFor(live, game);
  const base: GameTab = cur || ({
    id: `tab-${now}`,
    name: game.name,
    activeSteamGame: { name: game.name, appId: game.appId || 0, ...(game.art ? { headerImage: game.art } : {}), achievements: [], totalAchievements: 0, unlockedAchievements: 0 },
    messages: [],
    notes: '',
    createdAt: now,
    lastActive: now,
  } as unknown as GameTab);
  const have = new Set((base.messages || []).map((m) => m.id));
  const next: GameTab = {
    ...base,
    messages: [...(base.messages || []), ...[user, ai].filter((m) => !have.has(m.id))],
    lastActive: now,
    ...(place?.name ? { place: { ...(base.place || {}), ...place, name: String(place.name), confirmed: !!(base.place?.confirmed && base.place.name === place.name), checkedAt: now } as any } : {}),
  };
  const result = mergeTabState({ tabs: [next], deleted: {} }, cloud);
  return { tabs: result.merged.tabs, deleted: result.merged.deleted, changed: result.cloudChanged, id: next.id };
}

/**
 * Adds one question and its answer to this game's space on the account. Returns the space's id. Never throws: a
 * failure only means this question stays on this device.
 */
export async function addTurn(uid: string, game: Game, turn: Turn, place: Place | null): Promise<string | null> {
  if (!turn.answer) return null;
  const ref = doc(db, 'users', uid);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data: any = snap.exists() ? snap.data() : {};
      const now = Date.now();
      const r = withTurn({ tabs: Array.isArray(data.tabs) ? data.tabs : [], deleted: cleanTombstones(data.deletedTabs) }, game, turn, place, now);
      if (r.changed) tx.set(ref, removeUndefinedFields({ tabs: sanitizeTabsForCloud(r.tabs), deletedTabs: r.deleted, updatedAt: now }), { mergeFields: ['tabs', 'deletedTabs', 'updatedAt'] });
      return r.id;
    });
  } catch (e: any) {
    console.warn('[web] not saved to the account:', e?.message);
    return null;
  }
}
