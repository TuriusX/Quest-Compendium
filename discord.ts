/**
 * The Discord bot: /correction, for guide corrections from the Discord server, over Discord's HTTP interactions (no
 * always-on connection: Discord calls POST /api/discord/interactions, which runs on the normal server).
 *
 *   /correction game:<autocomplete> area:<autocomplete> correct:<what's correct> [entry:<autocomplete>]
 *     With an entry, it's a correction candidate (corrections.ts, source "discord"): each Discord user counts as one
 *     reporter toward the 3 the daily check needs when sources can't settle it. Without an entry it goes to the review
 *     queue as a report. The bot replies with a short thanks and a "Confirm" button.
 *   Confirm (Guide Moderator role only): the moderator's confirmation stands in for the 3 reporters; the correction still
 *     goes through the source check (scripts/guides/corrections.ts). Anyone else gets a short "moderators only" note.
 * Once the pipeline decides (applied, or dismissed), it posts the result in the results channel (announceDecisions).
 *
 * Settings: DISCORD_APP_ID, DISCORD_PUBLIC_KEY (request signatures), DISCORD_MOD_ROLE_ID, DISCORD_RESULTS_CHANNEL_ID,
 * and the secret DISCORD_BOT_TOKEN (for posting results and registering the command: scripts/discord/register.ts).
 */
import crypto from 'crypto';
import express, { type Express, type Request, type Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { guideList, guideAreasByKey, guideAreaEntries } from './guidesApi';
import { saveCandidate, entryById, looksLikeSpam, REPORTER_WEIGHT } from './corrections';

const PUBLIC_KEY = () => process.env.DISCORD_PUBLIC_KEY || '';
const MOD_ROLE = () => process.env.DISCORD_MOD_ROLE_ID || '';
const API = 'https://discord.com/api/v10';

/** Discord's request signature (Ed25519 over timestamp + raw body), required on every interaction. */
export function verifyDiscordSignature(rawBody: Buffer | string, signature: string, timestamp: string, publicKeyHex: string): boolean {
  try {
    if (!signature || !timestamp || !publicKeyHex) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody)]), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

/** A Discord user, anonymised like the app's players (the id itself is never stored). */
const reporterKey = (userId: string) =>
  `discord:${crypto.createHash('sha256').update(`${process.env.CORRECTION_SALT || 'qc-corrections'}:discord:${userId}`).digest('hex').slice(0, 20)}`;

const opt = (data: any, name: string) => (data?.options || []).find((o: any) => o.name === name);
const choices = (list: { name: string; value: string }[], typed: string) => {
  const t = String(typed || '').toLowerCase();
  return list
    .filter((c) => !t || c.name.toLowerCase().includes(t))
    .slice(0, 25)
    .map((c) => ({ name: c.name.slice(0, 100), value: c.value.slice(0, 100) }));
};

/** Autocomplete: games with a published guide, that game's areas, that area's entries. */
async function autocomplete(data: any): Promise<{ name: string; value: string }[]> {
  const focused = (data?.options || []).find((o: any) => o.focused);
  if (!focused) return [];
  const game = String(opt(data, 'game')?.value || '');
  const area = String(opt(data, 'area')?.value || '');
  if (focused.name === 'game') return choices((await guideList()).map((g) => ({ name: g.game, value: g.key })), focused.value);
  if (focused.name === 'area') {
    const g = game ? await guideAreasByKey(game) : null;
    return g ? choices(g.areas.map((a) => ({ name: a.name, value: a.slug })), focused.value) : [];
  }
  if (focused.name === 'entry') return game && area ? choices((await guideAreaEntries(game, area)).map((e) => ({ name: e.label, value: e.id })), focused.value) : [];
  return [];
}

const reply = (content: string, opts: { ephemeral?: boolean; components?: any[] } = {}) => ({
  type: 4,
  data: { content, allowed_mentions: { parse: [] }, ...(opts.ephemeral ? { flags: 64 } : {}), ...(opts.components ? { components: opts.components } : {}) },
});
const confirmButton = (id: string) => [{ type: 1, components: [{ type: 2, style: 3, label: 'Confirm (moderators)', custom_id: `qc-confirm:${id}` }] }];

/** /correction: save it, thank the reporter, offer moderators the Confirm button. */
async function correctionCommand(i: any): Promise<any> {
  const data = i.data;
  const userId = String(i.member?.user?.id || i.user?.id || '');
  const game = String(opt(data, 'game')?.value || '').trim();
  const area = String(opt(data, 'area')?.value || '').trim();
  const entryId = String(opt(data, 'entry')?.value || '').trim();
  const correct = String(opt(data, 'correct')?.value || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!userId) return reply('Sorry, I could not tell who sent that.', { ephemeral: true });
  if (looksLikeSpam(correct)) return reply('Please say what is correct in a sentence or two (no links).', { ephemeral: true });
  const guide = await guideAreasByKey(game);
  const areaInfo = guide?.areas.find((a) => a.slug === area);
  if (!guide || !areaInfo) return reply('Pick a game and an area from the suggestions, so I know which guide page you mean.', { ephemeral: true });
  if (entryId) {
    const found = await entryById(game, area, entryId);
    if (!found) return reply('Pick the entry from the suggestions (or leave it out).', { ephemeral: true });
    const id = await saveCandidate({
      gameKey: game, game: found.game, area, areaName: found.areaName, entry: found.entry, claim: correct, field: 'where',
      via: 'command', reporterKey: reporterKey(userId), source: 'discord', weight: REPORTER_WEIGHT.discord,
      extra: { discord: { guild: String(i.guild_id || ''), channel: String(i.channel_id || ''), token: String(i.token || '') } },
    });
    if (!id) return reply("Thanks! You've already reported this one (or hit today's limit), so it wasn't counted again.", { ephemeral: true });
    // The reply's message id (for the link in the result post) is only known after the reply is sent.
    setTimeout(() => rememberReply(id, String(i.token || '')).catch(() => {}), 1500);
    return reply(
      `Thanks! Your correction for **${found.entry.name}** (${found.game} · ${found.areaName}) is recorded. It's checked against sources before the guide changes; I'll post the result in <#${process.env.DISCORD_RESULTS_CHANNEL_ID || ''}>.`,
      { components: confirmButton(id) },
    );
  }
  // No entry: a report for the review queue (an admin decides).
  await getFirestore().collection('reviewQueue').add({
    kind: 'report', source: 'discord', key: game, game: guide.game, page: area, pageName: areaInfo.name, text: correct,
    status: 'open', action: null, createdAt: Date.now(), updatedAt: Date.now(),
  });
  return reply(`Thanks! Your note about **${areaInfo.name}** (${guide.game}) is on the review queue. Naming the entry next time lets it be checked and applied automatically.`);
}

/** Store the bot reply's message id and a link to it on the candidate (for the result post). */
async function rememberReply(candidateId: string, token: string) {
  const app = process.env.DISCORD_APP_ID;
  if (!app || !token) return;
  const r = await fetch(`${API}/webhooks/${app}/${token}/messages/@original`);
  if (!r.ok) return;
  const m: any = await r.json();
  const ref = getFirestore().collection('corrections').doc(candidateId);
  const c: any = (await ref.get()).data();
  if (!c?.discord) return;
  await ref.update({ 'discord.message': String(m.id || ''), 'discord.link': `https://discord.com/channels/${c.discord.guild}/${m.channel_id}/${m.id}`, 'discord.token': null });
}

/** The Confirm button: moderators only. It marks the entry's correction as moderator-confirmed (sources still check it). */
async function confirmButtonPressed(i: any): Promise<any> {
  const id = String(i.data?.custom_id || '').replace(/^qc-confirm:/, '');
  const roles: string[] = Array.isArray(i.member?.roles) ? i.member.roles : [];
  if (!MOD_ROLE() || !roles.includes(MOD_ROLE())) return reply('Only Guide Moderators can confirm corrections.', { ephemeral: true });
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return reply('That button is out of date.', { ephemeral: true });
  const c: any = (await getFirestore().collection('corrections').doc(id).get()).data();
  if (!c) return reply('That correction is no longer waiting.', { ephemeral: true });
  const gref = getFirestore().collection('correctionGroups').doc(c.groupId);
  const g: any = (await gref.get()).data() || {};
  await gref.set({
    modConfirmed: true, modConfirmedBy: reporterKey(String(i.member?.user?.id || '')), modConfirmedAt: Date.now(), updatedAt: Date.now(),
    // A dismissed correction that a moderator confirms is looked at again.
    ...(g.status === 'dismissed' ? { status: 'pending' } : {}),
  }, { merge: true });
  // Update the message: the button goes, the confirmation shows.
  const content = String(i.message?.content || '');
  return { type: 7, data: { content: `${content}\n✅ Confirmed by a Guide Moderator: it skips the 3-reporter rule, but sources still check it.`, components: [], allowed_mentions: { parse: [] } } };
}

export function registerDiscord(app: Express) {
  // Raw body: the signature is over the exact bytes Discord sent (so this is registered before express.json).
  app.post('/api/discord/interactions', express.raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
    const raw = req.body as Buffer;
    if (!verifyDiscordSignature(raw, String(req.headers['x-signature-ed25519'] || ''), String(req.headers['x-signature-timestamp'] || ''), PUBLIC_KEY())) {
      return res.status(401).send('invalid request signature');
    }
    let i: any;
    try {
      i = JSON.parse(raw.toString('utf8'));
    } catch {
      return res.status(400).send('bad body');
    }
    try {
      if (i.type === 1) return res.json({ type: 1 }); // PING (Discord checks the endpoint)
      if (i.type === 4) return res.json({ type: 8, data: { choices: await autocomplete(i.data) } });
      if (i.type === 2 && i.data?.name === 'correction') return res.json(await correctionCommand(i));
      if (i.type === 3 && String(i.data?.custom_id || '').startsWith('qc-confirm:')) return res.json(await confirmButtonPressed(i));
      return res.json(reply('Unknown command.', { ephemeral: true }));
    } catch (e: any) {
      console.error('[discord]', e?.message);
      return res.json(reply('Something went wrong saving that. Please try again later.', { ephemeral: true }));
    }
  });
}
