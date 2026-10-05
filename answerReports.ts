/**
 * Reports on AI answers (Microsoft Store policy 11.16: players can report inappropriate generated content).
 *
 *   POST /api/report-answer                 { reason, comment?, question?, answer, game?, place?, model?, appVersion?,
 *                                             messageId?, client? }: saved in Firestore answerReports/{id} for review
 *   GET  /api/admin/answer-reports          open and recently decided reports (the Reports tab of /admin/reviews)
 *   POST /api/admin/answer-reports/:id      { action: 'reviewed' | 'actioned' | 'open' } or
 *                                           { action: 'candidate', entryId, claim }: a "wrong or misleading" report about
 *                                           a guide entry becomes a correction candidate (corrections.ts)
 *
 * Who reported is stored only as an anonymised id (a hashed account id, or a hashed IP for players not signed in).
 * Rate limits, per reporter: 10 an hour and 30 a day (and 2,000 reports a day in all), kept in memory.
 */
import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { guidePageFor, type GuidePageForPlace } from './guidesApi';
import { playerHash, saveCandidate, looksLikeSpam, REPORTER_WEIGHT, type EntryRef } from './corrections';

type Mw = (req: Request, res: Response, next: NextFunction) => any;

export const REPORT_REASONS = ['harmful', 'wrong', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_STATUSES = ['open', 'reviewed', 'actioned'] as const;

const db = () => getFirestore();
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, n);
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ---- rate limits (in memory; a restart resets them) ----
const hourly = new Map<string, number[]>();
const daily = new Map<string, { day: string; n: number }>();
let total = { day: '', n: 0 };
export function reportAllowed(reporter: string, now = Date.now()): boolean {
  const day = new Date(now).toISOString().slice(0, 10);
  if (total.day !== day) total = { day, n: 0 };
  if (total.n >= 2000) return false;
  const recent = (hourly.get(reporter) || []).filter((t) => now - t < 3_600_000);
  const d = daily.get(reporter);
  const today = d && d.day === day ? d.n : 0;
  if (recent.length >= 10 || today >= 30) return false;
  recent.push(now);
  hourly.set(reporter, recent);
  daily.set(reporter, { day, n: today + 1 });
  total.n++;
  return true;
}

/**
 * Guide entries an answer talks about, for a "wrong or misleading" report: the entries on the place's guide page whose
 * names appear in the answer (items, key fights, then secrets and checklist lines by their opening words). At most 8.
 */
export function entriesInAnswer(page: Pick<GuidePageForPlace, 'items' | 'secrets' | 'sections' | 'fights'>, answer: string): EntryRef[] {
  const text = ` ${norm(answer)} `;
  const has = (name: string) => {
    const n = norm(name);
    return n.length >= 4 && text.includes(` ${n} `);
  };
  const head = (s: string) => norm(s).split(' ').slice(0, 4).join(' ');
  const out: EntryRef[] = [
    ...(page.items || []).filter((x: any) => has(x.name)).map((x: any) => ({ id: String(x.id), kind: 'item' as const, name: String(x.name), text: String(x.where || '') })),
    ...(page.fights || []).filter((x: any) => has(x.name)).map((x: any) => ({ id: String(x.id), kind: 'fight' as const, name: String(x.name), text: [x.enemies, x.tactics].filter(Boolean).join(' · ') })),
    ...(page.secrets || []).filter((x: any) => head(x.text || x.name || '').split(' ').length >= 3 && has(head(x.text || x.name || ''))).map((x: any) => ({ id: String(x.id), kind: 'secret' as const, name: String(x.text || x.name || '').slice(0, 80), text: String(x.text || '') })),
    ...(page.sections || []).flatMap((s) => s.entries).filter((x) => head(x.text).split(' ').length >= 3 && has(head(x.text))).map((x) => ({ id: String(x.id), kind: 'section' as const, name: String(x.text).slice(0, 80), text: String(x.text) })),
  ];
  return out.slice(0, 8);
}

/** The anonymised reporter: a signed-in or guest account's hashed id, else a hashed IP. */
function reporterOf(req: Request): { key: string; signedIn: boolean } {
  const uid = (req as any).user?.uid as string | undefined;
  if (uid && !String(uid).startsWith('guest_')) return { key: playerHash(uid), signedIn: true };
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer guest_')) return { key: `guest:${playerHash(auth.slice(7))}`, signedIn: false };
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  return { key: `ip:${crypto.createHash('sha256').update(`${process.env.CORRECTION_SALT || 'qc-corrections'}:ip:${ip}`).digest('hex').slice(0, 20)}`, signedIn: false };
}

export function registerAnswerReports(app: Express, deps: { requireAuth: Mw; optionalAuth: Mw; isAdmin: (user: any) => boolean }) {
  const reports = () => db().collection('answerReports');

  app.post('/api/report-answer', deps.optionalAuth, async (req: Request, res: Response) => {
    const b = req.body || {};
    const reason = String(b.reason || '') as ReportReason;
    if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ error: 'Pick a reason.' });
    const answer = cut(b.answer, 12000);
    if (!answer) return res.status(400).json({ error: 'Nothing to report.' });
    const who = reporterOf(req);
    if (!reportAllowed(who.key)) return res.status(429).json({ error: 'Too many reports right now. Please try again later.' });
    const messageId = cut(b.messageId, 80).replace(/[^A-Za-z0-9_-]/g, '');
    // One report per answer per player: reporting the same answer again updates the report.
    const id = messageId ? crypto.createHash('sha256').update(`${who.key}:${messageId}`).digest('hex').slice(0, 28) : '';
    const game = cut(b.game, 160), place = cut(b.place, 160);
    const report: Record<string, unknown> = {
      reason, comment: cut(b.comment, 1000), question: cut(b.question, 4000), answer,
      game, place, model: cut(b.model, 80), appVersion: cut(b.appVersion, 40), client: cut(b.client, 20) || 'desktop',
      reporterKey: who.key, signedIn: who.signedIn, status: 'open', createdAt: Date.now(), updatedAt: Date.now(),
    };
    try {
      // "Wrong or misleading": the guide page for the place, and the entries the answer talks about, so the report can
      // become a correction candidate on the Reports tab.
      if (reason === 'wrong' && game && place) {
        const page = await guidePageFor(game, place);
        if (page) report.guide = { key: page.key, slug: page.slug, name: page.name, entries: entriesInAnswer(page, answer) };
      }
      if (id) await reports().doc(id).set(report, { merge: true });
      else await reports().add(report);
      res.json({ ok: true });
    } catch (e: any) {
      console.error('[report-answer] save failed:', e?.message);
      res.status(500).json({ error: 'Could not save the report.' });
    }
  });

  const requireAdmin: Mw = (req, res, next) => (deps.isAdmin((req as any).user) ? next() : res.status(403).json({ error: 'Not an admin.' }));

  app.get('/api/admin/answer-reports', deps.requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const snap = await reports().orderBy('updatedAt', 'desc').limit(300).get();
      // No reporter ids on the page: only whether they were signed in.
      const items = snap.docs.map((d) => {
        const { reporterKey: _k, ...r } = d.data() as any;
        return { id: d.id, ...r };
      });
      res.json({ open: items.filter((i) => i.status === 'open'), decided: items.filter((i) => i.status !== 'open').slice(0, 60) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load the reports.' });
    }
  });

  app.post('/api/admin/answer-reports/:id', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const action = String(req.body?.action || '');
    const ref = reports().doc(String(req.params.id));
    const r: any = (await ref.get()).data();
    if (!r) return res.status(404).json({ error: 'No such report.' });
    const by = String((req as any).user?.email || '');
    if ((REPORT_STATUSES as readonly string[]).includes(action)) {
      await ref.set({ status: action, decidedBy: by, decidedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
      return res.json({ ok: true });
    }
    if (action !== 'candidate') return res.status(400).json({ error: 'Unknown action.' });
    // A correction candidate from a "wrong or misleading" report: the entry the admin picked and what's correct.
    const entry: EntryRef | undefined = (r.guide?.entries || []).find((e: EntryRef) => e.id === String(req.body?.entryId || ''));
    const claim = cut(req.body?.claim, 500).replace(/\s+/g, ' ');
    if (!r.guide || !entry) return res.status(400).json({ error: 'Pick the guide entry the report is about.' });
    if (claim.length < 8 || looksLikeSpam(claim)) return res.status(400).json({ error: 'Say what is correct (a short, specific sentence).' });
    const cid = await saveCandidate({
      gameKey: r.guide.key, game: r.game, area: r.guide.slug, areaName: r.guide.name, entry, claim, field: entry.kind === 'item' ? 'where' : 'notes',
      via: 'report', question: r.question, reporterKey: r.reporterKey, source: 'app',
      weight: r.signedIn ? REPORTER_WEIGHT.app : REPORTER_WEIGHT.appGuest, guest: !r.signedIn, dailyLimit: 1000,
      extra: { answerReport: ref.id },
    });
    if (!cid) return res.status(409).json({ error: 'Not saved: this reporter already made the same correction.' });
    await ref.set({ status: 'actioned', candidateId: cid, decidedBy: by, decidedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    res.json({ ok: true, candidateId: cid });
  });
}
