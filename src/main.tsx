import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { lazy, Suspense } from 'react';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { captureSource } from './utils/source';
import { reloadOnNewVersion } from './utils/newVersionReload';

captureSource(); // ?from= on links into the app (website, stores, Discord)
reloadOnNewVersion(); // a new web app version: reload once, before anything is asked on this page
// The offline helper (service worker), on the website only: in the desktop app (files, no server) it only failed to
// fetch on every start (Nov 24 2026 audit).
if (!(window as any).electronAPI && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {}); });
} else if ('serviceWorker' in navigator) {
  // One an older desktop version registered goes.
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister())).catch(() => {});
}

// The new web app (src/web) is the web app for everyone (owner, Nov 25 2026: "i want the new app to show immediately for
// everyone"); never in the desktop app. The old screens stay for what only they do: the desktop app's browser sign-in
// (/desktop-login), the email sign-in link (/email-signin), the desktop settings window (#settings), the companion
// window (#companion), Steam linking (?steamId=), and anyone who picked "Use the old web app" (?new=0; ?new=1 undoes it).
const OLD_WEB = 'qcw_off';
const newWeb = (() => {
  if ((window as any).electronAPI) return false;
  try {
    const q = new URLSearchParams(location.search);
    const p = q.get('new');
    if (p === '0') localStorage.setItem(OLD_WEB, '1');
    if (p === '1') localStorage.removeItem(OLD_WEB);
    localStorage.removeItem('qcw_on'); // the switch from before it was the default
    if (p !== null) {
      const u = new URL(location.href);
      u.searchParams.delete('new');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    }
    const oldOnly = ['/email-signin', '/desktop-login'].includes(location.pathname) || /settings|companion/.test(location.hash) || q.has('steamId');
    return !oldOnly && localStorage.getItem(OLD_WEB) !== '1';
  } catch {
    return true;
  }
})();
const WebApp = lazy(() => import('./web/WebApp'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {newWeb ? (
        <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0c0d14' }} />}>
          <WebApp />
        </Suspense>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </StrictMode>,
);
