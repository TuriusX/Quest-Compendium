/** Playthrough memory on the account: users/{uid}/playthrough/{game} (see utils/playthrough.ts). */
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { emptyPlaythrough, playKey, type Playthrough } from './playthrough';

const cloudRef = (uid: string, game: string) => doc(db, 'users', uid, 'playthrough', playKey(game));

export async function readCloud(uid: string, game: string): Promise<Playthrough | null> {
  try {
    const snap = await getDoc(cloudRef(uid, game));
    const d: any = snap.exists() ? snap.data() : null;
    return d && Array.isArray(d.entries) ? { ...emptyPlaythrough(), ...d } : null;
  } catch {
    return null;
  }
}

export async function writeCloud(uid: string, game: string, p: Playthrough): Promise<void> {
  try {
    // A cleared game keeps only when it was cleared (no entries), so another computer's older copy can't bring the
    // entries back.
    await setDoc(cloudRef(uid, game), { ...p, game: String(game).slice(0, 160) });
  } catch (e: any) {
    console.warn('[playthrough] not saved to the account:', e?.message);
  }
}
