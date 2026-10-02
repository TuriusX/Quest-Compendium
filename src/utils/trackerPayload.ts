/**
 * What the objectives tracker (electron/tracker.cjs) shows for an answer: the quest line, where the player is and
 * the answer's markers as a checklist. The tracker is the panel's minimized state, so it always follows the latest
 * finished answer in the active game tab, markers or not (or the one picked with "Track on screen").
 * Its words come from the app's translations (labels), so it follows the app language.
 */
import type { ChatMessage, GameTab, SteamGameData } from '../types';
import { samePlace } from './placeName';

export type TrackerData = {
  id: string;
  accent: string;
  quest: string;
  place?: { name: string; story?: string; sure: boolean };
  objectives: { label: string; where?: string; done: boolean; missable?: boolean }[];
  labels?: Record<string, string>;
};
export type TrackerPayload = { data: TrackerData; gameKey: string };

/** The tracker page's words (electron/tracker.html), from the "tracker.*" translations. */
const LABEL_KEYS = [
  'title', 'confirm', 'missable', 'hint', 'hintNoKeys', 'headHint', 'placeHint', 'confirmHint', 'collapse', 'open', 'away', 'size',
  'alpha', 'backdrop', 'tabHint', 'itemTodo', 'itemDone', 'none',
] as const;
export const trackerLabels = (t: (key: string) => string): Record<string, string> =>
  Object.fromEntries(LABEL_KEYS.map((k) => [k, t(`tracker.${k}`)]));

/** Lines that open with an apology or a correction ("You're right…", "Sorry…") make a poor quest title. */
const APOLOGY = /^(you are|you're|you’re|sorry|my mistake|apologies)\b/i;

/** The answer's first real line, without Markdown: the quest title when there's no title and no story beat. */
function questLine(text: string): string {
  const clean = (l: string) =>
    l
      .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]+/g, '')
      .trim();
  const line = (text || '').split('\n').map(clean).find((l) => l && !APOLOGY.test(l)) || '';
  return line.slice(0, 100);
}

/** The game the tracker's settings (position, view, size) are saved under. */
export const trackerGameKey = (tab: GameTab | null | undefined, game?: SteamGameData | null) =>
  String(game?.appId ?? game?.name ?? tab?.activeSteamGame?.appId ?? tab?.activeSteamGame?.name ?? tab?.name ?? '');

/** The finished answer the tracker follows in a tab: the picked one if it's still there, else the latest (markers or not). */
export function trackedMessage(tab: GameTab | null | undefined, pickedId?: string | null): ChatMessage | undefined {
  const finished = (m: ChatMessage) => m.role === 'assistant' && !m.isStreaming;
  if (!tab) return undefined;
  if (pickedId) {
    const picked = tab.messages.find((m) => m.id === pickedId && finished(m));
    if (picked) return picked;
  }
  for (let i = tab.messages.length - 1; i >= 0; i--) if (finished(tab.messages[i])) return tab.messages[i];
  return undefined;
}

export function buildTrackerPayload(
  msg: ChatMessage,
  accent: string,
  gameKey: string,
  tab?: GameTab | null,
  labels?: Record<string, string>,
): TrackerPayload {
  const done = new Set(msg.donePoints ?? []);
  // The place as the player set it for this answer (or confirmed for the tab), else the AI's guess.
  const confirmed = tab?.place?.confirmed && msg.place && samePlace(tab.place.name, msg.place.name) ? tab.place : undefined;
  const placeName = msg.placeChosen || confirmed?.name || msg.place?.name;
  const story = msg.storyChosen || (tab?.place?.storyConfirmed ? tab.place.story : undefined) || msg.place?.story;
  // The quest line: the AI's title, else the story beat (then not repeated on the place line), else the answer's first line.
  const title = msg.title?.trim();
  const storyQuest = title ? '' : story?.trim() || '';
  return {
    gameKey,
    data: {
      id: msg.id,
      accent,
      quest: title || storyQuest || questLine(msg.text),
      place: placeName
        ? { name: placeName, story: storyQuest ? undefined : story, sure: !!msg.placeChosen || !!confirmed || !!msg.place?.sure }
        : undefined,
      objectives: (msg.points ?? []).map((p, i) => ({ label: p.label, where: p.where, done: done.has(i), missable: !!p.missable })),
      ...(labels ? { labels } : {}),
    },
  };
}
