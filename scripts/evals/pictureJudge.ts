// Picture judging, Gemini vs OpenAI (owner, Nov 19 2026): the suggester's wiki check (is this wiki picture the thing our
// guide describes?) on real candidates, both ways; writes an HTML page with the pictures and both verdicts to compare.
//   npx tsx scripts/evals/pictureJudge.ts --games red-dead-redemption-2,baldur-s-gate-3 [--max 50]
import fs from 'fs';
import { db, arg, ledgerDollars } from '../guides/common';
import { forTests as S } from '../guides/suggestImages';

const OUT = 'scratchpad/picture-judge';
fs.mkdirSync(OUT, { recursive: true });
const games = String(arg('games') || '').split(',').filter(Boolean);
const max = Number(arg('max', '50')) || 50;
const rows: any[] = [];
for (const key of games) {
  if (rows.length >= max) break;
  const info: any = (await db().collection('guides').doc(key).get()).data() || {};
  const game = String(info.game || key);
  const src: any = (await db().collection('guideImageSources').doc(key).get()).data() || {};
  const fx = await S.fextralifeDomain(key, game, src);
  const finders = [
    ...(src.wiki?.domain ? [(n: string) => S.wikiImage(String(src.wiki.domain), n)] : []),
    ...(fx ? [(n: string) => S.fextralifeImage(fx, n)] : []),
  ];
  const { top } = await S.targetsOf(key);
  for (const t of top) {
    if (rows.length >= max) break;
    let w: any = null;
    for (const f of finders) { w = await f(t.name); if (w) break; }
    if (!w) continue;
    const buf = await S.download(w.url);
    const img = buf && (await S.forLook(buf));
    if (!buf || !img) continue;
    const verdicts: any = {};
    for (const side of ['gemini', 'openai']) {
      process.env.PIPELINE_OPENAI = side === 'openai' ? '1' : '';
      const t0 = Date.now();
      try { verdicts[side] = { ...(await S.check(game, img.jpeg, t, w.title)), ms: Date.now() - t0 }; } catch (e: any) { verdicts[side] = { ok: false, what: `error ${String(e?.message).slice(0, 80)}` }; }
    }
    const file = `${rows.length + 1}.jpg`;
    fs.writeFileSync(`${OUT}/${file}`, Buffer.from(img.jpeg, 'base64'));
    rows.push({ game, name: t.name, label: t.label, desc: t.desc, wiki: w.title, file, ...verdicts });
    console.log(`${rows.length}. ${game} | ${t.name} (wiki "${w.title}") | Gemini ${verdicts.gemini.ok ? 'yes' : 'no'} | OpenAI ${verdicts.openai.ok ? 'yes' : 'no'}`);
  }
}
const agree = rows.filter((r) => r.gemini.ok === r.openai.ok).length;
const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
fs.writeFileSync(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8"><style>body{font:13px sans-serif;background:#222;color:#eee}div{display:inline-block;width:300px;margin:6px;vertical-align:top}img{width:300px}.d{outline:3px solid #f5a}</style>` +
  rows.map((r) => `<div class="${r.gemini.ok !== r.openai.ok ? 'd' : ''}"><img src="${r.file}"><b>${esc(r.name)}</b> (${esc(r.label)}) · wiki "${esc(r.wiki)}"<br>Gemini: ${r.gemini.ok ? 'YES' : 'no'}, ${esc(r.gemini.what)}<br>OpenAI: ${r.openai.ok ? 'YES' : 'no'}, ${esc(r.openai.what)}</div>`).join(''));
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(rows, null, 1));
console.log(`\n${rows.length} pictures: agree on ${agree}; Gemini yes ${rows.filter((r) => r.gemini.ok).length}, OpenAI yes ${rows.filter((r) => r.openai.ok).length}; $${ledgerDollars().toFixed(3)}`);
process.exit(0);
