import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A window of the app's own, drawn by this page (owner, Nov 15 2026: the popped-out quest log is the same log as the
 * docked one). window.open(name) gives a blank same-origin window (the main process sizes and places it, see
 * electron/logWindow.cjs); the children render into it through a portal, so state and handlers stay this page's.
 * The page's styles and its root's classes and theme variables are copied over and kept in step.
 */
export function PopWindow({ name, title, children }: { name: string; title: string; children: ReactNode }) {
  const [box, setBox] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const w = window.open('', name);
    if (!w) return;
    const d = w.document;
    d.title = title;
    const copyStyles = () => {
      d.head.querySelectorAll('[data-qc-copied]').forEach((n) => n.remove());
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
        const c = n.cloneNode(true) as HTMLElement;
        if (c instanceof HTMLLinkElement) c.href = (n as HTMLLinkElement).href; // absolute: the blank window has no base
        c.setAttribute('data-qc-copied', '');
        d.head.appendChild(c);
      });
    };
    const copyRoot = () => {
      for (const [from, to] of [[document.documentElement, d.documentElement], [document.body, d.body]] as const) {
        for (const a of Array.from(to.attributes)) if (!from.hasAttribute(a.name)) to.removeAttribute(a.name);
        for (const a of Array.from(from.attributes)) to.setAttribute(a.name, a.value);
      }
      d.body.style.margin = '0';
      d.body.style.overflow = 'hidden';
    };
    copyStyles();
    copyRoot();
    const root = d.createElement('div');
    root.style.height = '100vh';
    d.body.appendChild(root);
    setBox(root);
    // Styles added later (dev reloads, lazy chunks) and theme changes on the root follow.
    const heads = new MutationObserver(copyStyles);
    heads.observe(document.head, { childList: true });
    const attrs = new MutationObserver(copyRoot);
    attrs.observe(document.documentElement, { attributes: true });
    attrs.observe(document.body, { attributes: true });
    return () => {
      heads.disconnect();
      attrs.disconnect();
      setBox(null);
      try { w.close(); } catch { /* already gone */ }
    };
  }, [name]);

  useEffect(() => { if (box) box.ownerDocument.title = title; }, [box, title]);

  return box ? createPortal(children, box) : null;
}
