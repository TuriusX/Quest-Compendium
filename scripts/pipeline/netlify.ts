/**
 * Deploy a folder to Netlify with its file-digest API: send the list of files with their fingerprints, then upload
 * only the files Netlify doesn't already have. Needs a personal access token and the site's API id.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * The shrinkage guard: a build whose sitemap has far fewer pages than the live site's (a publish that stopped halfway)
 * is never deployed, since a deploy removes every live page the build lacks. More than 2% of the live pages, or any
 * guide that's live but missing from the build, refuses the deploy (QC_DEPLOY_ALLOW_SHRINK=1 overrides, for a
 * deliberate removal).
 */
export async function checkShrink(root: string, site = 'https://questcompendium.com'): Promise<string | null> {
  if (process.env.QC_DEPLOY_ALLOW_SHRINK === '1') return null;
  const locs = (xml: string) => (xml.match(/<loc>[^<]+/g) || []).map((x) => x.slice(5));
  let live: string[] = [];
  try {
    const r = await fetch(`${site}/sitemap.xml`, { signal: AbortSignal.timeout(20_000) });
    if (r.ok) live = locs(await r.text());
  } catch {
    return null; // the live sitemap can't be read: nothing to compare against
  }
  const local = fs.existsSync(path.join(root, 'sitemap.xml')) ? locs(fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8')) : [];
  if (!live.length) return null;
  const have = new Set(local);
  const gone = live.filter((u) => !have.has(u));
  const guideOf = (u: string) => (u.match(/\/guides\/([^/]+)\//) || [])[1];
  const liveGuides = new Set(live.map(guideOf).filter(Boolean));
  const localGuides = new Set(local.map(guideOf).filter(Boolean));
  const lostGuides = [...liveGuides].filter((g) => !localGuides.has(g));
  if (lostGuides.length || gone.length > live.length * 0.02) {
    return `the build would remove ${gone.length} of ${live.length} live page(s)${lostGuides.length ? ` and ${lostGuides.length} whole guide(s) (${lostGuides.slice(0, 5).join(', ')})` : ''}; not deployed (QC_DEPLOY_ALLOW_SHRINK=1 if that's intended)`;
  }
  return null;
}

export async function deployToNetlify(dir: string, siteId: string, token: string): Promise<{ id: string; uploaded: number }> {
  const root = path.resolve(dir);
  const shrink = await checkShrink(root);
  if (shrink) throw new Error(shrink);
  const files: Record<string, string> = {};
  const byHash = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = '/' + path.relative(root, p).split(path.sep).join('/');
        const sha = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
        files[rel] = sha;
        byHash.set(sha, p);
      }
    }
  };
  walk(root);
  const api = 'https://api.netlify.com/api/v1';
  const headers = { Authorization: `Bearer ${token}` };
  const res = await fetch(`${api}/sites/${siteId}/deploys`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, async: false }),
  });
  if (!res.ok) throw new Error(`Netlify said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const deploy: any = await res.json();
  const required: string[] = deploy.required || [];
  const pathFor = new Map(Object.entries(files).map(([p, h]) => [h, p]));
  for (const sha of required) {
    const rel = pathFor.get(sha)!;
    const up = await fetch(`${api}/deploys/${deploy.id}/files${encodeURI(rel)}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: fs.readFileSync(byHash.get(sha)!),
    });
    if (!up.ok) throw new Error(`uploading ${rel} failed (${up.status})`);
  }
  return { id: deploy.id, uploaded: required.length };
}
