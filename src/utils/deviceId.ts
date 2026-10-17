/**
 * A random id this app keeps (never tied to the hardware), sent as X-QC-Device: free accounts used on one device share
 * one day of free questions (emailSignIn.ts on the server). Only a one-way fingerprint of it is stored there.
 */
const KEY = 'qc_device_id';

export function deviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = 'd_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}
