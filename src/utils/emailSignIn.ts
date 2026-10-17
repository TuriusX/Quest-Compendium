/**
 * Signing in with an email link (the server's emailSignIn.ts sends it through Firebase).
 *
 * Web: the link opens /email-signin in the browser and signs that browser in (the address is remembered here, so the
 * same browser doesn't ask for it again).
 * Desktop app: it gets a device code first (/api/device/start, the Steam Deck's sign-in) and the email's link asks
 * "Sign in the device showing this code?". On Yes the app, which has been checking, signs in with a one-time pass.
 */
import { getApiBaseUrl } from './api';

export const EMAIL_FOR_SIGNIN = 'qc_email_for_signin';

export type SendResult = 'ok' | 'bad_email' | 'too_many' | 'failed';

export async function sendEmailLink(email: string, lang: string, userCode?: string): Promise<SendResult> {
  try {
    const r = await fetch(`${getApiBaseUrl()}/api/email-link/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), lang, ...(userCode ? { userCode } : {}) }),
    });
    if (r.ok) {
      try { localStorage.setItem(EMAIL_FOR_SIGNIN, email.trim()); } catch { /* asked again on the page */ }
      return 'ok';
    }
    const body: any = await r.json().catch(() => ({}));
    return body.error === 'bad_email' ? 'bad_email' : body.error === 'too_many' ? 'too_many' : 'failed';
  } catch {
    return 'failed';
  }
}

export type DeviceCode = { deviceCode: string; userCode: string; interval: number; expiresAt: number };

/** A code for this device (the email's page asks to confirm it). */
export async function startDeviceCode(): Promise<DeviceCode | null> {
  try {
    const r = await fetch(`${getApiBaseUrl()}/api/device/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) return null;
    const b = await r.json();
    return { deviceCode: b.deviceCode, userCode: b.userCode, interval: Math.max(2, Number(b.interval) || 3), expiresAt: Date.now() + (Number(b.expiresIn) || 600) * 1000 };
  } catch {
    return null;
  }
}

/**
 * Checks until the code is confirmed: the one-time pass (a Firebase custom token), or null when it expired or was
 * stopped (stop() ends it).
 */
export function waitForDevice(code: DeviceCode, onDone: (customToken: string | null) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped) return;
    if (Date.now() > code.expiresAt) { onDone(null); return; }
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/device/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode: code.deviceCode, custom: true }),
      });
      const b: any = await r.json().catch(() => ({}));
      if (stopped) return;
      if (b.status === 'linked' && b.customToken) { onDone(b.customToken); return; }
      if (b.status === 'expired') { onDone(null); return; }
    } catch { /* offline for a moment: keep checking */ }
    timer = setTimeout(tick, code.interval * 1000);
  };
  timer = setTimeout(tick, code.interval * 1000);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
