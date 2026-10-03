/**
 * Player corrections to the guides: learned from conversations, never trusted from any single player.
 *
 * Collect (here, in /api/chat): when an answer corrects what the guide notes say about an entry in the player's area —
 * after the player pushed back ("that's wrong", "it's not there", "actually…") or because the player asked about it
 * directly — the model adds a <qc-correction> block. Its entry is matched to the guide page (by name, as the tracker
 * details do) and saved as a candidate in corrections/{id}: the game and area, the entry, the guide's current text, the
 * corrected claim, how it came up, an anonymised player id and the date. Text only, never screenshots.
 *
 * Verify (scripts/guides/corrections.ts, from the daily pipeline): candidates are grouped by entry in
 * correctionGroups/{game}__{area}__{entry}, checked against web sources and by the reviewer, and applied to the guide
 * through a staged copy and the review gate (confirmed by sources), applied once 3+ different signed-in players agree
 * (not checkable), or dismissed (contradicted). A verified correction goes into the prompt for its area at once
 * (verifiedCorrectionsForPrompt), before the guide page is republished.
 *
 * Routes:
 *   POST /api/corrections/confirm-place   { ids }: the player tapped "That's right" on the answer that made them
 *   GET  /api/admin/corrections           pending and disputed groups (the review queue page's Corrections tab)
 *   POST /api/admin/corrections/:id       { action: 'apply' | 'dismiss' }
 */
import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import type { GuidePageForPlace } from './guidesApi';

type Mw = (req: Request, res: Response, next: NextFunction) => any;

/** What the model is asked to add when it corrects the guide notes (only when there are guide notes for the place). */
export const CORRECTION_RULES = `
- Guide corrections: if this answer corrects what the GUIDE NOTES above say about one of their entries (where it is,
  how to get it, what it takes), because the player said it's wrong or because you checked and the notes are wrong or
  too vague to follow, add one line at the very end (removed before the player sees it):
<qc-correction>{"entry": "<the entry's name, or the start of its line, exactly as in the guide notes>", "guide": "<what the notes say>", "claim": "<the corrected fact: short, specific and self-contained, e.g. where exactly and how to reach it>", "field": "where"}</qc-correction>
  "field" is where, how or notes. Only for a real correction of the notes, never when you agree with them, and never
  for something the notes don't mention. One line per corrected entry.`;

export type CorrectionOut = { entry: string; guide: string; claim: string; field: 'where' | 'how' | 'notes' };

/** Pull the <qc-correction> lines out of an answer (always removed from the text). */
export function extractCorrections(text: string): { text: string; corrections: CorrectionOut[] } {
  const corrections: CorrectionOut[] = [];
  const cleaned = text.replace(/(?:```[a-z]*\s*)?<qc-correction>([\s\S]*?)<\/qc-correction>(?:\s*```)?/gi, (_m, body) => {
    try {
      const j = JSON.parse(String(body).trim());
      const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
      const c: CorrectionOut = {
        entry: str(j?.entry, 160),
        guide: str(j?.guide, 400),
        claim: str(j?.claim, 500),
        field: ['where', 'how', 'notes'].includes(j?.field) ? j.field : 'where',
      };
      if (c.entry && c.claim) corrections.push(c);
    } catch {
      /* a broken line is dropped */
    }
    return '';
  });
  return { text: cleaned.replace(/\n{3,}/g, '\n\n'), corrections: corrections.slice(0, 3) };
}

/** Did the player push back on the last answer? ("that's wrong", "it's not there", "actually…", in a few languages.) */
export function isPushback(question: string): boolean {
  const q = ` ${String(question || '').toLowerCase()} `;
  return /(that'?s|thats|it'?s|you'?re|youre) (wrong|not right|incorrect|not there)|\bnot there\b|\bisn'?t there\b|\bwrong\b|\bincorrect\b|\bactually\b|\bno,? it'?s\b|\bnope\b|\bmistake\b|\bnot where\b|no está|equivocad|incorrect[oa]|não está|errad[oa]|falsch|stimmt nicht|faux|неправильно|не там|違う|틀렸|不对|错了/.test(q);
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export type EntryRef = { id: string; kind: 'item' | 'secret' | 'section'; name: string; text: string };

/**
 * The guide entry a correction names: an item by its name, else a secret or checklist line whose text starts with (or
 * contains) what the model quoted. Null when nothing matches well enough.
 */
export function matchGuideEntry(page: Pick<GuidePageForPlace, 'items' | 'secrets' | 'sections'>, entry: string): EntryRef | null {
  // The model often copies a whole line of the guide notes: drop its label ("Item:", "Secret:", a section title) and an
  // item's "(where)" part.
  let raw = String(entry || '').replace(/^\s*(item|secret|enemy|shop\/npc|tip)\s*:\s*/i, '');
  for (const s of page.sections || []) if (s.title && raw.toLowerCase().startsWith(`${s.title.toLowerCase()}:`)) raw = raw.slice(s.title.length + 1);
  const e = norm(raw.replace(/\s*\([^)]*\)?\s*(\[missable\])?\s*$/i, '') || raw);
  if (e.length < 3) return null;
  const item = (page.items || []).find((x: any) => norm(x.name) === e) || (page.items || []).find((x: any) => norm(x.name).length >= 4 && (e.startsWith(norm(x.name)) || norm(x.name).startsWith(e)));
  if (item) return { id: String(item.id), kind: 'item', name: String(item.name || ''), text: String(item.where || '') };
  const lines: EntryRef[] = [
    ...(page.secrets || []).map((x: any) => ({ id: String(x.id), kind: 'secret' as const, name: String(x.text || x.name || '').slice(0, 80), text: String(x.text || '') })),
    ...(page.sections || []).flatMap((s) => s.entries.map((x) => ({ id: String(x.id), kind: 'section' as const, name: String(x.text || '').slice(0, 80), text: String(x.text || '') }))),
  ];
  const head = e.slice(0, 60);
  return lines.find((l) => norm(l.text).startsWith(head)) || (e.length >= 12 ? lines.find((l) => norm(l.text).includes(head)) : undefined) || null;
}

/** The anonymised player id stored with a candidate (never the account id itself). */
export const playerHash = (uid: string) =>
  crypto.createHash('sha256').update(`${process.env.CORRECTION_SALT || 'qc-corrections'}:${uid}`).digest('hex').slice(0, 20);

export const groupId = (gameKey: string, slug: string, entryId: string) => `${gameKey}__${slug}__${entryId}`.slice(0, 400);

// At most 20 candidates per player a day (kept in memory; a restart resets it).
const perPlayer = new Map<string, { day: string; n: number }>();
function allowed(uidHash: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const c = perPlayer.get(uidHash);
  if (!c || c.day !== day) {
    perPlayer.set(uidHash, { day, n: 1 });
    return true;
  }
  if (c.n >= 20) return false;
  c.n++;
  return true;
}

/**
 * Save the answer's corrections that match an entry of the guide page as candidates. Returns their ids (the app sends
 * them back when the player taps "That's right", which confirms the area they're about).
 */
export async function saveCorrectionCandidates(opts: {
  page: GuidePageForPlace | null;
  corrections: CorrectionOut[];
  question: string;
  uid: string;
  isGuest: boolean;
  game: string;
}): Promise<string[]> {
  const { page, corrections } = opts;
  if (!page || !corrections.length || !opts.uid) return [];
  const uidHash = playerHash(opts.uid);
  const pushback = isPushback(opts.question);
  const ids: string[] = [];
  for (const c of corrections) {
    const entry = matchGuideEntry(page, c.entry);
    if (!entry || !allowed(uidHash)) continue;
    try {
      const ref = await getFirestore().collection('corrections').add({
        gameKey: page.key, game: opts.game.slice(0, 120), area: page.slug, areaName: page.name,
        entryId: entry.id, entryKind: entry.kind, entryName: entry.name, guideText: entry.text.slice(0, 600),
        claim: c.claim, field: c.field,
        // How it came up: the player pushed back, or the answer contradicted the guide on something asked directly.
        via: pushback ? 'pushback' : 'contradiction',
        question: String(opts.question || '').slice(0, 300),
        uidHash, guest: !!opts.isGuest, placeConfirmed: false,
        groupId: groupId(page.key, page.slug, entry.id), status: 'pending', at: Date.now(),
      });
      ids.push(ref.id);
      // The entry's group (what the review queue lists and the daily check decides): created pending on its first report.
      const gref = getFirestore().collection('correctionGroups').doc(groupId(page.key, page.slug, entry.id));
      const g = await gref.get();
      const summary = { lastClaim: c.claim, reports: (g.exists ? Number(g.data()?.reports || 0) : 0) + 1, updatedAt: Date.now() };
      if (g.exists) await gref.update({ ...summary, ...(['applied', 'dismissed'].includes(g.data()?.status) ? { status: 'pending' } : {}) });
      else {
        await gref.set({
          gameKey: page.key, game: opts.game.slice(0, 120), area: page.slug, areaName: page.name,
          entryId: entry.id, entryKind: entry.kind, entryName: entry.name, guideText: entry.text.slice(0, 600),
          status: 'pending', createdAt: Date.now(), ...summary,
        });
      }
    } catch (e: any) {
      console.warn('[corrections] save failed:', e?.message);
    }
  }
  if (ids.length) console.log(`[corrections] ${ids.length} candidate(s) for ${page.key}/${page.slug} (${pushback ? 'pushback' : 'contradiction'})`);
  return ids;
}

// Verified corrections per area, for the prompt: cached for 5 minutes.
const cache = new Map<string, { at: number; text: string }>();
/** The area's verified corrections as prompt notes ('' when there are none). They override the guide notes. */
export async function verifiedCorrectionsForPrompt(gameKey: string, slug: string): Promise<string> {
  const k = `${gameKey}/${slug}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.text;
  let text = '';
  try {
    const snap = await getFirestore().collection('correctionGroups').where('gameKey', '==', gameKey).where('area', '==', slug).get();
    const lines = snap.docs
      .map((d) => d.data() as any)
      .filter((g) => g.status === 'verified' && g.verifiedText)
      .map((g) => {
        const v = g.verifiedText || {};
        const parts = [v.where && `where: ${v.where}`, v.how && `how: ${v.how}`, v.notes && `notes: ${v.notes}`].filter(Boolean).join('; ');
        return parts ? `- ${g.entryName}: ${parts}` : '';
      })
      .filter(Boolean);
    if (lines.length) {
      text = `[CORRECTIONS TO THE GUIDE NOTES (reported by players and verified): these override the guide notes above]\n${lines.join('\n').slice(0, 1500)}`;
    }
  } catch (e: any) {
    console.warn('[corrections] prompt load failed:', e?.message);
  }
  cache.set(k, { at: Date.now(), text });
  if (cache.size > 500) cache.clear();
  return text;
}

export function registerCorrections(app: Express, deps: { requireAuth: Mw; isAdmin: (user: any) => boolean }) {
  const db = () => getFirestore();

  // "That's right" on the answer that made these candidates: the player confirmed the area they're about.
  app.post('/api/corrections/confirm-place', deps.requireAuth, async (req: Request, res: Response) => {
    const ids: string[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x: unknown) => typeof x === 'string' && /^[A-Za-z0-9]{10,40}$/.test(x)).slice(0, 5);
    const uidHash = playerHash((req as any).user?.uid || '');
    let n = 0;
    for (const id of ids) {
      const ref = db().collection('corrections').doc(id);
      const c = (await ref.get()).data();
      if (!c || c.uidHash !== uidHash) continue; // only the player's own candidates
      await ref.update({ placeConfirmed: true });
      n++;
    }
    res.json({ ok: true, updated: n });
  });

  const requireAdmin: Mw = (req, res, next) => (deps.isAdmin((req as any).user) ? next() : res.status(403).json({ error: 'Not an admin.' }));

  app.get('/api/admin/corrections', deps.requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const snap = await db().collection('correctionGroups').orderBy('updatedAt', 'desc').limit(200).get();
      const groups = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const open = groups.filter((g) => ['pending', 'disputed', 'approved'].includes(g.status));
      // What players said, for the open ones (no player ids: only whether they confirmed the area, and guests).
      await Promise.all(open.map(async (g) => {
        const r = await db().collection('corrections').where('groupId', '==', g.id).limit(12).get();
        g.reports = r.docs.map((d) => {
          const c = d.data() as any;
          return { claim: c.claim, via: c.via, placeConfirmed: !!c.placeConfirmed, guest: !!c.guest, at: c.at };
        });
        g.players = new Set(r.docs.filter((d) => !d.data().guest).map((d) => d.data().uidHash)).size;
      }));
      res.json({
        open,
        decided: groups.filter((g) => ['verified', 'applied', 'dismissed'].includes(g.status)).slice(0, 40),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load the corrections.' });
    }
  });

  app.post('/api/admin/corrections/:id', deps.requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const action = String(req.body?.action || '');
    if (!['apply', 'dismiss'].includes(action)) return res.status(400).json({ error: 'Unknown action.' });
    const ref = db().collection('correctionGroups').doc(String(req.params.id));
    if (!(await ref.get()).exists) return res.status(404).json({ error: 'No such correction.' });
    // Apply: the next pipeline run writes it into the guide (through the review gate); dismiss: done now.
    await ref.set({ status: action === 'apply' ? 'approved' : 'dismissed', decidedBy: String((req as any).user?.email || ''), decidedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    res.json({ ok: true });
  });
}
