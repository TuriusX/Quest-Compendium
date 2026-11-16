/**
 * Visual answers, server side (owner's request Nov 14 2026). Off unless VISUAL_ANSWERS=1; videos also need the
 * YouTube key (Secret Manager YOUTUBE_API_KEY, mounted as an env var on Cloud Run).
 *
 *   POST /api/visual        { game, guideKey?, question, answer, client }  ->  { visual | null, ref }
 *                           Called by the app AFTER the answer has arrived (the answer itself never waits or changes).
 *   POST /api/visual/event  { type: played | opened | wrong, ref? }  "wrong" ("Not right") drops the saved visual and
 *                           keeps it from being picked for that question or topic again.
 *
 * Saved results: visualCache/{sha1(key)}. Day counts for /stats: visualStats/{YYYY-MM-DD} (UTC). Today's YouTube
 * searches: system/visualAnswers {searchDay (Pacific, when YouTube's quota resets), searches}; past the limit
 * (YOUTUBE_DAILY_SEARCHES, default 100) answers simply show no video until the next day.
 */
import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { visualFor, visualId, communityWikis, YouTubeQuotaOut, type Cost, type Visual, type VisualStore } from './visualAnswer';
import { communityWikisFor, rememberPictureSite, type CommunityWiki } from './scripts/guides/suggestImages';
import { GENERATED } from './src/locales.generated';

/**
 * The app's stand-in question when the player sent only a screenshot or a voice message (ChatArea: chat.defaultShotQ,
 * chat.defaultQ, chat.voiceMessage), in every language: such a question gets its topic from the answer (owner, Nov 14
 * 2026). The app says so itself from 0.7.4 (shotOnly); this also covers 0.7.3. English, Spanish and Portuguese are in
 * src/i18n.tsx (React), so they're listed here.
 */
const STAND_IN_KEYS = ['chat.defaultShotQ', 'chat.defaultQ', 'chat.voiceMessage'];
const STAND_INS = new Set<string>([
  'Please analyze this game screenshot and give helpful tips, secrets, or my current objectives.',
  'What should I do here? Please give gameplay tips, secrets, or next steps.',
  'Voice message',
  'Analiza esta captura del juego y dame consejos útiles, secretos u objetivos actuales.',
  '¿Qué debo hacer aquí? Dame consejos de juego, secretos o próximos pasos.',
  'Mensaje de voz',
  'Analise esta captura do jogo e me dê dicas úteis, segredos ou os objetivos atuais.',
  'O que eu devo fazer aqui? Me dê dicas de gameplay, segredos ou próximos passos.',
  'Mensagem de voz',
  ...Object.values(GENERATED).flatMap((l) => STAND_IN_KEYS.map((k) => l[k]).filter(Boolean)),
].map((s) => s.trim().toLowerCase()));
export const isStandInQuestion = (q: string) => STAND_INS.has(String(q || '').trim().toLowerCase());

type Gen = Parameters<typeof visualFor>[0];

/** The YouTube day is Pacific time (its quota resets at midnight there). */
export const pacificDay = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
export const keyDoc = (k: string) => crypto.createHash('sha1').update(k).digest('hex');
/** A local test run writes to test_ collections (VISUAL_TEST_PREFIX=test_, never on Cloud Run), removed afterwards. */
const P = !process.env.K_SERVICE ? String(process.env.VISUAL_TEST_PREFIX || '').replace(/[^a-z_]/g, '') : '';
const C = { cache: `${P}visualCache`, stats: `${P}visualStats`, sys: `${P}visualAnswers` };

export function firestoreStore(): VisualStore {
  const col = () => getFirestore().collection(C.cache);
  return {
    async get(keys) {
      for (const k of keys) {
        const d = await col().doc(keyDoc(k)).get();
        if (d.exists) return d.data() as any;
      }
      return null;
    },
    async set(keys, visual, excluded) {
      const batch = getFirestore().batch();
      for (const k of keys) batch.set(col().doc(keyDoc(k)), { key: k, visual, at: Date.now(), excluded: excluded || [] });
      await batch.commit();
    },
  };
}

/** Adds to today's counts (visualStats/{UTC day}). */
export async function countVisual(fields: Record<string, number>, t = Date.now()): Promise<void> {
  const inc: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) if (v) inc[k] = FieldValue.increment(v);
  if (Object.keys(inc).length) await getFirestore().collection(C.stats).doc(utcDay(t)).set(inc, { merge: true });
}

/** Reserves one of today's YouTube searches; throws YouTubeQuotaOut once the day's limit is used. */
export function searchBudget(limit: number): () => Promise<void> {
  return async () => {
    const ref = getFirestore().collection('system').doc(C.sys);
    const day = pacificDay();
    const ok = await getFirestore().runTransaction(async (tx) => {
      const d: any = (await tx.get(ref)).data() || {};
      const used = d.searchDay === day ? Number(d.searches) || 0 : 0;
      if (used >= limit) return false;
      tx.set(ref, { searchDay: day, searches: used + 1 }, { merge: true });
      return true;
    });
    if (!ok) throw new YouTubeQuotaOut(`today's ${limit} YouTube searches are used up`);
  };
}

/** What a shown visual counts as in /stats. */
export const statKind = (v: Visual) => (v.kind === 'picture' ? (v.source === 'ours' ? 'ours' : 'wiki') : v.kind);

type VisualDeps = {
  requireAuth: any;
  getGeminiClient: () => Gen;
  log?: Cost['log'];
  guideKeyFor: (game: string) => Promise<string | null>;
  env?: NodeJS.ProcessEnv;
};

/** Visual answers are on (VISUAL_ANSWERS=1 on the server). */
export const visualAnswersOn = (env: NodeJS.ProcessEnv = process.env) => env.VISUAL_ANSWERS === '1';

/**
 * The visual for one answer, counted for /stats: used by the app's /api/visual and the website's ask box
 * (siteAsk.ts /api/site/visual). `visual` is null when nothing helps or nothing confident was found.
 */
export async function answerVisual(deps: Pick<VisualDeps, 'getGeminiClient' | 'log' | 'guideKeyFor' | 'env'>, o: { game: string; guideKey?: string; question: string; answer: string; client: string; appVersion?: string; shotOnly?: boolean }): Promise<{ visual: Visual | null; ref: string | null; cost: number }> {
  const env = deps.env ?? process.env;
  const shotOnly = o.shotOnly === true || isStandInQuestion(o.question);
  const keyOf = async (game: string) => (await deps.guideKeyFor(game)) || game.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const wikiOf = async (gameKey: string, game = o.game) => {
    const src: any = (await getFirestore().collection('guideImageSources').doc(gameKey).get()).data() || {};
    // Community wikis: the override, else found once from the name (a first lookup waits at most 6 s and finishes in
    // the background, remembered for the next answer).
    const found = communityWikis(gameKey).length ? Promise.resolve(communityWikis(gameKey))
      : communityWikisFor(gameKey, game, src, deps.getGeminiClient()).catch(() => [] as CommunityWiki[]);
    const more = await Promise.race([found, new Promise<CommunityWiki[]>((r) => setTimeout(() => r([]), 6000))]);
    return { fextralife: src.fextralife?.domain || '', fandom: src.wiki?.domain || '', more, prefer: (src.pictureSites || []) as string[] };
  };
  const gameKey = String(o.guideKey || '').replace(/[^a-z0-9-]/g, '').slice(0, 120) || (await keyOf(o.game));
  const key = String(env.YOUTUBE_API_KEY || '');
  const r = await visualFor(deps.getGeminiClient(), {
    game: o.game, gameKey, question: o.question, answer: o.answer, youtubeKey: key, shotOnly,
    wiki: await wikiOf(gameKey),
    store: firestoreStore(), log: deps.log,
    beforeSearch: key ? searchBudget(Number(env.YOUTUBE_DAILY_SEARCHES) || 100) : async () => { throw new YouTubeQuotaOut('no YouTube key'); },
    // A question about another game than the compendium's: that game's guide key and wikis.
    otherGame: async (name) => { const k = await keyOf(name); return { gameKey: k, wiki: await wikiOf(k, name) }; },
  });
  const v = r.visual;
  // A picture from the web (not one of the game's known wikis): its site is remembered for the game.
  if (v.kind === 'picture' && !r.cached && (v as any).page?.site && !/^(Fextralife|Fandom)$/.test((v as any).page.site)) {
    const w = await wikiOf(gameKey).catch(() => null);
    if (w && !(w.more || []).some((m) => m.site === (v as any).page.site)) void rememberPictureSite(gameKey, (v as any).page.site).catch(() => {});
  }
  const client = String(o.client || 'web').replace(/[^a-z]/g, '').slice(0, 8) || 'web';
  // One line per visual (owner, Nov 14 2026: why did a question get none?): the app, the game, the kind chosen, the result
  // and the steps. No player id or question beyond the first 80 characters.
  console.log(`[visual] ${client}${o.appVersion ? ` ${String(o.appVersion).replace(/[^0-9a-z.\-]/gi, '').slice(0, 20)}` : ''} | ${r.game} | ${shotOnly ? '(screenshot only) ' : ''}"${o.question.replace(/\s+/g, ' ').slice(0, 80)}" | chose ${r.kindChosen || '?'} -> ${v.kind}${v.kind === 'video' ? ` ${v.videoId}` : ''}${r.cached ? ' (saved)' : ''} | ${r.youtubeSearches} search(es) $${r.cost.toFixed(4)} | ${r.steps.join(' / ').replace(/\s+/g, ' ').slice(0, 900)}`);
  void countVisual({
    answers: 1, [`shown_${statKind(v)}`]: 1, cached: r.cached ? 1 : 0, quotaOut: r.quotaOut ? 1 : 0,
    youtubeSearches: r.youtubeSearches, cost: Math.round(r.cost * 1e6) / 1e6, [`client_${client}`]: 1,
  }).catch(() => {});
  return { visual: v.kind === 'none' ? null : v, ref: r.keys[0] ? keyDoc(r.keys[0]) : null, cost: r.cost };
}

export function registerVisualAnswers(app: Express, deps: VisualDeps): void {
  const env = deps.env ?? process.env;
  const on = () => visualAnswersOn(env);
  const perUserHourly = Number(env.VISUAL_PER_USER_HOURLY) || 60;
  const hourly = new Map<string, { n: number; reset: number }>();
  setInterval(() => { const t = Date.now(); for (const [k, v] of hourly) if (t >= v.reset) hourly.delete(k); }, 60_000).unref();

  app.post('/api/visual', deps.requireAuth, async (req: Request, res: Response) => {
    if (!on()) return res.json({ visual: null, off: true });
    const game = String(req.body?.game ?? '').trim().slice(0, 120);
    const question = String(req.body?.question ?? '').trim().slice(0, 500);
    const answer = String(req.body?.answer ?? '').trim().slice(0, 6000);
    if (!game || !question || !answer) return res.json({ visual: null });
    const uid = String((req as any).user?.uid ?? '');
    const t = Date.now();
    let w = hourly.get(uid);
    if (!w || t >= w.reset) hourly.set(uid, (w = { n: 0, reset: t + 3600_000 }));
    if (w.n++ >= perUserHourly) return res.json({ visual: null, limited: true });
    try {
      const r = await answerVisual(deps, { game, guideKey: String(req.body?.guideKey || ''), question, answer, client: String(req.body?.client || 'web'), appVersion: String(req.body?.appVersion || ''), shotOnly: req.body?.shotOnly === true });
      res.json({ visual: r.visual, ref: r.ref });
    } catch (e: any) {
      console.warn('[visual] failed:', e?.message || e);
      res.json({ visual: null });
    }
  });

  app.post('/api/visual/event', deps.requireAuth, async (req: Request, res: Response) => {
    const type = String(req.body?.type ?? '');
    if (!['played', 'opened', 'wrong'].includes(type)) return res.status(400).json({ ok: false });
    await visualEvent(type as any, String(req.body?.ref ?? ''), 1);
    res.json({ ok: true });
  });
}

/**
 * Played, opened or "Not right", counted for /stats. "Not right" drops the saved visual everywhere it's saved and keeps
 * it from being picked again once `dropAt` players have said so (1 in the app, where players are signed in or have a
 * guest id; 2 on the website, where anyone can ask, so one visitor can't remove a good video alone).
 */
export async function visualEvent(type: 'played' | 'opened' | 'wrong', refId: string, dropAt: number): Promise<void> {
  void countVisual({ [type]: 1 }).catch(() => {});
  if (type !== 'wrong' || !/^[0-9a-f]{40}$/.test(refId)) return;
  try {
    const col = getFirestore().collection(C.cache);
    const ref = col.doc(refId);
    const d: any = (await ref.get()).data();
    if (!d?.visual || d.visual.kind === 'none') return;
    const votes = (Number(d.wrongVotes) || 0) + 1;
    if (votes < dropAt) { await ref.set({ wrongVotes: votes }, { merge: true }); return; }
    const id = visualId(d.visual);
    // Every saved key showing that same visual loses it; the next asker gets a fresh look without it.
    const field = d.visual.kind === 'video' ? 'visual.videoId' : 'visual.url';
    const same = await col.where(field, '==', id).limit(50).get();
    const batch = getFirestore().batch();
    for (const doc of same.docs) batch.set(doc.ref, { visual: { kind: 'none', why: 'marked not right' }, at: 0, wrongVotes: 0, excluded: FieldValue.arrayUnion(id) }, { merge: true });
    await batch.commit();
  } catch (e: any) {
    console.warn('[visual] not-right failed:', e?.message || e);
  }
}

/**
 * The /stats section (ownerStats.ts): visuals shown by kind, how often a saved one was reused, cost per answer, plays,
 * opens and "Not right", and today's YouTube searches against the free limit. `label` is the window ("last 7 days").
 */
export function visualStatsLine(s: { days: Record<string, any>[]; searchesToday: number; searchLimit: number }, label: string): string {
  const sum = (k: string) => s.days.reduce((n, d) => n + (Number(d[k]) || 0), 0);
  const answers = sum('answers');
  const shown = sum('shown_video') + sum('shown_ours') + sum('shown_wiki') + sum('shown_link');
  const pct = (n: number) => (answers ? ` (${Math.round((100 * n) / answers)}%)` : '');
  const cost = sum('cost');
  return [
    `**Visual answers** (${label}): ${answers} answer(s) looked at, ${shown} got one${pct(shown)}`,
    `Video ${sum('shown_video')} · our picture ${sum('shown_ours')} · wiki picture ${sum('shown_wiki')}${sum('shown_link') ? ` · wiki page only ${sum('shown_link')}` : ''} · nothing ${sum('shown_none')} · saved one reused ${sum('cached')}`,
    `Cost: $${cost.toFixed(2)}${answers ? ` ($${(cost / answers).toFixed(4)} per answer)` : ''} · played ${sum('played')} · pictures opened ${sum('opened')} · "Not right" ${sum('wrong')}`,
    `YouTube searches today: ${s.searchesToday} of ${s.searchLimit}${sum('quotaOut') ? ` · ${sum('quotaOut')} answer(s) got no video because the day's searches were used up` : ''}`,
  ].join('\n');
}

/** For /stats: the last `days` days of counts, and today's YouTube searches against the limit. */
export async function visualStatsFor(days = 7): Promise<{ days: Record<string, any>[]; searchesToday: number; searchLimit: number }> {
  const db = getFirestore();
  const list = Array.from({ length: days }, (_, i) => utcDay(Date.now() - i * 86400_000));
  const docs = await Promise.all(list.map((day) => db.collection(C.stats).doc(day).get()));
  const sys: any = (await db.collection('system').doc(C.sys).get()).data() || {};
  return {
    days: docs.map((d, i) => ({ day: list[i], ...(d.data() || {}) })),
    searchesToday: sys.searchDay === pacificDay() ? Number(sys.searches) || 0 : 0,
    searchLimit: Number(process.env.YOUTUBE_DAILY_SEARCHES) || 100,
  };
}
