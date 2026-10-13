/**
 * How many times the app has been opened on this device, this launch included (counted once per launch). First-run
 * hints (the screenshot shortcut under the question box) show only for the first few sessions.
 */
let counted: number | null = null;

export function sessionCount(): number {
  if (counted !== null) return counted;
  try {
    const prev = Number(localStorage.getItem('qc_sessions') || '0') || 0;
    // A reload in the same launch is not a new session.
    if (sessionStorage.getItem('qc_session_counted')) counted = Math.max(prev, 1);
    else {
      counted = prev + 1;
      localStorage.setItem('qc_sessions', String(counted));
      sessionStorage.setItem('qc_session_counted', '1');
    }
  } catch {
    counted = 1;
  }
  return counted;
}

/** The first five sessions show the screenshot shortcut hint. */
export const showFirstRunHints = () => sessionCount() <= 5;
