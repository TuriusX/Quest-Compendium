/**
 * Per-guide locks, so no two processes (the daily pipeline, the flagship job, a manual run, a local test) build,
 * repair, promote or publish the same guide at once. A lock is a Firestore document, guideLocks/{key}, taken in a
 * transaction: who holds it, since when, and until when. The holder renews it every few minutes while it's alive and
 * releases it when done; if the process dies, the lock simply expires (LOCK_TTL).
 *
 * A process's child scripts share its lock (GUIDE_LOCK_OWNER is inherited), so the pipeline's repair.ts doesn't lock
 * itself out; a child never releases a lock its parent took. The site-wide publish (publish.ts and the Netlify deploy)
 * uses the key SITE_LOCK.
 */
import os from 'os';
import crypto from 'crypto';
import { db } from './common';

export const LOCK_TTL = 45 * 60_000;
const RENEW_EVERY = 5 * 60_000;
export const SITE_LOCK = '_site'; // (ids like __x__ are reserved in Firestore)

/** This process tree's lock owner (inherited by child scripts), and how it describes itself to others. */
if (!process.env.GUIDE_LOCK_OWNER) process.env.GUIDE_LOCK_OWNER = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;
const OWNER = process.env.GUIDE_LOCK_OWNER;
export const lockLabel = () =>
  process.env.GUIDE_LOCK_LABEL ||
  (process.env.CLOUD_RUN_JOB ? `${process.env.CLOUD_RUN_JOB} (${process.env.CLOUD_RUN_EXECUTION || 'job'})` : `a local run on ${os.hostname()}`);

export type GuideLock = { key: string; release: () => Promise<void> };
export type LockRefusal = { key: string; heldBy: string; until: number };

const held = new Map<string, { timer: NodeJS.Timeout; reentrant: boolean }>();
const ref = (key: string) => db().collection('guideLocks').doc(key.replace(/--next$/, '').replace(/\//g, '_'));

/**
 * Take the lock on a guide (its live key; a staged copy counts as the same guide). Returns the lock, or who holds it.
 * Re-entrant for the same process tree.
 */
export async function acquireGuideLock(key: string, what = ''): Promise<GuideLock | LockRefusal> {
  const r = ref(key);
  const now = Date.now();
  let refusal: LockRefusal | null = null;
  let reentrant = false;
  await db().runTransaction(async (t) => {
    const d: any = (await t.get(r)).data();
    if (d && d.expiresAt > now && d.owner !== OWNER) {
      refusal = { key, heldBy: String(d.label || 'another process'), until: Number(d.expiresAt) };
      return;
    }
    reentrant = !!d && d.owner === OWNER && d.expiresAt > now;
    t.set(r, { owner: OWNER, label: lockLabel(), what: what || d?.what || '', at: reentrant ? d.at : now, expiresAt: now + LOCK_TTL });
  });
  if (refusal) return refusal;
  if (!held.has(key)) {
    // Renewed while this process lives (unref: it never keeps a finished process alive).
    const timer = setInterval(() => { r.set({ expiresAt: Date.now() + LOCK_TTL }, { merge: true }).catch(() => {}); }, RENEW_EVERY);
    timer.unref();
    held.set(key, { timer, reentrant });
  }
  return {
    key,
    release: async () => {
      const h = held.get(key);
      if (!h) return;
      clearInterval(h.timer);
      held.delete(key);
      if (h.reentrant) return; // the parent took it; the parent releases it
      await db().runTransaction(async (t) => {
        const d: any = (await t.get(r)).data();
        if (d && d.owner === OWNER) t.delete(r);
      }).catch(() => {});
    },
  };
}

export const isRefusal = (l: GuideLock | LockRefusal): l is LockRefusal => 'heldBy' in l;
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
/** The standard line for an item skipped because its guide was locked (the pipeline reads "Skipped (locked)"). */
export const lockedLine = (r: LockRefusal, game = r.key) => `Skipped (locked): ${game} is being worked on by ${r.heldBy} (lock until ${hhmm(r.until)} UTC); tried again next run.`;

/** Wait for a lock (polling), up to maxWaitMs; null if it's still held then. */
export async function waitForGuideLock(key: string, what: string, maxWaitMs: number): Promise<GuideLock | LockRefusal> {
  const until = Date.now() + maxWaitMs;
  for (;;) {
    const l = await acquireGuideLock(key, what);
    if (!isRefusal(l) || Date.now() > until) return l;
    await new Promise((res) => setTimeout(res, 20_000));
  }
}

/** Run fn holding the guide's lock; if another process holds it, returns the refusal without running fn. */
export async function withGuideLock<T>(key: string, what: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; refusal: LockRefusal }> {
  const l = await acquireGuideLock(key, what);
  if (isRefusal(l)) return { ok: false, refusal: l };
  try {
    return { ok: true, value: await fn() };
  } finally {
    await l.release();
  }
}

/**
 * Release every lock this process took (scripts call this before they exit; process.exit skips exit hooks, and a
 * killed process lets its locks expire instead).
 */
export async function releaseGuideLocks() {
  for (const [key, h] of held) {
    clearInterval(h.timer);
    if (h.reentrant) continue;
    await ref(key).get().then((s) => (s.data()?.owner === OWNER ? s.ref.delete() : undefined)).catch(() => {});
  }
  held.clear();
}
