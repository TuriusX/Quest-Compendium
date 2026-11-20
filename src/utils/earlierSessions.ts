/**
 * Earlier, grouped (owner, Nov 20 2026: "helps the quest log build upon itself as you go"): the steps the player moved
 * on from (questLog.passed) in play sessions, newest first, each grouped by place, with a one-sentence note of what the
 * player did in that session (a small AI call, /api/session-note, made only when Earlier is opened and kept in
 * questLog.notes). A session ends after SESSION_GAP_MS without any question or step.
 */

export const SESSION_GAP_MS = 60 * 60 * 1000;

export type PassedItem = { id: string; text: string; place?: string; msgId?: string; at: number };
export type EarlierSession = {
  /** Its first activity's time (ms): the key its note is kept under. */
  key: string;
  start: number;
  end: number;
  /** Places in the order the player reached them, each with its steps (oldest first). */
  places: { place: string; items: { id: string; text: string }[] }[];
  count: number;
  /** The questions asked in it (for the note), oldest first. */
  questions: string[];
};

/**
 * The sessions with at least one step, newest first. `activity`: every question's time and text (the user's messages),
 * so a session that only asked questions still ends where the player stopped.
 */
export function earlierSessions(passed: PassedItem[] | undefined, activity: { at: number; text?: string }[], gapMs = SESSION_GAP_MS): EarlierSession[] {
  const items = [...(passed || [])].filter((x) => x && Number.isFinite(x.at)).sort((a, b) => a.at - b.at);
  if (!items.length) return [];
  const times = [...items.map((x) => ({ at: x.at, q: '' })), ...activity.filter((a) => Number.isFinite(a.at)).map((a) => ({ at: a.at, q: String(a.text || '') }))].sort((a, b) => a.at - b.at);
  // Session boundaries: a gap of gapMs or more between two consecutive activities.
  const bounds: { start: number; end: number; qs: string[] }[] = [];
  for (const t of times) {
    const cur = bounds[bounds.length - 1];
    if (!cur || t.at - cur.end >= gapMs) bounds.push({ start: t.at, end: t.at, qs: t.q ? [t.q] : [] });
    else { cur.end = t.at; if (t.q) cur.qs.push(t.q); }
  }
  const out: EarlierSession[] = [];
  for (const b of bounds) {
    const mine = items.filter((x) => x.at >= b.start && x.at <= b.end);
    if (!mine.length) continue;
    const places: EarlierSession['places'] = [];
    for (const x of mine) {
      const place = (x.place || '').trim();
      let g = places.find((p) => p.place === place);
      if (!g) { g = { place, items: [] }; places.push(g); }
      g.items.push({ id: x.id, text: x.text });
    }
    out.push({ key: String(b.start), start: b.start, end: b.end, places, count: mine.length, questions: b.qs.slice(-12) });
  }
  return out.reverse();
}

/** "Today", "Yesterday", or the date (the app's locale). */
export function sessionDay(start: number, now: number, words: { today: string; yesterday: string }, locale?: string): string {
  const day = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const diff = Math.round((day(now) - day(start)) / 86400000);
  if (diff <= 0) return words.today;
  if (diff === 1) return words.yesterday;
  try {
    return new Date(start).toLocaleDateString(locale || undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return new Date(start).toDateString();
  }
}

/** A session's note is made again once it has this many more steps than when it was made. */
export const noteStale = (note: { n: number } | undefined, count: number): boolean => !note || count >= note.n + 2;

// ---- The note (server: /api/session-note) ----------------------------------------------------------------------------

export const SESSION_NOTE_PROMPT = `You write one short sentence for a video game player's quest log, saying what they did in one play session, so they
can pick up where they left off later. You get the game, the steps they moved on from (with places) and the questions
they asked, in order.
- One sentence, at most 160 characters, past tense, second person ("You got the brass key from the keeper and rode the
  lift down to the Undercroft.").
- Only what the list shows they did or reached. Never invent events, never guess outcomes, never add advice, never
  mention what comes next or anything later in the game.
- Name places and items as the list does. Plain words, no markdown, no quotes around it.
- Write it in the language given.`;

export function sessionNoteInput(o: { game: string; language: string; places: EarlierSession['places']; questions: string[] }): string {
  const steps = o.places.map((p) => `${p.place || '(no place)'}: ${p.items.map((i) => i.text).join('; ')}`).join('\n');
  const qs = o.questions.length ? o.questions.map((q) => `- ${q}`).join('\n') : '(none)';
  return `Game: ${o.game || 'unknown'}\nLanguage: ${o.language || 'English'}\nSteps moved on from, by place:\n${steps}\nQuestions asked:\n${qs}`;
}

/** The note as shown: one line, no quotes or markdown, at most 200 characters ('' when unusable). */
export function cleanSessionNote(raw: string): string {
  let s = String(raw || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^["“'‘]+|["”'’]+$/g, '').trim();
  if (s.length < 12) return '';
  if (s.length > 200) {
    const cut = s.slice(0, 200);
    const end = cut.lastIndexOf('. ');
    s = end > 60 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
  }
  return s;
}

/** The request body's parts, cleaned on the server (sizes capped). */
export function cleanNoteRequest(body: any): { game: string; language: string; places: EarlierSession['places']; questions: string[] } | null {
  const places = (Array.isArray(body?.places) ? body.places : []).slice(0, 12).map((p: any) => ({
    place: String(p?.place || '').slice(0, 60),
    items: (Array.isArray(p?.items) ? p.items : []).slice(0, 20).map((i: any) => ({ id: '', text: String(i?.text || '').replace(/\s+/g, ' ').slice(0, 120) })).filter((i: any) => i.text.trim()),
  })).filter((p: any) => p.items.length);
  if (!places.length) return null;
  const questions = (Array.isArray(body?.questions) ? body.questions : []).slice(-12).map((q: any) => String(q || '').replace(/\s+/g, ' ').slice(0, 160)).filter((q: string) => q.trim());
  return { game: String(body?.game || '').slice(0, 80), language: String(body?.language || 'English').slice(0, 40), places, questions };
}
