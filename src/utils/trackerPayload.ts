/**
 * What the objectives tracker (electron/tracker.cjs) shows: a quest log for where the player is, filled from our own
 * guides. Top to bottom: the place, a quest line, then sections, each only when it has something:
 *   - "From your last answer": the answer's steps (its <qc-steps>: steps, choices, warnings in amber), while that answer is about
 *     the current place
 *   - "Missable here": the guide area's missable entries (and missable sections)
 *   - "Point of no return": the achievement guide's roadmap points for this area, and what they lock out
 *   - "To collect": the area's other checklist entries, in the guide's order
 *   - "Achievements here": achievement tips for this area (done once unlocked on Steam)
 * and "Next: <area>" from the guide's area order; the place line steps through the guide's areas (‹ ›, or a list).
 * Uncollected entries come first in each section. Entry ids are stable (per area), so hiding an entry on the tracker
 * sticks.
 * Without a guide for the game it shows the answer's steps and quest line. On-screen markers never feed the quest log
 * (they're optional, Settings). The panel-hidden handler, live
 * updates and "Track on screen" all build it here. Its words come from the app's translations (labels).
 */
import type { Achievement, ChatMessage, GameTab, SteamGameData } from '../types';
import type { AchievementGuide } from './achievementGuide';
import { tipMatches } from './achievementGuide';
import type { GuidePage } from './guideApi';
import { nameKey, samePlace, storyPhrase } from './placeName';

export type TrackerItem = {
  /**
   * Stable per area: s:<answer id>:<step index>, g:<area slug>:<entry id> (both tickable), n:<area slug>:<point>,
   * h:<area slug>:<achievement>. Hidden entries are saved by id.
   */
  id: string;
  label: string;
  where?: string;
  done?: boolean;
  missable?: boolean;
  /** Can be ticked on the tracker. */
  tick?: boolean;
  /**
   * Everything the guide (or the answer) has on the entry, untrimmed: shown when it's expanded on the tracker. full is
   * the whole text when the label is shortened; missable says why it can be missed (or what a point of no return locks).
   */
  detail?: TrackerDetail;
};
export type TrackerDetail = { full?: string; where?: string; how?: string; missable?: string; notes?: string };
/** A detail with only the parts that have something in them (undefined when there's nothing). */
const detail = (d: TrackerDetail): TrackerDetail | undefined => {
  const out: TrackerDetail = {};
  for (const k of ['full', 'where', 'how', 'missable', 'notes'] as const) {
    const v = (d[k] || '').trim();
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
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
  /** When the place isn't a guide area by name: "From the guide: <area> (closest match)". */
  source?: string;
  /** The guide's areas in order and where the player is among them (the ‹ › arrows and the area list). */
  areas?: { names: string[]; index: number };
  /** "Locate me" is looking at a screenshot. */
  locating?: boolean;
  /** A short message on the tracker (why "Locate me" couldn't set the place). */
  notice?: string;
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
  next?: { slug: string; name: string; story?: string } | null;
  done: Set<string>;
  /** How the area was found for the place (utils/guideMatch): by name, or as the closest match. */
  via?: 'name' | 'sub' | 'story';
  /** All the guide's areas in order, and this one's position. */
  areas?: { name: string; story: string }[];
  index?: number;
};

/** The tracker page's words (electron/tracker.html), from the "tracker.*" translations. */
const LABEL_KEYS = [
  'title', 'confirm', 'missable', 'placeHint', 'confirmHint', 'away', 'size',
  'alpha', 'backdrop', 'tabHint', 'itemTodo', 'itemDone', 'empty', 'secAnswer', 'secMissable', 'secNoReturn', 'secCollect', 'secAch',
  'more', 'next', 'closest', 'showHidden', 'hideEntry', 'limitHint', 'prevArea', 'nextArea', 'areaList', 'locate', 'locating',
  'hintBook', 'hintBookNoKeys', 'headFold', 'openBook', 'foldHint', 'detWhere', 'detHow', 'detMissable', 'detNotes', 'openInGuide', 'askAbout',
  'expandHint', 'spine', 'choice',
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

/** The finished answer the tracker follows in a tab: the picked one if it's still there, else the latest. */
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

/** Entries the guide lists separately that are one thing in the game (one chest, one cache), merged on the tracker. */
export type MergedSpot = { ids: string[]; label: string; missable: boolean; full?: string; where?: string };

const spotKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Named landmarks in a place description: Title Case phrases of two words or more ("Scuffed Rock", "Ornate Chest"). */
const landmarks = (s: string) => [...String(s || '').matchAll(/\b[A-Z][a-z'’]+(?:\s+(?:of|the)\s+|\s+)[A-Z][a-z'’]+(?:\s+[A-Z][a-z'’]+)*/g)].map((m) => m[0]);
/**
 * A short name for the spot: "A Harper cache concealed beneath the Scuffed Rock along the western cliffs; …" becomes
 * "Harper cache under the Scuffed Rock", "Inside an Ornate Chest concealed underneath the Scuffed Rock" becomes
 * "Ornate Chest under the Scuffed Rock".
 */
function spotName(s: string): string {
  let t = String(s || '').split(/[;,]|\s+(?:along|near|by|on|at|in|beside|past)\s+the\s+/i)[0].trim();
  t = t.replace(/^(inside|in|within)\s+/i, '').replace(/^(a|an|the)\s+/i, '');
  t = t.replace(/\b(concealed|hidden|buried|tucked|stashed)\s+(beneath|underneath|under|below)\b/gi, 'under').replace(/\bunderneath\b/gi, 'under');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/**
 * Guide entries that describe the same spot: items with the very same container or location ("Inside an Ornate Chest
 * concealed underneath the Scuffed Rock"), plus a secret that names one of that spot's landmarks (the Harper cache under
 * the Scuffed Rock). Only groups of two or more; conservative, so different chests that merely share a word stay apart.
 */
export function mergeSameSpot(page: { items: { id: string; name?: string; text?: string; where?: string; missable?: boolean }[]; secrets: { id: string; text?: string; name?: string }[] }): MergedSpot[] {
  const byWhere = new Map<string, typeof page.items>();
  for (const e of page.items) {
    const w = String(e.where || '').trim();
    if (w.length < 15) continue;
    const k = spotKey(w);
    byWhere.set(k, [...(byWhere.get(k) || []), e]);
  }
  const used = new Set<string>();
  const out: MergedSpot[] = [];
  for (const group of byWhere.values()) {
    const where = String(group[0].where || '');
    const marks = landmarks(where).map((m) => m.toLowerCase());
    const secret = page.secrets.find((s) => !used.has(s.id) && marks.some((m) => String(s.text || s.name || '').toLowerCase().includes(m)));
    if (group.length + (secret ? 1 : 0) < 2) continue;
    if (secret) used.add(secret.id);
    const names = group.map((e) => String(e.name || e.text || '')).filter(Boolean);
    const spot = spotName(secret ? String(secret.text || secret.name || '') : where) || spotName(where);
    out.push({
      ids: [...group.map((e) => e.id), ...(secret ? [secret.id] : [])],
      label: `${spot}: ${names.join(', ')}`,
      missable: group.some((e) => e.missable),
      full: secret ? String(secret.text || secret.name || '') : undefined,
      where,
    });
  }
  return out;
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
 * when the tab has none). latestAnswer: the answer to show steps from (the latest finished one, or the one picked
 * with "Track on screen": opts.pinned shows its steps wherever it's about). guideArea / achievementGuide: the
 * guide's data for the current place (null without a guide). Returns null when there's nothing to show: no known
 * place and no answer with steps.
 */
export function buildTrackerPayload(
  tab: GameTab | null | undefined,
  latestAnswer: ChatMessage | null | undefined,
  guideArea: TrackerGuideArea | null | undefined,
  achievementGuide: AchievementGuide | null | undefined,
  labels: Record<string, string> | undefined,
  opts: { accent: string; gameKey: string; pinned?: boolean; achievements?: Achievement[]; locating?: boolean; notice?: string },
): TrackerPayload | null {
  const msg = latestAnswer || null;
  const L = labels || {};
  const title = (id: TrackerSectionId) => L[SECTION_KEY[id]] || SECTION_EN[id];

  // Where the player is: the tab's place, else (no place known yet) what the answer says.
  const tabPlace = tab?.place?.name ? tab.place : null;
  const answerPlace = msg ? msg.placeChosen || msg.place?.name || '' : '';
  // The answer counts for the current place when it's about it (or nothing better is known, or it was picked).
  const answerHere = !!msg && (!!opts.pinned || !tabPlace || (!!answerPlace && samePlace(answerPlace, tabPlace.name)));
  const steps = answerHere && msg?.steps?.length ? msg.steps : [];
  if (!tabPlace && !steps.length) return null;

  const place = tabPlace
    ? { name: tabPlace.name, story: storyPhrase(tabPlace.story) || undefined, sure: !!tabPlace.confirmed }
    : answerPlace
      ? { name: answerPlace, story: storyPhrase(msg?.storyChosen || msg?.place?.story) || undefined, sure: !!msg?.placeChosen || !!msg?.place?.sure }
      : undefined;

  // The quest line: the answer's title (when it's about here), else the guide area's story beat, else the place's story
  // beat (then not repeated on the place line), else the answer's first line.
  const answerTitle = answerHere ? msg?.title?.trim() || '' : '';
  const areaStory = (guideArea?.story || guideArea?.page?.story || '').trim();
  const placeStory = !answerTitle && !areaStory ? place?.story?.trim() || '' : '';
  const quest = answerTitle || areaStory || placeStory || (answerHere && msg ? questLine(msg.text) : '');
  if (place && placeStory) place.story = undefined;

  const sections: TrackerSection[] = [];
  if (steps.length && msg) {
    const done = new Set(msg.doneSteps ?? []);
    sections.push({
      id: 'answer',
      title: title('answer'),
      // In the answer's order (most important first): a choice says so, a warning shows in amber like a missable.
      items: steps.map((st, i) => ({
        id: `s:${msg.id}:${i}`,
        label: st.kind === 'choice' ? (L.choice || 'Choice: {text}').replace('{text}', st.text) : st.text,
        done: done.has(i), missable: st.kind === 'warning', tick: true,
        // Its details: the sentence of the answer it comes from.
        detail: detail({ full: st.detail }),
      })),
    });
  }

  const page = guideArea?.page;
  if (guideArea && page) {
    const done = guideArea.done;
    const entry = (id: string, label: string, where?: string, missable?: boolean, more?: TrackerDetail): TrackerItem => ({
      id: `g:${guideArea.slug}:${id}`, label, where, done: done.has(id), missable, tick: true,
      detail: detail({ full: label, where, ...more }),
    });
    // A guide entry's notes, for its details.
    const itemMore = (e: { notes?: string }): TrackerDetail => ({ notes: e.notes });
    // Entries that are really one thing (the Harper's Map and Notebook in the chest under the Scuffed Rock, and the
    // secret about that cache): one entry listing what's inside, ticked together (its id joins theirs with "+").
    const merged = mergeSameSpot(page);
    const mergedEntry = (g: MergedSpot): TrackerItem => ({
      id: `g:${guideArea.slug}:${g.ids.join('+')}`, label: g.label, done: g.ids.every((id) => done.has(id)), missable: g.missable || undefined, tick: true,
      detail: detail({ full: g.full, where: g.where }),
    });
    /** The merged entry in place of its first part, nothing for its other parts, the entry itself otherwise. */
    const keep = (id: string, make: () => TrackerItem): TrackerItem | null => {
      const g = merged.find((m) => m.ids.includes(id));
      if (!g) return make();
      return g.ids[0] === id ? mergedEntry(g) : null;
    };
    const items = (list: (TrackerItem | null)[]) => list.filter((it): it is TrackerItem => !!it && !!it.label);
    // Missable: the area's missable items and its missable checklist sections (the area page's "Don't miss").
    const missSec = (page.sections || []).filter((x) => x.check && /miss/i.test(x.title));
    const isMissable = (id: string) => {
      const g = merged.find((m) => m.ids.includes(id));
      return g ? g.missable : !!page.items.find((e) => e.id === id)?.missable;
    };
    const missable = items([
      ...page.items.filter((e) => isMissable(e.id)).map((e) => keep(e.id, () => entry(e.id, e.name || e.text || '', e.where, true, { ...itemMore(e), how: e.name && e.text && e.text !== e.name ? e.text : undefined }))),
      // A missable checklist line says itself what can be missed and how.
      ...missSec.flatMap((x) => x.entries.map((e) => entry(e.id, e.text, undefined, true, { missable: x.title }))),
    ]);
    if (missable.length) sections.push({ id: 'missable', title: title('missable'), tone: 'amber', items: openFirst(missable) });

    const noReturn = (achievementGuide?.roadmap?.noReturn || []).filter((n) => n?.point && pointIsHere(n.point, guideArea.name));
    if (noReturn.length) {
      sections.push({
        id: 'noreturn', title: title('noreturn'), tone: 'amber', icon: 'warn',
        items: noReturn.map((n) => ({ id: `n:${guideArea.slug}:${nameKey(n.point)}`, label: n.point, where: n.lost, detail: detail({ full: n.point, missable: n.lost }) })),
      });
    }

    // To collect: everything else the area page has a checkbox for, in the guide's order (merged parts are listed once,
    // under Missable when any part is missable).
    const inMissable = (id: string) => isMissable(id) && merged.some((m) => m.ids.includes(id));
    const collect = items([
      ...page.items.filter((e) => !isMissable(e.id)).map((e) => keep(e.id, () => entry(e.id, e.name || e.text || '', e.where, undefined, { ...itemMore(e), how: e.name && e.text && e.text !== e.name ? e.text : undefined }))),
      ...page.secrets.filter((e) => !inMissable(e.id)).map((e) => keep(e.id, () => entry(e.id, e.text || e.name || '', undefined, undefined, { ...itemMore(e), where: e.where }))),
      ...(page.sections || []).filter((x) => x.check && !missSec.includes(x)).flatMap((x) => x.entries.map((e) => entry(e.id, e.text))),
    ]);
    if (collect.length) sections.push({ id: 'collect', title: title('collect'), items: openFirst(collect) });
  }

  if (guideArea && achievementGuide?.list?.length) {
    const unlocked = (opts.achievements || []).filter((a) => a.unlocked);
    const here = achievementGuide.list.filter((t) => t.area === guideArea.slug || (!!t.areaName && samePlace(t.areaName, guideArea.name)));
    const items = here.map((t): TrackerItem => ({
      id: `h:${guideArea.slug}:${t.englishName || t.name}`,
      label: t.name,
      // Hidden achievements keep their secret: no "how" on the game.
      where: t.hidden ? undefined : t.how ? t.how.slice(0, 90) : undefined,
      done: unlocked.some((a) => tipMatches(t, a.name)),
      missable: !!t.missable,
      // The whole tip (the line above shows only its start); hidden achievements still keep their secret.
      detail: t.hidden ? undefined : detail({ full: t.name, how: t.how || t.desc, notes: t.how && t.desc && t.desc !== t.how ? t.desc : undefined }),
    }));
    if (items.length) sections.push({ id: 'ach', title: title('ach'), items: openFirst(items) });
  }

  return {
    gameKey: opts.gameKey,
    data: {
      id: msg?.id || '',
      accent: opts.accent,
      quest,
      place,
      sections,
      ...(guideArea?.next ? { next: { name: guideArea.next.name } } : {}),
      ...(guideArea?.areas?.length && Number.isInteger(guideArea.index) ? { areas: { names: guideArea.areas.map((a) => a.name), index: guideArea.index! } } : {}),
      ...(opts.locating ? { locating: true } : {}),
      ...(opts.notice ? { notice: opts.notice } : {}),
      // The place isn't one of the guide's areas by name: say which area this is and that it's the closest match.
      ...(guideArea && guideArea.via && guideArea.via !== 'name'
        ? { source: (L.closest || 'From the guide: {area} (closest match)').replace('{area}', guideArea.name) }
        : {}),
      ...(labels ? { labels } : {}),
    },
  };
}
