import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { captureSource } from './utils/source';
import { reloadOnNewVersion } from './utils/newVersionReload';

captureSource(); // ?from= on links into the app (website, stores, Discord)
reloadOnNewVersion(); // a new web app version: reload once, before anything is asked on this page

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
