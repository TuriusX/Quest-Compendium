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

// The new web app (src/web, owner Nov 25 2026), on the website only, behind a switch while it's built: ?new=1 turns it
// on for this browser, ?new=0 back off.
const NEW_WEB = 'qcw_on';
const newWeb = (() => {
  if ((window as any).electronAPI) return false;
  try {
    const p = new URLSearchParams(location.search).get('new');
    if (p === '1') localStorage.setItem(NEW_WEB, '1');
    if (p === '0') localStorage.removeItem(NEW_WEB);
    if (p !== null) {
      const u = new URL(location.href);
      u.searchParams.delete('new');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    }
    return localStorage.getItem(NEW_WEB) === '1';
  } catch {
    return false;
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
