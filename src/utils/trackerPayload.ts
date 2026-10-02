/**
 * What the objectives tracker (electron/tracker.cjs) shows for an answer: the quest line, where the player is and
 * the answer's markers as a checklist. The tracker is the panel's minimized state, so it always follows the latest
 * finished answer with markers in the active game tab (or the one picked with "Track on screen").
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
  'alpha', 'backdrop', 'tabHint', 'itemTodo', 'itemDone',
] as const;
export const trackerLabels = (t: (key: string) => string): Record<string, string> =>
  Object.fromEntries(LABEL_KEYS.map((k) => [k, t(`tracker.${k}`)]));

/** The answer's first line, without Markdown: the quest title when the model didn't name one. */
function questLine(text: string): string {
  const line = (text || '').split('\n').find((l) => l.trim()) || '';
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .trim()
    .slice(0, 100);
}

/** The game the tracker's settings (position, view, size) are saved under. */
export const trackerGameKey = (tab: GameTab | null | undefined, game?: SteamGameData | null) =>
  String(game?.appId ?? game?.name ?? tab?.activeSteamGame?.appId ?? tab?.activeSteamGame?.name ?? tab?.name ?? '');

/** The finished answer with markers the tracker follows in a tab: the picked one if it's still there, else the latest. */
export function trackedMessage(tab: GameTab | null | undefined, pickedId?: string | null): ChatMessage | undefined {
  const withPoints = (m: ChatMessage) => m.role === 'assistant' && !m.isStreaming && !!m.points?.length;
  if (!tab) return undefined;
  if (pickedId) {
    const picked = tab.messages.find((m) => m.id === pickedId && withPoints(m));
    if (picked) return picked;
  }
  for (let i = tab.messages.length - 1; i >= 0; i--) if (withPoints(tab.messages[i])) return tab.messages[i];
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
  return {
    gameKey,
    data: {
      id: msg.id,
      accent,
      quest: msg.title?.trim() || questLine(msg.text),
      place: placeName ? { name: placeName, story, sure: !!msg.placeChosen || !!confirmed || !!msg.place?.sure } : undefined,
      objectives: (msg.points ?? []).map((p, i) => ({ label: p.label, where: p.where, done: done.has(i), missable: !!p.missable })),
      ...(labels ? { labels } : {}),
    },
  };
}
