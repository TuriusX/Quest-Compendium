/**
 * Accuracy for flagship pages, claim by claim (the owner's review of Elden Ring Limgrave and Yakuza: Like a Dragon
 * chapter 1 found wrong NPC locations, missing merchants, an invented lockout, entries in the wrong walkthrough step,
 * garbled text and checkboxes for starting money, on pages the old review scored 90-100: it judged how a page read, and
 * checked it against the model's own research notes).
 *
 * 1. Evidence pack (buildEvidencePack): a few searched research calls about the area. Only the sentences Google's
 *    search grounding attributes to a source (groundingSupports) are kept, each as an evidence line with an id and the
 *    sites behind it; anything the model added without a source is dropped before writing. Cached in
 *    evidencePacks/{key}__{slug}.
 * 2. Claim check (claimCheck, the cheap model): every specific claim on the draft (an NPC's or item's location, a
 *    merchant, what's missable or locks you out, a consequence, which step an entry belongs to) must cite an evidence
 *    line that supports it. Unsupported or contradicted claims are removed (applyClaims), never kept because they sound
 *    plausible; "missable / locks you out" needs a line that says so explicitly.
 * 3. Rules (pageRules, plain code): no checkboxes for starting items or automatic rewards, no garbled entry text
 *    ("how: how:", labels, fragments), and "Services and people" from the evidence, marked incomplete unless a source
 *    lists them all.
 * 4. Review (claimReview, the Pro reviewer): the page's claims checked against the evidence, one by one; the score is
 *    the share of specific claims a source supports; under 90%, or more than 2 contradicted claims, fails it, and the
 *    claims it couldn't support are removed from the page in any case.
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini, MODEL, searchesIn } from './common';
import { PRO_MODEL, takePro } from './reviewerQuota';

export type Evidence = { id: string; text: string; sources: string[]; topic: string };
export type EvidencePack = { key: string; slug: string; game: string; area: string; evidence: Evidence[]; sites: string[]; servicesComplete: boolean; searches: number; at: number };

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** What each research call asks about the area (one searched call each). */
const TOPICS: { topic: string; ask: (game: string, area: string, neighbours: string) => string }[] = [
  { topic: 'order', ask: (g, a, n) => `In the video game "${g}", the area "${a}" (neighbouring areas: ${n}): what a player meets there, in the order most players experience it: arrivals, landmarks and sub-locations, sites of grace or save points, events, dungeons. Also say which notable places and characters are NOT in ${a} but in a neighbouring area.` },
  { topic: 'items', ask: (g, a) => `In the video game "${g}", the area "${a}": the notable items and secrets, each with exactly where it is found (a landmark a player can find) and how to get it. Say which ones can be permanently missed, and only if a source says so, what exactly locks them out. Do not list items the player starts the game with or receives automatically.` },
  { topic: 'people', ask: (g, a) => `In the video game "${g}", the area "${a}": every merchant, trader, vendor and service (shops, blacksmiths, upgrades, fast travel) and every notable NPC, each with exactly where they are in ${a}. Give the complete list if a source has one, and say whether it is complete.` },
  { topic: 'fights', ask: (g, a) => `In the video game "${g}", the area "${a}": the bosses and notable fights, where each one is, what it drops, and its main threats and weaknesses.` },
  { topic: 'choices', ask: (g, a) => `In the video game "${g}", the area "${a}": the quests and choices that happen there, what each option leads to, and anything a player can lock themselves out of here. Only consequences a source states.` },
];

/**
 * Sites that don't count as a source on their own: forums, videos, social media, document dumps and key resellers.
 * (A forum post or video title is how the invented "beating Margit locks out Recusant Henricus" got in.) Evidence
 * only these back is dropped; a guide or wiki site has to say it.
 */
export const LOW_TRUST = /(^|\.)(reddit\.com|youtube\.com|youtu\.be|steamcommunity\.com|facebook\.com|x\.com|twitter\.com|tiktok\.com|quora\.com|scribd\.com|pinterest\.com|royalcdkeys\.com|mmoexp\.com|plarium\.com|g2a\.com|eneba\.com|kinguin\.net|instant-gaming\.com)$/i;
export const trustedSites = (sites: string[]) => sites.filter((s) => !LOW_TRUST.test(s));
/** The pack with low-trust-only evidence left out (and low-trust sites off each line). */
export function trusted(p: EvidencePack): EvidencePack {
  const evidence = p.evidence.map((e) => ({ ...e, sources: trustedSites(e.sources) })).filter((e) => e.sources.length);
  return { ...p, evidence, sites: trustedSites(p.sites) };
}

/** Search grounding's supported segments: the parts of a reply a source backs, with the sites behind each. */
export function supportedSegments(res: any): { text: string; sites: string[] }[] {
  const gm = res?.candidates?.[0]?.groundingMetadata || {};
  const chunks: any[] = gm.groundingChunks || [];
  const site = (i: number) => String(chunks[i]?.web?.title || chunks[i]?.web?.domain || '').replace(/^www\./, '');
  const out: { text: string; sites: string[] }[] = [];
  for (const s of gm.groundingSupports || []) {
    const text = String(s?.segment?.text || '').replace(/^[*\-\s#]+/, '').replace(/\*\*/g, '').trim();
    const sites = [...new Set<string>((s?.groundingChunkIndices || []).map(site).filter(Boolean))];
    if (text.length >= 12 && sites.length) out.push({ text, sites });
  }
  return out;
}

// ---------------- the game's evidence (researched once, reused by every page) ----------------

/** Game-wide topics, researched for groups of areas at a time; every line names the area it belongs to. */
const GAME_TOPICS: { topic: string; ask: (game: string, areas: string) => string }[] = [
  { topic: 'people', ask: (g, a) => `In the video game "${g}", for each of these areas: ${a}. List every merchant, trader, vendor and service (shops, blacksmiths, upgrades) in it, and where exactly in the area each one is.` },
  { topic: 'people', ask: (g, a) => `In the video game "${g}", for each of these areas: ${a}. List the notable NPCs and quest characters found there, and where exactly in the area each one is.` },
  { topic: 'fights', ask: (g, a) => `In the video game "${g}", for each of these areas: ${a}. List the bosses and notable fights, where each one is in the area, and what it drops.` },
  { topic: 'items', ask: (g, a) => `In the video game "${g}", for each of these areas: ${a}. List the key items and notable equipment found there and exactly where each one is (not starting items or automatic rewards).` },
  { topic: 'missables', ask: (g, a) => `In the video game "${g}", for each of these areas: ${a}. List what can be permanently missed there, and exactly what locks it out, only where a source says so.` },
];
const GAME_GROUP = 6;

export type GameEvidence = { key: string; game: string; evidence: (Evidence & { area: string })[]; areas: string[]; searches: number; at: number };
const normArea = (s: string) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The game's evidence for these areas: merchants, NPCs, bosses, key items and missables, researched in groups of areas
 * (each searched line tagged with its area) and cached in gameEvidence/{key}; areas already researched aren't redone.
 */
export async function buildGameEvidence(key: string, game: string, areas: string[]): Promise<GameEvidence> {
  const ref = db().collection('gameEvidence').doc(key);
  const have: GameEvidence = ((await ref.get()).data() as GameEvidence) || { key, game, evidence: [], areas: [], searches: 0, at: 0 };
  const done = new Set(have.areas.map(normArea));
  const todo = areas.filter((a) => !done.has(normArea(a)));
  for (let i = 0; i < todo.length; i += GAME_GROUP) {
    const group = todo.slice(i, i + GAME_GROUP);
    const byNorm = new Map(group.map((a) => [normArea(a), a]));
    for (const t of GAME_TOPICS) {
      const res: any = await gemini().models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: `${t.ask(game, group.join('; '))}\nRun several searches (the game's wikis and guides). One fact per line, only what the sources say, and START EVERY LINE with the area's name in square brackets, exactly as written above, e.g. "[${group[0]}] ...". Leave out anything that is in none of these areas.` }] }],
        config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 6000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
      have.searches += searchesIn(res);
      for (const seg of supportedSegments(res)) {
        const m = seg.text.match(/^\[([^\]]+)\]\s*[:\-–]?\s*(.+)$/s);
        const area = m ? byNorm.get(normArea(m[1])) : undefined;
        if (!m || !area) continue; // a line that names no area of the group can't be filed
        const text = cut(m[2], 400);
        if (have.evidence.some((e) => e.text === text && e.area === area)) continue;
        have.evidence.push({ id: `g${have.evidence.length + 1}`, text, sources: seg.sites.slice(0, 4), topic: t.topic, area });
      }
    }
    have.areas.push(...group);
    have.at = Date.now();
    await ref.set(JSON.parse(JSON.stringify(have)));
    console.log(`  game evidence: ${group.length} area(s) researched (${have.evidence.length} lines, ${have.searches} searches in all)`);
  }
  return have;
}

/** The game evidence that belongs to one page: its area's lines, and lines naming one of its entries. */
export function gameLinesFor(g: GameEvidence, area: string, entries: string[]): Evidence[] {
  const a = normArea(area);
  const names = entries.map(normArea).filter((n) => n.length >= 5);
  return g.evidence.filter((e) => normArea(e.area) === a || names.some((n) => normArea(e.text).includes(n)))
    .map((e) => ({ id: e.id, text: e.area && normArea(e.area) !== a ? `(in ${e.area}) ${e.text}` : e.text, sources: e.sources, topic: e.topic }));
}

/** The area's evidence: only sentences a source supports (cached; rebuild with opts.rebuild). */
export async function buildEvidencePack(key: string, slug: string, game: string, area: string, neighbours: string[], opts: { rebuild?: boolean; entries?: string[]; gameEvidence?: GameEvidence } = {}): Promise<EvidencePack> {
  const ref = db().collection('evidencePacks').doc(`${key}__${slug}`);
  // The page's own entries, asked about by name (so a true entry the general research didn't mention keeps its support).
  const names = (opts.entries || []).filter(Boolean).slice(0, 30);
  const entryTopic = names.length ? [{ topic: 'entries', ask: (g: string, a: string) => `In the video game "${g}", the area "${a}": for each of these, say exactly where it is found (and whether it is really in ${a} at all), how to get it, and only if a source says so whether it can be permanently missed and why: ${names.join('; ')}.` }] : [];
  let have: EvidencePack | undefined;
  if (!opts.rebuild) {
    have = (await ref.get()).data() as EvidencePack | undefined;
    if (have?.evidence?.length && (opts.gameEvidence ? have.evidence.some((e) => e.topic === 'order') : !entryTopic.length || have.evidence.some((e) => e.topic === 'entries'))) return trusted(withGame(have, opts.gameEvidence, area, names));
  }
  const evidence: Evidence[] = have?.evidence?.length ? [...have.evidence] : [];
  const sites = new Set<string>(have?.sites || []);
  let searches = have?.searches || 0, servicesComplete = !!have?.servicesComplete;
  // With the game's evidence, the page researches only what's its own: the order of play and its entries (merchants,
  // NPCs, bosses, key items and missables come from the game's evidence). A cached pack only needs the entries topic added.
  // One call for both, held to a few searches (searches are most of the cost).
  const pageTopic = { topic: 'order', ask: (g: string, a: string, n: string) => `${TOPICS[0].ask(g, a, n)}${names.length ? ` Then, for each of these, where exactly it is found (and whether it is really in ${a} at all), how to get it, and only if a source says so whether it can be permanently missed and why: ${names.join('; ')}.` : ''} Use at most five searches.` };
  const topics = opts.gameEvidence ? (have?.evidence?.length && have.evidence.some((e) => e.topic === 'order') ? [] : [pageTopic]) : have?.evidence?.length ? entryTopic : [...TOPICS, ...entryTopic];
  for (const t of topics) {
    const res: any = await gemini().models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: `${t.ask(game, area, neighbours.join(', ') || 'unknown')}\nRun several searches (the game's wikis and guides). Answer in short factual sentences, one fact per line, only what the sources say; name the place each thing is in.` }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    searches += searchesIn(res);
    for (const seg of supportedSegments(res)) {
      if (evidence.some((e) => e.text === seg.text)) continue;
      evidence.push({ id: `e${evidence.length + 1}`, text: cut(seg.text, 400), sources: seg.sites.slice(0, 4), topic: t.topic });
      seg.sites.forEach((s) => sites.add(s));
      // "Services and people" counts as complete only when a sourced sentence says the list is complete.
      if (t.topic === 'people' && /\b(complete list|all (the )?(merchants|vendors|traders) in|there are (only )?\d+ (merchants|vendors|traders))\b/i.test(seg.text)) servicesComplete = true;
    }
  }
  const pack: EvidencePack = { key, slug, game, area, evidence, sites: [...sites], servicesComplete, searches, at: Date.now() };
  await ref.set(JSON.parse(JSON.stringify(pack)));
  return trusted(withGame(pack, opts.gameEvidence, area, names));
}

/** The page's own evidence plus the game's lines for it (game lines keep their g-ids, so ids never clash). */
function withGame(p: EvidencePack, g: GameEvidence | undefined, area: string, entries: string[]): EvidencePack {
  if (!g) return p;
  const lines = gameLinesFor(g, area, entries).filter((e) => !p.evidence.some((x) => x.text === e.text));
  return { ...p, evidence: [...p.evidence, ...lines], sites: [...new Set([...p.sites, ...lines.flatMap((e) => e.sources)])] };
}

/** The evidence as the writer and the checkers see it: "e12 [fextralife.com, ign.com] (people): text". */
export const evidenceText = (p: EvidencePack, limit = 16000) =>
  p.evidence.map((e) => `${e.id} [${e.sources.join(', ')}] (${e.topic}): ${e.text}`).join('\n').slice(0, limit);

// ---------------- claim check ----------------

/**
 * One claim to check, cut from the page by code (not chosen by the model, so every check covers the same claims): each
 * sentence of a walkthrough step, each entry's place in a step, each item's location and its "missable because", each
 * choice, advice line, service and fight.
 */
export type ClaimSlot = {
  id: string;
  /** Where it is on the page: S3 (a step), E4 (an entry), C1, A2, P1 (services and people), F1 (a fight). */
  label: string;
  kind: 'sentence' | 'placement' | 'location' | 'how' | 'missable' | 'consequence' | 'advice' | 'merchant' | 'fight' | 'fight-rewards' | 'fight-weaknesses';
  /** A placement's or an entry's id; a step sentence's index. */
  entry?: string;
  sentence?: number;
  text: string;
};
export type ClaimVerdict = ClaimSlot & { verdict: 'supported' | 'unsupported' | 'contradicted' | 'general'; evidence: string[]; fix?: string; why?: string };

/** The page's draft, as the claim slots are cut from it. */
export type ClaimPage = {
  steps: { title: string; text: string; entries?: string[] }[];
  entries: { id: string; name?: string; text?: string; where?: string; how?: string; lockout?: string }[];
  choices: { title: string; when?: string; options: { label: string; outcome: string }[] }[];
  advice: string[];
  services: string[];
  fights: { name: string; enemies?: string; rewards?: string; weaknesses?: string }[];
};

export const sentencesOf = (t: string) => String(t || '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 3);

export function claimSlots(p: ClaimPage): ClaimSlot[] {
  const out: ClaimSlot[] = [];
  const add = (s: Omit<ClaimSlot, 'id'>) => out.push({ id: `K${out.length + 1}`, ...s });
  const names = new Map(p.entries.map((e) => [e.id, e.name || cut(e.text, 60)]));
  p.steps.forEach((s, i) => {
    sentencesOf(s.text).forEach((x, j) => add({ label: `S${i + 1}`, kind: 'sentence', sentence: j, text: x }));
    for (const id of s.entries || []) add({ label: `S${i + 1}`, kind: 'placement', entry: id, text: `"${names.get(id) || id}" is found in the part of the area this step covers: "${s.title}" (${cut(s.text, 160)})` });
  });
  p.entries.forEach((e, i) => {
    add({ label: `E${i + 1}`, kind: 'location', entry: e.id, text: e.name ? `${e.name}: ${e.where || '(no location)'}` : cut(e.text, 300) });
    if (e.name && e.how) add({ label: `E${i + 1}`, kind: 'how', entry: e.id, text: `How to get ${e.name}: ${e.how}` });
    if (e.lockout) add({ label: `E${i + 1}`, kind: 'missable', entry: e.id, text: `${e.name || cut(e.text, 60)} can be permanently missed because: ${e.lockout}` });
  });
  p.choices.forEach((c, i) => add({ label: `C${i + 1}`, kind: 'consequence', text: `${c.title}${c.when ? ` (${c.when})` : ''}: ${c.options.map((o) => `${o.label} => ${o.outcome}`).join(' ;; ')}` }));
  p.advice.forEach((a, i) => add({ label: `A${i + 1}`, kind: 'advice', text: a }));
  p.services.forEach((s, i) => add({ label: `P${i + 1}`, kind: 'merchant', text: s }));
  p.fights.forEach((f, i) => {
    add({ label: `F${i + 1}`, kind: 'fight', text: `${f.name} is fought in this area${f.enemies ? `; enemies: ${f.enemies}` : ''}` });
    if (f.rewards) add({ label: `F${i + 1}`, kind: 'fight-rewards', text: `${f.name} drops or rewards: ${f.rewards}` });
    if (f.weaknesses) add({ label: `F${i + 1}`, kind: 'fight-weaknesses', text: `${f.name}'s weaknesses and resistances: ${f.weaknesses}` });
  });
  return out;
}

export const CLAIM_RULES = [
  'Give a verdict for EVERY numbered claim, judged against the EVIDENCE only (never your own knowledge of the game):',
  '"supported": an evidence line says it (cite its id). Every specific part has to be supported: a location, a merchant, what an item is, a drop, a consequence.',
  '"contradicted": an evidence line says otherwise (cite it, and give the corrected wording from the evidence in "fix").',
  '"unsupported": no evidence line says it, even if it sounds right.',
  '"general": the claim states no specific fact at all (pure advice like "explore carefully", or a transition like "Then head on.").',
  'Something being missable, permanently lost, or locking the player out needs an evidence line that explicitly says so; otherwise it is "unsupported".',
  'A placement claim is supported only if the evidence puts that thing in the part of the area the step covers (a thing the evidence puts in another part, or another area, is "unsupported" or "contradicted").',
];

function claimPrompt(game: string, area: string, slots: ClaimSlot[], evidence: string) {
  return [
    `Check a guide page for the video game "${game}", the area "${area}", claim by claim against the EVIDENCE (sentences from sources, each with an id).`,
    ...CLAIM_RULES,
    'Reply with JSON only: an array with one object per claim: {"id": "K1", "verdict": "supported|unsupported|contradicted|general", "evidence": ["e4"], "fix": "...", "why": "a few words"}.',
    '',
    'EVIDENCE:',
    evidence,
    '',
    'CLAIMS:',
    ...slots.map((s) => `${s.id} (${s.kind}): ${s.text}`),
  ].join('\n');
}

/** A temporary API failure (overloaded, rate limited, timed out, connection dropped): worth retrying. */
export const isTransient = (e: any) => /\b(500|502|503|504|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|overloaded|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(String(e?.message || e));
/** A call retried twice (after 10 and 30 seconds) on a temporary failure. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt >= 2 || !isTransient(e)) throw e;
      await new Promise((r) => setTimeout(r, attempt ? 30_000 : 10_000));
    }
  }
}

/** The model judges every slot against the evidence (in batches, so a long page fits). A slot it skips is unsupported. */
export async function claimCheck(game: string, area: string, slots: ClaimSlot[], ev: EvidencePack, model = MODEL): Promise<ClaimVerdict[]> {
  const out: ClaimVerdict[] = [];
  for (let i = 0; i < slots.length; i += 60) {
    const batch = slots.slice(i, i + 60);
    const res: any = await withRetry(() => gemini().models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: claimPrompt(game, area, batch, evidenceText(ev)) }] }],
      config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 12000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    }));
    out.push(...parseClaims(String(res?.text || ''), batch, ev));
  }
  return out;
}

/**
 * The checker's JSON, kept honest: every slot gets a verdict (a missing one is unsupported), and "supported" or
 * "contradicted" must cite evidence ids that exist (otherwise it's unsupported).
 */
export function parseClaims(text: string, slots: ClaimSlot[], ev: EvidencePack): ClaimVerdict[] {
  let rows: any[] = [];
  try {
    rows = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    rows = [];
  }
  const byId = new Map((Array.isArray(rows) ? rows : []).filter((r) => r && r.id).map((r) => [String(r.id).toUpperCase(), r]));
  const ids = new Set(ev.evidence.map((e) => e.id));
  return slots.map((s) => {
    const r: any = byId.get(s.id) || {};
    const evidence = (Array.isArray(r.evidence) ? r.evidence : []).map(String).filter((x: string) => ids.has(x));
    let verdict: ClaimVerdict['verdict'] = ['supported', 'unsupported', 'contradicted', 'general'].includes(r.verdict) ? r.verdict : 'unsupported';
    if ((verdict === 'supported' || verdict === 'contradicted') && !evidence.length) verdict = 'unsupported';
    // Only a step sentence, advice or a how-to can be "general"; anything else states a fact by construction.
    if (verdict === 'general' && s.kind !== 'sentence' && s.kind !== 'advice' && s.kind !== 'how') verdict = 'unsupported';
    return { ...s, verdict, evidence, ...(r.fix ? { fix: cut(r.fix, 400) } : {}), ...(r.why ? { why: cut(r.why, 200) } : {}) };
  });
}

// ---------------- rules (plain code) ----------------

/** Things a player starts with or gets automatically: never a checkbox. */
const AUTOMATIC = /\b(starting (funds|money|equipment|gear|items?|cash)|you start (the game )?with|start(s)? with|received automatically|automatic(ally)? (given|awarded|received|reward)|given to you at the start|story reward|default (weapon|equipment))\b/i;
export const isAutomatic = (e: { name?: string; where?: string; how?: string; text?: string }) =>
  AUTOMATIC.test([e.name, e.where, e.how, e.text].filter(Boolean).join(' '));

/** Garbled text: a repeated field label, a leaked draft label, or a broken fragment. Returns the cleaned text, or '' if unusable. */
export function cleanEntryText(v: unknown, label = ''): string {
  let t = String(v ?? '').replace(/\s+/g, ' ').trim();
  // "how: how: ..." / "where: where ..." / a leaked "S3:" or "E2:" label.
  t = t.replace(/^(?:(?:how|where|missable because|missable|note|tip)\s*:\s*)+/i, '').replace(/^\s*[SNECAP]\d+\s*:\s*/, '');
  if (label) t = t.replace(new RegExp(`\\b${label}\\s*:\\s*${label}\\s*:`, 'gi'), `${label}:`);
  t = t.replace(/\b(how|where)\s*:\s*\1\s*:/gi, '$1:').replace(/\|/g, ',').replace(/\s+,/g, ',').trim();
  // A fragment: under three words, or ending on a dangling joiner.
  if (t.split(' ').length < 3 && !/^[A-Z0-9¥$£€]/.test(t)) return '';
  if (/\b(and|or|the|to|of|with|a|an|by)$/i.test(t)) return '';
  if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length) t = t.replace(/[()]/g, '');
  return t;
}

/**
 * The page rules on a finished draft: automatic and starting items lose their checkbox (dropped from the lists and
 * steps), entry text is cleaned (garbled fields dropped), and the summary box's services come from the evidence.
 * Returns what was removed or changed, for the report.
 */
export function pageRules(pr: any, ev: EvidencePack | null): { removed: string[]; cleaned: number } {
  const removed: string[] = [];
  let cleaned = 0;
  const dropIds = new Set<string>();
  for (const list of ['items', 'secrets'] as const) {
    pr[list] = (pr[list] || []).filter((e: any) => {
      if (isAutomatic(e)) { removed.push(`${e.name || cut(e.text, 60)}: a starting item or automatic reward (no checkbox)`); dropIds.add(e.id); return false; }
      return true;
    }).map((e: any) => {
      const out = { ...e };
      for (const f of ['where', 'how', 'lockout', 'text'] as const) {
        if (!out[f]) continue;
        const c = cleanEntryText(out[f], f === 'lockout' ? 'missable because' : f);
        if (c !== out[f]) cleaned++;
        if (c) out[f] = c; else delete out[f];
      }
      if (!out.lockout) out.missable = false;
      return out;
    }).filter((e: any) => (list === 'items' ? e.name && e.where : e.text));
    // The same item twice (the page's own entry and a new one): the first stays, its id takes the other's places.
    const seen = new Map<string, string>();
    pr[list] = pr[list].filter((e: any) => {
      const k = String(e.name || e.text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!k) return true;
      if (seen.has(k)) { dropIds.add(e.id); removed.push(`${e.name || cut(e.text, 60)}: listed twice (merged)`); return false; }
      seen.set(k, e.id);
      return true;
    });
  }
  pr.walkthrough = (pr.walkthrough || []).map((s: any) => ({ ...s, entries: (s.entries || []).filter((id: string) => !dropIds.has(id)) }));
  if (ev && pr.info) {
    // Services and people: only what the evidence names, and said to be incomplete unless a source lists them all.
    pr.info = { ...pr.info, servicesComplete: !!ev.servicesComplete };
  }
  return { removed, cleaned };
}

// ---------------- the review ----------------

export type ReviewResult = { score: number; status: 'passed' | 'failed'; reason?: string; claims: ClaimVerdict[]; supported: number; total: number; contradicted: ClaimVerdict[]; unsupported: ClaimVerdict[] };

/**
 * The Pro reviewer, claim by claim against the evidence (no judgement of how the page reads). Score: the share of
 * specific claims a source supports ("general" lines with no fact don't count). Fails under 90% supported or with more
 * than 2 contradicted claims; the claims it couldn't support are removed from the page either way (applyClaimVerdicts).
 */
export async function claimReview(game: string, area: string, page: ClaimPage, ev: EvidencePack, opts: { model?: string } = {}): Promise<ReviewResult> {
  const model = opts.model || PRO_MODEL;
  if (/pro/i.test(model)) await takePro('careful');
  return scoreClaims(await claimCheck(game, area, claimSlots(page), ev, model));
}

export function scoreClaims(claims: ClaimVerdict[]): ReviewResult {
  const specific = claims.filter((c) => c.verdict !== 'general');
  const total = specific.length;
  const supported = specific.filter((c) => c.verdict === 'supported').length;
  const contradicted = specific.filter((c) => c.verdict === 'contradicted');
  const unsupported = specific.filter((c) => c.verdict === 'unsupported');
  const score = total ? Math.round((supported / total) * 100) : 0;
  const reason = !total ? 'no specific claims could be checked'
    : contradicted.length > 2 ? `${contradicted.length} claims the sources contradict (${contradicted.slice(0, 3).map((c) => cut(c.text, 80)).join('; ')})`
    : score < 90 ? `only ${supported} of ${total} specific claims are supported by the sources` : undefined;
  return { score, status: reason ? 'failed' : 'passed', ...(reason ? { reason } : {}), claims, supported, total, contradicted, unsupported };
}
