/**
 * Cross-page consistency, per game: the same named thing (an item, a boss or fight, an NPC, a mission) said to be in
 * different places, dropped by different bosses, or given by different people on different pages of ours. Each page is
 * checked only against its own evidence when it's built, and quick pages against nothing, so siblings can disagree
 * (the Haligtree Secret Medallion halves, Prey's Golden Gun, Dark Souls' Skull Lantern); in 12 of the audit's cases
 * another page of ours already had it right.
 *
 * Detection only: it reads the live area pages and the published compendium entities and writes nothing (no model,
 * no search). Resolving a conflict (re-checking both claims against the stored evidence) is a separate, paid step.
 *
 *   npx tsx scripts/guides/consistency.ts --key elden-ring[,prey,...] [--out report.json]
 */
import fs from 'fs';
import { db, arg } from './common';
import { normName } from './rebuildGuard';
import { entityKind } from './siteText';

export type Mention = {
  kind: 'item' | 'fight' | 'npc' | 'quest';
  name: string;
  /** Where it was said: an area page's slug, or "entity:<slug>". */
  on: string;
  onName: string;
  text: string;
  /** Known places the text names (or the page itself when it names none). */
  places: string[];
  missable?: boolean;
  /** Whether the text names a place itself (else places is the page it's on). */
  named?: boolean;
  /** Dropped by or a reward of this enemy or fight. */
  from?: string;
  /** "from" is a key fight (a boss), not an ordinary enemy. */
  fight?: boolean;
  giver?: string;
  /** For a mission: the people whose pages list it. */
  listedBy?: string;
  /** Part of a set: "left" in "Haligtree Secret Medallion (Left)". */
  variant?: string;
};
export type Conflict = { kind: Mention['kind']; name: string; reason: string; mentions: { on: string; text: string }[] };

/** "Haligtree Secret Medallion (Left)" → base "haligtree secret medallion", variant "left". */
export function baseAndVariant(name: string): { base: string; variant: string } {
  const m = String(name || '').match(/^(.*?)\s*[([]([^)\]]+)[)\]]\s*$/);
  return m ? { base: normName(m[1]), variant: normName(m[2]) } : { base: normName(name), variant: '' };
}

/** The known places a text names (whole words; a place inside a longer matched place doesn't count twice). */
export function placesIn(text: string, known: string[]): string[] {
  const t = ` ${normName(text)} `;
  const hit = known.filter((k) => k.length >= 4 && t.includes(` ${k} `));
  return [...new Set(hit.filter((h) => !hit.some((o) => o !== h && o.includes(h))))];
}

/** Says it's a drop or a boss reward ("uncommon drop from Necromancers"), not "dropped into a pit". */
const DEFEAT = /\b(?:defeat(?:s|ed|ing)?|kill(?:s|ed|ing)?|slay(?:s|ing)?|slain|beat(?:s|ing)?)\b/i;
const DROP = /\bdrop(?:s|ped)?\s+(?:by|from)\b|\b(?:rare|uncommon|common|guaranteed|random)\s+drop\b|\breward(?:ed)?\s+(?:for|after)\s+(?:defeating|killing|beating)\b/i;

/** An item listed on more pages than this is common (several exist); only its set pieces are compared. */
const COMMON = 2;
/** Rewards that aren't items. */
const GENERIC = /^(?:nothing|none|n a|unknown|runes?|\d[\d ]*(?:runes?|souls?|xp|gold|coins?)?)$|\b(?:xp|exp|experience|supplies|loot|gold|coins?)$/;

const short = (s: string, n = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const disjoint = (a: string[], b: string[]) => a.length > 0 && b.length > 0 && !a.some((x) => b.includes(x));
const sameVariant = (a: Mention, b: Mention) => !a.variant || !b.variant || a.variant === b.variant;
const ref = (m: Mention) => ({ on: m.on, text: `${m.onName}: ${short(m.text)}` });

/** The checks, on one game's mentions (pure, for the tests). */
export function findConflicts(mentions: Mention[]): Conflict[] {
  const out: Conflict[] = [];
  const by = (kind: Mention['kind'], key: (m: Mention) => string) => {
    const g = new Map<string, Mention[]>();
    for (const m of mentions.filter((x) => x.kind === kind)) { const k = key(m); if (k) g.set(k, [...(g.get(k) || []), m]); }
    return g;
  };

  // Items. Many things exist more than once (a weapon in two rooms, crafting materials everywhere), so an item a guide
  // lists on more than COMMON pages is treated as common and only its set pieces (halves, parts) are compared. One
  // conflict per item, with every reason.
  for (const [base, ms] of by('item', (m) => baseAndVariant(m.name).base)) {
    if (base.length < 4 || GENERIC.test(base)) continue;
    const name = ms[0].name.replace(/\s*[([][^)\]]+[)\]]\s*$/, '');
    const pickups = ms.filter((m) => !m.from);
    const pages = new Set(ms.filter((m) => !m.on.startsWith('entity:')).map((m) => m.on));
    const common = pages.size > COMMON;
    const reasons: string[] = [];
    const cited = new Set<Mention>();
    const cite = (...xs: Mention[]) => xs.forEach((x) => cited.add(x));
    // a. Said to be in different places (a page and an entity page, a set piece, or an item only two pages list).
    outer: for (let i = 0; i < pickups.length; i++) for (let j = i + 1; j < pickups.length; j++) {
      const a = pickups[i], b = pickups[j];
      if (a.on === b.on || !sameVariant(a, b) || !disjoint(a.places, b.places)) continue;
      if (common && !a.variant && !b.variant && !a.on.startsWith('entity:') && !b.on.startsWith('entity:')) continue;
      const v = (m: Mention) => (m.variant ? `(${m.variant}) ` : '');
      reasons.push(`in different places: ${v(a)}${a.places.join(' / ')} on ${a.onName}; ${v(b)}${b.places.join(' / ')} on ${b.onName}`);
      cite(a, b);
      break outer;
    }
    if (!common) {
      // b. Missable on one page and not on another.
      const miss = pickups.filter((m) => m.missable !== undefined && !m.on.startsWith('entity:'));
      if (miss.some((m) => m.missable) && miss.some((m) => !m.missable)) {
        reasons.push(`missable on ${miss.filter((m) => m.missable).map((m) => m.onName).join(', ')}, not on ${miss.filter((m) => !m.missable).map((m) => m.onName).join(', ')}`);
        cite(...miss);
      }
      // c. A drop on one page, picked up somewhere on another.
      const drops = ms.filter((m) => m.from || DROP.test(m.text));
      // A pick-up that says it's won from a fight ("obtained by defeating Commander O'Neil") agrees with a drop.
      const found = pickups.filter((m) => !DROP.test(m.text) && !DEFEAT.test(m.text) && !drops.some((d) => d.on === m.on || (d.from && normName(m.text).includes(normName(d.from)))));
      if (drops.length && found.length) {
        reasons.push(`a drop on ${[...new Set(drops.map((d) => `${d.onName}${d.from ? ` (from ${d.from})` : ''}`))].join(', ')}; picked up on ${[...new Set(found.map((f) => f.onName))].join(', ')}`);
        cite(...drops, ...found);
      }
      // d. Listed on one page while its text puts it on another page that lists it too (neighbour bleed).
      for (const m of pickups.filter((x) => x.named && x.places.length === 1 && !x.on.startsWith('entity:'))) {
        const there = pickups.find((o) => o !== m && o.on !== m.on && normName(o.onName) === m.places[0]);
        if (there && normName(m.onName) !== m.places[0]) { reasons.push(`listed on ${m.onName}, but its text puts it in ${there.onName}, which lists it too`); cite(m, there); }
      }
    }
    // e. A boss reward credited to different fights (swapped pairings); an item many fights give is a common drop.
    // One boss under two names ("Viconia DeVir (Mother Superior)", "Lorroakan (Confrontation at Ramazith's Tower)") is one.
    const boss = (f: string) => baseAndVariant(f).base;
    const all = [...new Map(ms.filter((m) => m.fight).map((m) => [boss(m.from!), m])).values()];
    const fights = all.filter((m) => !all.some((o) => o !== m && (boss(o.from!).includes(boss(m.from!)) || boss(m.from!).includes(boss(o.from!))) && all.indexOf(o) < all.indexOf(m)));
    if (fights.length >= 2 && fights.length <= 3 && fights.every((m) => sameVariant(m, fights[0]))) {
      reasons.push(`a reward of different fights: ${fights.map((m) => `${m.from} (${m.onName})`).join(', ')}`);
      cite(...fights);
    }
    if (reasons.length) out.push({ kind: 'item', name, reason: reasons.join('. '), mentions: [...cited].slice(0, 6).map(ref) });
  }

  // Fights: the same fight with rewards that share nothing.
  for (const [, ms] of by('fight', (m) => normName(m.name))) {
    const withRewards = ms.filter((m) => m.text);
    for (let i = 0; i < withRewards.length; i++) for (let j = i + 1; j < withRewards.length; j++) {
      const a = withRewards[i], b = withRewards[j];
      if (a.on === b.on) continue;
      const ra = a.text.split(/[,;]|\band\b/).map(normName).filter((x) => x.length > 3);
      const rb = b.text.split(/[,;]|\band\b/).map(normName).filter((x) => x.length > 3);
      if (ra.length && rb.length && !ra.some((x) => rb.some((y) => x.includes(y) || y.includes(x)))) {
        out.push({ kind: 'fight', name: a.name, reason: `different rewards on ${a.onName} and ${b.onName}`, mentions: [ref(a), ref(b)] });
      }
    }
  }

  // NPCs: a page placing someone where their own entity page never has them.
  for (const [, ms] of by('npc', (m) => normName(m.name))) {
    const own = ms.filter((m) => m.on.startsWith('entity:'));
    const ownPlaces = [...new Set(own.flatMap((m) => m.places))];
    if (!ownPlaces.length) continue;
    // Only where the page names a place itself (a card on a region's page that doesn't name a spot isn't a claim).
    for (const m of ms.filter((x) => !x.on.startsWith('entity:') && x.named)) {
      if (disjoint(m.places, ownPlaces) && !ownPlaces.includes(normName(m.onName))) {
        out.push({ kind: 'npc', name: m.name, reason: `${m.onName} has them at ${m.places.join(' / ')}; their own page at ${ownPlaces.slice(0, 4).join(' / ')}`, mentions: [ref(m), ...own.map(ref)] });
      }
    }
  }

  // Missions: different givers on different pages (the mission's own page, a person's page, a walkthrough step). A
  // person's list of missions is every mission they're in, so it isn't a giver claim.
  for (const [, ms] of by('quest', (m) => normName(m.name))) {
    const claims = ms.filter((m) => m.giver);
    const givers = [...new Map(claims.map((m) => [normName(m.giver), m.giver!])).entries()];
    // "Dutch" and "Dutch van der Linde" are one giver.
    const distinct = givers.filter(([g]) => !givers.some(([o]) => o !== g && o.includes(g)));
    if (distinct.length > 1) out.push({ kind: 'quest', name: ms[0].name, reason: `given by ${distinct.map(([, g]) => g).join(' and ')} on different pages`, mentions: claims.slice(0, 6).map(ref) });
  }
  return out;
}

/**
 * Giver claims in a sentence: one mission name and one person, with "gives", "offers", "assigns", "starts" or "given
 * by" ("Hosea gives Arthur The Spines of America"). A sentence naming several missions or people claims nothing.
 */
export function giverClaims(sentence: string, missions: string[], people: string[]): { mission: string; giver: string }[] {
  if (!/\b(?:gives?|given\s+by|offers?|offered\s+by|assigns?|assigned\s+by|starts?|started\s+by|asks?|hands?)\b/i.test(sentence)) return [];
  const t = ` ${normName(sentence)} `;
  const ms = missions.filter((m) => normName(m).length >= 6 && t.includes(` ${normName(m)} `));
  const first = (p: string) => normName(p).split(' ')[0];
  const ps = people.filter((p) => t.includes(` ${normName(p)} `) || (first(p).length >= 4 && t.includes(` ${first(p)} `)));
  return ms.length === 1 && ps.length === 1 ? [{ mission: ms[0], giver: ps[0] }] : [];
}

/** One game's mentions, from its live area pages and published entities (reads only). */
export async function gameMentions(key: string): Promise<{ game: string; mentions: Mention[]; pages: number; entities: number }> {
  const info: any = (await db().collection('guides').doc(key).get()).data() || {};
  const areas = (await db().collection('guides').doc(key).collection('areas').where('status', '==', 'published').get()).docs.map((d) => ({ slug: d.id, ...(d.data() as any) }));
  const ents = (await db().collection('guideCompendium').doc(key).collection('entities').where('status', '==', 'published').get()).docs.map((d) => ({ slug: d.id, ...(d.data() as any) }));
  // Known places: the guide's pages, place entities, and the places entity pages name.
  const known = [...new Set([
    ...areas.map((a) => normName(a.name)), ...areas.map((a) => normName(String(a.name || '').split(':').pop())),
    ...ents.filter((e) => e.kind !== 'quest' && entityKind(e.typeLabel || e.type) === 'place').map((e) => normName(e.name)),
    ...ents.flatMap((e) => (e.summary?.places || []).map((p: any) => normName(p?.name))),
  ].filter((n) => n.length >= 4))];
  const at = (text: string, fallback: string) => { const p = placesIn(text, known); return p.length ? p : [normName(fallback)]; };
  const names = (text: string) => placesIn(text, known).length > 0;
  const mentions: Mention[] = [];
  const itemNames = new Set<string>();
  for (const a of areas) {
    for (const e of a.items || []) {
      if (!e?.name) continue;
      const text = [e.where, e.how].filter(Boolean).join('; ');
      mentions.push({ kind: 'item', name: e.name, on: a.slug, onName: a.name, text, places: at(text, a.name), named: names(text), missable: !!e.missable, variant: baseAndVariant(e.name).variant });
      itemNames.add(baseAndVariant(e.name).base);
    }
    for (const f of a.fights || []) {
      if (!f?.name) continue;
      mentions.push({ kind: 'fight', name: f.name, on: a.slug, onName: a.name, text: String(f.rewards || ''), places: [normName(a.name)] });
      // Each reward of a fight, as a drop of that fight (a swapped pairing shows up as two bosses for one item).
      for (const r of String(f.rewards || '').split(/[,;]|\band\b/).map((x) => x.trim()).filter((x) => x.length > 3)) {
        mentions.push({ kind: 'item', name: r.replace(/^(?:the|a|an)\s+/i, ''), on: a.slug, onName: a.name, text: `reward of ${f.name}`, places: [normName(a.name)], from: f.name, fight: true, variant: baseAndVariant(r).variant });
      }
    }
    for (const e of a.enemies || []) {
      const steal = String(e?.steal || '').replace(/\s*\((?:rare|uncommon|common)\)/gi, '');
      for (const r of steal.split(/[,;]|\bor\b/).map((x) => x.trim()).filter((x) => x.length > 3)) mentions.push({ kind: 'item', name: r, on: a.slug, onName: a.name, text: `drop of ${e.name}`, places: [normName(a.name)], from: e.name });
    }
    for (const s of a.shops || []) if (s?.name) mentions.push({ kind: 'npc', name: s.name, on: a.slug, onName: a.name, text: String(s.sells || ''), places: [normName(a.name)] });
    for (const g of a.people?.groups || []) for (const p of g.people || []) if (p?.name) mentions.push({ kind: 'npc', name: p.name, on: a.slug, onName: a.name, text: String(p.where || ''), places: at(String(p.where || ''), a.name), named: names(String(p.where || '')) });
  }
  for (const e of ents) {
    const on = `entity:${e.slug}`;
    const s = e.summary || {};
    if (e.kind === 'quest' || e.quest) {
      if (e.quest?.giver) mentions.push({ kind: 'quest', name: e.name, on, onName: e.name, text: `given by ${e.quest.giver}${e.quest.where ? ` ${e.quest.where}` : ''}`, places: [], giver: e.quest.giver });
      continue;
    }
    if (entityKind(e.typeLabel || e.type) === 'person') {
      const where = (s.whereToFind || []).map((w: any) => String(w?.where || '')).join('; ');
      mentions.push({ kind: 'npc', name: e.name, on, onName: e.name, text: where, places: placesIn(where, known) });
      for (const q of s.quests || []) if (q?.name) mentions.push({ kind: 'quest', name: q.name, on, onName: e.name, text: `listed on ${e.name}'s page`, places: [], listedBy: e.name });
    }
    for (const c of s.collectibles || []) {
      if (!c?.name || !itemNames.has(baseAndVariant(c.name).base)) continue;
      mentions.push({ kind: 'item', name: c.name, on, onName: e.name, text: String(c.where || ''), places: placesIn(String(c.where || ''), known), named: true, variant: baseAndVariant(c.name).variant });
    }
    // Notes that place one of the guide's items ("either half of the Haligtree Secret Medallion (such as from Albus in
    // the Village of the Albinaurics)").
    for (const n of s.notes || []) {
      const t = ` ${normName(n)} `;
      for (const base of itemNames) {
        if (base.length < 6 || !t.includes(` ${base} `)) continue;
        const places = placesIn(n, known);
        if (places.length) mentions.push({ kind: 'item', name: base, on, onName: e.name, text: String(n), places, named: true });
      }
    }
  }
  // Giver claims in prose: person pages' notes and story parts, and the walkthrough steps of the guide's pages.
  const missions = ents.filter((e) => e.kind === 'quest' || e.quest).map((e) => String(e.name));
  const people = ents.filter((e) => e.kind !== 'quest' && !e.quest && entityKind(e.typeLabel || e.type) === 'person').map((e) => String(e.name));
  const sentences = (t: unknown) => String(t || '').split(/(?<=[.!?])\s+/);
  const claim = (text: string, on: string, onName: string) => {
    for (const s of sentences(text)) for (const c of giverClaims(s, missions, people)) mentions.push({ kind: 'quest', name: c.mission, on, onName, text: s, places: [], giver: c.giver });
  };
  if (missions.length) {
    for (const e of ents.filter((x) => people.includes(String(x.name)))) for (const t of [...(e.summary?.notes || []), ...(e.story || []).map((x: any) => x?.text)]) claim(t, `entity:${e.slug}`, e.name);
    for (const a of areas) for (const st of a.walkthrough || []) claim(st?.text, a.slug, a.name);
  }
  return { game: String(info.game || key), mentions, pages: areas.length, entities: ents.length };
}

export async function consistencyReport(key: string) {
  const g = await gameMentions(key);
  return { key, game: g.game, pages: g.pages, entities: g.entities, mentions: g.mentions.length, conflicts: findConflicts(g.mentions) };
}

if (/consistency\.ts$/.test(process.argv[1] || '')) {
  (async () => {
    const keys = String(arg('key') || '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'true');
    if (!keys.length) { console.log('Usage: npx tsx scripts/guides/consistency.ts --key elden-ring[,prey] [--out report.json]   (reads only)'); process.exit(1); }
    const reports = [];
    for (const key of keys) {
      const r = await consistencyReport(key);
      reports.push(r);
      const byKind = (k: string) => r.conflicts.filter((c) => c.kind === k).length;
      console.log(`\n${r.game} (${key}): ${r.pages} pages, ${r.entities} entities, ${r.mentions} named mentions; ${r.conflicts.length} conflict(s): ${byKind('item')} item, ${byKind('fight')} fight, ${byKind('npc')} NPC, ${byKind('quest')} mission`);
      for (const c of r.conflicts) {
        console.log(`- [${c.kind}] ${c.name}: ${c.reason}`);
        for (const m of c.mentions) console.log(`    ${m.text}`);
      }
    }
    const out = arg('out');
    if (out && out !== 'true') { fs.writeFileSync(out, JSON.stringify(reports, null, 2)); console.log(`\nSaved ${out}`); }
    process.exit(0);
  })().catch((e) => { console.error(e?.message || e); process.exit(1); });
}
