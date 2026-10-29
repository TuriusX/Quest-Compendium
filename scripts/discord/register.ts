/**
 * One-time Discord setup (run again after changing the command):
 *   npx tsx scripts/discord/register.ts
 * 1. Points the app's Interactions Endpoint URL at the server (/api/discord/interactions). Discord pings it first, so the
 *    server must already be deployed with DISCORD_PUBLIC_KEY.
 * 2. Registers /correction and /stats in the server the results channel is in (a server command shows up at once).
 * The bot token comes from DISCORD_BOT_TOKEN, else from Secret Manager (gcloud). It's never printed.
 */
import { execSync } from 'child_process';

const APP_ID = process.env.DISCORD_APP_ID || '1556130258120343582';
const CHANNEL = process.env.DISCORD_RESULTS_CHANNEL_ID || '1554700742873325568';
const SERVER = process.env.QC_SERVER_URL || 'https://quest-compendium-890629309063.us-east1.run.app';
const API = 'https://discord.com/api/v10';

const token =
  process.env.DISCORD_BOT_TOKEN ||
  execSync('gcloud secrets versions access latest --secret DISCORD_BOT_TOKEN --project quest-compendium-1bccf', { encoding: 'utf8' }).trim();
const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };

/** /correction. Required options come first (Discord's rule). */
export const CORRECTION_COMMAND = {
  name: 'correction',
  description: 'Report a correction to a Quest Compendium guide',
  dm_permission: false,
  options: [
    { type: 3, name: 'game', description: 'The game (start typing to search the guides)', required: true, autocomplete: true },
    { type: 3, name: 'area', description: 'The guide page (area)', required: true, autocomplete: true },
    { type: 3, name: 'correct', description: "What's correct (where it really is, how to get it…)", required: true, min_length: 8, max_length: 300 },
    { type: 3, name: 'entry', description: 'The guide entry that is wrong (needed for automatic checking)', required: false, autocomplete: true },
  ],
};

/** /stats: the owner's numbers (the server answers only DISCORD_OWNER_ID); hidden from members without Administrator. */
export const STATS_COMMAND = {
  name: 'stats',
  description: 'Activity at a glance (owner only)',
  dm_permission: false,
  default_member_permissions: '8',
  options: [
    { type: 3, name: 'window', description: 'A longer window (default: last 24 hours and last 7 days)', required: false, choices: [{ name: 'Last 24 hours', value: '24h' }, { name: 'Last 7 days', value: '7d' }, { name: 'Last 30 days', value: '30d' }] },
    { type: 3, name: 'chart', description: 'A chart instead: questions per day, or accounts over time', required: false, choices: [{ name: 'Questions, last 30 days', value: '30d' }, { name: 'Questions, last 90 days', value: '90d' }, { name: 'Questions, all time', value: 'all' }, { name: 'Accounts, last 30 days', value: 'a30d' }, { name: 'Accounts, last 90 days', value: 'a90d' }, { name: 'Accounts, all time', value: 'aall' }] },
  ],
};

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

(async () => {
  const endpoint = `${SERVER}/api/discord/interactions`;
  await call('PATCH', '/applications/@me', { interactions_endpoint_url: endpoint });
  console.log(`Interactions Endpoint URL set: ${endpoint}`);
  const channel = await call('GET', `/channels/${CHANNEL}`);
  const guild = channel.guild_id;
  const cmd = await call('PUT', `/applications/${APP_ID}/guilds/${guild}/commands`, [CORRECTION_COMMAND, STATS_COMMAND]);
  console.log(`/correction and /stats registered in server ${guild} (command ids ${cmd.map((c: any) => c.id).join(', ')}); results go to #${channel.name}.`);
})().catch((e) => {
  console.error('Discord setup failed:', e?.message || e);
  process.exit(1);
});
