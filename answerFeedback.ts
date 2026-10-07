/**
 * Answer quality: players' one-tap 👍 / 👎 on AI answers, and how often the markers' close-up check drops a marker.
 *
 *   POST /api/answer-feedback        { messageId, vote: 'up' | 'down', reason?: 'place' | 'info' | 'marker' | 'unhelpful',
 *                                      qtype?, game?, model?, markers?, question?, answer?, client? }
 *                                    saved in Firestore answerFeedback/{id}, one per answer per player (voting again
 *                                    replaces it; vote 'none' takes it back)
 *   GET  /api/admin/answer-quality   the Quality tab of /admin/reviews: the 👍 rate per game, per question type and per
 *                                    model (last 30 days), recent 👎s with their answers, and marker drops per game
 *
 * Marker drops (recordMarkerCheck, from the close-up check in locate.ts) are counted per game and day in
 * markerStats/{gameKey}. Voters are stored only as an anonymised id, like reports (answerReports.ts).
 */
import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { playerHash } from './corrections';
import { QUESTION_TYPES } from './src/utils/questionType';

type Mw = (req: Request, res: Response, next: NextFunction) => any;

export const FEEDBACK_REASONS = ['place', 'info', 'marker', 'unhelpful'] as const;
const db = () => getFirestore();
const cut = (v: unknown, n: number) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, n);
const gameKeyOf = (g: string) => g.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'unknown';

// Rate limit per voter: 120 an hour (kept in memory; a restart resets it).
const hourly = new Map<string, number[]>();
export function feedbackAllowed(voter: string, now = Date.now()): boolean {
  const recent = (hourly.get(voter) || []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 120) return false;
  recent.push(now);
  hourly.set(voter, recent);
  return true;
}

function voterOf(req: Request): string {
  const uid = (req as any).user?.uid as string | undefined;
  if (uid) return playerHash(uid);
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  return `ip:${crypto.createHash('sha256').update(`${process.env.CORRECTION_SALT || 'qc-corrections'}:ip:${ip}`).digest('hex').slice(0, 20)}`;
}

/** The close-up check looked at `checked` markers and kept `kept`: counted per game and day. */
export async function recordMarkerCheck(game: string, checked: number, kept: number): Promise<void> {
  if (!checked) return;
  const day = new Date().toISOString().slice(0, 10);
  const dropped = Math.max(0, checked - kept);
  try {
    await db().collection('markerStats').doc(gameKeyOf(game || 'unknown')).set({
      game: cut(game, 160) || 'Unknown',
      checked: FieldValue.increment(checked), dropped: FieldValue.increment(dropped), checks: FieldValue.increment(1),
      days: { [day]: { checked: FieldValue.increment(checked), dropped: FieldValue.increment(dropped) } },
      updatedAt: Date.now(),
    }, { merge: true });
  } catch (e: any) {
    console.warn('[markers] drop count not saved:', e?.message);
  }
}

type Tally = { up: number; down: number };
/** The 👍 rate per group: [{ key, up, down, rate }], most votes first. */
export function tallyBy(rows: { vote: string }[], keyOf: (r: any) => string): { key: string; up: number; down: number; rate: number }[] {
  const m = new Map<string, Tally>();
  for (const r of rows) {
    if (r.vote !== 'up' && r.vote !== 'down') continue;
    const k = keyOf(r) || 'unknown';
    const t = m.get(k) || { up: 0, down: 0 };
    t[r.vote as 'up' | 'down']++;
    m.set(k, t);
  }
  return [...m].map(([key, t]) => ({ key, ...t, rate: Math.round((t.up / (t.up + t.down)) * 100) })).sort((a, b) => b.up + b.down - (a.up + a.down));
}

export function registerAnswerFeedback(app: Express, deps: { requireAuth: Mw; optionalAuth: Mw; isAdmin: (user: any) => boolean }) {
  const col = () => db().collection('answerFeedback');

  app.post('/api/answer-feedback', deps.optionalAuth, async (req: Request, res: Response) => {
    const b = req.body || {};
    const vote = String(b.vote || '');
    if (!['up', 'down', 'none'].includes(vote)) return res.status(400).json({ error: 'Vote up or down.' });
    const messageId = cut(b.messageId, 80).replace(/[^A-Za-z0-9_-]/g, '');
    if (!messageId) return res.status(400).json({ error: 'Which answer?' });
    const voter = voterOf(req);
    if (!feedbackAllowed(voter)) return res.status(429).json({ error: 'Too many votes right now.' });
    const id = crypto.createHash('sha256').update(`${voter}:${messageId}`).digest('hex').slice(0, 28);
    try {
      if (vote === 'none') {
        await col().doc(id).delete();
        return res.json({ ok: true });
      }
      const reason = (FEEDBACK_REASONS as readonly string[]).includes(String(b.reason)) ? String(b.reason) : null;
      const qtype = (QUESTION_TYPES as string[]).includes(String(b.qtype)) ? String(b.qtype) : 'general';
      await col().doc(id).set({
        vote, reason, qtype, game: cut(b.game, 160), model: cut(b.model, 80), markers: b.markers === true,
        client: cut(b.client, 20) || 'desktop', question: cut(b.question, 1000),
        // The answer is kept for 👎s only (the Quality tab shows them).
        answer: vote === 'down' ? cut(b.answer, 6000) : null,
        voterKey: voter, at: Date.now(),
      });
      res.json({ ok: true });
    } catch (e: any) {
      console.error('[answer-feedback] save failed:', e?.message);
      res.status(500).json({ error: 'Could not save the vote.' });
    }
  });

  const requireAdmin: Mw = (req, res, next) => (deps.isAdmin((req as any).user) ? next() : res.status(403).json({ error: 'Not an admin.' }));

  app.get('/api/admin/answer-quality', deps.requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const since = Date.now() - 30 * 86_400_000;
      const rows = (await col().where('at', '>=', since).orderBy('at', 'desc').limit(3000).get()).docs.map((d) => {
        const { voterKey: _v, ...r } = d.data() as any;
        return { id: d.id, ...r };
      });
      const up = rows.filter((r) => r.vote === 'up').length, down = rows.filter((r) => r.vote === 'down').length;
      const markers = (await db().collection('markerStats').orderBy('checked', 'desc').limit(40).get()).docs.map((d) => {
        const m: any = d.data();
        return { key: d.id, game: m.game, checked: m.checked || 0, dropped: m.dropped || 0, checks: m.checks || 0, rate: m.checked ? Math.round(((m.dropped || 0) / m.checked) * 100) : 0 };
      });
      res.json({
        total: { up, down, rate: up + down ? Math.round((up / (up + down)) * 100) : null },
        byGame: tallyBy(rows, (r) => r.game || 'No game').slice(0, 40),
        byType: tallyBy(rows, (r) => r.qtype),
        byModel: tallyBy(rows, (r) => r.model),
        byMarkers: tallyBy(rows, (r) => (r.markers ? 'markers shown' : 'no markers')),
        reasons: Object.fromEntries(FEEDBACK_REASONS.map((x) => [x, rows.filter((r) => r.vote === 'down' && r.reason === x).length])),
        recentDown: rows.filter((r) => r.vote === 'down').slice(0, 40),
        markers,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load the numbers.' });
    }
  });
}
