/**
 * Find old answers again, and delete a question and its answer (owner, Nov 20 2026, ideas #1 and #10).
 *
 * - qaPair: the ids a delete removes: the answer, and the question it answered (the player's message just before it).
 * - logWithout: the quest log without them (Now, Saved, Earlier, closed offers).
 * - searchAnswers: the player's questions and answers matching some words, across games or in one; all on this
 *   computer, no AI call. Every word must appear (in any order, accents and case ignored); the question and the
 *   answer's title count more than its text; newer first among equals.
 * - savedAnswers / recentAnswers: what the search shows before anything is typed.
 */
import type { ChatMessage, GameTab, QuestLogState } from '../types';

/** The answer and the question it answered (only one question: a question answered twice keeps the other answer's). */
export function qaPair(messages: ChatMessage[], answerId: string): string[] {
  const i = messages.findIndex((m) => m.id === answerId);
  if (i < 0) return [];
  const ids = [answerId];
  const q = messages[i - 1];
  if (q && q.role === 'user') {
    const next = messages[i + 1];
    // The question had a second answer after this one (asked again): the question stays with it.
    const answeredAgain = !!next && next.role === 'assistant' && !next.asideMoved;
    if (!answeredAgain) ids.unshift(q.id);
  }
  return ids;
}

/** The quest log without these messages: Now, Saved (pins), Earlier steps from them, and their closed "Set as Now" offers. */
export function logWithout(log: QuestLogState | undefined, ids: string[]): Partial<QuestLogState> | null {
  if (!log) return null;
  const gone = new Set(ids);
  const out: Partial<QuestLogState> = {};
  let changed = false;
  if (log.now && gone.has(log.now)) { out.now = undefined; changed = true; }
  if (log.pins?.some((p) => gone.has(p))) { out.pins = log.pins.filter((p) => !gone.has(p)); changed = true; }
  if (log.passed?.some((p) => p.msgId && gone.has(p.msgId))) { out.passed = log.passed.filter((p) => !(p.msgId && gone.has(p.msgId))); changed = true; }
  if (log.hidden?.some((h) => gone.has(h.replace(/^offer:/, '')))) { out.hidden = log.hidden.filter((h) => !gone.has(h.replace(/^offer:/, ''))); changed = true; }
  return changed ? out : null;
}

export type FoundAnswer = {
  tabId: string;
  game: string;
  answerId: string;
  question: string;
  /** The answer's title, else its first words. */
  title: string;
  /** A few words of the answer around the first match ('' when the match was in the question or title). */
  snippet: string;
  at: number;
  saved: boolean;
};

const fold = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plain = (s: string) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/[*_#`>|]+/g, ' ').replace(/\[(.*?)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
const gameOf = (t: GameTab) => t.activeSteamGame?.name || t.name || '';

/** Every answer of a tab with the question before it (answers moved to another tab, and the stubs left, are skipped). */
function pairsOf(t: GameTab): { answer: ChatMessage; question: string }[] {
  const out: { answer: ChatMessage; question: string }[] = [];
  const msgs = t.messages || [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== 'assistant' || m.asideMoved || !String(m.text || '').trim()) continue;
    let question = '';
    for (let j = i - 1; j >= 0; j--) if (msgs[j].role === 'user') { question = String(msgs[j].text || ''); break; } else if (msgs[j].role === 'assistant') break;
    out.push({ answer: m, question });
  }
  return out;
}

function found(t: GameTab, a: ChatMessage, question: string, snippet = ''): FoundAnswer {
  const text = plain(a.text || '');
  return {
    tabId: t.id, game: gameOf(t), answerId: a.id, question: plain(question).slice(0, 200),
    title: plain(a.title || '') || text.split(/(?<=[.!?])\s/)[0].slice(0, 90),
    snippet, at: a.timestamp || 0, saved: !!t.questLog?.pins?.includes(a.id),
  };
}

/** Matching answers, best first; tabId limits it to one game. At most `limit`. */
export function searchAnswers(tabs: GameTab[], query: string, opts: { tabId?: string; limit?: number } = {}): FoundAnswer[] {
  const words = fold(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
  if (!words.length) return [];
  const scored: { f: FoundAnswer; score: number }[] = [];
  for (const t of tabs) {
    if (opts.tabId && t.id !== opts.tabId) continue;
    for (const { answer, question } of pairsOf(t)) {
      const head = fold(`${question} ${answer.title || ''} ${gameOf(t)}`);
      const textRaw = plain(answer.text || '');
      const body = fold(textRaw);
      if (!words.every((w) => head.includes(w) || body.includes(w))) continue;
      const score = words.reduce((s, w) => s + (head.includes(w) ? 3 : 1), 0);
      // The answer's words around the first match found only in its text.
      const w = words.find((x) => !head.includes(x));
      let snippet = '';
      if (w) {
        const at = body.indexOf(w);
        let from = Math.max(0, at - 50);
        // Start on a whole word.
        if (from > 0) { const sp = textRaw.indexOf(' ', from); if (sp >= 0 && sp < at) from = sp + 1; }
        snippet = `${from > 0 ? '…' : ''}${textRaw.slice(from, at + w.length + 70).trim()}${at + w.length + 70 < textRaw.length ? '…' : ''}`;
      }
      scored.push({ f: found(t, answer, question, snippet), score });
    }
  }
  return scored.sort((a, b) => b.score - a.score || b.f.at - a.f.at).slice(0, opts.limit ?? 40).map((x) => x.f);
}

/** Saved answers (the quest log's Save), newest saved first per game; games by when they were last played. */
export function savedAnswers(tabs: GameTab[], opts: { tabId?: string } = {}): FoundAnswer[] {
  const out: FoundAnswer[] = [];
  for (const t of [...tabs].sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))) {
    if (opts.tabId && t.id !== opts.tabId) continue;
    const pairs = new Map(pairsOf(t).map((p) => [p.answer.id, p]));
    for (const id of t.questLog?.pins || []) {
      const p = pairs.get(id);
      if (p) out.push(found(t, p.answer, p.question));
    }
  }
  return out;
}

/** The latest answers (not the saved ones, shown above them), newest first. */
export function recentAnswers(tabs: GameTab[], opts: { tabId?: string; limit?: number } = {}): FoundAnswer[] {
  const out: FoundAnswer[] = [];
  for (const t of tabs) {
    if (opts.tabId && t.id !== opts.tabId) continue;
    for (const { answer, question } of pairsOf(t)) if (!t.questLog?.pins?.includes(answer.id)) out.push(found(t, answer, question));
  }
  return out.sort((a, b) => b.at - a.at).slice(0, opts.limit ?? 8);
}
