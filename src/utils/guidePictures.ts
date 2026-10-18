import { useEffect, useState } from 'react';
import { SITE } from './guideSite';
import type { TrackerPayload } from './trackerPayload';

/**
 * The owner-approved pictures of a game's guide, as the nightly publish lists them (guides/{key}/pictures.json, from
 * scripts/guides/sitePictures.ts picturesOf): each with where the owner's switches let it show. The app uses them for
 * the card under an answer ("App answer") and the quest log's thumbnails ("Quest log / step"); the guide pages carry
 * their own (they are the website's).
 */
export type GuidePicture = {
  kind: 'area' | 'entity' | 'step' | 'entry';
  slug: string;
  id?: string;
  page: boolean;
  step: boolean;
  answer: boolean;
  thumb: string;
  w300: string;
  w600: string;
  big: string;
  alt: string;
  caption: string;
  credit?: string;
};

const cache = new Map<string, Promise<GuidePicture[]>>();
export function loadGuidePictures(key: string): Promise<GuidePicture[]> {
  if (!cache.has(key)) {
    cache.set(key, fetch(`${SITE}/guides/${encodeURIComponent(key)}/pictures.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (Array.isArray(j?.pictures) ? (j.pictures as GuidePicture[]) : []))
      .catch(() => { cache.delete(key); return []; }));
  }
  return cache.get(key)!;
}

export function useGuidePictures(key: string | null | undefined): GuidePicture[] {
  const [pics, setPics] = useState<GuidePicture[]>([]);
  useEffect(() => {
    setPics([]);
    if (!key) return;
    let alive = true;
    loadGuidePictures(key).then((p) => alive && setPics(p));
    return () => { alive = false; };
  }, [key]);
  return pics;
}

/** The picture for an answer that used this entry (or, failing that, its page): only with "App answer" on. */
export function answerPicture(pics: GuidePicture[], slug: string, entry?: string): GuidePicture | null {
  if (entry) {
    const e = pics.find((p) => p.answer && p.slug === slug && p.id === entry && (p.kind === 'entry' || p.kind === 'step'));
    if (e) return e;
  }
  return pics.find((p) => p.answer && p.slug === slug && (p.kind === 'area' || p.kind === 'entity')) || null;
}

/** A walkthrough step's or a checklist entry's picture: only with "Quest log / step" on (the target itself, never the page). */
export function stepPicture(pics: GuidePicture[], slug: string, id: string, kind: 'step' | 'entry'): GuidePicture | null {
  return pics.find((p) => p.step && p.kind === kind && p.slug === slug && p.id === id) || null;
}

/**
 * The quest log's rows with their thumbnails: a guide entry (g:<slug>:<id>[+<id>…]) or a loaded walkthrough step
 * (w:<slug>:<step id>) that has a "Quest log / step" picture. Rows without one stay as they are.
 */
export function withPictures(payload: TrackerPayload | null, pics: GuidePicture[]): TrackerPayload | null {
  if (!payload || !pics.some((p) => p.step)) return payload;
  const sections = payload.data.sections.map((x) => ({
    ...x,
    items: x.items.map((o) => {
      const [kind, slug, ...rest] = String(o.id).split(':');
      const id = rest.join(':').split('+')[0];
      const pic = kind === 'g' ? stepPicture(pics, slug, id, 'entry') : kind === 'w' ? stepPicture(pics, slug, id, 'step') : null;
      return pic ? { ...o, pic: pic.thumb, picAlt: pic.alt } : o;
    }),
  }));
  return { ...payload, data: { ...payload.data, sections } };
}
