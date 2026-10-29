/**
 * Light mode for the admin pages (/admin/reviews, /admin/images, /admin/asked; owner, Oct 29 2026), like the website's:
 * the device's setting by default, or the sun/moon button (remembered in the browser, localStorage qc-theme, the same
 * key as the site, so /admin on questcompendium.com follows the site's choice). Their colours are CSS variables, so light
 * mode redefines those, and the few fixed colours the pages use.
 */
export const ADMIN_THEME_HEAD = `<script>(function(){var d=document.documentElement,m=window.matchMedia&&matchMedia('(prefers-color-scheme: light)');function t(){try{return localStorage.getItem('qc-theme')}catch(e){return null}}function set(l){d.classList.toggle('qc-light',l);}set(t()?t()==='light':!!(m&&m.matches));document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-qc-theme]');if(!b)return;var l=!d.classList.contains('qc-light');set(l);try{localStorage.setItem('qc-theme',l?'light':'dark')}catch(e){}});})();</script>
<style>
  html.qc-light { color-scheme: light; --bg: #f6f5fa; --card: #ffffff; --line: #dcd8e6; --text: #1f1c27; --dim: #5c5768; --accent: #5f33c4; --ok: #05664a; --bad: #a8113a; --warn: #7c4306; }
  html.qc-light header { background: rgba(246,245,250,.94) !important; }
  html.qc-light button, html.qc-light select, html.qc-light input, html.qc-light textarea { background: #ffffff; color: var(--text); }
  html.qc-light button.primary { background: var(--accent); color: #ffffff; border-color: var(--accent); }
  html.qc-light .tab.on { background: #ece6ff; color: var(--text); }
  html.qc-light .chip.queued, html.qc-light .chip.pending, html.qc-light .chip.report { background: transparent; }
  [data-qc-theme] { width: 32px; height: 32px; padding: 0; display: inline-grid; place-items: center; }
  .qc-sun { display: block; } .qc-moon { display: none; } html.qc-light .qc-sun { display: none; } html.qc-light .qc-moon { display: block; }
</style>`;

/** The sun/moon button for an admin page's header. */
export const ADMIN_THEME_BUTTON = `<button type="button" data-qc-theme aria-label="Light or dark mode" title="Light or dark mode"><svg class="qc-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="qc-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>`;
