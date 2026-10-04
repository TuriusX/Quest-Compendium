/**
 * Progress memory: what the player has already done in a game, so answers never send them back to finished content.
 * Kept per game in settings.gameDone (most recent first, at most DONE_MAX items) and sent with every question:
 *   - fight:  a fight that ended (a combat answer followed by a screenshot with no fight on it)
 *   - quest:  something an answer said is complete (its <qc-done> block)
 *   - step:   a quest-log step the player ticked
 *   - area:   a guide area the player moved past (on to a later area in the guide's order)
 * Shared by the app and the server.
 */
import { placeKey } from './placeName';

export type DoneKind = 'fight' | 'quest' | 'step' | 'area';
export type DoneItem = { text: string; kind: DoneKind; at: number };

export const DONE_MAX = 30;
const KINDS: DoneKind[] = ['fight', 'quest', 'step', 'area'];
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
const key = (s: string) => placeKey(s, '');

/** The list with new items added at the front (a repeat moves to the front), capped at DONE_MAX. */
export function addDone(list: DoneItem[] | undefined, items: { text: string; kind: DoneKind }[], now = Date.now()): DoneItem[] {
  const fresh = items
    .map((x, i) => ({ text: clean(x.text), kind: KINDS.includes(x.kind) ? x.kind : 'quest', at: now + (items.length - i) * 0.001 }))
    .filter((x) => x.text.length >= 3);
  if (!fresh.length) return list || [];
  const seen = new Set<string>();
  const out: DoneItem[] = [];
  for (const x of [...fresh, ...(list || [])]) {
    const k = key(x.text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ text: x.text, kind: x.kind, at: Math.round(x.at) });
  }
  return out.slice(0, DONE_MAX);
}

/** What goes to the server: the texts, labelled by kind ("Fight: Gate defence"), most recent first. */
export const doneForRequest = (list: DoneItem[] | undefined): string[] =>
  (list || []).slice(0, DONE_MAX).map((x) => `${x.kind === 'fight' ? 'Fight' : x.kind === 'area' ? 'Area' : x.kind === 'step' ? 'Step' : 'Quest'}: ${x.text}`);

/**
 * The area the player moved past, when they go from one guide area to a later one in the guide's order (null when
 * moving back, staying, or either isn't a guide area).
 */
export function areaMovedPast(areaNames: string[], from: string | undefined, to: string | undefined): string | null {
  if (!from || !to) return null;
  const i = areaNames.findIndex((a) => key(a) === key(from));
  const j = areaNames.findIndex((a) => key(a) === key(to));
  return i >= 0 && j > i ? areaNames[i] : null;
}

/**
 * The fight that just ended: the latest answer before this one was a combat answer and this one's screenshot shows no
 * fight. Its name is the fight the answer named, else its quest title.
 */
export function endedFight(
  messages: { role: string; combat?: boolean; noFight?: boolean; fight?: string; title?: string; isStreaming?: boolean }[],
  answer: { noFight?: boolean },
): string | null {
  if (!answer.noFight) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || m.isStreaming) continue;
    if (!m.combat) return null;
    return clean(m.fight || m.title || '') || null;
  }
  return null;
}

/** What the model is told about <qc-done> (any answer). */
export const DONE_RULES = `
- Finished content: when this answer or the screen shows the player has just finished something (a quest, a fight, a
  puzzle, a quest step), add one line at the very end (removed before the player sees it), with 1 to 3 short names:
<qc-done>["Defend the Emerald Grove gate"]</qc-done>
  Only for things that are actually finished, never for what's still to do.`;

/** Pull the <qc-done> list out of an answer (always removed from the text). */
export function extractDone(text: string): { text: string; done: string[] } {
  const done: string[] = [];
  const cleaned = String(text || '').replace(/(?:```[a-z]*\s*)?<qc-done>([\s\S]*?)<\/qc-done>(?:\s*```)?/gi, (_m, body) => {
    try {
      const j = JSON.parse(String(body).trim());
      for (const x of Array.isArray(j) ? j : [j]) {
        const t = clean(typeof x === 'string' ? x : x?.text);
        if (t.length >= 3) done.push(t);
      }
    } catch {
      /* a broken line is dropped */
    }
    return '';
  });
  return { text: done.length || cleaned !== text ? cleaned.replace(/\n{3,}/g, '\n\n').trimEnd() : cleaned, done: done.slice(0, 3) };
}
