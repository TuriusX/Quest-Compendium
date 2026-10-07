/**
 * Search Console URL Inspection on a sample of URLs: what Google has on file for each (indexed or not, why, the
 * canonical it chose and the one the page names, when it last crawled), plus the sitemaps it knows about. Read-only;
 * the token comes from the Cloud Run metadata server like searchConsole.ts, so this runs as a job:
 *
 *   gcloud run jobs execute guide-pipeline --args=tsx,scripts/pipeline/inspectUrls.ts   (from Bash: PowerShell joins the args)
 *
 * The sample: pages moved by redirects (scripts/guides/site-redirects.json), unpublished guides, index.html variants,
 * and translated pages from the live sitemap.
 */
import fs from 'fs';
import path from 'path';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const SITES = ['sc-domain:questcompendium.com', 'https://questcompendium.com/', 'https://www.questcompendium.com/'];
const SITE = 'https://questcompendium.com';

async function token(): Promise<string> {
  const r = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(SCOPE)}`, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error(`no token from the metadata server (HTTP ${r.status}): this runs on Cloud Run`);
  return String((await r.json()).access_token || '');
}

async function sample(): Promise<{ group: string; url: string }[]> {
  const moved: Record<string, Record<string, string>> = JSON.parse(fs.readFileSync(path.join('scripts', 'guides', 'site-redirects.json'), 'utf8'));
  const out: { group: string; url: string }[] = [];
  for (const [key, m] of Object.entries(moved).slice(0, 6)) out.push({ group: 'redirected (was 404)', url: `${SITE}/guides/${key}/${Object.keys(m)[0]}/` });
  for (const key of ['hollow-knight', 'mass-effect-3-legendary-edition', 'final-fantasy-xii-the-zodiac-age']) out.push({ group: 'unpublished guide (404)', url: `${SITE}/guides/${key}/` });
  for (const p of ['guides/index.html', 'guides/elden-ring/index.html', 'index.html', 'de/index.html']) out.push({ group: 'index.html variant', url: `${SITE}/${p}` });
  const sm = (await (await fetch(`${SITE}/sitemap.xml`)).text()).match(/<loc>[^<]+/g)?.map((x) => x.slice(5)) || [];
  const tr = sm.filter((u) => /questcompendium\.com\/[a-z]{2}\/guides\/[^/]+\/[^/]+\/$/.test(u));
  for (let i = 0; i < 5 && tr.length; i++) out.push({ group: 'translated page', url: tr[Math.floor((i * tr.length) / 5)] });
  out.push({ group: 'translated page', url: `${SITE}/de/` });
  return out;
}

async function main() {
  const tok = await token();
  const auth = { Authorization: `Bearer ${tok}` };
  const sites: any = await (await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', { headers: auth })).json();
  const have = new Map<string, string>((sites.siteEntry || []).map((s: any) => [s.siteUrl, s.permissionLevel]));
  const site = SITES.find((s) => have.has(s));
  if (!site) throw new Error('no access to questcompendium.com in Search Console');
  console.log(`Property: ${site} (${have.get(site)})`);
  const sm: any = await (await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/sitemaps`, { headers: auth })).json();
  for (const s of sm.sitemap || []) console.log(`Sitemap ${s.path}: submitted ${s.lastSubmitted || '-'}, downloaded ${s.lastDownloaded || '-'}, ${s.contents?.map((c: any) => `${c.submitted} submitted`).join(', ') || ''}${s.errors ? `, ${s.errors} error(s)` : ''}${s.warnings ? `, ${s.warnings} warning(s)` : ''}`);
  for (const { group, url } of await sample()) {
    const r = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: url, siteUrl: site }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { console.log(`[inspect] ${group} | ${url} | HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`); continue; }
    const x = j.inspectionResult?.indexStatusResult || {};
    console.log(`[inspect] ${group} | ${url} | ${x.verdict || '-'} | ${x.coverageState || '-'} | fetch ${x.pageFetchState || '-'} | google canonical ${x.googleCanonical || '-'} | page canonical ${x.userCanonical || '-'} | crawled ${x.lastCrawlTime || 'never'}`);
  }
}
main().then(() => process.exit(0), (e) => { console.error(e?.message || e); process.exit(1); });
