/**
 * The fact database (owner, Nov 8 2026; plan: Desktop\QC-database-plan\PLAN.md, roadmap 29). One record per thing in a
 * game (an item, an NPC, a boss, a place, a quest step, a choice, an achievement, a point of no return), each with its
 * own sources and status, so pages can be generated from facts and answers can draw on checked facts.
 *
 *   gameRecords/{key}                 the game's summary: counts by type, tier and status, when it was last imported
 *   gameRecords/{key}/records/{id}    one record (GameRecord below)
 *
 * Step 1 (this file and recordsImport.ts) fills the store from what is live today: the guide's area pages (as
 * published: the owner's edits laid over, an unchecked page's unshown fields kept but marked), the compendium, the
 * achievement guides and the facts learned from players' searches (gameFacts). Nothing reads the store yet: the site,
 * the apps and the answers are unchanged until later steps switch them on.
 *
 * Tiers (how far a record is from being shown as checked):
 *   A  on a checked page (or a compendium page that passed its claim check, or a checked achievement guide) with
 *      sources of its own, or written by a flagship build from the page's checked source pack: moves over as checked
 *   B  sources of its own, but its page isn't checked (or it was learned from a player's search, or its sources are
 *      only the page's): rechecked against evidence already on file, no new searches
 *   C  no sources of its own (most entries of quick, unchecked pages), or only a blocked source (Fandom): verified with
 *      searches, most wanted first
 * Status: A is "checked"; B and C are "unconfirmed"; a player fact marked disputed is "disputed". Missing fields a
 * record should have (a missable's lockout, its exact final step) are listed in gaps.
 */
import crypto from 'crypto';
import { BLOCKED } from './claimCheck';
import { entityKind } from './siteText';
import { missableGaps, type GuideArea } from './common';

export type RecordType =
  | 'place' | 'item' | 'secret' | 'enemy' | 'boss' | 'shop' | 'npc' | 'quest' | 'step' | 'choice' | 'tip' | 'advice'
  | 'checklist' | 'achievement' | 'noreturn' | 'warning' | 'thing' | 'other';
export type Tier = 'A' | 'B' | 'C';
export type RecordStatus = 'checked' | 'unconfirmed' | 'disputed';

export type GameRecord = {
  id: string;
  key: string;
  type: RecordType;
  name: string;
  /** One short line for tables, cards and the overlay (at most 200 characters). */
  short?: string;
  /** The page this record lives on (an area or compendium slug), and its order there (route order for steps). */
  place?: string;
  placeName?: string;
  order?: number;
  /** The record's facts, field by field (where, how, lockout, sells, weakness, rewards...). Strings or short lists. */
  fields: Record<string, string | string[]>;
  missable?: boolean;
  /** Other records this one points at: a step's items and fights, an achievement's area. */
  links?: string[];
  /** Long text still to be turned into facts (step 2): a step's walkthrough text, a page's overview, answers. */
  prose?: Record<string, string>;
  sources: string[];
  tier: Tier;
  status: RecordStatus;
  gaps?: string[];
  /** Where it came from (for re-imports and the pages that still render the old way). */
  origin: { from: 'area' | 'entity' | 'achievements' | 'gameFacts' | 'extract'; slug?: string; entry?: string };
  /** Fields filled from the page's own prose (recordsExtract.ts), each backed by a word-for-word quote. */
  extracted?: { field: string; quote: string }[];
  /** The page's Search Console impressions in the last window (pageStats), for ordering the verify queue. */
  impressions?: number;
  /** When the record's page was last checked or changed (ms). */
  checkedAt?: number;
  hash?: string;
  importedAt?: number;
};

const clean = (v: unknown, n = 2000) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const firstSentence = (s: string, n = 200) => {
  const t = clean(s, 1000);
  const m = t.match(/^.+?[.!?](?=\s|$)/);
  const one = (m ? m[0] : t).trim();
  return one.length <= n ? one : `${one.slice(0, n - 1).replace(/\s+\S*$/, '')}…`;
};
const usable = (sources: unknown) => (Array.isArray(sources) ? sources.map(String).filter((s) => s && !BLOCKED.test(s.trim())) : []);
const blockedOnly = (sources: unknown) => Array.isArray(sources) && sources.length > 0 && usable(sources).length === 0;
const slugOf = (s: string) => clean(s, 200).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
/** Firestore document ids: no slashes, at most 1,500 bytes. */
const docId = (...parts: string[]) => parts.map((p) => String(p).replace(/[/\s]+/g, '-')).join('.').slice(0, 300);

/** Only fields with something in them. */
function fieldsOf(o: Record<string, unknown>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) { const xs = v.map((x) => clean(x, 400)).filter(Boolean); if (xs.length) out[k] = xs; }
    else { const t = clean(v); if (t) out[k] = t; }
  }
  return out;
}

export const recordHash = (r: GameRecord) => {
  const { hash: _h, importedAt: _i, impressions: _p, ...rest } = r;
  return crypto.createHash('sha1').update(JSON.stringify(rest)).digest('hex').slice(0, 16);
};

export function finish(r: Omit<GameRecord, 'hash'>): GameRecord {
  const out = JSON.parse(JSON.stringify(r)) as GameRecord;
  if (!out.gaps?.length) delete out.gaps;
  if (!out.links?.length) delete out.links;
  if (out.prose && !Object.keys(out.prose).length) delete out.prose;
  out.hash = recordHash(out);
  return out;
}
const statusOf = (t: Tier): RecordStatus => (t === 'A' ? 'checked' : 'unconfirmed');

/**
 * An area page's records, as the page is published (the owner's edits already laid over by the caller). On an
 * unchecked page the site leaves out secrets and weaknesses (publish.ts sourcedOnly); they are kept here, tier C.
 */
export function areaRecords(key: string, a: GuideArea & Record<string, any>, impressions = 0): GameRecord[] {
  const slug = String(a.slug);
  const checked = a.verified !== false;
  const flagship = !!a.flagship || !!(a.walkthrough && a.walkthrough.length);
  const pageSources = usable(a.sources);
  const at = Number(a.updatedAt || 0) || undefined;
  const base = { key, place: slug, placeName: clean(a.name, 120), impressions: impressions || undefined, checkedAt: checked ? at : undefined };
  const tierOf = (e: any): Tier => {
    if (e?.unconfirmed || blockedOnly(e?.sources)) return 'C';
    const own = usable(e?.sources).length > 0;
    if (checked && (own || (flagship && !(e?.sources?.length)))) return 'A';
    if (own || (checked && pageSources.length)) return 'B';
    return 'C';
  };
  const srcOf = (e: any) => { const own = usable(e?.sources); return own.length ? own : pageSources; };
  const out: GameRecord[] = [];
  const info = a.info || {};
  // The place itself: what it is, where, how to get there.
  out.push(finish({
    ...base, id: docId('area', slug), type: 'place', name: clean(a.name, 120), short: firstSentence(a.overview || a.story || ''),
    order: Number(a.order) || 0,
    fields: fieldsOf({ region: info.region, levels: info.levels, directions: info.directions, coords: info.coords, connected: info.connected, quests: info.quests, services: info.services, enemyTypes: info.enemyTypes, group: a.group, story: a.story }),
    prose: fieldsOf({ overview: a.overview }) as Record<string, string>,
    sources: usable(info.sources).length ? usable(info.sources) : pageSources,
    tier: checked && pageSources.length ? 'A' : pageSources.length ? 'B' : 'C', status: statusOf(checked && pageSources.length ? 'A' : 'C'),
    origin: { from: 'area', slug },
  }));
  (a.items || []).forEach((e: any, i: number) => {
    const t = tierOf(e);
    const gaps = e.missable ? missableGaps(e) : [];
    out.push(finish({ ...base, id: docId('area', slug, e.id || `i${i}`), type: 'item', name: clean(e.name, 160), order: i, missable: !!e.missable,
      fields: fieldsOf({ where: e.where, how: e.how, lockout: e.lockout }), sources: srcOf(e), tier: t, status: statusOf(t), gaps, origin: { from: 'area', slug, entry: e.id } }));
  });
  (a.secrets || []).forEach((e: any, i: number) => {
    const t = tierOf(e);
    out.push(finish({ ...base, id: docId('area', slug, e.id || `s${i}`), type: 'secret', name: clean(e.name || firstSentence(e.text, 90), 160), short: firstSentence(e.text), order: i,
      fields: fieldsOf({ text: e.text }), sources: srcOf(e), tier: t, status: statusOf(t), origin: { from: 'area', slug, entry: e.id } }));
  });
  (a.enemies || []).forEach((e: any, i: number) => {
    const t = tierOf(e);
    out.push(finish({ ...base, id: docId('area', slug, e.id || `e${i}`), type: 'enemy', name: clean(e.name, 160), order: i,
      fields: fieldsOf({ weakness: e.weakness, steal: e.steal, notes: e.notes }), sources: srcOf(e), tier: t, status: statusOf(t), origin: { from: 'area', slug, entry: e.id } }));
  });
  (a.shops || []).forEach((e: any, i: number) => {
    const t = tierOf(e);
    out.push(finish({ ...base, id: docId('area', slug, e.id || `p${i}`), type: 'shop', name: clean(e.name, 160), order: i,
      fields: fieldsOf({ sells: e.sells }), sources: srcOf(e), tier: t, status: statusOf(t), origin: { from: 'area', slug, entry: e.id } }));
  });
  (a.fights || []).forEach((f: any, i: number) => {
    const t = tierOf(f);
    out.push(finish({ ...base, id: docId('area', slug, f.id || `f${i}`), type: 'boss', name: clean(f.name, 160), order: i,
      fields: fieldsOf({ enemies: f.enemies, threats: f.threats, weaknesses: f.weaknesses, tactics: f.tactics, rewards: f.rewards }), sources: srcOf(f), tier: t, status: statusOf(t), origin: { from: 'area', slug, entry: f.id } }));
  });
  (a.sections || []).forEach((sec: any, si: number) => (sec.entries || []).forEach((e: any, i: number) => {
    const t = tierOf(e);
    out.push(finish({ ...base, id: docId('area', slug, e.id || `c${si}-${i}`), type: 'checklist', name: firstSentence(e.text, 120), short: firstSentence(e.text), order: si * 1000 + i,
      fields: fieldsOf({ text: e.text, group: sec.title, tickable: sec.check ? 'yes' : '' }), sources: srcOf(e), tier: t, status: statusOf(t), origin: { from: 'area', slug, entry: e.id } }));
  }));
  // The flagship parts: steps in route order (linked to the items and fights found along the way), choices, advice.
  const ref = (id: string) => docId('area', slug, id);
  (a.walkthrough || []).forEach((s: any, i: number) => {
    const t: Tier = checked ? 'A' : 'C';
    out.push(finish({ ...base, id: docId('area', slug, s.id || `w${i}`), type: 'step', name: clean(s.title, 160), short: firstSentence(s.text), order: i,
      fields: fieldsOf({ tip: s.tip, warn: s.warn }), links: [...(s.entries || []), ...(s.fights || [])].map((x: string) => ref(String(x))),
      prose: fieldsOf({ text: s.text }) as Record<string, string>, sources: pageSources, tier: t, status: statusOf(t), origin: { from: 'area', slug, entry: s.id } }));
  });
  (a.choices || []).forEach((c: any, i: number) => {
    const t: Tier = checked ? 'A' : 'C';
    out.push(finish({ ...base, id: docId('area', slug, c.id || `ch${i}`), type: 'choice', name: clean(c.title, 160), order: i,
      fields: fieldsOf({ when: c.when, options: (c.options || []).map((o: any) => `${clean(o.label, 200)}: ${clean(o.outcome, 400)}`), recommended: c.recommended, note: c.note }),
      sources: pageSources, tier: t, status: statusOf(t), origin: { from: 'area', slug, entry: c.id } }));
  });
  (a.tips || []).forEach((tip: string, i: number) => {
    const t: Tier = checked && pageSources.length ? 'B' : 'C';
    out.push(finish({ ...base, id: docId('area', slug, `tip${i}`), type: 'tip', name: firstSentence(tip, 120), short: firstSentence(tip), order: i,
      fields: {}, prose: fieldsOf({ text: tip }) as Record<string, string>, sources: pageSources, tier: t, status: statusOf(t), origin: { from: 'area', slug, entry: `tip${i}` } }));
  });
  if (a.advice) for (const kind of ['matters', 'skip', 'mistakes'] as const) (a.advice[kind] || []).forEach((x: string, i: number) => {
    const t: Tier = checked ? 'B' : 'C';
    out.push(finish({ ...base, id: docId('area', slug, `adv-${kind}${i}`), type: 'advice', name: firstSentence(x, 120), short: firstSentence(x), order: i,
      fields: { kind }, prose: fieldsOf({ text: x }) as Record<string, string>, sources: pageSources, tier: t, status: statusOf(t), origin: { from: 'area', slug, entry: `adv-${kind}${i}` } }));
  });
  return out;
}

/** A compendium page's record (a person, a place, a boss, a thing or a quest) and its quest steps. */
export function entityRecords(key: string, e: any, impressions = 0): GameRecord[] {
  const slug = String(e.slug);
  const passed = e.review?.status === 'passed' || Number(e.review?.score) >= 90;
  const src = usable(e.sources);
  const t: Tier = passed && src.length ? 'A' : src.length ? 'B' : 'C';
  const quest = e.kind === 'quest' || !!e.quest;
  const kind = quest ? 'quest' : entityKind(String(e.typeLabel || e.type || ''));
  const type: RecordType = quest ? 'quest' : kind === 'person' ? 'npc' : kind === 'boss' ? 'boss' : kind === 'thing' ? 'thing' : 'place';
  const s = e.summary || {};
  const q = e.quest || {};
  const base = { key, place: slug, placeName: clean(e.name, 120), impressions: impressions || undefined, checkedAt: passed ? Number(e.promotedFromDraft || e.builtAt || 0) || undefined : undefined };
  const out: GameRecord[] = [finish({
    ...base, id: docId('ent', slug), type, name: clean(e.displayName || e.name, 160), short: firstSentence(e.overview || ''),
    fields: fieldsOf({
      group: e.typeLabel, region: s.region, where: s.where, gettingThere: s.gettingThere,
      whereToFind: (s.whereToFind || []).map((w: any) => (w.when ? `${clean(w.when, 80)}: ${clean(w.where, 300)}` : clean(w.where, 300))),
      shops: (s.shops || []).map((x: any) => (x.what ? `${clean(x.name, 100)}: ${clean(x.what, 300)}` : clean(x.name, 100))),
      services: s.services, collectibles: (s.collectibles || []).map((x: any) => (x.where ? `${clean(x.name, 100)}: ${clean(x.where, 300)}` : clean(x.name, 100))),
      places: (s.places || []).map((x: any) => (x.what ? `${clean(x.name, 100)}: ${clean(x.what, 300)}` : clean(x.name, 100))),
      quests: (s.quests || []).map((x: any) => [x.name, x.kind, x.chapter].filter(Boolean).map((v) => clean(v, 100)).join(' · ')),
      chapters: s.chapters, notes: s.notes,
      giver: q.giver, chapter: q.chapter, startsAt: q.where, rewards: q.rewards, missables: q.missables, goldMedal: q.goldMedal,
      choices: (q.choices || []).map((c: any) => `${clean(c.choice, 200)}: ${clean(c.outcome, 300)}`),
    }),
    missable: Array.isArray(q.missables) && q.missables.length > 0,
    prose: fieldsOf({
      overview: e.overview,
      qa: (e.qa || []).map((x: any) => `${clean(x.q, 200)} ${clean(x.a, 800)}`).join('\n'),
      story: (e.story || []).map((x: any) => `${clean(x.heading, 120)}: ${clean(x.text, 1500)}`).join('\n'),
      gameplay: (e.gameplay || []).map((x: any) => `${clean(x.heading, 120)}: ${clean(x.text, 1500)}`).join('\n'),
    }) as Record<string, string>,
    sources: src, tier: t, status: statusOf(t), origin: { from: 'entity', slug },
  })];
  let n = 0;
  for (const p of q.parts || []) for (const st of p.steps || []) {
    out.push(finish({ ...base, id: docId('ent', slug, st.id || `s${n}`), type: 'step', name: clean(st.text, 200), short: firstSentence(st.text), order: n++,
      fields: fieldsOf({ part: p.name, chapter: p.chapter, where: p.where }), sources: src, tier: t, status: statusOf(t), origin: { from: 'entity', slug, entry: st.id } }));
  }
  return out;
}

/** An achievement guide's records: each achievement, and the roadmap's points of no return. */
export function achievementRecords(key: string, m: any): GameRecord[] {
  const t: Tier = m.verified ? 'A' : 'C';
  const at = Number(m.updatedAt || 0) || undefined;
  const out: GameRecord[] = [];
  (m.list || []).forEach((a: any, i: number) => {
    const gaps = a.missable && !clean(a.how) ? ['no final step'] : [];
    out.push(finish({ key, id: docId('ach', slugOf(a.name)), type: 'achievement', name: clean(a.name, 160), short: firstSentence(a.desc || ''), order: i,
      place: a.area || undefined, placeName: a.areaName || undefined, missable: !!a.missable,
      fields: fieldsOf({ desc: a.desc, how: a.how, rarity: a.rarity != null ? `${a.rarity}%` : '', hidden: a.hidden ? 'yes' : '', icon: a.icon, labels: a.labels }),
      links: a.area ? [docId('area', String(a.area))] : [], sources: [], tier: t, status: statusOf(t), gaps, checkedAt: m.verified ? at : undefined, origin: { from: 'achievements', entry: a.name } }));
  });
  (m.roadmap?.noReturn || []).forEach((p: any, i: number) => {
    out.push(finish({ key, id: docId('ach', 'noreturn', String(i)), type: 'noreturn', name: clean(p.point, 200), short: firstSentence(p.lost || ''), order: i,
      fields: fieldsOf({ lost: p.lost }), sources: [], tier: t, status: statusOf(t), checkedAt: m.verified ? at : undefined, origin: { from: 'achievements', entry: `noreturn${i}` } }));
  });
  return out;
}

const FACT_TYPE: Record<string, RecordType> = { enemy: 'enemy', boss: 'boss', item: 'item', secret: 'secret', missable: 'item', npc: 'npc', place: 'place', other: 'other' };
/** A fact learned from a player's searched answer (searchGuard.ts): sourced, but never checked on a page. */
export function gameFactRecord(key: string, id: string, f: any): GameRecord | null {
  if (!f?.subject || !f?.fact) return null;
  const src = usable(f.sources);
  const t: Tier = blockedOnly(f.sources) || !src.length ? 'C' : 'B';
  return finish({
    key, id: docId('gf', id), type: FACT_TYPE[String(f.kind)] || 'other', name: clean(f.subject, 160), short: firstSentence(f.fact),
    placeName: f.place ? clean(f.place, 120) : undefined, missable: f.kind === 'missable',
    fields: fieldsOf({ fact: f.fact, previous: f.previous, confirmations: f.confirmations > 1 ? String(f.confirmations) : '' }),
    // A player's missable fact is one line of text: not yet held to the missable standard (where, final step, lockout).
    gaps: f.kind === 'missable' ? ['not split into where, final step and lockout'] : [],
    sources: src, tier: t, status: f.disputed ? 'disputed' : statusOf(t), checkedAt: Number(f.at || 0) || undefined, origin: { from: 'gameFacts', entry: id },
  });
}

/** All the prose of one page's records, in a stable order: what the extraction read, and its signature. */
export function proseOf(recs: GameRecord[]): { text: string; sig: string } {
  const parts: string[] = [];
  for (const r of [...recs].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const [k, v] of Object.entries(r.prose || {})) parts.push(`[${r.id} ${k}] ${v}`);
    for (const k of ['tip', 'warn', 'note', 'notes']) { const v = r.fields?.[k]; if (v) parts.push(`[${r.id} ${k}] ${Array.isArray(v) ? v.join(' ') : v}`); }
  }
  const text = parts.join('\n');
  return { text, sig: crypto.createHash('sha1').update(text).digest('hex').slice(0, 16) };
}

const GAP_OF: Record<string, string> = { lockout: 'no lockout', how: 'no final step', where: 'vague where' };
const ADD_TYPE: Record<string, RecordType> = { item: 'item', noreturn: 'noreturn', warning: 'warning', npc: 'npc', boss: 'boss', tip: 'tip', other: 'other' };
/**
 * One page's extraction (recordsExtract.ts) laid over its records, while the page's prose is the same as when it was
 * extracted: one-line shorts, fields filled from the prose (each with its quote), and the facts the prose adds as new
 * records (tier B: rechecked from stored evidence before they count as checked).
 */
export function applyExtracted(recs: GameRecord[], x: { sig: string; shorts: any[]; fills: any[]; adds: any[] } | undefined): GameRecord[] {
  if (!x || !recs.length || proseOf(recs).sig !== x.sig) return recs;
  const byId = new Map(recs.map((r) => [r.id, r]));
  for (const s of x.shorts || []) { const r = byId.get(String(s.id)); if (r && s.short) r.short = String(s.short); }
  for (const f of x.fills || []) {
    const r = byId.get(String(f.id));
    if (!r || r.fields[f.field]) continue;
    r.fields[f.field] = String(f.value);
    r.extracted = [...(r.extracted || []), { field: String(f.field), quote: String(f.quote) }];
    if (r.gaps && GAP_OF[f.field]) r.gaps = r.gaps.filter((g) => g !== GAP_OF[f.field]);
  }
  const first = recs[0];
  const pageSources = recs.find((r) => r.type === 'place')?.sources || first.sources;
  const added = (x.adds || []).map((a: any, i: number) => finish({
    key: first.key, id: `x.${first.place}.${i}`, type: ADD_TYPE[String(a.type)] || 'other', name: String(a.name), short: a.fields?.text ? firstSentence(a.fields.text) : undefined,
    place: first.place, placeName: first.placeName, impressions: first.impressions, missable: !!a.missable || a.type === 'noreturn',
    fields: fieldsOf({ where: a.fields?.where, how: a.fields?.how, lockout: a.fields?.lockout, text: a.fields?.text }),
    links: a.step ? [String(a.step)] : [], extracted: [{ field: 'all', quote: String(a.quote) }],
    sources: pageSources, tier: 'B', status: 'unconfirmed', origin: { from: 'extract', slug: first.place, entry: String(i) },
  }));
  return [...recs.map((r) => finish(r)), ...added];
}

/** A record's content as the verify step checked it (its type, name and fields): a changed record is checked again. */
export const contentSig = (r: Pick<GameRecord, 'type' | 'name' | 'fields'>) =>
  crypto.createHash('sha1').update(JSON.stringify([r.type, r.name, r.fields])).digest('hex').slice(0, 16);

/**
 * The verify step's results (recordsVerify.ts) laid over the records whose content is unchanged since: checked
 * records become tier A, a contradicted one is "disputed" with the evidence's correction in `dispute`.
 */
export function applyVerified(recs: GameRecord[], v: { at?: number; results?: Record<string, { sig: string; status: string; fix?: string }> } | undefined): GameRecord[] {
  if (!v?.results) return recs;
  return recs.map((r) => {
    const x = v.results![r.id];
    if (!x || x.sig !== contentSig(r)) return r;
    if (x.status === 'checked') return finish({ ...r, tier: 'A', status: 'checked', checkedAt: Number(v.at) || r.checkedAt });
    if (x.status === 'disputed') return finish({ ...r, status: 'disputed', ...(x.fix ? { dispute: x.fix } : {}) } as any);
    return r;
  });
}
