/**
 * Your playthrough in the new web app: the same record as the desktop app's "Your playthrough" (src/utils/playthrough.ts),
 * on this device and, signed in, on the account (users/{uid}/playthrough/{game}), so both apps show and update one
 * record. After each answer its own small call (POST /api/save-state, well under $0.001; the old app makes the same
 * call) updates who the player is, their party, the story so far and what's still open.
 */
import { addEntries, clearPlaythrough, editState, emptyPlaythrough, mergePlaythrough, readLocal, removeEntry, setState, writeLocal, type PlayKind, type Playthrough } from '../utils/playthrough';
import { readCloud, writeCloud } from '../utils/playthroughCloud';
import { getApiBaseUrl } from '../utils/api';
import type { Who } from './webApi';

export const ownerOf = (w: Who) => w.user?.uid || w.guestId || 'guest';

export async function loadPlay(w: Who, game: string): Promise<Playthrough> {
  const local = readLocal(ownerOf(w), game);
  if (!w.user) return local;
  const cloud = await readCloud(w.user.uid, game);
  const merged = cloud ? mergePlaythrough(local, cloud) : local;
  writeLocal(ownerOf(w), game, merged);
  return merged;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function savePlay(w: Who, game: string, p: Playthrough): void {
  writeLocal(ownerOf(w), game, p);
  if (!w.user) return;
  const uid = w.user.uid;
  const k = `${uid}:${game}`;
  const old = timers.get(k);
  if (old) clearTimeout(old);
  timers.set(k, setTimeout(() => void writeCloud(uid, game, p), 800));
}

export { addEntries, clearPlaythrough, editState, emptyPlaythrough, removeEntry, setState, type PlayKind, type Playthrough };

/** The save record updated from one answer; null when the call fails (the old record stays). */
export async function fetchSaveState(w: Who, x: { game: string; question: string; answer: string; image?: string; place: string; story: string; done: string[]; play: Playthrough; guideKey?: string }): Promise<unknown | null> {
  try {
    const tok = w.user ? await w.user.getIdToken().catch(() => null) : w.guestId;
    const p = x.play;
    const res = await fetch(`${getApiBaseUrl()}/api/save-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify({
        game: x.game, question: x.question, answer: x.answer.slice(0, 8000), place: x.place, story: x.story, done: x.done,
        ...(x.image && x.image.startsWith('data:image') ? { imageBase64: x.image } : {}),
        old: p.state ? { who: p.state.who, party: p.state.party, story: p.state.story, open: p.state.open, edited: !!p.state.edited } : null,
        choices: p.entries.filter((e) => e.kind === 'choice').map((e) => e.text),
        found: p.entries.filter((e) => e.kind === 'found').map((e) => e.text),
        ...(x.guideKey ? { guideKey: x.guideKey } : {}),
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.state || null;
  } catch {
    return null;
  }
}
