/**
 * Deploy a folder to Netlify with its file-digest API: send the list of files with their fingerprints, then upload
 * only the files Netlify doesn't already have. Needs a personal access token and the site's API id.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export async function deployToNetlify(dir: string, siteId: string, token: string): Promise<{ id: string; uploaded: number }> {
  const root = path.resolve(dir);
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
