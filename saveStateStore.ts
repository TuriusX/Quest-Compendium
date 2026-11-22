/**
 * The save record on the server (owner, Nov 21 2026: the Steam Deck gets it too). The desktop app keeps the record in
 * the player's playthrough, users/{uid}/playthrough/{playKey(game)} (src/utils/playthroughCloud.ts), and sends it with
 * every question. The Deck sends none: for its questions the server reads the stored record and, after the answer,
 * updates it the same way (/api/save-state's call). Both apps then share one record per game; the desktop's "Your save
 * right now" panel shows and edits it.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { cleanState, emptyPlaythrough, playKey, type SaveState } from './src/utils/playthrough';

const ref = (uid: string, game: string) => getFirestore().collection('users').doc(uid).collection('playthrough').doc(playKey(game));

/** The stored record for this game, or null (none yet, or the read failed: the answer never waits on an error). */
export async function readSaveState(uid: string, game: string): Promise<SaveState | null> {
  if (!uid || !game) return null;
  try {
    const d: any = (await ref(uid, game).get()).data();
    return d?.state ? cleanState(d.state) : null;
  } catch {
    return null;
  }
}

/**
 * Store an updated record, as the desktop's setState does: not over a newer one (another answer or the player's own
 * edit since this question was asked), and a player's edit stays marked as theirs. A new document gets the
 * playthrough's empty fields, so the desktop reads it like its own.
 */
export async function writeSaveState(uid: string, game: string, next: unknown, askedAt: number, now = Date.now()): Promise<boolean> {
  if (!uid || !game) return false;
  const st = cleanState({ ...(next as object), at: now }, now);
  if (!st) return false;
  try {
    return await getFirestore().runTransaction(async (tx) => {
      const r = ref(uid, game);
      const snap = await tx.get(r);
      const d: any = snap.exists ? snap.data() : null;
      const old = d?.state ? cleanState(d.state) : null;
      if (old && Math.max(old.at, old.edited || 0) > askedAt) return false;
      if (old?.edited) st.edited = old.edited;
      if (d) tx.set(r, { state: st, updatedAt: now }, { merge: true });
      else tx.set(r, { ...emptyPlaythrough(), state: st, updatedAt: now, game: String(game).slice(0, 160) });
      return true;
    });
  } catch {
    return false;
  }
}
