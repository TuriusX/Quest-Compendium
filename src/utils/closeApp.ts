/**
 * Close Quest Compendium (desktop): sync first (at most 1.5 seconds, so closing never hangs), then quit. The full
 * view's header and the compact card's close button both use it.
 */
export async function closeAppAfterSync(onSync?: () => Promise<unknown> | unknown): Promise<void> {
  try {
    if (onSync) {
      await Promise.race([onSync(), new Promise((resolve) => setTimeout(resolve, 1500))]);
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('quest_flush_sync'));
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  } catch (err) {
    console.warn('[close] Auto-sync on close error:', err);
  } finally {
    (window as any).electronAPI?.closeApp?.();
  }
}
