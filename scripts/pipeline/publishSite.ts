/**
 * The website rebuilt and deployed on its own, no AI and no pipeline steps (owner, Nov 3 2026: site changes go out when no
 * run is going, without waiting for the next one). The job's own settings and the same site lock as the daily run:
 *
 *   gcloud run jobs execute guide-pipeline --args=tsx,scripts/pipeline/publishSite.ts --region us-east1 --wait
 */
import path from 'path';
import { spawnSync } from 'child_process';
import { waitForGuideLock, isRefusal, lockedLine, SITE_LOCK } from '../guides/guideLock';
import { deployToNetlify } from './netlify';

async function main() {
  const lock = await waitForGuideLock(SITE_LOCK, 'publish and deploy', 15 * 60_000);
  if (isRefusal(lock)) {
    console.log(lockedLine(lock, 'The website'));
    process.exit(1);
  }
  try {
    const cli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const r = spawnSync(process.execPath, [cli, 'scripts/guides/publish.ts'], { encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    process.stdout.write(String(r.stdout || '').slice(-3000));
    // A publish that failed leaves a partial site: never deploy it.
    if (r.status !== 0) throw new Error(`publishing failed (exit ${r.status ?? r.signal}); nothing deployed: ${String(r.stderr || '').slice(-500)}`);
    if (!process.env.NETLIFY_AUTH_TOKEN || !process.env.NETLIFY_SITE_ID) throw new Error('Netlify settings missing; rebuilt but not deployed');
    const n = await deployToNetlify('Marketing_Website_Files', process.env.NETLIFY_SITE_ID, process.env.NETLIFY_AUTH_TOKEN);
    console.log(`Deployed to Netlify (${n.uploaded} changed file(s)).`);
  } finally {
    await lock.release();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('Site publish failed:', e?.message || e);
  process.exit(1);
});
