/**
 * Settle the cross-page contradictions consistency.ts finds, against the evidence we already store (no searches): each
 * page's claim about the thing is checked against the evidence packs of every page involved. The verdicts say which
 * page is right; nothing is changed (fixes go through the usual review).
 *
 *   npx tsx scripts/guides/resolveConflicts.ts --file consistency.json --key elden-ring [--max 3] [--names "A;B"]
 * Cost: one Flash claim check per conflict (token-only, about $0.01), counted like any run.
 */
import fs from 'fs';
import { db, arg, usageScope } from './common';
import { claimCheck, trusted, type ClaimSlot, type Evidence, type EvidencePack } from './claimCheck';

type Mention = { on: string; text: string };
type Conflict = { kind: string; name: string; reason: string; mentions: Mention[] };

/** Every stored evidence line for the pages a conflict touches (area packs; the game's shared research). */
async function evidenceFor(key: string, ons: string[]): Promise<EvidencePack> {
  const lines: Evidence[] = [];
  const sites = new Set<string>();
  for (const on of [...new Set(ons)].filter((x) => !x.startsWith('entity:'))) {
    const p = (await db().collection('evidencePacks').doc(`${key}__${on}`).get()).data() as EvidencePack | undefined;
    for (const e of p?.evidence || []) if (!lines.some((x) => x.text === e.text)) lines.push({ ...e, id: `p${lines.length + 1}` });
    (p?.sites || []).forEach((s) => sites.add(s));
  }
  const g: any = (await db().collection('gameEvidence').doc(key).get()).data();
  for (const e of (g?.evidence || []) as any[]) if (!lines.some((x) => x.text === e.text)) lines.push({ id: `p${lines.length + 1}`, text: e.area ? `(in ${e.area}) ${e.text}` : e.text, sources: e.sources || [], topic: e.topic });
  return trusted({ key, slug: 'conflict', game: '', area: '', evidence: lines, sites: [...sites], servicesComplete: false, searches: 0, at: Date.now() });
}

export async function resolveConflict(key: string, game: string, c: Conflict) {
  const ev = await evidenceFor(key, c.mentions.map((m) => m.on));
  if (!ev.evidence.length) return { name: c.name, verdicts: [], note: 'no stored evidence for these pages' };
  const slots: ClaimSlot[] = c.mentions.map((m, i) => ({ id: `K${i + 1}`, label: `E${i + 1}`, kind: 'location', text: `${c.name}: ${m.text}` }));
  const v = await claimCheck(game, c.name, slots, ev);
  return { name: c.name, note: `${ev.evidence.length} evidence line(s)`, verdicts: c.mentions.map((m, i) => ({ on: m.on, text: m.text, verdict: v[i]?.verdict || 'unsupported', why: v[i]?.why || '' })) };
}

async function main() {
  const file = String(arg('file') || '');
  const key = String(arg('key') || '');
  const max = Number(arg('max', '3')) || 3;
  const names = String(arg('names') || '').split(';').map((x) => x.trim()).filter(Boolean);
  const report: any[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const g = report.find((r) => r.key === key);
  if (!g) throw new Error(`no ${key} in ${file}`);
  const list: Conflict[] = (g.conflicts as Conflict[]).filter((c) => !names.length || names.includes(c.name)).slice(0, max);
  const scope = { dollars: 0, searches: 0 };
  const out = await usageScope.run(scope, async () => { const r = []; for (const c of list) r.push(await resolveConflict(key, String(g.game || key), c)); return r; });
  for (const r of out) {
    console.log(`\n${r.name} (${r.note})`);
    for (const v of r.verdicts) console.log(`  ${v.verdict.toUpperCase().padEnd(13)} ${v.on}: ${v.text}${v.why ? `  [${v.why}]` : ''}`);
  }
  console.log(`\n${out.length} conflict(s) checked, $${scope.dollars.toFixed(3)} (${scope.searches} searches).`);
  setTimeout(() => process.exit(0), 300);
}
if (/resolveConflicts\.ts$/.test(process.argv[1] || '')) main().catch((e) => { console.error('resolveConflicts failed:', e?.message || e); process.exit(1); });
