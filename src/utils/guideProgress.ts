/**
 * What the player has collected in a guide area: the ids of its ticked checklist entries, saved on this computer per
 * guide and area. Shared by the Guide's area pages and the objectives tracker, so a tick in one shows in the other:
 * every change fires a 'qc-guide-done' event ({ key, slug }) that both listen to.
 */
export const GUIDE_DONE_EVENT = 'qc-guide-done';
const doneKey = (key: string, slug: string) => `qc-guide-done:${key}:${slug}`;

export function readDone(key: string, slug: string): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(doneKey(key, slug)) || '[]'));
  } catch {
    return new Set<string>();
  }
}

export function writeDone(key: string, slug: string, done: Set<string>): void {
  try {
    localStorage.setItem(doneKey(key, slug), JSON.stringify([...done]));
  } catch {
    /* not remembered */
  }
  try {
    window.dispatchEvent(new CustomEvent(GUIDE_DONE_EVENT, { detail: { key, slug } }));
  } catch {
    /* no window (tests) */
  }
}

/** Tick or untick one entry. */
export function setEntryDone(key: string, slug: string, id: string, done: boolean): void {
  const next = readDone(key, slug);
  if (done) next.add(id);
  else next.delete(id);
  writeDone(key, slug, next);
}
