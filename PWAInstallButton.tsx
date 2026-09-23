import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Smartphone } from './icons';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        title="Install Web App"
        className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-all cursor-pointer flex items-center gap-1.5"
      >
        <Download className="w-4 h-4" />
      </button>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not supported by WebKit)
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          title="Install on iOS"
          className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-all cursor-pointer flex items-center gap-1.5"
        >
          <Download className="w-4 h-4" />
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-xl bg-[#1a1528] border border-[var(--accent-border)] p-6 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white font-fantasy uppercase tracking-wider">Install on iPhone / iPad</h3>
                <button onClick={() => setShowIOSGuide(false)} className="text-zinc-400 hover:text-white p-1">
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
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-color)] py-2 text-sm font-bold tracking-widest text-[var(--accent-color)] hover:bg-[var(--accent-color)] hover:text-white transition-colors"
              >
                CLOSE
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
