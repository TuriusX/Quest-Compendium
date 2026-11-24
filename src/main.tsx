import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
