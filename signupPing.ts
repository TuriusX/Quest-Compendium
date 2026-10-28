/**
 * The owner's instant sign-up ping: a Discord message the first time a new account reaches the server (its first
 * /api/user/status), once per account (signupPings/{uid}, created only once). No email or name: how they signed in,
 * which app, and where they came from. The daily summary still counts sign-ups as before.
 *
 * Settings: DISCORD_SIGNUP_WEBHOOK_URL (falls back to DISCORD_WEBHOOK_URL, the pipeline's summary webhook); without
 * either, nothing is posted.
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { UserRecord } from 'firebase-admin/auth';

const PROVIDERS: Record<string, string> = { 'google.com': 'Google', 'password': 'email and password', 'emailLink': 'email link', 'apple.com': 'Apple', 'github.com': 'GitHub', 'microsoft.com': 'Microsoft' };
const APPS: Record<string, string> = { desktop: 'desktop app', web: 'web app', deck: 'Steam Deck' };

export function signupPingText(user: Pick<UserRecord, 'providerData' | 'metadata'>, app: string, src: string, now = Date.now()): string {
  const pid = user.providerData?.[0]?.providerId || '';
  const how = PROVIDERS[pid] || pid || 'unknown sign-in';
  const where = APPS[app] || (app ? app : 'web app');
  const mins = Math.round((now - Date.parse(user.metadata.creationTime)) / 60_000);
  const ago = mins >= 10 ? ` (account made ${mins < 120 ? `${mins} min` : `${Math.round(mins / 60)} h`} ago)` : '';
  const from = src && src !== 'untagged' && src !== 'desktop' ? `, from ${src}` : '';
  return `🆕 New account: ${how}, ${where}${from}${ago}.`;
}

/** Posts the ping once per account; quiet on any failure (the daily summary still counts the sign-up). */
export async function pingNewSignup(uid: string, user: UserRecord, app: string, src: string): Promise<void> {
  const hook = process.env.DISCORD_SIGNUP_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
  if (!hook) return;
  try {
    await getFirestore().collection('signupPings').doc(uid).create({ at: FieldValue.serverTimestamp() });
  } catch {
    return; // already pinged (or Firestore is down: no ping rather than a repeat)
  }
  await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: signupPingText(user, app, src) }) })
    .catch((e) => console.warn(`Sign-up ping failed: ${e?.message}`));
}
