/**
 * Missing fights: gaps in the guides found in play. When a combat answer (<qc-combat>) is about a fight that matches
 * nothing on the area's guide page (no key fight, no enemy entry), it's saved as a "missing fight" candidate in the
 * corrections collections: the game, area, fight name, enemy names and the answer's battle-plan summary (its quest-log
 * steps), never the conversation. The daily check (scripts/guides/corrections.ts) verifies it against sources, writes a
 * Key fights entry into a staged copy and runs the review gate. More reports of the same fight raise its priority.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { isTestTraffic } from './testTraffic';
import type { GuidePageForPlace } from './guidesApi';
import { saveCandidate, playerHash, REPORTER_WEIGHT, type EntryRef } from './corrections';

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** Words that say nothing about which fight it is. */
const FILLER = new Set(['the', 'a', 'an', 'of', 'at', 'on', 'in', 'to', 'and', 'for', 'fight', 'battle', 'boss', 'encounter', 'attack', 'defence', 'defense', 'ambush', 'vs', 'versus', 'with', 'against', 'group', 'enemies', 'enemy', 'raid', 'assault']);
/** "Goblins" and "goblin archer" share "goblin"; "harpies" and "harpy" share "harp". */
const stem = (w: string) => w.replace(/(ies|y|es|s)$/, '');
export const words = (s: unknown) => norm(s).split(' ').filter((w) => w.length >= 3 && !FILLER.has(w)).map(stem).filter((w) => w.length >= 3);

/** The fight and enemies the model named in <qc-combat>{...}</qc-combat>. */
export type CombatFight = { fight?: string; enemies?: string[] };

/**
 * Does the guide page already cover this fight? Yes when a key fight's name shares a distinctive word with the fight's
 * name, or any named enemy appears in a key fight (name or enemies) or an enemy entry. A page with nothing about the
 * fight (Emerald Grove's harpies, when the goblins attack the gate) doesn't.
 */
export function fightKnown(page: Pick<GuidePageForPlace, 'enemies' | 'fights'>, f: CombatFight): boolean {
  const nameWords = new Set(words(f.fight));
  const enemyWords = new Set((f.enemies || []).flatMap(words));
  if (!nameWords.size && !enemyWords.size) return true; // nothing to go on: never a candidate
  for (const k of page.fights || []) {
    const kw = new Set([...words(k.name), ...words(k.enemies)]);
    if (words(k.name).some((w) => nameWords.has(w)) || [...enemyWords].some((w) => kw.has(w))) return true;
  }
  for (const e of page.enemies || []) if (words(e.name).some((w) => enemyWords.has(w) || nameWords.has(w))) return true;
  return false;
}

/** Same fight (two reports of it)? Shares a distinctive word in the name, or most of the named enemies. */
export function sameFight(a: CombatFight, b: CombatFight): boolean {
  const an = new Set(words(a.fight)), bn = words(b.fight);
  if (bn.some((w) => an.has(w))) return true;
  const ae = new Set((a.enemies || []).flatMap(words)), be = [...new Set((b.enemies || []).flatMap(words))];
  if (!ae.size || !be.length) return false;
  const shared = be.filter((w) => ae.has(w)).length;
  return shared >= Math.max(1, Math.ceil(Math.min(ae.size, be.length) / 2));
}

/** The battle plan as one line, from the answer's quest-log steps (never the conversation). */
export const planSummary = (steps: { text: string }[]) =>
  steps.map((s) => String(s.text || '').replace(/\s+/g, ' ').trim().replace(/\.?$/, '.')).filter((t) => t.length > 1).join(' ').slice(0, 500);

const slugOf = (s: string) => norm(s).replace(/ /g, '-').slice(0, 60) || 'fight';

/**
 * Save a missing fight (when the page doesn't cover it). The group id reuses an open group for the same fight in the
 * area, so repeated reports count up (the daily check works the most-reported first). Returns the candidate id or null.
 */
export async function saveMissingFight(opts: {
  page: GuidePageForPlace | null; combat: CombatFight; steps: { text: string }[]; uid: string; isGuest: boolean; game: string;
}): Promise<string | null> {
  const { page, combat } = opts;
  if (!page || !opts.uid || isTestTraffic(opts.uid) || fightKnown(page, combat)) return null;
  const fight = String(combat.fight || '').trim() || (combat.enemies || []).slice(0, 2).join(' and ');
  const enemies = (combat.enemies || []).map((e) => String(e).trim()).filter(Boolean).slice(0, 8);
  const plan = planSummary(opts.steps);
  if (!fight || !plan) return null;
  try {
    const open = await getFirestore().collection('correctionGroups').where('gameKey', '==', page.key).where('area', '==', page.slug).where('entryKind', '==', 'fight').get();
    const match = open.docs.find((d) => sameFight({ fight: d.data().entryName, enemies: d.data().enemies }, { fight, enemies }));
    const entry: EntryRef = { id: match ? String(match.data().entryId) : `fight-${slugOf(fight)}`, kind: 'fight', name: match ? String(match.data().entryName) : fight, text: '' };
    const id = await saveCandidate({
      gameKey: page.key, game: opts.game, area: page.slug, areaName: page.name, entry, claim: plan, field: 'notes', via: 'combat',
      reporterKey: playerHash(opts.uid), source: 'app', weight: opts.isGuest ? REPORTER_WEIGHT.appGuest : REPORTER_WEIGHT.app, guest: opts.isGuest,
      oncePerReporter: true, extra: { fightName: fight, enemies }, groupExtra: { enemies },
    });
    if (id) console.log(`[corrections] missing fight "${fight}" in ${page.key}/${page.slug}`);
    return id;
  } catch (e: any) {
    console.warn('[corrections] missing fight save failed:', e?.message);
    return null;
  }
}
