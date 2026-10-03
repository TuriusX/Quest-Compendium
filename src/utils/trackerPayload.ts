/**
 * What the objectives tracker (electron/tracker.cjs) shows: a quest log for where the player is, filled from our own
 * guides. Top to bottom: the place, a quest line, then sections, each only when it has something:
 *   - "From your last answer": the answer's markers (numbered like the markers on screen), while that answer is about
 *     the current place
 *   - "Missable here": the guide area's missable entries (and missable sections)
 *   - "Point of no return": the achievement guide's roadmap points for this area, and what they lock out
 *   - "To collect": the area's other checklist entries, in the guide's order
 *   - "Achievements here": achievement tips for this area (done once unlocked on Steam)
 * and "Next: <area>" from the guide's area order. Uncollected entries come first in each section.
 * Without a guide for the game it falls back to the answer's markers and quest line. The panel-hidden handler, live
 * updates and "Track on screen" all build it here. Its words come from the app's translations (labels).
 */
import type { Achievement, ChatMessage, GameTab, SteamGameData } from '../types';
import type { AchievementGuide } from './achievementGuide';
import { tipMatches } from './achievementGuide';
import type { GuidePage } from './guideApi';
import { nameKey, samePlace } from './placeName';

export type TrackerItem = {
  /** Where a tick goes: a:<answer id>:<marker index>, g:<area slug>:<entry id>; others (n:, h:) can't be ticked here. */
  id: string;
  label: string;
  where?: string;
  done?: boolean;
  missable?: boolean;
  /** The number of the answer's on-screen marker. */
  badge?: number;
  /** Can be ticked on the tracker. */
  tick?: boolean;
};
export type TrackerSectionId = 'answer' | 'missable' | 'noreturn' | 'collect' | 'ach';
export type TrackerSection = { id: TrackerSectionId; title: string; tone?: 'amber'; icon?: 'warn'; items: TrackerItem[] };
export type TrackerData = {
  id: string;
  accent: string;
  quest: string;
  place?: { name: string; story?: string; sure: boolean };
  sections: TrackerSection[];
  /** The next area in the guide's order ("I'm here now" moves the tracker there). */
  next?: { name: string };
  /** Only without a guide: the answer's missable markers, as one line. */
  warning?: string;
  labels?: Record<string, string>;
};
export type TrackerPayload = { data: TrackerData; gameKey: string };

/** The guide area the player is in, with what they've ticked there. */
export type TrackerGuideArea = {
  key: string;
  slug: string;
  name: string;
  story: string;
  page: GuidePage | null;
  next?: { slug: string; name: string } | null;
  done: Set<string>;
};

/** The tracker page's words (electron/tracker.html), from the "tracker.*" translations. */
const LABEL_KEYS = [
  'title', 'confirm', 'missable', 'hint', 'hintNoKeys', 'headHint', 'placeHint', 'confirmHint', 'collapse', 'open', 'away', 'size',
  'alpha', 'backdrop', 'tabHint', 'itemTodo', 'itemDone', 'empty', 'secAnswer', 'secMissable', 'secNoReturn', 'secCollect', 'secAch',
  'more', 'next', 'hereNow',
] as const;
export const trackerLabels = (t: (key: string) => string): Record<string, string> =>
  Object.fromEntries(LABEL_KEYS.map((k) => [k, t(`tracker.${k}`)]));

/** Section titles when a translation is missing (the page has the same English fallbacks for its other words). */
const SECTION_EN: Record<TrackerSectionId, string> = {
  answer: 'From your last answer',
  missable: 'Missable here',
  noreturn: 'Point of no return',
  collect: 'To collect',
  ach: 'Achievements here',
};
const SECTION_KEY: Record<TrackerSectionId, string> = { answer: 'secAnswer', missable: 'secMissable', noreturn: 'secNoReturn', collect: 'secCollect', ach: 'secAch' };

/** Lines that open with an apology or a correction ("You're right…", "Sorry…") make a poor quest title. */
const APOLOGY = /^(you are|you're|you’re|sorry|my mistake|apologies)\b/i;

/** The answer's first real line, without Markdown: the quest title when there's nothing better. */
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

/** The game the tracker's settings (position, view, size, folded sections) are saved under. */
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

/** Uncollected first, otherwise in the guide's order. */
const openFirst = (items: TrackerItem[]) => items.map((it, i) => ({ it, i })).sort((a, b) => Number(!!a.it.done) - Number(!!b.it.done) || a.i - b.i).map((x) => x.it);

/** Does a point of no return ("Leaving the Nautiloid", "Before boarding the Blackjack") belong to this area? */
function pointIsHere(point: string, area: string): boolean {
  if (samePlace(point, area)) return true;
  const a = nameKey(area);
  return a.length >= 3 && ` ${nameKey(point)} `.includes(` ${a} `);
}

/**
 * The tracker for the active tab. tab.place is where the player is (the caller fills it from the saved game progress
 * when the tab has none). latestAnswer: the answer to show markers from (the latest finished one, or the one picked
 * with "Track on screen": opts.pinned shows its markers wherever it's about). guideArea / achievementGuide: the
 * guide's data for the current place (null without a guide). Returns null when there's nothing to show: no known
 * place and no answer with markers.
 */
export function buildTrackerPayload(
  tab: GameTab | null | undefined,
  latestAnswer: ChatMessage | null | undefined,
  guideArea: TrackerGuideArea | null | undefined,
  achievementGuide: AchievementGuide | null | undefined,
  labels: Record<string, string> | undefined,
  opts: { accent: string; gameKey: string; pinned?: boolean; achievements?: Achievement[] },
): TrackerPayload | null {
  const msg = latestAnswer || null;
  const L = labels || {};
  const title = (id: TrackerSectionId) => L[SECTION_KEY[id]] || SECTION_EN[id];

  // Where the player is: the tab's place, else (no place known yet) what the answer says.
  const tabPlace = tab?.place?.name ? tab.place : null;
  const answerPlace = msg ? msg.placeChosen || msg.place?.name || '' : '';
  // The answer counts for the current place when it's about it (or nothing better is known, or it was picked).
  const answerHere = !!msg && (!!opts.pinned || !tabPlace || (!!answerPlace && samePlace(answerPlace, tabPlace.name)));
  const markers = answerHere && msg?.points?.length ? msg.points : [];
  if (!tabPlace && !markers.length) return null;

  const place = tabPlace
    ? { name: tabPlace.name, story: tabPlace.story, sure: !!tabPlace.confirmed }
    : answerPlace
      ? { name: answerPlace, story: msg?.storyChosen || msg?.place?.story, sure: !!msg?.placeChosen || !!msg?.place?.sure }
      : undefined;

  // The quest line: the answer's title (when it's about here), else the guide area's story beat, else the place's story
  // beat (then not repeated on the place line), else the answer's first line.
  const answerTitle = answerHere ? msg?.title?.trim() || '' : '';
  const areaStory = (guideArea?.story || guideArea?.page?.story || '').trim();
  const placeStory = !answerTitle && !areaStory ? place?.story?.trim() || '' : '';
  const quest = answerTitle || areaStory || placeStory || (answerHere && msg ? questLine(msg.text) : '');
  if (place && placeStory) place.story = undefined;

  const sections: TrackerSection[] = [];
  if (markers.length && msg) {
    const done = new Set(msg.donePoints ?? []);
    sections.push({
      id: 'answer',
      title: title('answer'),
      // In marker order: the badges match the numbered markers on screen.
      items: markers.map((p, i) => ({ id: `a:${msg.id}:${i}`, label: p.label, where: p.where, done: done.has(i), missable: !!p.missable, badge: i + 1, tick: true })),
    });
  }

  const page = guideArea?.page;
  if (guideArea && page) {
    const done = guideArea.done;
    const entry = (id: string, label: string, where?: string, missable?: boolean): TrackerItem => ({
      id: `g:${guideArea.slug}:${id}`, label, where, done: done.has(id), missable, tick: true,
    });
    // Missable: the area's missable items and its missable checklist sections (the area page's "Don't miss").
    const missSec = (page.sections || []).filter((x) => x.check && /miss/i.test(x.title));
    const missable = [
      ...page.items.filter((e) => e.missable).map((e) => entry(e.id, e.name || e.text || '', e.where, true)),
      ...missSec.flatMap((x) => x.entries.map((e) => entry(e.id, e.text, undefined, true))),
    ].filter((it) => it.label);
    if (missable.length) sections.push({ id: 'missable', title: title('missable'), tone: 'amber', items: openFirst(missable) });

    const noReturn = (achievementGuide?.roadmap?.noReturn || []).filter((n) => n?.point && pointIsHere(n.point, guideArea.name));
    if (noReturn.length) {
      sections.push({
        id: 'noreturn', title: title('noreturn'), tone: 'amber', icon: 'warn',
        items: noReturn.map((n, i) => ({ id: `n:${i}`, label: n.point, where: n.lost })),
      });
    }

    // To collect: everything else the area page has a checkbox for, in the guide's order.
    const collect = [
      ...page.items.filter((e) => !e.missable).map((e) => entry(e.id, e.name || e.text || '', e.where)),
      ...page.secrets.map((e) => entry(e.id, e.text || e.name || '')),
      ...(page.sections || []).filter((x) => x.check && !missSec.includes(x)).flatMap((x) => x.entries.map((e) => entry(e.id, e.text))),
    ].filter((it) => it.label);
    if (collect.length) sections.push({ id: 'collect', title: title('collect'), items: openFirst(collect) });
  }

  if (guideArea && achievementGuide?.list?.length) {
    const unlocked = (opts.achievements || []).filter((a) => a.unlocked);
    const here = achievementGuide.list.filter((t) => t.area === guideArea.slug || (!!t.areaName && samePlace(t.areaName, guideArea.name)));
    const items = here.map((t, i): TrackerItem => ({
      id: `h:${i}:${t.englishName || t.name}`,
      label: t.name,
      // Hidden achievements keep their secret: no "how" on the game.
      where: t.hidden ? undefined : t.how ? t.how.slice(0, 90) : undefined,
      done: unlocked.some((a) => tipMatches(t, a.name)),
      missable: !!t.missable,
    }));
    if (items.length) sections.push({ id: 'ach', title: title('ach'), items: openFirst(items) });
  }

  // Without a guide, the answer's missable markers still get their warning line (as before the guide sections).
  const warning = !guideArea
    ? (() => {
        const miss = markers.filter((p, i) => p.missable && !(msg?.donePoints ?? []).includes(i)).map((p) => p.label);
        return miss.length && L.missable ? L.missable.replace('{list}', miss.join(', ')) : miss.length ? `Missable: ${miss.join(', ')}` : '';
      })()
    : '';

  return {
    gameKey: opts.gameKey,
    data: {
      id: msg?.id || '',
      accent: opts.accent,
      quest,
      place,
      sections,
      ...(guideArea?.next ? { next: { name: guideArea.next.name } } : {}),
      ...(warning ? { warning } : {}),
      ...(labels ? { labels } : {}),
    },
  };
}
