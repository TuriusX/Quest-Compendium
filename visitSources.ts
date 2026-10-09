/**
 * Where players come from, for the daily summary's "Sources" line: stats/{day} (Central time, like the rest of the
 * daily activity) gets
 *   sources        { home: 3, guide: 2, direct: 5, search: 1, … }   web app visits (one per network per source per day)
 *   sourceQuestions { home: 4, … }                                   questions, by the player's first source
 *   sourceSignups   { guide: 1, … }                                  new accounts, by their first source
 * A source is the ?from= tag on links into the app (guide, home, store, discord), else the referring site (the website
 * itself, a search engine, another site), else direct. Bots, the app's own reloads and test traffic aren't counted.
 * Networks are counted by a short one-way hash (nothing personal stored).
 */
import crypto from 'crypto';
import type { Request } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { statsDay } from './searchGuard';
import { isLocalServer, isTestTraffic } from './testTraffic';

export const TAGS = ['guide', 'home', 'store', 'discord'] as const;
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|python|curl|wget|node|go-http|axios|java\/|facebookexternal|discord|slack|whatsapp|telegram|google-|bingpreview|embedly|quora|pinterest|vkshare|skype/i;

/** A tag the app knows ("guide"), or ''. */
export const cleanTag = (v: unknown): string => {
  const t = String(v || '').toLowerCase().trim();
  return (TAGS as readonly string[]).includes(t) ? t : '';
};

/** The source of one visit: the ?from= tag, else what the referrer says, else direct. '' = don't count (a reload). */
export function sourceOf(from: unknown, referer: unknown, selfHost = ''): string {
  const tag = cleanTag(from);
  if (tag) return tag;
  let host = '';
  try {
    host = new URL(String(referer || '')).hostname.toLowerCase();
  } catch {
    return 'direct';
  }
  if (!host) return 'direct';
  if (selfHost && host === selfHost.toLowerCase()) return ''; // moving around inside the app
  if (/(^|\.)questcompendium\.com$/.test(host)) return 'website';
  if (/(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|naver)\.[a-z.]+$/.test(host)) return 'search';
  if (/(^|\.)(discord\.com|discord\.gg|discordapp\.com)$/.test(host)) return 'discord';
  if (/(^|\.)(itch\.io|steampowered\.com|steamcommunity\.com|microsoft\.com|apps\.microsoft\.com)$/.test(host)) return 'store';
  if (/(^|\.)(reddit\.com|youtube\.com|x\.com|twitter\.com|facebook\.com|tiktok\.com|twitch\.tv)$/.test(host)) return 'social';
  return 'other';
}

const hash = (s: string) => crypto.createHash('sha256').update(`qc-visit:${s}`).digest('hex').slice(0, 12);

/** One page load of the web app (GET / from a browser). */
export function recordVisit(req: Request, ip: string): void {
  if (isLocalServer()) return;
  const ua = String(req.headers['user-agent'] || '');
  if (!ua || BOT.test(ua) || /Electron|QuestCompendiumDeck/i.test(ua)) return;
  const src = sourceOf(req.query.from, req.headers.referer, String(req.headers.host || '').split(':')[0]);
  if (!src) return;
  const d = getFirestore();
  const ref = d.collection('stats').doc(statsDay());
  const who = hash(`${ip}:${src}`);
  d.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() || {};
    const seen: string[] = Array.isArray(cur.visitors) ? cur.visitors : [];
    if (seen.includes(who) || seen.length >= 2000) return;
    const sources: Record<string, number> = cur.sources || {};
    sources[src] = (sources[src] || 0) + 1;
    tx.set(ref, { visitors: [...seen, who], sources, updatedAt: Date.now() }, { merge: true });
  }).catch(() => {});
}

/** A new account's first source (once per account, when it's new). */
export function recordSignupSource(uid: string, src: string): void {
  if (!uid || isTestTraffic(uid)) return;
  void getFirestore().collection('stats').doc(statsDay()).set({ sourceSignups: { [src || 'unknown']: FieldValue.increment(1) }, updatedAt: Date.now() }, { merge: true }).catch(() => {});
}
