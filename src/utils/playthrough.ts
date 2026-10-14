/**
 * Playthrough memory (roadmap item 8): per game, per account, what Quest Compendium noted about the player's
 * playthrough, so answers fit their save. Shown in "Your playthrough", where the player can edit, delete or clear it,
 * and turned off in Settings ("Remember my playthrough"; off: nothing is noted or sent).
 *
 *   - choice: a choice the player made ("Sided with the druids"), from an answer's <qc-done> block
 *   - found:  a key item they have, from an answer or a ticked guide entry
 * What they've finished is the progress memory (settings.gameDone, utils/progressMemory.ts); where they are is the
 * tab's place and story point; their Notes can be added too (the Notes "Use in answers" switch).
 *
 * Stored on this computer (localStorage) and, signed in, in its own document per game, users/{uid}/playthrough/{game},
 * so the user record stays small. Two copies merge by entry id: an entry deleted on either side stays deleted
 * (`deleted`), and "Clear this game" (`clearedAt`) drops everything noted before it, on every device.
 */

export type PlayKind = 'choice' | 'found';
export type PlayEntry = { id: string; kind: PlayKind; text: string; source: 'answer' | 'guide' | 'you'; at: number };
export type Playthrough = { entries: PlayEntry[]; deleted: Record<string, number>; clearedAt: number; updatedAt: number; notesInAnswers?: boolean };

/** At most this many of each kind (choices, key items), newest kept: guide ticks never push out choices. */
export const PLAY_MAX = 20;
const capKinds = (list: PlayEntry[]) => {
  const n: Record<string, number> = {};
  return list.filter((e) => (n[e.kind] = (n[e.kind] || 0) + 1) <= PLAY_MAX);
};
export const PLAY_TEXT_MAX = 160;
/** What answers get: at most this many characters (choices first, then what was found, then the player's notes). */
export const PLAY_CONTEXT_MAX = 1200;
export const PLAYTHROUGH_EVENT = 'qc-playthrough';
export const OPEN_PLAYTHROUGH_EVENT = 'qc-open-playthrough';

export const emptyPlaythrough = (): Playthrough => ({ entries: [], deleted: {}, clearedAt: 0, updatedAt: 0 });
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, PLAY_TEXT_MAX);
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
/** The document id for a game: its name, lower case, letters and digits only. */
export const playKey = (game: string) => norm(game).replace(/\s+/g, '-').slice(0, 120) || 'unknown';

/** Add entries (newest first); the same text of the same kind isn't added twice. Capped at PLAY_MAX. */
export function addEntries(p: Playthrough, items: { kind: PlayKind; text: string; source: PlayEntry['source'] }[], now = Date.now()): Playthrough {
  const have = new Set(p.entries.map((e) => `${e.kind}:${norm(e.text)}`));
  const fresh: PlayEntry[] = [];
  for (const it of items) {
    const text = clean(it.text);
    const k = `${it.kind}:${norm(text)}`;
    if (text.length < 3 || have.has(k) || (it.kind !== 'choice' && it.kind !== 'found')) continue;
    have.add(k);
    fresh.push({ id: newId(), kind: it.kind, text, source: it.source, at: now });
  }
  if (!fresh.length) return p;
  return { ...p, entries: capKinds([...fresh, ...p.entries]), updatedAt: now };
}

export function editEntry(p: Playthrough, id: string, text: string, now = Date.now()): Playthrough {
  const t = clean(text);
  if (t.length < 2) return removeEntry(p, id, now);
  return { ...p, entries: p.entries.map((e) => (e.id === id ? { ...e, text: t, source: 'you', at: now } : e)), updatedAt: now };
}

export function removeEntry(p: Playthrough, id: string, now = Date.now()): Playthrough {
  return { ...p, entries: p.entries.filter((e) => e.id !== id), deleted: { ...p.deleted, [id]: now }, updatedAt: now };
}

export function clearPlaythrough(p: Playthrough, now = Date.now()): Playthrough {
  return { ...emptyPlaythrough(), clearedAt: now, updatedAt: now, ...(p.notesInAnswers === false ? { notesInAnswers: false } : {}) };
}

/** Two copies of the same game's playthrough (this computer's and the account's): merged by entry id. */
export function mergePlaythrough(a: Playthrough, b: Playthrough): Playthrough {
  const clearedAt = Math.max(a.clearedAt || 0, b.clearedAt || 0);
  const deleted: Record<string, number> = { ...(a.deleted || {}) };
  for (const [id, at] of Object.entries(b.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, at);
  const byId = new Map<string, PlayEntry>();
  for (const e of [...(a.entries || []), ...(b.entries || [])]) {
    if (deleted[e.id] || e.at < clearedAt) continue;
    const had = byId.get(e.id);
    if (!had || e.at > had.at) byId.set(e.id, e);
  }
  const newer = (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b;
  return {
    entries: capKinds([...byId.values()].sort((x, y) => y.at - x.at)),
    // Old deletions are dropped once nothing could bring the entry back (a month).
    deleted: Object.fromEntries(Object.entries(deleted).filter(([, at]) => at > Date.now() - 30 * 86_400_000)),
    clearedAt,
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
    ...(newer.notesInAnswers === false ? { notesInAnswers: false } : {}),
  };
}

/** What a question sends: choices first, then what was found, then the player's notes; at most PLAY_CONTEXT_MAX characters. */
export function playthroughForRequest(p: Playthrough | null | undefined, notes?: string): { choices: string[]; found: string[]; notes: string } | null {
  if (!p) return null;
  let room = PLAY_CONTEXT_MAX;
  const take = (list: string[]) => list.filter((t) => (room -= t.length + 3) >= 0);
  const choices = take(p.entries.filter((e) => e.kind === 'choice').map((e) => e.text));
  const found = take(p.entries.filter((e) => e.kind === 'found').map((e) => e.text));
  // The Notes are rich text: only their words go.
  const n = p.notesInAnswers === false ? '' : String(notes || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, Math.max(0, room));
  return choices.length || found.length || n ? { choices, found, notes: n } : null;
}

// ---- storage: this computer, and the account ----
const localKey = (owner: string, game: string) => `qc-playthrough:${owner}:${playKey(game)}`;

export function readLocal(owner: string, game: string): Playthrough {
  try {
    const raw = JSON.parse(localStorage.getItem(localKey(owner, game)) || 'null');
    return raw && Array.isArray(raw.entries) ? { ...emptyPlaythrough(), ...raw } : emptyPlaythrough();
  } catch {
    return emptyPlaythrough();
  }
}

export function writeLocal(owner: string, game: string, p: Playthrough): void {
  try {
    localStorage.setItem(localKey(owner, game), JSON.stringify(p));
  } catch {
    /* not remembered on this computer */
  }
}
