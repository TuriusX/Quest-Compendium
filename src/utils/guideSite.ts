/** Where the app reads the published guide from (the website), and how its links and addresses are read. */
// A local build of the site can stand in on a dev machine (localStorage qc_guide_site, honoured on localhost only).
export const SITE = (() => {
  try {
    if (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      const v = localStorage.getItem('qc_guide_site');
      if (v && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(v)) return v;
    }
  } catch { /* storage blocked */ }
  return 'https://questcompendium.com';
})();

/** The pages a guide link can open: a game's front page, one of its pages (#entry), or its achievement guide. */
export type GuideTarget = { key: string; slug?: string; anchor?: string };
export function guideTarget(href: string, base: string): GuideTarget | { external: string } | null {
  let u: URL;
  try { u = new URL(href, base); } catch { return null; }
  if (u.origin !== SITE) return /^https?:$/.test(u.protocol) ? { external: u.toString() } : null;
  const m = u.pathname.match(/^\/(?:[a-z]{2}\/)?guides\/([a-z0-9-]+)\/(?:([a-z0-9-]+)\/)?(?:index\.html)?$/);
  if (!m) return { external: u.toString() };
  return { key: m[1], ...(m[2] ? { slug: m[2] } : {}), ...(u.hash ? { anchor: decodeURIComponent(u.hash.slice(1)) } : {}) };
}

/** Root-relative addresses (/img/…, /assets/…) point at the website, the page's own folder too. */
export const absolutize = (html: string) => html.replace(/(\s(?:src|href|srcset)=")\/(?!\/)/g, `$1${SITE}/`).replace(/(,\s*)\/(?!\/)(img\/)/g, `$1${SITE}/$2`);
