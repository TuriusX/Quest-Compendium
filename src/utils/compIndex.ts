/**
 * A guide front page's index (scripts/guides/publish.ts compIndexHtml): its behaviour, the same on the website (inlined
 * there with toString(), so plain browser code with no imports) and in the app's Guide tab (GuideFragment).
 *
 * - Mission ticks ([data-mtick]): kept like a guide page's ticks, under the page name "_missions" (the website saves them
 *   in the browser; the app syncs them to the account like every other tick).
 * - Walkthrough pages ([data-progress="key|slug|total"]): their ticks as "3/8", or ✓ when all are done.
 * - Each chapter's count ([data-chcount]) and bar ([data-chbar]): missions ticked and pages finished; the first
 *   unfinished chapter opens when the page opens.
 * - The filter ([data-qc-filter]): hides rows ([data-f]) that don't match, and groups ([data-fgroup]) and sections
 *   ([data-fsec]) left empty; a chapter with a match opens.
 *
 * read(slug): the ticked ids of a guide page; write(slug, ids): saves them. Returns the repaint (ticks made elsewhere).
 */
export function compIndex(root: ParentNode, read: (slug: string) => string[], write: (slug: string, ids: string[]) => void): () => void {
  const box = root.querySelector('[data-qc-index]');
  if (!box) return function () {};
  const all = function (sel: string, el?: Element): Element[] { return Array.prototype.slice.call((el || box).querySelectorAll(sel)); };
  const paint = function () {
    const m = read('_missions');
    all('[data-mtick]').forEach(function (el) {
      const on = m.indexOf(String(el.getAttribute('data-mtick'))) >= 0;
      const inp = el.querySelector('input');
      if (inp) (inp as HTMLInputElement).checked = on;
      const row = el.closest('[data-f]');
      if (row) row.classList.toggle('qc-mdone', on);
    });
    all('[data-progress]').forEach(function (el) {
      const p = String(el.getAttribute('data-progress')).split('|'), t = +p[2], n = t ? read(p[1]).length : 0;
      el.textContent = !t ? '' : n >= t ? '✓' : n ? n + '/' + t : '';
      el.classList.toggle('is-complete', !!t && n >= t);
      const row = el.closest('[data-f]');
      if (row && t) row.classList.toggle('qc-mdone', n >= t);
    });
    all('details[data-ch]').forEach(function (ch) {
      // Rows that can be finished: a mission, or a page with something to tick.
      const rows = all('[data-f]', ch).filter(function (r) { return r.querySelector('[data-mtick]') || /\|[1-9]\d*$/.test(String(r.querySelector('[data-progress]')?.getAttribute('data-progress') || '')); });
      const d = rows.filter(function (r) { return r.classList.contains('qc-mdone'); }).length;
      const c = ch.querySelector('[data-chcount]'), b = ch.querySelector('[data-chbar]') as HTMLElement | null;
      if (c) c.textContent = rows.length ? (d === rows.length ? '✓ ' : '') + d + '/' + rows.length : '';
      if (b) b.style.width = rows.length ? Math.round((100 * d) / rows.length) + '%' : '0';
      ch.classList.toggle('qc-chdone', !!rows.length && d === rows.length);
    });
  };
  box.addEventListener('change', function (e) {
    const inp = e.target as HTMLInputElement, el = inp && inp.closest && inp.closest('[data-mtick]');
    if (!el) return;
    const id = String(el.getAttribute('data-mtick')), m = read('_missions').filter(function (x) { return x !== id; });
    if (inp.checked) m.push(id);
    write('_missions', m);
    paint();
  });
  paint();
  // The first chapter not finished yet is the open one (a page opened at a link inside another one keeps that open too).
  const chs = all('details[data-ch]');
  const first = chs.filter(function (c) { return !c.classList.contains('qc-chdone'); })[0];
  if (first) chs.forEach(function (c) { (c as HTMLDetailsElement).open = c === first; });
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
  return paint;
}
