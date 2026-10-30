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
import type { ChatMessage, GameTab, QuestStep } from '../types';
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
};
export type LogWatch = { id: string; text: string; why?: string };
export type LogView = {
  gameKey: string;
  accent: string;
  place?: TrackerData['place'];
  areas?: TrackerData['areas'];
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

const NEXT_MAX = 3;

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
    walk?: { slug: string; steps: { id: string; title: string; text?: string }[]; done: Set<string> } | null;
  },
): LogView | null {
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
  for (const it of missable?.items || []) if (!it.done) watch.push({ id: it.id, text: it.label, why: it.detail?.missable || it.where });
  for (const it of noReturn?.items || []) watch.push({ id: it.id, text: it.label, why: it.where });

  // 3. Nothing chosen: the guide fills in for where the player is (marked "From the guide"), always as tasks, never
  // the area's description: its walkthrough's next unticked step ("Reach the Giant-Conquering Hero's Grave: cross the
  // narrow rock bridge…", ticked like the walkthrough), else its first unticked entries ("Get the Rusty Key").
  if (!now && !done && (data || opts.walk)) {
    const walkOpen = (opts.walk?.steps || []).filter((st) => st.title && !opts.walk!.done.has(`walk:${st.id}`));
    if (walkOpen.length) {
      const steps = walkOpen.slice(0, 1 + NEXT_MAX).map((st): LogStep => {
        const t = taskOf(st.title, st.text || '');
        return { id: `w:${opts.walk!.slug}:${st.id}`, text: t.text, sub: t.sub, detail: st.text || undefined, done: false, tick: true };
      });
      now = { ...steps[0], source: 'guide', goal: data?.place?.name || '', doneCount: 0, total: 0 };
      next = steps.slice(1);
    } else {
      const open = (more.find((x) => x.id === 'collect')?.items || []).filter((it) => !it.done && it.tick);
      const get = (it: TrackerItem): LogStep => {
        const st = itemStep(it);
        // An item or a chest's contents: "Get the Rusty Key" (a secret or a checklist line is a task already).
        return it.icon === 'item' || it.icon === 'chest' ? { ...st, text: (opts.labels?.logGetItem || 'Get {item}').replace('{item}', st.text) } : st;
      };
      if (open.length) {
        now = { ...get(open[0]), source: 'guide', goal: data?.place?.name || '', doneCount: 0, total: 0 };
        next = open.slice(1, NEXT_MAX).map(get);
      }
    }
  }

  const pins = (state.pins || []).map((id) => byId(id)).filter((m): m is ChatMessage => !!m).map((m) => ({ id: m.id, title: answerTitle(m) || '…' }));
  const invite = !msgs.some((m) => m.role === 'user');
  const uncollected = more.filter((x) => x.id === 'missable' || x.id === 'collect').flatMap((x) => x.items).filter((it) => it.tick && !it.done).length;
  const bookmark = now && now.total ? now.total - now.doneCount : uncollected;

  // Nothing at all (an answered game with no place and nothing chosen): no log. A new game has its invitation.
  if (!now && !done && !pins.length && !data && !watch.length && !invite) return null;
  return {
    gameKey: opts.gameKey,
    accent: opts.accent,
    place: data?.place,
    areas: data?.areas,
    ...(data?.locating ? { locating: true } : {}),
    ...(data?.notice ? { notice: data.notice } : {}),
    now,
    next,
    watch: watch.find((w) => !hidden.has(w.id)) || null,
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
