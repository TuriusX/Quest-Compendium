import { useEffect, useState } from 'react';
import { guideApi, type GuidePage } from './guideApi';
import { GUIDE_DONE_EVENT, readDone } from './guideProgress';
import { clipWords, type TrackerItem } from './trackerPayload';
import type { ChatMessage, GameTab } from '../types';

/**
 * Guide-backed objectives: when the player's current quest is one the guide covers (a quest page with steps, like
 * RDR2's Stranger missions, or a story mission or step of a chapter's walkthrough), the quest log offers to load the
 * guide's steps as its objectives, without asking the AI anything. Ticks go where the guide keeps its ticks
 * (utils/guideProgress, synced with the account): a quest page's under "quest:<slug>", a walkthrough's under its area as
 * "walk:<step id>".
 *
 * Matching (no AI): the quest's name in the tracked answer's title or text, the player's story point or the objective
 * Locate me saw on screen (whole
 * words, longest name first); otherwise a step title of the current area's walkthrough in the answer's title.
 */

export type WalkStep = { id: string; title: string; text?: string; warn?: string; tip?: string };
export type QuestData = {
  giver?: string; chapter?: string; where?: string; missables: string[];
  parts: { id: string; name: string; where?: string; steps: { id: string; text: string }[] }[];
  walkthrough?: { slug: string; name: string; anchor?: string };
};
/** What the quest log can load: a quest page's steps, or a walkthrough's (from a step on). */
export type GuideStepsRef =
  | { kind: 'quest'; key: string; slug: string; name: string }
  | { kind: 'walk'; key: string; slug: string; name: string; from?: string };
/** Loaded on a tab: what it is, and the answer it was loaded with (a newer answer takes the log back). */
export type LoadedGuideSteps = GuideStepsRef & { answerId?: string };

/** Lower case, straight quotes, letters and digits only, single spaces. */
export const normName = (s: string) =>
  ` ${String(s || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}']+/gu, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim()} `;

/** The texts the player's current quest can be read from: the answer's title and start, the question, the story point. */
export function questTexts(tab: GameTab | null | undefined, msg: ChatMessage | null | undefined): string[] {
  const out: string[] = [];
  if (msg) {
    out.push(msg.title || '', String(msg.text || '').slice(0, 2000));
    const i = tab ? tab.messages.findIndex((m) => m.id === msg.id) : -1;
    for (let j = i - 1; j >= 0 && tab; j--) if (tab.messages[j].role === 'user') { out.push(tab.messages[j].text || ''); break; }
  }
  if (tab?.place?.story) out.push(tab.place.story);
  // The objective Locate me saw on screen (the journal's quest, an on-screen objective).
  if (tab?.place?.doing?.objective) out.push(tab.place.doing.objective);
  return out.filter(Boolean);
}

/** The guide quest named in these texts (longest name first; names shorter than 8 letters are too easy to hit by chance). */
export function findQuest(entities: { slug: string; name: string; quest?: boolean }[], texts: string[]): { slug: string; name: string } | null {
  const hay = texts.map(normName).join(' | ');
  const quests = entities.filter((e) => e.quest && normName(e.name).trim().length >= 8).sort((a, b) => b.name.length - a.name.length);
  for (const q of quests) if (hay.includes(normName(q.name))) return { slug: q.slug, name: q.name };
  return null;
}

/** A walkthrough step of this page named in the answer's title (titles of 10 letters or more). */
export function findWalkStep(page: { walkthrough?: WalkStep[] } | null | undefined, title: string): WalkStep | null {
  const t = normName(title);
  if (!t.trim()) return null;
  for (const st of page?.walkthrough || []) {
    const n = normName(st.title);
    if (n.trim().length >= 10 && (t.includes(n) || n.includes(t))) return st;
  }
  return null;
}

/**
 * A quest step as a quest-log label: the guide writes steps as actions the player takes (scripts/guides/quests.ts), so
 * this only tidies and cuts them.
 */
export function stepLabel(text: string): string {
  return clipWords(String(text || '').replace(/\s+/g, ' ').trim().replace(/[.;]+$/, ''), 70);
}

/**
 * A quest step for the log: a label of a few words and the rest as the dim line. A long step is split at its first
 * clause ("After all 13 fish are mailed" / "Gill sends an invitation letter…"), so neither is cut mid-thought.
 */
export function stepParts(text: string): { label: string; rest?: string } {
  const whole = stepLabel(text);
  if (!whole.endsWith('…') && whole.length <= 48) return { label: whole };
  const t = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');
  // The first clause break after a few words: a comma, a semicolon, or " while " / " and then ".
  const m = t.match(/^(.{12,55}?)(?:,\s+|;\s+|\s+while\s+|\s+and then\s+)(.+)$/);
  if (m) {
    const tail = m[2].charAt(0).toUpperCase() + m[2].slice(1);
    return { label: stepLabel(m[1]), rest: clipWords(tail, 90) };
  }
  return { label: whole };
}

/** A walkthrough warning that says something can be missed (not "don't worry about missing it"). */
const missWarn = (w?: string) => !!w && /\b(miss|missable|lock|permanent|for good|can't return|cannot return|point of no return)\b/i.test(w) && !/\b(don't|do not|no need to) worry\b|\bremains?\b/i.test(w);

/** The quest log's section for loaded guide steps: its title, its objectives and a missable line. */
export type GuideStepsSection = { title: string; items: TrackerItem[]; warning?: string };

export function questSection(ref: { key: string; slug: string; name: string }, q: QuestData, done: Set<string>, L: Record<string, string> = {}): GuideStepsSection | null {
  const parts = q.parts.filter((p) => p.steps.length);
  if (!parts.length) return null;
  // The part being played: the first with an unticked step (the last when all are ticked).
  const at = Math.max(0, parts.findIndex((p) => p.steps.some((st) => !done.has(st.id))));
  const part = parts[at] || parts[parts.length - 1];
  const title = parts.length > 1 ? `${ref.name} · ${(L.part || 'Part {n} of {total}').replace('{n}', String(at + 1)).replace('{total}', String(parts.length))}` : ref.name;
  const items: TrackerItem[] = part.steps.map((st, i) => ({
    id: `q:${ref.slug}:${st.id}`, label: stepParts(st.text).label,
    // The step's second half, or (on the part's first step) where the part starts.
    where: stepParts(st.text).rest || (i === 0 && part.where ? clipWords(part.where, 90) : undefined),
    done: done.has(st.id), tick: true, detail: { full: st.text, ...(i === 0 && part.where ? { where: part.where } : {}) },
  }));
  const warning = q.missables.length ? (L.missable || 'Missable: {list}').replace('{list}', q.missables.slice(0, 2).join('; ')) : undefined;
  return { title, items, warning };
}

export function walkSection(ref: { slug: string; name: string; from?: string }, page: { walkthrough?: WalkStep[] }, done: Set<string>): GuideStepsSection | null {
  const steps = page.walkthrough || [];
  const start = ref.from ? Math.max(0, steps.findIndex((s) => s.id === ref.from)) : 0;
  const list = steps.slice(start, start + 10);
  if (!list.length) return null;
  const items: TrackerItem[] = list.map((st) => {
    const first = String(st.text || '').split(/(?<=[.!?])\s/)[0] || '';
    const miss = missWarn(st.warn);
    return {
      id: `w:${ref.slug}:${st.id}`, label: clipWords(st.title, 60), where: first ? clipWords(first, 90) : undefined,
      done: done.has(`walk:${st.id}`), tick: true, missable: miss || undefined,
      detail: { full: st.text, ...(miss ? { missable: st.warn } : st.warn ? { notes: st.warn } : {}), ...(st.tip ? { how: st.tip } : {}) },
    };
  });
  return { title: ref.name, items };
}

/**
 * For the active tab: what the quest log can offer to load (the player's current quest in the guide) and, when the
 * player loaded one, its section. Re-reads the ticks whenever anything is ticked.
 */
export function useGuideSteps(opts: {
  guideKey: string | null; lang: string; tab: GameTab | null | undefined; msg: ChatMessage | null | undefined;
  areaSlug?: string; areaPage?: (GuidePage & { walkthrough?: WalkStep[] }) | null; loaded: LoadedGuideSteps | null | undefined; labels?: Record<string, string>;
}): { offer: (GuideStepsRef & { count: number }) | null; section: GuideStepsSection | null } {
  const { guideKey, lang, tab, msg, areaSlug, areaPage, loaded, labels } = opts;
  const [entities, setEntities] = useState<{ key: string; list: { slug: string; name: string; quest?: boolean }[] } | null>(null);
  const [data, setData] = useState<{ id: string; quest?: QuestData; page?: { walkthrough?: WalkStep[] } } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!guideKey) { setEntities(null); return; }
    let alive = true;
    guideApi(`/api/guides/${encodeURIComponent(guideKey)}`, lang)
      .then((g) => alive && setEntities({ key: guideKey, list: Array.isArray(g?.entities) ? g.entities : [] }))
      .catch(() => alive && setEntities(null));
    return () => { alive = false; };
  }, [guideKey, lang]);

  // The candidate: a quest page named in the answer (with steps, or a walkthrough it belongs to), else a walkthrough
  // step of the current area named in the answer's title.
  const texts = questTexts(tab, msg);
  const quest = entities && entities.key === guideKey ? findQuest(entities.list, texts) : null;
  const walkHere = !quest && areaSlug && areaPage ? findWalkStep(areaPage, msg?.title || '') : null;
  const candidate: GuideStepsRef | null = loaded
    ? null
    : quest && guideKey ? { kind: 'quest', key: guideKey, slug: quest.slug, name: quest.name }
    : walkHere && guideKey && areaSlug ? { kind: 'walk', key: guideKey, slug: areaSlug, name: areaPage?.name || walkHere.title, from: walkHere.id }
    : null;
  const want: GuideStepsRef | null = loaded || candidate;
  const wantId = want ? `${want.kind}:${want.key}:${want.slug}:${(want as any).from || ''}` : '';

  // Fetch what it needs: the quest page (its steps, or the walkthrough it points to), or the area page.
  useEffect(() => {
    if (!want) { setData(null); return; }
    let alive = true;
    (async () => {
      if (want.kind === 'quest') {
        const e = await guideApi(`/api/guides/${encodeURIComponent(want.key)}/entity/${encodeURIComponent(want.slug)}`, lang).catch(() => null);
        const q: QuestData | undefined = e?.quest;
        if (!q) { if (alive) setData(null); return; }
        // A story mission without steps of its own: the chapter walkthrough it links to, from its step.
        const hasSteps = q.parts?.some((p) => p.steps?.length);
        const page = !hasSteps && q.walkthrough?.slug ? await guideApi(`/api/guides/${encodeURIComponent(want.key)}/${encodeURIComponent(q.walkthrough.slug)}`, lang).catch(() => null) : null;
        if (alive) setData({ id: wantId, quest: q, page: page || undefined });
      } else {
        const page = await guideApi(`/api/guides/${encodeURIComponent(want.key)}/${encodeURIComponent(want.slug)}`, lang).catch(() => null);
        if (alive) setData({ id: wantId, page: page || undefined });
      }
    })();
    return () => { alive = false; };
  }, [wantId, lang]);

  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener(GUIDE_DONE_EVENT, on);
    return () => window.removeEventListener(GUIDE_DONE_EVENT, on);
  }, []);
  void tick;

  let section: GuideStepsSection | null = null;
  let count = 0;
  if (want && data && data.id === wantId) {
    const q = data.quest;
    if (want.kind === 'quest' && q && q.parts?.some((p) => p.steps?.length)) {
      section = questSection(want, q, readDone(want.key, `quest:${want.slug}`), labels);
      count = q.parts.reduce((n, p) => n + p.steps.length, 0);
    } else if (data.page?.walkthrough?.length) {
      // A quest page pointing at a chapter walkthrough, or a walkthrough step: that walkthrough's steps.
      const slug = want.kind === 'quest' ? q?.walkthrough?.slug || '' : want.slug;
      const from = want.kind === 'quest' ? q?.walkthrough?.anchor : (want as any).from;
      if (slug) {
        // Without a step to start from, it's the chapter's whole walkthrough: named as that, not as the mission.
        const name = want.kind === 'quest' && !from ? q?.walkthrough?.name || want.name : want.name;
        section = walkSection({ slug, name, from }, data.page, readDone(want.key, slug));
        count = section?.items.length || 0;
      }
    }
  }
  if (loaded) return { offer: null, section };
  return { offer: candidate && section && count ? { ...candidate, count } : null, section: null };
}
