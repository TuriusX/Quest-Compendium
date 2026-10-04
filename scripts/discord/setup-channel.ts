/**
 * Set up #guide-corrections (run again any time; it updates rather than duplicates):
 *   npx tsx scripts/discord/setup-channel.ts
 * 1. Posts the "Spotted a mistake?" message with a "Suggest a correction" button (it opens the correction form, see
 *    discord.ts), or edits it if it's already there (its id is kept in Firestore system/discord), and pins it.
 * 2. Sets the channel topic.
 * The bot needs, in that channel: View Channel, Send Messages, Read Message History, Pin Messages (or Manage Messages)
 * to pin, and Manage Channel to set the topic. The token comes from DISCORD_BOT_TOKEN, else Secret Manager; never printed.
 */
import { execSync } from 'child_process';
import { db } from '../guides/common';

const CHANNEL = process.env.DISCORD_RESULTS_CHANNEL_ID || '1554700742873325568';
const API = 'https://discord.com/api/v10';
const token =
  process.env.DISCORD_BOT_TOKEN ||
  execSync('gcloud secrets versions access latest --secret DISCORD_BOT_TOKEN --project quest-compendium-1bccf', { encoding: 'utf8' }).trim();
const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };

const MESSAGE = {
  content: 'Spotted a mistake in a guide? Tap the button below and tell us what\'s right. Corrections are checked against sources before the guide changes.',
  components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Suggest a correction', custom_id: 'qc-suggest', emoji: { name: '📝' } }] }],
  allowed_mentions: { parse: [] },
};
const TOPIC = 'Report guide mistakes with the button in the pinned message or /correction.';

async function call(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const r = await fetch(`${API}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  return { ok: r.ok, status: r.status, json, text };
}

(async () => {
  const stateRef = db().collection('system').doc('discord');
  const state: any = (await stateRef.get()).data() || {};
  let messageId: string | undefined = state.pinnedMessageId;
  // Edit the existing message if it's still there, else post a new one.
  if (messageId) {
    const r = await call('PATCH', `/channels/${CHANNEL}/messages/${messageId}`, MESSAGE);
    if (r.ok) console.log(`Updated the pinned message (${messageId}).`);
    else messageId = undefined;
  }
  if (!messageId) {
    const r = await call('POST', `/channels/${CHANNEL}/messages`, MESSAGE);
    if (!r.ok) throw new Error(`posting the message failed: ${r.status} ${r.text.slice(0, 200)} (the bot needs View Channel and Send Messages there)`);
    messageId = String(r.json.id);
    await stateRef.set({ pinnedMessageId: messageId, channel: CHANNEL, updatedAt: Date.now() }, { merge: true });
    console.log(`Posted the message (${messageId}).`);
  }
  const pin = await call('PUT', `/channels/${CHANNEL}/pins/${messageId}`);
  console.log(pin.ok ? 'Pinned it.' : `Couldn't pin it: ${pin.status} ${pin.text.slice(0, 160)} (give the bot Pin Messages, or Manage Messages, in the channel)`);
  const topic = await call('PATCH', `/channels/${CHANNEL}`, { topic: TOPIC });
  console.log(topic.ok ? `Topic set: "${TOPIC}"` : `Couldn't set the topic: ${topic.status} ${topic.text.slice(0, 160)} (give the bot Manage Channel there, or set it by hand)`);
  setTimeout(() => process.exit(pin.ok && topic.ok ? 0 : 2), 500);
})().catch((e) => {
  console.error('Channel setup failed:', e?.message || e);
  process.exit(1);
});
