/**
 * The quest log (owner, Oct 30 2026): micro-level and driven by the player's questions. Three parts, nothing else by
 * default:
 *   - Now        one objective: the next step of the answer the player set as their current objective ("Set as Now"),
 *                else of the guide's steps they loaded, else (nothing asked) the guide's fill-in for where they are
 *   - Next       the 2-3 steps after it
 *   - Watch out  one thing only, and only what's missable at this spot: the objective's warning, the loaded steps'
 *                warning, the area's first unticked missable, or its point of no return; ✕ hides it for this save
 * Pinned answers sit on one folded line, and the guide's lists (buildTrackerPayload's sections) behind "Show more from
 * the guide". Ticks are the same ticks as before: an answer step is s:<answer id>:<index> (its doneSteps), a guide entry
 * g:<area>:<id>. The docked log (components/QuestLog.tsx), the popped-out window (electron/tracker.html), the compact
 * card and the bookmark all draw this one view.
 */
import type { ChatMessage, GameTab, PlaceDoing, QuestStep } from '../types';
import type { TrackerData, TrackerItem, TrackerSection } from './trackerPayload';

export type LogStep = {
  id: string;
  text: string;
  /** One short line under it: where, or how. */
  sub?: string;
  /** The whole step, when the text is shortened. */
  detail?: string;
  done: boolean;
  /** Can be ticked (a guide's story beat can't). */
  tick: boolean;
};
export type LogNow = LogStep & {
  /** Where it comes from: the player's question, steps they loaded from the guide, or the guide's fill-in. */
  source: 'question' | 'loaded' | 'guide';
  /** The goal the steps lead to ("Reach the Haligtree"), and how far along it is. */
  goal: string;
  doneCount: number;
  total: number;
  /** The answer it comes from (a question's objective). */
  msgId?: string;
  /** A guide step picked by what Locate me saw the player doing: what matched ("Save Duke Ravengard", "Lucretious"). */
  seen?: string;
  /**
   * A question's objective: the guide's walkthrough step it is about (owner, Oct 31 2026), matched from the question,
   * the answer or the screen, never guessed: its title and whole text ("From the guide: …").
   */
  guide?: { id: string; title: string; detail?: string };
};
/**
 * "In <place> (from the guide)" (owner, Oct 31 2026): the place is known but not what the player is doing there, so no
 * guide step is "Now": a short list of what's here and the area's missables (the guide's: never presented as complete).
 */
export type LogHere = { place: string; items: LogStep[]; missables: LogWatch[] };
/** fromGuide: the guide's missable list (never presented as complete: "Missable here (from the guide)"). */
export type LogWatch = { id: string; text: string; why?: string; fromGuide?: boolean };
/**
 * "Where are you?" (owner, Oct 31 2026): the place isn't known yet (a new tab, a resumed save, the game just started),
 * so nothing from the guide shows. locating: a Locate me check is running. suggestion: what an unsure check or answer
 * thought ("Looks like Rivington?"). last: where this playthrough was last time ("Still in Emerald Grove?"). areas: the
 * guide's areas to pick from.
 */
export type LogWhere = { locating: boolean; suggestion?: string; last?: string; areas: string[] };
export type LogView = {
  gameKey: string;
  accent: string;
  place?: TrackerData['place'];
  areas?: TrackerData['areas'];
  /** The place isn't known: the log asks instead of showing the guide. */
  where?: LogWhere;
  /** The place is known but not what the player is doing: the guide's list for it, no Now. */
  here?: LogHere;
  locating?: boolean;
  notice?: string;
  now: LogNow | null;
  next: LogStep[];
  watch: LogWatch | null;
  pins: { id: string; title: string }[];
  /** The guide's lists for this place, behind "Show more from the guide". */
  more: TrackerSection[];
  /** Nothing asked in this game yet: the log invites a question. */
  invite: boolean;
  /** Every step of the objective is ticked: "Done: <goal> ✓ · What's next?". */
  done: { goal: string; msgId?: string } | null;
  /** "Load the guide's steps: <quest> (n)" (the guide covers the current quest). */
  offer?: TrackerData['offer'];
  /** The number on the bookmark and the spine: steps left on Now's goal, else the guide's unticked entries here. */
  bookmark: number;
  labels?: Record<string, string>;
};

/** A walkthrough step as the log reads it: entries are the ids of the guide entries met in it (some missable). */
export type WalkLogStep = { id: string; title: string; text?: string; warn?: string; tip?: string; entries?: string[]; places?: string[] };

const NEXT_MAX = 3;
/** "In <place> (from the guide)": how many of the area's parts it lists. */
const HERE_MAX = 4;

/** A short name for an answer: its quest title, else its first real line. */
export function answerTitle(m: ChatMessage | undefined | null): string {
  if (!m) return '';
  if (m.title?.trim()) return m.title.trim();
  const line = String(m.text || '')
    .split('\n')
    .map((l) => l.replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '').replace(/[*_`~]+/g, '').trim())
    .find(Boolean) || '';
  return line.length > 70 ? `${line.slice(0, 69).replace(/\s+\S*$/, '')}…` : line;
}

/** The steps of an answer that make a checklist (warnings are Watch out instead), with their indexes. */
export const doSteps = (m: ChatMessage | undefined | null): { st: QuestStep; i: number }[] =>
  (m?.steps || []).map((st, i) => ({ st, i })).filter((x) => x.st.kind !== 'warning' && !!x.st.text);

/**
 * Worth offering as the current objective: an answer with at least two things to do (a fight's battle plan isn't a
 * goal). A plain fact answer gets only 📌 Pin.
 */
export const isGoalAnswer = (m: ChatMessage | undefined | null): boolean =>
  !!m && m.role === 'assistant' && !m.isStreaming && !m.combat && doSteps(m).length >= 2;

const stepOf = (m: ChatMessage, st: QuestStep, i: number, done: Set<number>): LogStep => ({
  id: `s:${m.id}:${i}`,
  text: st.label || st.text,
  sub: st.label ? st.where : undefined,
  detail: st.label && st.text !== st.label ? st.text : st.detail,
  done: done.has(i),
  tick: true,
});
const itemStep = (it: TrackerItem): LogStep => ({
  id: it.id, text: it.label, sub: it.where, detail: it.detail?.full && it.detail.full !== it.label ? it.detail.full : undefined, done: !!it.done, tick: !!it.tick,
});

/**
 * The log for the active playthrough. data: the guide's quest log for where the player is (buildTrackerPayload; null
 * without a place or a guide). loaded: the guide's steps the player loaded for their quest (its section's title and
 * items), or null.
 */
export function buildLogView(
  tab: GameTab | null | undefined,
  data: TrackerData | null | undefined,
  opts: {
    gameKey: string; accent: string; loaded?: { title: string; items: TrackerItem[]; warning?: string } | null; labels?: Record<string, string>;
    /** The guide area's walkthrough (its steps and which are ticked, walk:<id>): the fill-in's Now and Next. */
    walk?: { slug: string; steps: WalkLogStep[]; done: Set<string> } | null;
    /** The place isn't known (placeIsCurrent): no Now, Next or Watch out from the guide, only "Where are you?". */
    where?: LogWhere | null;
    /** What Locate me saw the player doing (the place's doing): picks the walkthrough step for Now (matchDoing). */
    doing?: PlaceDoing | null;
    /** The area's fights and enemies (its page's fights and enemies): a fight on screen is Now (matchFoe). */
    foes?: { slug: string; list: Foe[] } | null;
  },
): LogView | null {
  // Not knowing where the player is, nothing from the guide: never its start, never the last place of another save.
  if (opts.where) {
    data = null;
    opts = { ...opts, walk: null };
  }
  const msgs = tab?.messages || [];
  const state = tab?.questLog || {};
  const hidden = new Set(state.hidden || []);
  const byId = (id?: string) => (id ? msgs.find((m) => m.id === id && m.role === 'assistant') : undefined);

  let now: LogNow | null = null;
  let next: LogStep[] = [];
  let done: LogView['done'] = null;
  const watch: LogWatch[] = [];

  // 1. The player's current objective: an answer's steps.
  const obj = byId(state.now);
  const objSteps = doSteps(obj);
  if (obj && objSteps.length) {
    const ticked = new Set(obj.doneSteps || []);
    const steps = objSteps.map(({ st, i }) => stepOf(obj, st, i, ticked));
    const open = steps.filter((s) => !s.done);
    const goal = answerTitle(obj);
    if (!open.length) done = { goal, msgId: obj.id };
    else {
      now = { ...open[0], source: 'question', goal, doneCount: steps.length - open.length, total: steps.length, msgId: obj.id };
      next = open.slice(1, 1 + NEXT_MAX);
    }
    (obj.steps || []).forEach((st, i) => {
      if (st.kind === 'warning') watch.push({ id: `s:${obj.id}:${i}`, text: st.label || st.text, why: st.label && st.text !== st.label ? st.text : st.detail });
    });
  } else if (opts.loaded && opts.loaded.items.length) {
    // 2. The guide's steps for the player's quest, loaded on the log.
    const steps = opts.loaded.items.map(itemStep);
    const open = steps.filter((s) => !s.done);
    if (!open.length) done = { goal: opts.loaded.title };
    else {
      now = { ...open[0], source: 'loaded', goal: opts.loaded.title, doneCount: steps.length - open.length, total: steps.length };
      next = open.slice(1, 1 + NEXT_MAX);
    }
    if (opts.loaded.warning) watch.push({ id: `w:loaded:${nameId(opts.loaded.title)}`, text: opts.loaded.warning });
  }

  // The guide's lists for this place (the old quest log's sections, without the answer's and the loaded steps).
  const more = (data?.sections || []).filter((x) => x.id !== 'answer' && x.id !== 'guide');
  const missable = more.find((x) => x.id === 'missable');
  const noReturn = more.find((x) => x.id === 'noreturn');
  for (const it of missable?.items || []) if (!it.done) watch.push({ id: it.id, text: it.label, why: it.detail?.missable || it.where, fromGuide: true });
  for (const it of noReturn?.items || []) watch.push({ id: it.id, text: it.label, why: it.where, fromGuide: true });
  const placeName = data?.place?.name || '';

  // A question's objective: the guide's walkthrough step it is about (owner, Oct 31 2026), picked the way the screen
  // reading picks one (matchDoing): from the question and the answer (their words and names), else from what Locate me
  // saw. Only a step that matches, never the area's first: its text as the details, its missables first under Watch out
  // (after the answer's own warnings).
  if (now?.source === 'question' && obj && opts.walk) {
    const walkSteps = opts.walk.steps.filter((st) => st.title);
    const others = data?.areas?.names;
    const at = matchDoing(walkSteps, questionDoing(questionOf(msgs, obj.id), obj), placeName, others) || matchDoing(walkSteps, opts.doing, placeName, others);
    if (at) {
      const st = walkSteps[at.index];
      const id = `w:${opts.walk.slug}:${st.id}`;
      now = { ...now, guide: { id, title: st.title, ...(st.text ? { detail: st.text } : {}) } };
      const own: LogWatch[] = [];
      // The step's warning as it is (once: not shortened with the whole of it repeated under it).
      if (st.warn) own.push({ id: `${id}:warn`, text: clip(st.warn, 220), fromGuide: true });
      for (const e of st.entries || []) {
        const it = missable?.items.find((x) => !x.done && x.id.endsWith(`:${e}`));
        if (it && !own.some((w) => w.id === it.id)) own.push({ id: it.id, text: it.label, why: it.detail?.missable || it.where, fromGuide: true });
      }
      const at0 = watch.findIndex((w) => w.fromGuide);
      const rest = watch.splice(at0 < 0 ? watch.length : at0).filter((w) => !own.some((o) => o.id === w.id));
      watch.push(...own, ...rest);
    }
  }

  // 3. Nothing chosen: the guide fills in for where the player is (marked "From the guide"), always as tasks, never
  // the area's description. Only what the player is seen doing makes a guide step "Now" (owner, Oct 31 2026: the area's
  // first unticked step is often far behind them): the walkthrough step that matches the objective on screen, who
  // they're talking to or the names on screen (matchDoing), from there on; the steps before it are behind them. Not
  // knowing what they're doing: "In <place> (from the guide)", a short list of what's here and its missables, no Now.
  let here: LogHere | undefined;
  if (!now && !done && (data || opts.walk)) {
    const walkSteps = (opts.walk?.steps || []).filter((st) => st.title);
    const isOpen = (st: { id: string }) => !opts.walk!.done.has(`walk:${st.id}`);
    const at = matchDoing(walkSteps, opts.doing, placeName, data?.areas?.names);
    const from = at ? walkSteps.slice(at.index).filter(isOpen) : [];
    if (at && from.length) {
      const steps = from.slice(0, 1 + NEXT_MAX).map((st): LogStep => {
        const t = taskOf(st.title, st.text || '');
        return { id: `w:${opts.walk!.slug}:${st.id}`, text: t.text, sub: t.sub, detail: st.text || undefined, done: false, tick: true };
      });
      now = { ...steps[0], source: 'guide', goal: placeName, doneCount: 0, total: 0, seen: at.matched };
      next = steps.slice(1);
    }
    // A fight on screen (most guides list each area's bosses and enemies, few have a walkthrough): "Defeat X".
    const foe = now ? null : matchFoe(opts.foes?.list || [], opts.doing);
    if (foe) {
      const how = foe.tactics || foe.notes || foe.weaknesses || '';
      now = {
        id: `f:${opts.foes!.slug}:${foe.id}`, text: (opts.labels?.logDefeat || 'Defeat {name}').replace('{name}', foe.name),
        ...(how ? { sub: clip(how, 110), detail: how } : {}), done: false, tick: false,
        source: 'guide', goal: placeName, doneCount: 0, total: 0, seen: foe.name,
      };
    }
    if (!now) {
      const walkOpen = walkSteps.filter(isOpen);
      const get = (it: TrackerItem): LogStep => {
        const st = itemStep(it);
        // An item or a chest's contents: "Get the Rusty Key" (a secret or a checklist line is a task already).
        return it.icon === 'item' || it.icon === 'chest' ? { ...st, text: (opts.labels?.logGetItem || 'Get {item}').replace('{item}', st.text) } : st;
      };
      // What's here: the walkthrough's parts by their titles ("Circus of the Last Days"), else the first entries.
      const items: LogStep[] = walkOpen.length
        ? walkOpen.slice(0, HERE_MAX).map((st) => ({ id: `w:${opts.walk!.slug}:${st.id}`, text: clip(st.title, 70), detail: st.text || undefined, done: false, tick: true }))
        : (more.find((x) => x.id === 'collect')?.items || []).filter((it) => !it.done && it.tick).slice(0, HERE_MAX).map(get);
      const missables = watch.filter((w) => w.fromGuide && !hidden.has(w.id)).slice(0, 3);
      if (items.length || missables.length) here = { place: placeName, items, missables };
    }
  }

  const pins = (state.pins || []).map((id) => byId(id)).filter((m): m is ChatMessage => !!m).map((m) => ({ id: m.id, title: answerTitle(m) || '…' }));
  const invite = !msgs.some((m) => m.role === 'user');
  const uncollected = more.filter((x) => x.id === 'missable' || x.id === 'collect').flatMap((x) => x.items).filter((it) => it.tick && !it.done).length;
  const bookmark = now && now.total ? now.total - now.doneCount : uncollected;

  // Nothing at all (an answered game with no place and nothing chosen): no log. A new game has its invitation; a game
  // whose place isn't known asks where the player is.
  if (!now && !done && !pins.length && !data && !watch.length && !invite && !opts.where) return null;
  return {
    gameKey: opts.gameKey,
    accent: opts.accent,
    place: data?.place,
    areas: data?.areas,
    ...(opts.where ? { where: opts.where } : {}),
    ...(data?.locating ? { locating: true } : {}),
    ...(data?.notice ? { notice: data.notice } : {}),
    now,
    next,
    // In the guide's list for the place, its missables are listed there.
    watch: (here ? null : watch.find((w) => !hidden.has(w.id))) || null,
    ...(here ? { here } : {}),
    pins,
    more,
    invite,
    done,
    ...(data?.offer && !opts.loaded?.items.length ? { offer: data.offer } : {}),
    bookmark,
    ...(opts.labels ? { labels: opts.labels } : {}),
  };
}

// Verbs a walkthrough step's title or sentence starts with when it's already a task ("Cross the Bridge and Claim the
// Bat", "Head across the river bridge…").
const TASK_VERBS = new Set(('reach find defeat beat kill fight battle cross head travel go walk run ride climb enter explore return talk speak '
  + 'meet survive clear collect get grab loot open claim rescue save escape follow regroup chase use take unlock investigate search '
  + 'ascend descend board leave visit help protect defend destroy solve complete finish confront activate rest light pull push jump '
  + 'drop swim sail fly continue proceed make bring deliver give buy craft equip upgrade examine inspect check break hide sneak avoid '
  + 'track hunt ask learn read pick choose decide kick ring play win join warn stop answer recover retrieve backtrack locate traverse '
  + 'move advance step work exit hijack intercept inspect establish rob catch').split(' '));
const startsWithVerb = (s: string) => TASK_VERBS.has((s.trim().split(/\s+/)[0] || '').toLowerCase());
const ucFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lcFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
/** Cut to about n characters at a word, without a dangling joiner. */
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '').replace(/\s+(and|or|to|the|a|an|of|in|on|at|with)$/i, '')}…`;
};

/**
 * A walkthrough step as a task for the log's Now: "Goal: action" when the step names a goal ("…to reach X" in its
 * first sentence, or a title that is itself a task), else the first sentence's main clause, with the step's title
 * under it. English walkthroughs read best; in other languages the first sentence is used as it is.
 */
export function taskOf(title: string, text: string): { text: string; sub?: string } {
  // The first sentence, without parentheses (map coordinates, asides).
  let sentence = (String(text || '').replace(/\s*\([^)]*\)/g, '').split(/(?<=[.!?])\s+/)[0] || '').replace(/[.!?]+$/, '').trim();
  // The main clause: "After beating Margit, the Fell Omen, you will reach X" → "reach X"; "When you arrive …, activate X"
  // → "activate X"; "Returning to the castle, locate X" → "locate X"; "You can also give X" → "give X".
  const you = sentence.match(/,\s+you(?:'ll| will| can| should| must| need to| have to)\s+(?:also\s+)?(\w.*)$/i);
  if (you) sentence = you[1];
  else {
    sentence = sentence.replace(/^(?:when|after|once|as soon as|upon|before|while|if|immediately after|following|having|with|now that)\b[^,]{0,160},\s*/i, '');
    // Any other opening ("Returning to the castle,", "From the crash site,") when a task follows it.
    const opening = !startsWithVerb(sentence) ? sentence.match(/^[^,]{0,120},\s*(.+)$/) : null;
    if (opening && startsWithVerb(opening[1])) sentence = opening[1];
  }
  sentence = sentence.replace(/^you(?:'ll| will| can| should| must| need to| have to)\s+(?:also\s+)?/i, '');
  // Drop what follows the first clause (", where you can…", ", which…", "; …").
  sentence = sentence.split(/,\s+(?:where|which|who|while|then|and then|but|so)\b|;\s/i)[0].trim();
  const imperative = startsWithVerb(sentence);
  // "Cross the narrow bridge to reach the Hero's Grave" → "Reach the Hero's Grave: cross the narrow bridge". The goal
  // ends at ", then", ", and", ", snagging…", " while", " before" (a name with a comma, "D, Hunter of the Dead", stays).
  const to = imperative ? sentence.match(/^(.+?)\s+to\s+(reach|get to|enter|breach|find|meet|access|arrive at|defeat|open|unlock|locate)\s+(.{3,})$/i) : null;
  if (to && !startsWithVerb(title)) {
    const target = to[3].split(/,\s+(?:then|and|or|but)\b|,\s+\w+ing\b|\s+(?:while|before|after|so that|in order to|if)\b/i)[0].trim();
    // A long goal keeps its first part ("Reach the Whiteridge Road Site of Grace and clear the fort" → the grace).
    const goal = target.length > 45 ? target.split(/\s+and\s+/)[0] : target;
    return { text: `${ucFirst(to[2].toLowerCase())} ${clip(goal, 70)}: ${lcFirst(clip(to[1], 70))}`, sub: title };
  }
  const action = clip(sentence, 110);
  if (startsWithVerb(title)) {
    // The title is the task; the sentence says how, when it's an instruction too.
    if (imperative && !action.toLowerCase().startsWith(title.toLowerCase())) return { text: `${title}: ${lcFirst(clip(sentence, 80))}` };
    return { text: title, ...(action && action.toLowerCase() !== title.toLowerCase() ? { sub: ucFirst(action) } : {}) };
  }
  if (action) return { text: ucFirst(action), sub: title };
  return { text: title };
}

/** A short stable id from a name. */
function nameId(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// Words that say nothing about which step it is ("Find a way into the prison" → prison).
const FILLER = new Set(('the and for with from into onto your you his her their its this that these those there here then than '
  + 'are was were has have had will can not but all any some one two out off over under way about what when where who how why '
  + 'them they she our quest quests objective optional main side part chapter act').split(' '));
/** A name as read off the screen, for showing: a game's all-capitals name in ordinary capitals ("LUCRETIOUS" → "Lucretious"). */
const shownName = (s: string) => (/\p{Ll}/u.test(s) || s.length < 4 ? s : s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, c: string) => a + c.toUpperCase()));

/**
 * The one area of the guide where what the player is doing fits (a walkthrough step or a fight there), for when Locate
 * me couldn't tell the place from the screen (a boss fight in a hall that looks like many): a suggestion the player
 * confirms ("Looks like Stormveil Castle?"), never the place by itself. Null when no area or several fit.
 */
export function areaFromDoing(
  areas: { slug: string; name: string }[],
  pages: Record<string, { walkthrough?: { title: string; text?: string; places?: string[] }[]; fights?: Foe[]; enemies?: Foe[] } | null | undefined>,
  doing: PlaceDoing | null | undefined,
): string | null {
  if (!doing) return null;
  const names = areas.map((a) => a.name);
  const hits = areas.filter((a) => {
    const page = pages[a.slug];
    if (!page) return false;
    const steps = (page.walkthrough || []).filter((st) => st?.title);
    return !!matchDoing(steps, doing, a.name, names) || !!matchFoe([...(page.fights || []), ...(page.enemies || [])], doing);
  });
  return hits.length === 1 ? hits[0].name : null;
}

/** Lower case, letters and digits only, single spaces (quotes dropped: "Arfur's" → "arfurs"). */
const normWords = (s: string) =>
  String(s || '').toLowerCase().replace(/['’‘`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (s: string) => {
  const out = new Set<string>();
  for (const w of normWords(s).split(' ')) if (w.length >= 3 && !FILLER.has(w) && !TASK_VERBS.has(w)) out.add(w);
  return out;
};

/** An area's fight or enemy in the guide (its page's fights and enemies). */
export type Foe = { id: string; name: string; notes?: string; tactics?: string; weaknesses?: string };

/**
 * The fight on screen, from what Locate me saw (owner, Oct 31 2026): an enemy or fight of the area named in the
 * activity ("fighting Margit, the Fell Omen"), or named on screen or as the one in front of the player while the
 * activity or objective is a fight ("fighting a boss", "Defeat …"). Names of 4 letters or more, whole words.
 */
export function matchFoe(foes: Foe[], doing: PlaceDoing | null | undefined): Foe | null {
  if (!doing || !foes.length) return null;
  const activity = ` ${normWords(doing.activity || '')} `;
  const fighting = /\b(fight|fighting|battle|battling|boss|combat|duel|duelling|dueling|attacking|attacked)\b/.test(activity) || /\b(defeat|kill|slay|beat)\b/i.test(doing.objective || '');
  const seen = ` ${[doing.talkingTo, ...(doing.names || []), doing.objective].map((x) => normWords(x || '')).join(' | ')} `;
  // Longest name first: "Margit, the Fell Omen" before "Margit".
  const sorted = foes.filter((f) => f?.name && normWords(f.name).length >= 4).sort((a, b) => b.name.length - a.name.length);
  for (const f of sorted) {
    const n = ` ${normWords(f.name)} `;
    if (activity.includes(n) || (fighting && seen.includes(n))) return f;
  }
  return null;
}

/**
 * Which walkthrough step the player is at, from what Locate me saw them doing (owner, Oct 31 2026): the objective on
 * screen (its words, 2 each), who they're talking to (4; their first or last name alone, 2), the names on screen (signs,
 * characters, landmarks: 3, or 2 for a short one) and the activity's words (1). A clue counts fully in one step, less in
 * two, half in up to half the steps, and not at all in more (the area's own name is in most of them). The best step
 * needs 3 or more (on a tie, the earlier one: never skip steps on a guess). matched: what it shows as the reason ("On
 * your screen: …"): the objective when it matched, else who they're talking to, else the name. Null when nothing fits well enough: then no guide step is "Now".
 */
export function matchDoing(
  steps: { title: string; text?: string; places?: string[] }[],
  doing: PlaceDoing | null | undefined,
  place = '',
  /** The guide's other areas: a place name says where, not what the player is doing. */
  otherPlaces: string[] = [],
): { index: number; matched: string } | null {
  if (!doing || !steps.length) return null;
  const hay = steps.map((st) => ` ${normWords(`${st.title} ${st.text || ''} ${(st.places || []).join(' ')}`)} `);
  const placeWords = words(place);
  const placeKey = normWords(place);
  const places = new Set(otherPlaces.map(normWords));
  // A map screen's labels are where things are, not what the player is doing.
  const onMap = /\b(map|maps)\b/.test(normWords(doing.activity || ''));
  const rarity = (phrase: string) => {
    const n = hay.filter((h) => h.includes(` ${phrase} `)).length;
    return n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 0.75 : n <= steps.length / 2 ? 0.5 : 0;
  };
  // Each clue: the phrase looked for, its weight, and the text shown for it.
  const clues: { phrase: string; weight: number; label: string; rank: number }[] = [];
  const objective = doing.objective || '';
  for (const w of words(objective)) if (!placeWords.has(w)) clues.push({ phrase: w, weight: 2, label: objective, rank: 3 });
  const who = normWords(doing.talkingTo || '');
  if (who && who !== placeKey) {
    clues.push({ phrase: who, weight: 4, label: doing.talkingTo!, rank: 2 });
    const parts = who.split(' ').filter((w) => w.length >= 4 && !FILLER.has(w));
    if (parts.length > 1) for (const w of parts) clues.push({ phrase: w, weight: 2, label: doing.talkingTo!, rank: 2 });
  }
  for (const name of onMap ? [] : doing.names || []) {
    const n = normWords(name);
    if (!n || n === placeKey || placeWords.has(n) || places.has(n) || clues.some((c) => c.phrase === n)) continue;
    clues.push({ phrase: n, weight: n.includes(' ') || n.length >= 6 ? 3 : 2, label: name, rank: 1 });
  }
  for (const w of words(doing.activity || '')) if (!placeWords.has(w) && !clues.some((c) => c.phrase === w)) clues.push({ phrase: w, weight: 1, label: '', rank: 0 });
  if (!clues.length) return null;
  const weights = clues.map((c) => c.weight * rarity(c.phrase));
  let best = -1;
  let bestScore = 0;
  let bestLabel = '';
  hay.forEach((h, i) => {
    let score = 0;
    let top = 0;
    let label = '';
    clues.forEach((c, j) => {
      if (!weights[j] || !h.includes(` ${c.phrase} `)) return;
      score += weights[j];
      if (c.label && c.rank > top) {
        top = c.rank;
        label = c.label;
      }
    });
    if (score > bestScore) {
      best = i;
      bestScore = score;
      bestLabel = label;
    }
  });
  return best >= 0 && bestScore >= 3 ? { index: best, matched: shownName(bestLabel) } : null;
}

/** The player's question an answer replies to (the last question before it). */
export function questionOf(msgs: ChatMessage[], answerId: string): string {
  const i = msgs.findIndex((m) => m.id === answerId);
  for (let j = i - 1; j >= 0; j--) if (msgs[j].role === 'user') return String(msgs[j].text || '');
  return '';
}

/**
 * Names in a text: capitalised words and runs of them ("Lower City", "Gate of Divinity"), not a sentence's first word
 * on its own ("Talk", "The") or "I".
 */
export function properNames(text: string): string[] {
  const out: string[] = [];
  const re = /\p{Lu}[\p{L}'’-]+(?:\s+(?:of the|of|the|de|du|von|van)\s+\p{Lu}[\p{L}'’-]+|\s+\p{Lu}[\p{L}'’-]+)*/gu;
  for (const m of String(text || '').matchAll(re)) {
    const before = text.slice(0, m.index).trimEnd();
    const starts = !before || /[.!?:;"“(\n·-]$/.test(before);
    if (starts && !/\s/.test(m[0])) continue;
    // A sentence's first word before a name ("Enter the Circus of the Last Days") isn't part of it.
    const name = (starts ? m[0].replace(/^\S+\s+(?:(?:of the|of|the|de|du|von|van)\s+)?/, '') : m[0]).trim();
    if (!/^\p{Lu}/u.test(name)) continue;
    if (name.length >= 3 && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

/**
 * What a question and its answer say the player is doing (owner, Oct 31 2026), for picking the guide step the way the
 * screen reading does (matchDoing): the answer's title and the question as the objective, the answer's steps as the
 * activity, and the names in the question and the steps.
 */
export function questionDoing(question: string, answer: ChatMessage): PlaceDoing {
  const steps = doSteps(answer).map(({ st }) => st);
  const names = properNames([question, ...steps.map((s) => `${s.text}. ${s.where || ''}`)].join('. ')).slice(0, 8);
  return {
    objective: [answer.title, question].filter(Boolean).join(' · ').slice(0, 240),
    activity: steps.map((s) => s.label || s.text).join(' · ').slice(0, 300),
    ...(names.length ? { names } : {}),
  };
}

/**
 * Is the question about what the player is trying to do right now (owner, Oct 31 2026)? For answers from a server that
 * doesn't say (its now="yes|no"): "How do I get into…", "Where do I find…", "I'm stuck…", "How do I beat…", and not
 * curiosity ("What does … do", lore, builds, "Is … worth it", settings).
 */
export function isNowQuestion(q: string): boolean {
  const s = ` ${String(q || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()} `;
  if (/\b(what does|what do(es)? .{1,40} do\b|lore|backstory|story behind|who is|who was|why (is|did|does)|best build|build for|worth it|is it worth|should i (spec|respec)|settings?|graphics|fps|controls?|difficulty|how long is|how many hours|release|dlc price)\b/.test(s)) return false;
  return /\b(how do i|how can i|how to|where do i|where can i|where is|where are|what do i do|what now|what next|i'm stuck|im stuck|i am stuck|stuck (on|at|in)|can't (find|get|reach|beat|open|figure)|cannot (find|get|reach|beat|open)|how do (we|you) (get|reach|beat|open|solve|find)|help me (get|find|beat|solve)|way (in|into|out|to)|get (past|into|to|through))\b/.test(s);
}

/**
 * Is the playthrough's place known now? (owner, Oct 31 2026: the log never shows the guide for a place the player
 * may not be in.) Known: the player set or confirmed it, or an answer or Locate me was sure of it; and when the place
 * has to be checked again (the game started, the tab was opened or switched to, the player came back to the game:
 * dueAt), it was set or checked since. A guess, or a place from before, is a suggestion at most.
 */
export function placeIsCurrent(place: GameTab['place'] | null | undefined, dueAt = 0): boolean {
  if (!place?.name || !(place.confirmed || place.sure)) return false;
  return !dueAt || (place.checkedAt || 0) >= dueAt;
}

/** The steps of the objective a newer question could tick (for the answer's <qc-done>): not ticked yet, with indexes. */
export function objectiveForRequest(tab: GameTab | null | undefined): { title: string; steps: { i: number; text: string }[] } | null {
  const m = tab?.questLog?.now ? tab.messages.find((x) => x.id === tab.questLog!.now) : undefined;
  if (!m) return null;
  const ticked = new Set(m.doneSteps || []);
  const steps = doSteps(m).filter(({ i }) => !ticked.has(i)).map(({ st, i }) => ({ i, text: st.text.slice(0, 140) }));
  return steps.length ? { title: answerTitle(m).slice(0, 80), steps } : null;
}

/** The quest log state after a change, without empty parts. */
export function nextLogState(s: GameTab['questLog'], patch: Partial<NonNullable<GameTab['questLog']>>): GameTab['questLog'] {
  const out = { ...(s || {}), ...patch };
  if (!out.now) delete out.now;
  if (!out.pins?.length) delete out.pins;
  if (!out.hidden?.length) delete out.hidden;
  else out.hidden = out.hidden.slice(-200);
  return Object.keys(out).length ? out : undefined;
}
