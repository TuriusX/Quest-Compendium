/**
 * The new web app's calls to the server (owner, Nov 25 2026: "redesign it from scratch and then maybe we can use that
 * as a pilot for a mobile app"). The same endpoints and the same guest and account sign-in as the desktop overlay's
 * code (src/App.tsx), sending only what a player on a phone or a browser tab has: the question, a photo or screenshot,
 * a voice message, the last few turns, the game and where they are.
 */
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { getApiBaseUrl } from '../utils/api';
import { deviceId } from '../utils/deviceId';
import { appSource } from '../utils/source';
import type { SourceLink } from '../components/SourceLinks';
import type { VisualData } from '../components/VisualCard';
import type { QuickId } from '../utils/quickQuestions';

const GUEST = 'quest_guest_session';

export type Who = { user: User | null; guestId: string | null };

/** A guest session the old app also understands, made without asking (no sign-in box before the first question). */
export function ensureGuest(): string {
  try {
    const cur = localStorage.getItem(GUEST);
    if (cur) return cur;
    const id = 'guest_' + Math.random().toString(36).substring(2, 12);
    localStorage.setItem(GUEST, id);
    return id;
  } catch {
    return 'guest_' + Math.random().toString(36).substring(2, 12);
  }
}

export function forgetGuest(): void {
  try {
    localStorage.removeItem(GUEST);
  } catch {
    /* fine */
  }
}

/** Signed in, or a guest: the player's identity, live. */
export function watchWho(cb: (w: Who) => void): () => void {
  return onAuthStateChanged(auth, (user) => cb(user ? { user, guestId: null } : { user: null, guestId: ensureGuest() }));
}

async function token(w: Who): Promise<string | null> {
  if (w.user) return w.user.getIdToken().catch(() => null);
  return w.guestId;
}

function headers(tok: string | null): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-QC-App': 'web',
    'X-QC-Device': deviceId(),
    ...(appSource() ? { 'X-QC-From': appSource() } : {}),
    ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
  };
}

export type Game = { name: string; appId: number; art?: string; platforms?: string; guide?: boolean };
export type Place = { name: string; story?: string; checkedAt?: number; [k: string]: unknown };

export type Turn = {
  id: string;
  q: string;
  /** A small copy of the photo or screenshot asked with (shown above the answer; never sent again). */
  thumb?: string;
  voice?: boolean;
  at: number;
  answer?: string;
  sources?: SourceLink[];
  visual?: VisualData;
  guideRefs?: { key: string; slug: string; area: string; name: string }[];
  /** The limit or an error: shown instead of an answer, with what to do. */
  problem?: { text: string; signIn?: boolean; premium?: boolean };
  getApp?: boolean;
};

export type AskResult = Pick<Turn, 'answer' | 'sources' | 'guideRefs' | 'problem'> & { place?: Place | null };

export async function ask(w: Who, o: {
  game: Game;
  question: string;
  image?: string;
  audio?: string;
  quick?: QuickId;
  history: Turn[];
  place?: Place | null;
  language: string;
}): Promise<AskResult> {
  const tok = await token(w);
  const history = o.history
    .filter((t) => t.answer)
    .slice(-3)
    .flatMap((t) => [{ role: 'user', text: t.q }, { role: 'assistant', text: t.answer || '' }]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100_000);
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: headers(tok),
      body: JSON.stringify({
        question: o.question,
        history,
        imageBase64: o.image,
        audioBase64: o.audio,
        answerModel: 'pro',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(o.quick ? { quick: o.quick } : {}),
        isGameRunningLocally: false,
        tabName: o.game.name,
        activeGame: { name: o.game.name, ...(o.game.appId ? { appId: o.game.appId } : {}) },
        achievements: [],
        news: [],
        generateBanner: false,
        language: o.language,
        markers: false,
        place: o.place || null,
        done: [],
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data?.modelUsed === 'Limit Reached' || res.status === 403 || res.status === 429) {
        return { problem: { text: String(data?.text || data?.error || 'No questions left for today.'), signIn: !w.user, premium: !!w.user } };
      }
      if (res.status === 401) return { problem: { text: 'Your sign-in ran out. Sign in again to keep going.', signIn: true } };
      return { problem: { text: 'That didn’t go through. Try asking again in a moment.' } };
    }
    const text = typeof data.text === 'string' && data.text.trim() ? data.text : '';
    if (!text) return { problem: { text: 'No answer came back. Try asking it another way.' } };
    return {
      answer: text,
      sources: Array.isArray(data.sourceLinks) ? data.sourceLinks.filter((l: any) => l && /^https:\/\//.test(String(l.url || ''))) : undefined,
      guideRefs: Array.isArray(data.guideRefs) ? data.guideRefs.slice(0, 6) : undefined,
      place: data.place && typeof data.place === 'object' && data.place.name ? data.place : undefined,
    };
  } catch {
    return { problem: { text: 'The answer took too long or the connection dropped. Try again.' } };
  } finally {
    clearTimeout(timer);
  }
}

/** The picture, video or page that shows the answer (the server decides; most answers get one, some none). */
export async function fetchVisual(w: Who, o: { game: Game; question: string; answer: string; shotOnly?: boolean }): Promise<VisualData | null> {
  try {
    const tok = await token(w);
    const res = await fetch(`${getApiBaseUrl()}/api/visual`, {
      method: 'POST',
      headers: headers(tok),
      body: JSON.stringify({ game: o.game.name, question: o.question, answer: o.answer, client: 'web', ...(o.shotOnly ? { shotOnly: true } : {}) }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const v = data?.visual;
    return v && (v.kind === 'video' || v.kind === 'picture' || v.kind === 'link') ? v : null;
  } catch {
    return null;
  }
}

/** Every game on every platform (server gameSearch.ts), games with a guide marked. */
export async function searchGames(w: Who, q: string): Promise<Game[]> {
  try {
    const tok = await token(w);
    const res = await fetch(`${getApiBaseUrl()}/api/steam/search?q=${encodeURIComponent(q)}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data.games || []).map((g: any) => ({ name: String(g.name), appId: Number(g.appId) || 0, art: g.headerImage, platforms: g.genre, guide: !!g.guide }));
  } catch {
    return [];
  }
}
