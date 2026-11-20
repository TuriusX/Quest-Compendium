/**
 * A guide front page's index (scripts/guides/publish.ts compIndexHtml): its behaviour, the same on the website (inlined
 * there with toString(), so plain browser code with no imports) and in the app's Guide tab (GuideFragment).
 *
 * - Chapters (details[data-ch]): the one holding the reader's last-visited page (a link [data-area-link="<last>"]) opens
 *   when the page opens; without one, the first chapter. The pages are plain reference: nothing here is ticked.
 * - The filter ([data-qc-filter]): hides rows ([data-f]) that don't match, and groups ([data-fgroup]) and sections
 *   ([data-fsec]) left empty; a chapter with a match opens.
 *
 * last: the guide page the reader was on last (the website keeps it in localStorage "qcw-last:<key>"), or null.
 */
export function compIndex(root: ParentNode, last?: string | null): void {
  const box = root.querySelector('[data-qc-index]');
  if (!box) return;
  const all = function (sel: string, el?: Element): Element[] { return Array.prototype.slice.call((el || box).querySelectorAll(sel)); };
  const chs = all('details[data-ch]');
  const here = last ? chs.filter(function (c) { return all('[data-area-link]', c).some(function (a) { return a.getAttribute('data-area-link') === last; }); })[0] : undefined;
  const open = here || chs[0];
  if (open) chs.forEach(function (c) { (c as HTMLDetailsElement).open = c === open; });
  const f = box.querySelector('[data-qc-filter]') as HTMLInputElement | null;
  if (f) {
    const norm = function (s: string) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ''); };
    const opened: Element[] = [];
    f.addEventListener('input', function () {
      const q = norm(f.value.trim());
      all('[data-f]').forEach(function (el) { (el as HTMLElement).hidden = !!q && norm(String(el.getAttribute('data-f'))).indexOf(q) < 0; });
      all('[data-fhead]').forEach(function (el) { (el as HTMLElement).hidden = !!q; });
      all('[data-fgroup],[data-fsec]').forEach(function (g) {
        const any = !!g.querySelector('[data-f]:not([hidden])');
        (g as HTMLElement).hidden = !!q && !any;
        if (q && any && g.tagName === 'DETAILS' && !(g as HTMLDetailsElement).open) { (g as HTMLDetailsElement).open = true; opened.push(g); }
      });
      // Chapters opened for a match close again when the filter is cleared.
      if (!q) while (opened.length) (opened.pop() as HTMLDetailsElement).open = false;
      const none = box.querySelector('[data-fnone]') as HTMLElement | null;
      if (none) none.hidden = !q || !!box.querySelector('[data-f]:not([hidden])');
    });
  }
}
