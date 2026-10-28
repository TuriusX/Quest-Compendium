import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ChatMessage, GamePlaythrough, GameSpace } from '../types';
import { canonicalStringify, removeUndefinedFields } from '../hooks/tabMerge';
import { emptySpaces, ptKey, type SpacesState } from './spacesStore';

/**
 * Game spaces on the account (games-not-tabs phase 2, behind the flag): one document per game,
 * users/{uid}/games/{gameId}, and one per playthrough, users/{uid}/games/{gameId}/playthroughs/{ptId}, so no document
 * holds everything (the old tabs array shared one 1 MB document); users/{uid}/games/_meta keeps the migration's map.
 * Only what changed is written. Two copies merge per game and per playthrough: the newer one's fields, every message
 * of both (by id), and deletes (tombstones) win over older edits.
 */

const META = '_meta';
/** A playthrough document stays under this many bytes (Firestore's limit is 1 MiB): the oldest messages stay local. */
const PT_MAX_BYTES = 850_000;

/** What goes to the account: no read-aloud audio, no full-size pictures (they stay on this computer). */
function cloudMessages(list: ChatMessage[]): ChatMessage[] {
  return (list || []).map((m) => {
    const x: any = { ...m };
    delete x.audioBase64;
    if (x.imageUrl && x.imageUrl.length > 2000) delete x.imageUrl;
    if (x.bannerImageUrl && x.bannerImageUrl.length > 2000) delete x.bannerImageUrl;
    return x;
  });
}

export function cloudPt(p: GamePlaythrough): GamePlaythrough {
  let messages = cloudMessages(p.messages);
  let out: GamePlaythrough = removeUndefinedFields({ ...p, messages });
  while (messages.length > 1 && JSON.stringify(out).length > PT_MAX_BYTES) {
    messages = messages.slice(Math.ceil(messages.length / 10));
    out = { ...out, messages, trimmed: true } as any;
  }
  return out;
}

function cloudGame(g: GameSpace, deletedAt?: number): any {
  const x: any = { ...g };
  if (x.activeSteamGame) {
    const s = { ...x.activeSteamGame };
    delete s.achievements;
    delete s.patchNotes;
    x.activeSteamGame = s;
  }
  return removeUndefinedFields({ ...x, ...(deletedAt ? { deletedAt } : {}) });
}

export async function loadCloudSpaces(uid: string): Promise<SpacesState | null> {
  const snap = await getDocs(collection(db, 'users', uid, 'games'));
  if (snap.empty) return null;
  const s = emptySpaces();
  for (const d of snap.docs) {
    const x: any = d.data();
    if (d.id === META) {
      s.tabMap = x.tabMap || {};
      s.migratedAt = Number(x.migratedAt) || 0;
      continue;
    }
    if (x.deletedAt) s.deleted[d.id] = Number(x.deletedAt);
    const { deletedAt, ...game } = x;
    s.games.push({ ...(game as GameSpace), id: d.id });
    const pts = await getDocs(collection(db, 'users', uid, 'games', d.id, 'playthroughs'));
    for (const p of pts.docs) s.playthroughs.push({ ...(p.data() as GamePlaythrough), id: p.id, gameId: d.id });
  }
  return s;
}

/** Every message of both copies (by id, the fuller text), by time; a playthrough's own fields from the newer copy. */
function mergePt(a: GamePlaythrough, b: GamePlaythrough): GamePlaythrough {
  const [newer, older] = (b.lastActive || 0) > (a.lastActive || 0) ? [b, a] : [a, b];
  const byId = new Map<string, ChatMessage>();
  for (const m of [...older.messages, ...newer.messages]) {
    if (!m?.id) continue;
    const had = byId.get(m.id);
    byId.set(m.id, !had ? m : { ...had, ...m, ...(String(had.text || '').length > String(m.text || '').length ? { text: had.text } : {}), imageUrl: m.imageUrl || had.imageUrl, audioBase64: (m as any).audioBase64 || (had as any).audioBase64 } as ChatMessage);
  }
  return { ...newer, messages: [...byId.values()].sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0)), lastActive: Math.max(a.lastActive || 0, b.lastActive || 0) };
}

export function mergeSpaces(local: SpacesState, cloud: SpacesState | null): SpacesState {
  if (!cloud) return local;
  const deleted = { ...cloud.deleted };
  for (const [k, v] of Object.entries(local.deleted)) deleted[k] = Math.max(v, deleted[k] || 0);
  const games = new Map<string, GameSpace>();
  for (const g of [...cloud.games, ...local.games]) {
    const had = games.get(g.id);
    games.set(g.id, !had ? g : (g.lastActive || 0) >= (had.lastActive || 0) ? { ...had, ...g, fromTabs: [...new Set([...had.fromTabs, ...g.fromTabs])] } : { ...g, ...had, fromTabs: [...new Set([...had.fromTabs, ...g.fromTabs])] });
  }
  const pts = new Map<string, GamePlaythrough>();
  for (const p of [...cloud.playthroughs, ...local.playthroughs]) {
    const k = ptKey(p.gameId, p.id);
    const had = pts.get(k);
    pts.set(k, had ? mergePt(had, p) : p);
  }
  return {
    games: [...games.values()],
    playthroughs: [...pts.values()],
    deleted,
    tabMap: { ...cloud.tabMap, ...local.tabMap },
    migratedAt: Math.min(...[local.migratedAt, cloud.migratedAt].filter((x) => x > 0)) || 0,
    alias: { ...(cloud.alias || {}), ...(local.alias || {}) },
  };
}

/**
 * Writes what changed since the last save (`saved`: document path → its JSON, kept by the caller). Returns how many
 * documents were written.
 */
export async function saveCloudSpaces(uid: string, s: SpacesState, saved: Map<string, string>): Promise<number> {
  let n = 0;
  const put = async (path: string[], data: any) => {
    const key = path.join('/');
    const json = canonicalStringify(data);
    if (saved.get(key) === json) return;
    await setDoc(doc(db, 'users', uid, ...(path as [string])), data);
    saved.set(key, json);
    n++;
  };
  await put(['games', META], { tabMap: s.tabMap, migratedAt: s.migratedAt });
  for (const g of s.games) await put(['games', g.id], cloudGame(g, s.deleted[g.id]));
  for (const p of s.playthroughs) {
    if (!s.games.some((g) => g.id === p.gameId)) continue;
    await put(['games', p.gameId, 'playthroughs', p.id], cloudPt(p));
  }
  return n;
}
