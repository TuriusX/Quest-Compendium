import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '../utils/api';
import { readDone, GUIDE_DONE_EVENT } from '../utils/guideProgress';
import { samePlace } from '../utils/placeName';

/**
 * "Worth getting here" for the player's area, any game, guide or not (owner, Nov 15 2026; server: worthOnDemand.ts).
 * The area's list comes from GET /api/worth (the fact database). An area with no list yet is filled when Help me here or
 * an answer hands the app a ticket (redeem): the server runs the area's pass while the app waits, and the quest log
 * says "Finding what's worth getting here…" meanwhile. A ticket waits until the quest log is on its area (Help me here
 * hands it over as it moves the player there). An area another player is filling is checked again every few seconds.
 */
export type WorthTicket = { key: string; slug: string; name: string; status: string; ticket?: string };
export type WorthHere = {
  status: 'idle' | 'filling' | 'ready' | 'none';
  key?: string; slug?: string; name?: string;
  worth?: any; achievements?: any;
  /** Ticked items of this area (the same store as the guide pages' ticks). */
  done: Set<string>;
};

const POLL_MS = 4000;
const POLL_TRIES = 30;
const IDLE: WorthHere = { status: 'idle', done: new Set() };

export function useWorthHere(game: string | undefined, place: string | undefined, o: { appId?: number; guideKey?: string | null; english: boolean; token: () => Promise<string | null> }) {
  const [here, setHere] = useState<WorthHere>(IDLE);
  const want = useRef('');
  const placeRef = useRef(place);
  placeRef.current = place;
  const tokenRef = useRef(o.token);
  tokenRef.current = o.token;
  const pending = useRef<WorthTicket | null>(null);
  const at = `${game || ''}\u0001${place || ''}`;

  const apply = useCallback((d: any, forAt: string) => {
    if (want.current !== forAt || !d) return;
    const facts = d.worth || d.achievements;
    setHere({
      status: d.status === 'ready' && facts ? 'ready' : d.status === 'running' ? 'filling' : 'none',
      key: d.key, slug: d.slug, name: d.name, worth: d.worth, achievements: d.achievements,
      done: d.key && d.slug ? readDone(d.key, d.slug) : new Set(),
    });
  }, []);

  const fill = useCallback(async (w: WorthTicket, forAt: string, read: (forAt: string, tries?: number) => Promise<void>) => {
    if (want.current !== forAt) return;
    setHere((h) => ({ ...h, status: 'filling', key: w.key, slug: w.slug, name: w.name }));
    const token = await tokenRef.current().catch(() => null);
    const d = await fetch(`${getApiBaseUrl()}/api/worth/fill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ticket: w.ticket }),
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d) apply(d, forAt);
    else if (want.current === forAt) setHere((h) => ({ ...h, status: 'none' }));
    if (d?.status === 'running') setTimeout(() => void read(forAt, 1), POLL_MS);
  }, [apply]);

  const read = useCallback(async (forAt: string, tries = 0): Promise<void> => {
    if (want.current !== forAt || !game || !place) return;
    const q = new URLSearchParams({ game, place, ...(o.appId ? { appId: String(o.appId) } : {}), ...(o.guideKey ? { guideKey: o.guideKey } : {}) });
    const d = await fetch(`${getApiBaseUrl()}/api/worth?${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    // Never filled, and a ticket for this area is waiting: fill it now.
    const w = pending.current;
    if (d?.status === 'missing' && w?.ticket && samePlace(place, w.name)) {
      pending.current = null;
      return fill(w, forAt, read);
    }
    apply(d, forAt);
    // Someone else is filling it: check again in a moment.
    if (d?.status === 'running' && tries < POLL_TRIES) setTimeout(() => void read(forAt, tries + 1), POLL_MS);
  }, [game, place, o.appId, o.guideKey, apply, fill]);

  useEffect(() => {
    want.current = at;
    setHere(IDLE);
    if (!o.english || !game || !place) return;
    void read(at);
  }, [at, o.english]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ticks made elsewhere (the guide page, another window) show here too.
  useEffect(() => {
    const on = () => setHere((h) => (h.key && h.slug ? { ...h, done: readDone(h.key, h.slug) } : h));
    window.addEventListener(GUIDE_DONE_EVENT, on);
    return () => window.removeEventListener(GUIDE_DONE_EVENT, on);
  }, []);

  /** Help me here or an answer named the player's area: fill it with its ticket, or read it again if it's in now. */
  const redeem = useCallback((w: WorthTicket | null | undefined) => {
    if (!w || !o.english) return;
    const onIt = samePlace(placeRef.current, w.name);
    if (w.status === 'missing' && w.ticket) {
      if (onIt) void fill(w, want.current, read);
      else pending.current = w; // the quest log moves there in a moment
    } else if (onIt && (w.status === 'ready' || w.status === 'running')) void read(want.current);
  }, [o.english, fill, read]);

  return { here, redeem };
}
