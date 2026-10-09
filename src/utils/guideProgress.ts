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

const PREFIX = 'qc-guide-done:';

/** Every guide page's ticks on this device ("key:slug" -> ids), for the account's synced copy (settings.guideDone). */
export function exportAllDone(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const ids = JSON.parse(localStorage.getItem(k) || '[]');
      if (Array.isArray(ids) && ids.length) out[k.slice(PREFIX.length)] = ids.map(String);
    }
  } catch {
    /* nothing readable */
  }
  return out;
}

/**
 * The account's ticks onto this device (from settings.guideDone, synced across the player's devices), added to what
 * this device has (never removing a tick, so two devices that both have ticks end up with all of them). Fires the
 * usual event per changed page.
 */
export function importAllDone(all: Record<string, string[]>): void {
  const local = exportAllDone();
  for (const [k, ids] of Object.entries(all || {})) {
    if (!Array.isArray(ids)) continue;
    const cur = local[k] || [];
    const next = [...new Set([...cur, ...ids.map(String)])];
    if (next.length === cur.length) continue;
    const at = k.indexOf(':');
    if (at > 0) writeDone(k.slice(0, at), k.slice(at + 1), new Set(next));
  }
}
