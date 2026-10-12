/**
 * Read-only: every address Google showed in the last 90 days (Search Console, any query) requested on the live site
 * now, without following redirects. Prints the ones that don't answer 200 (status, where a redirect goes, impressions).
 * Runs as a job:
 *
 *   gcloud run jobs execute guide-pipeline --args=tsx,scripts/pipeline/sc404.ts --wait
 */
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const SITE = 'sc-domain:questcompendium.com';
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const r0 = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(SCOPE)}`, { headers: { 'Metadata-Flavor': 'Google' } });
  const tok = String((await r0.json()).access_token || '');
  const r = await fetch(`${API}/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: day(90), endDate: day(1), dimensions: ['page'], rowLimit: 25_000, dataState: 'all' }),
  });
  const rows: { url: string; n: number }[] = ((await r.json()).rows || []).map((x: any) => ({ url: String(x.keys[0]).split('#')[0], n: x.impressions }));
  const urls = new Map<string, number>();
  for (const x of rows) urls.set(x.url, (urls.get(x.url) || 0) + x.n);
  const list = [...urls];
  const bad: string[] = [];
  for (let i = 0; i < list.length; i += 20) {
    await Promise.all(list.slice(i, i + 20).map(async ([url, n]) => {
      try {
        const res = await fetch(url, { method: 'GET', redirect: 'manual' });
        if (res.status !== 200) bad.push(`sc404: ${res.status}\t${url}\t${res.headers.get('location') || ''}\t${n}`);
      } catch (e: any) { bad.push(`sc404: ERR\t${url}\t${String(e?.message || e).slice(0, 60)}\t${n}`); }
    }));
  }
  console.log(`sc404: ${list.length} address(es) checked, ${bad.length} not 200.`);
  for (let i = 0; i < bad.length; i += 40) console.log(bad.slice(i, i + 40).join('\n'));
}
main().then(() => process.exit(0), (e) => { console.error('sc404 failed:', e?.message || e); process.exit(1); });
