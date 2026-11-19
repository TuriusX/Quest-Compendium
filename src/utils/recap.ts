/**
 * "Where was I?" (session companion step 1, owner Nov 18 2026; docs/proposals/session-companion.md): what the player
 * was doing in a game, built only from what the app already keeps (no AI call): where they were (the tab's place and
 * story point), the quest log's current objective and its next unticked step (else the last answer's title), the last
 * thing they asked, and one choice from their playthrough memory. Shown on the pop-up card when a game starts after a
 * gap (RECAP_GAP_MS), and any time from the controller's quick menu. Null when there's nothing worth showing.
 */
import type { ChatMessage, GameTab } from '../types';
import type { Playthrough } from './playthrough';

/** A game started this long after it was last played gets the recap by itself. */
export const RECAP_GAP_MS = 24 * 3600 * 1000;

export type Recap = {
  /** The headline: the current objective, else the place. */
  title: string;
  place: string;
  /** "3 days ago", or '' when it's less than a day. */
  ago: string;
  /** The next steps of the current objective (unticked), at most 3. */
  steps: string[];
  lastAsked: string;
  choice: string;
};

type Tr = (key: string, vars?: Record<string, string | number>) => string;

/** How long ago, in the player's words ("yesterday", "3 days ago", "2 weeks ago"); '' under a day. */
export function agoText(ms: number, tr: Tr): string {
  const days = Math.floor(ms / (24 * 3600 * 1000));
  if (days < 1) return '';
  if (days === 1) return tr('recap.yesterday');
  if (days < 14) return tr('recap.days', { n: days });
  return tr('recap.weeks', { n: Math.floor(days / 7) });
}

/** Questions the app writes itself (a screenshot or voice message with nothing typed) aren't worth repeating. */
const isOwnWording = (q: string, standIns: string[]) => standIns.some((s) => s && q.trim() === s.trim());

export function buildRecap(tab: GameTab | null | undefined, play: Playthrough | null | undefined, now: number, tr: Tr, standIns: string[] = []): Recap | null {
  if (!tab) return null;
  const msgs: ChatMessage[] = tab.messages || [];
  const place = tab.place?.name ? [tab.place.name, tab.place.story].filter(Boolean).join(' · ') : '';
  // The current objective (the quest log's Now), else the newest answer with a title.
  const nowMsg = (tab.questLog?.now && msgs.find((m) => m.id === tab.questLog!.now)) || [...msgs].reverse().find((m) => m.role === 'assistant' && m.title);
  const steps = nowMsg
    ? (nowMsg.steps || []).map((s, i) => ({ s, i })).filter(({ s, i }) => s.kind !== 'warning' && !(nowMsg.doneSteps || []).includes(i)).slice(0, 3).map(({ s }) => String(s.label || s.text || '').trim()).filter(Boolean)
    : [];
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && typeof m.text === 'string' && m.text.trim() && !isOwnWording(m.text, standIns));
  const lastAsked = lastUser ? lastUser.text.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const choice = (play?.entries || []).find((e) => e.kind === 'choice')?.text || '';
  const title = String(nowMsg?.title || '').trim() || place;
  if (!title && !lastAsked) return null;
  return { title, place, ago: agoText(now - (tab.lastActive || now), tr), steps, lastAsked, choice };
}

/** The pop-up card's answer payload for a recap (electron/answerCard.cjs answer()). */
export function recapCard(r: Recap, tr: Tr, id: string) {
  const lines = [
    r.ago ? tr('recap.lastPlayed', { when: r.ago }) : '',
    r.lastAsked ? tr('recap.lastAsked', { q: r.lastAsked }) : '',
    r.choice ? tr('recap.choice', { text: r.choice }) : '',
  ].filter(Boolean);
  return {
    id,
    question: tr('recap.question'),
    title: r.title,
    // One paragraph: the card shows a paragraph above the steps (4 lines), so all of it is seen without More.
    text: lines.join(' ') || r.title,
    steps: r.steps.map((label) => ({ kind: 'step', label, where: '' })),
    model: '',
    place: r.place,
    combat: false,
    picture: null,
  };
}
