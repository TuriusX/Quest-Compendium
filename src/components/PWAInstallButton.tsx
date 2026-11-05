import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download } from './icons';
import { useT } from '../i18n';

/**
 * "Install app" in the ⋯ menu (owner, Nov 5 2026: it was its own icon in the header). The header holds the install state
 * (usePWAInstall), because the menu isn't mounted when the browser offers the install.
 */
export const PWAInstallButton: React.FC<{ className: string; state: { isInstallable: boolean; isInstalled: boolean; isIOS: boolean; install: () => unknown }; onDone: () => void }> = ({ className, state, onDone }) => {
  const t = useT();
  const { isInstallable, isInstalled, isIOS, install } = state;
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled || (!isInstallable && !isIOS)) return null;
  const closeGuide = () => {
    setShowIOSGuide(false);
    onDone();
  };
  return (
    <>
      <button
        type="button"
        role="menuitem"
        // iOS Safari has no install prompt: how to add it to the home screen. Everywhere else, the browser's own prompt.
        onClick={() => {
          if (isInstallable) {
            void install();
            onDone();
          } else setShowIOSGuide(true);
        }}
        className={className}
      >
        <Download className="w-4 h-4 text-zinc-400" />
        <span className="flex-1">{t('menu.install')}</span>
      </button>
      {showIOSGuide && createPortal(
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl bg-[#1a1528] border border-[var(--accent-border)] p-6 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white font-fantasy uppercase tracking-wider">Install on iPhone / iPad</h3>
              <button onClick={closeGuide} className="text-zinc-400 hover:text-white p-1">
                ✕
              </button>
            </div>
            <div className="mt-2 text-sm text-zinc-300 space-y-3 leading-relaxed">
              <p>Get the native Quest Compendium experience on your iOS device:</p>
              <ol className="list-decimal pl-5 space-y-2 text-white">
                <li>Tap the <strong>Share</strong> button at the bottom of Safari.</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
              </ol>
            </div>
            <button onClick={closeGuide} className="mt-6 w-full rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-color)] py-2 text-sm font-bold tracking-widest text-white cursor-pointer">
              CLOSE
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
