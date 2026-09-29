/**
 * Guide publisher: turns guide pages from the database into website pages in Marketing_Website_Files/guides.
 *
 *   npx tsx scripts/guides/publish.ts --drafts                  preview: include drafts (marked DRAFT) so you can look them over
 *   npx tsx scripts/guides/publish.ts --approve "Final Fantasy VI"   publish that game's drafts, then build
 *   npx tsx scripts/guides/publish.ts                           build published pages only (what goes live)
 *
 * Then upload Marketing_Website_Files to Netlify as usual. Writes one page per area, a page per game, a guides index,
 * sitemap.xml and robots.txt. Pages that were held back by the checks are never published.
 */
import fs from 'fs';
import path from 'path';
import { db, gameKey, arg, type GuideArea, type GuideEntry } from './common';

const SITE = 'https://questcompendium.com';
const OUT = path.resolve('Marketing_Website_Files');
const withDrafts = arg('drafts') === 'true';
const approve = arg('approve');

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(opts: { title: string; description: string; depth: number; canonical: string; body: string; draft?: boolean }) {
  const up = '../'.repeat(opts.depth);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}">
  <link rel="canonical" href="${esc(opts.canonical)}">
  ${opts.draft ? '<meta name="robots" content="noindex">' : ''}
  <meta property="og:title" content="${esc(opts.title)}">
  <meta property="og:description" content="${esc(opts.description)}">
  <meta property="og:image" content="${SITE}/icon.png">
  <link rel="icon" type="image/svg+xml" href="${up}icon.svg">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: Inter, system-ui, sans-serif; background: #07070a; color: #e4e4e7; }
    .qc-pixel { image-rendering: pixelated; }
    .qc-check { accent-color: #a87ffb; }
  </style>
</head>
<body class="min-h-screen">
  <nav class="sticky top-0 z-40 bg-[#07070a]/85 backdrop-blur border-b border-white/5">
    <div class="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
      <a href="${up}index.html" class="flex items-center gap-2 font-bold text-white"><img src="${up}icon.svg" alt="" class="w-7 h-7 qc-pixel"> Quest Compendium</a>
      <div class="flex items-center gap-5 text-sm text-zinc-400">
        <a href="${up}guides/index.html" class="hover:text-white">Guides</a>
        <a href="${up}index.html#download" class="text-[#a87ffb] hover:text-white font-semibold">Get the app</a>
      </div>
    </div>
  </nav>
  ${opts.draft ? '<div class="bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-sm text-center py-2">DRAFT preview: not public yet</div>' : ''}
  <main class="max-w-4xl mx-auto px-6 py-10">${opts.body}</main>
  <footer class="max-w-4xl mx-auto px-6 py-10 text-xs text-zinc-500 border-t border-white/5">
    Guides are written with AI help. Spot a mistake? Tell us on <a href="https://discord.gg/WxdgNMXWyg" class="text-[#a87ffb]">Discord</a>.
    Game names belong to their owners; this site isn't affiliated with any publisher.
  </footer>
</body>
</html>
`;
}

const cta = (up: string, game: string) => `
  <div class="my-10 rounded-2xl border border-[#a87ffb]/30 bg-[#a87ffb]/10 p-6">
    <h2 class="text-lg font-bold text-white mb-1">Stuck somewhere in ${esc(game)}?</h2>
    <p class="text-zinc-300 text-sm mb-4">Quest Compendium sees your screen while you play and answers questions about exactly where you are, with no alt-tabbing.</p>
    <a href="${up}index.html#download" class="inline-block bg-[#a87ffb] text-black font-bold px-5 py-2 rounded-full hover:bg-white">Get live help while you play</a>
  </div>`;

function section(title: string, rows: string) {
  return rows ? `<section class="mt-8"><h2 class="text-xl font-bold text-white mb-3">${esc(title)}</h2>${rows}</section>` : '';
}
const checklist = (list: GuideEntry[], line: (e: GuideEntry) => string) =>
  list.length
    ? `<ul class="space-y-2">${list.map((e) => `<li class="flex gap-3 items-start"><input type="checkbox" class="qc-check mt-1" aria-label="Got it"><span>${line(e)}</span></li>`).join('')}</ul>`
    : '';

function areaBody(game: string, a: GuideArea, prev?: { slug: string; name: string }, next?: { slug: string; name: string }) {
  const up = '../../../';
  const items = checklist(a.items, (e) => `<strong class="text-white">${esc(e.name)}</strong>${e.missable ? ' <span class="text-amber-400 text-xs font-bold">MISSABLE</span>' : ''}: ${esc(e.where)}`);
  const secrets = checklist(a.secrets, (e) => esc(e.text));
  const enemies = a.enemies.length
    ? `<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-left text-zinc-400"><th class="py-2 pr-4">Enemy</th><th class="py-2 pr-4">Weakness</th><th class="py-2 pr-4">Steal</th><th class="py-2">Notes</th></tr></thead><tbody>${a.enemies
        .map((e) => `<tr class="border-t border-white/5"><td class="py-2 pr-4 text-white font-semibold">${esc(e.name)}</td><td class="py-2 pr-4">${esc(e.weakness || '')}</td><td class="py-2 pr-4">${esc(e.steal || '')}</td><td class="py-2">${esc(e.notes || '')}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '';
  const shops = a.shops.length ? `<ul class="space-y-2">${a.shops.map((e) => `<li><strong class="text-white">${esc(e.name)}</strong>: ${esc(e.sells)}</li>`).join('')}</ul>` : '';
  const tips = a.tips.length ? `<ul class="list-disc pl-5 space-y-1">${a.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  const nav = `<div class="mt-10 flex justify-between gap-4 text-sm">${prev ? `<a class="text-[#a87ffb] hover:text-white" href="../${esc(prev.slug)}/index.html">&larr; ${esc(prev.name)}</a>` : '<span></span>'}${next ? `<a class="text-[#a87ffb] hover:text-white" href="../${esc(next.slug)}/index.html">${esc(next.name)} &rarr;</a>` : ''}</div>`;
  return `
    <p class="text-sm text-zinc-500 mb-2"><a class="hover:text-white" href="${up}guides/index.html">Guides</a> / <a class="hover:text-white" href="../index.html">${esc(game)}</a></p>
    <h1 class="text-3xl font-bold text-white">${esc(a.name)}</h1>
    <p class="text-zinc-400 mt-1">${esc(game)} guide${a.story ? ` · ${esc(a.story)}` : ''}</p>
    ${a.overview ? `<p class="mt-6 text-zinc-300 leading-relaxed">${esc(a.overview)}</p>` : ''}
    ${section('Items', items)}${section('Secrets', secrets)}${section('Enemies', enemies)}${section('Shops and people', shops)}${section('Tips', tips)}
    ${cta(up, game)}
    ${a.sources.length ? `<p class="text-xs text-zinc-500">Sources checked: ${a.sources.map(esc).join(', ')}</p>` : ''}
    ${nav}`;
}

/**
 * The homepage's "Free guides" section, between the QC-GUIDES markers in Marketing_Website_Files/index.html: a tile per
 * game with published pages, rewritten on every run so it grows with the guides. Draft-only games are left out.
 */
function updateHomepage(games: { key: string; game: string; published: number }[]) {
  const file = path.join(OUT, 'index.html');
  if (!fs.existsSync(file)) return;
  const html = fs.readFileSync(file, 'utf8');
  const nl = html.includes('\r\n') ? '\r\n' : '\n';
  const start = '<!-- QC-GUIDES:START -->';
  const end = '<!-- QC-GUIDES:END -->';
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a < 0 || b < a) {
    console.log('Homepage guides section not found (no QC-GUIDES markers); skipped.');
    return;
  }
  const tiles = games
    .slice()
    .sort((x, y) => y.published - x.published)
    .slice(0, 8)
    .map(
      (g) =>
        `        <a href="guides/${esc(g.key)}/index.html" class="block rounded-2xl border border-white/10 bg-white/5 p-5 hover:border-[#a87ffb]/50 hover:bg-white/[0.07] transition-colors">` +
        `<div class="text-white font-bold leading-snug">${esc(g.game)}</div>` +
        `<div class="text-sm text-zinc-400 mt-1">${g.published} area${g.published === 1 ? '' : 's'}</div></a>`,
    )
    .join(nl);
  const block = games.length
    ? [
        start,
        '      <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">',
        '        <div>',
        '          <h2 class="text-2xl sm:text-3xl font-bold text-white">Free guides: what not to miss</h2>',
        '          <p class="text-zinc-400 mt-2 max-w-2xl">Area-by-area checklists of items, secrets, missables and enemy weaknesses, so you never walk past the good stuff.</p>',
        '        </div>',
        '        <a href="guides/index.html" class="text-[#a87ffb] hover:text-white font-semibold whitespace-nowrap">See all guides &rarr;</a>',
        '      </div>',
        '      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">',
        tiles,
        '      </div>',
        end,
      ].join(nl)
    : `${start}${nl}${end}`;
  fs.writeFileSync(file, html.slice(0, a) + block + html.slice(b + end.length));
  console.log(`Homepage guides section updated: ${Math.min(games.length, 8)} game(s) shown.`);
}

async function main() {
  const guides = await db().collection('guides').get();
  if (approve) {
    const ref = db().collection('guides').doc(gameKey(approve));
    const drafts = await ref.collection('areas').where('status', '==', 'draft').get();
    for (const d of drafts.docs) await d.ref.update({ status: 'published', updatedAt: Date.now() });
    console.log(`Published ${drafts.size} draft page(s) for ${approve}.`);
  }
  // Start clean, so pages from an earlier preview (drafts) never get uploaded by accident.
  fs.rmSync(path.join(OUT, 'guides'), { recursive: true, force: true });
  const sitemap: string[] = [`${SITE}/`, `${SITE}/guides/`];
  const games: { key: string; game: string; count: number; published: number }[] = [];
  const show = (s: string) => s === 'published' || (withDrafts && s === 'draft');

  for (const g of guides.docs) {
    const info = g.data();
    const game = String(info.game || g.id);
    const order: { slug: string; name: string }[] = info.areas || [];
    const snap = await g.ref.collection('areas').get();
    const byslug = new Map(snap.docs.map((d) => [d.id, d.data() as GuideArea]));
    const visible = order.filter((o) => byslug.has(o.slug) && show(byslug.get(o.slug)!.status));
    if (!visible.length) continue;
    games.push({ key: g.id, game, count: visible.length, published: visible.filter((o) => byslug.get(o.slug)!.status === 'published').length });
    const dir = path.join(OUT, 'guides', g.id);
    fs.mkdirSync(dir, { recursive: true });
    visible.forEach((o, i) => {
      const a = byslug.get(o.slug)!;
      const draft = a.status !== 'published';
      const adir = path.join(dir, o.slug);
      fs.mkdirSync(adir, { recursive: true });
      const title = `${a.name} – ${game} Guide: Items, Secrets & Enemies | Quest Compendium`;
      const firsts = [...a.items.map((e) => e.name), ...a.secrets.map(() => 'secrets')].filter(Boolean).slice(0, 4).join(', ');
      const description = `${game} ${a.name} guide: ${a.items.length} items${a.secrets.length ? `, ${a.secrets.length} secrets` : ''}${a.enemies.length ? `, enemy weaknesses` : ''}. ${firsts ? `Includes ${firsts}.` : ''}`.slice(0, 158);
      fs.writeFileSync(
        path.join(adir, 'index.html'),
        page({ title, description, depth: 3, canonical: `${SITE}/guides/${g.id}/${o.slug}/`, body: areaBody(game, a, visible[i - 1], visible[i + 1]), draft }),
      );
      if (!draft) sitemap.push(`${SITE}/guides/${g.id}/${o.slug}/`);
    });
    const list = visible
      .map((o) => {
        const a = byslug.get(o.slug)!;
        return `<li class="border-t border-white/5 py-3"><a class="text-white font-semibold hover:text-[#a87ffb]" href="${esc(o.slug)}/index.html">${esc(a.name)}</a>${a.status !== 'published' ? ' <span class="text-amber-400 text-xs">DRAFT</span>' : ''}<div class="text-sm text-zinc-500">${esc(a.story)}</div></li>`;
      })
      .join('');
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      page({
        title: `${game} Guide and Walkthrough | Quest Compendium`,
        description: `Area-by-area ${game} guide with item checklists, secrets, missables and enemy weaknesses.`,
        depth: 2,
        canonical: `${SITE}/guides/${g.id}/`,
        body: `<p class="text-sm text-zinc-500 mb-2"><a class="hover:text-white" href="../index.html">Guides</a></p><h1 class="text-3xl font-bold text-white">${esc(game)} guide</h1><p class="text-zinc-400 mt-2 mb-6">Every area in story order, with item checklists, secrets, missables and enemy weaknesses.</p><ul>${list}</ul>${cta('../../', game)}`,
        draft: visible.some((o) => byslug.get(o.slug)!.status !== 'published'),
      }),
    );
    if (visible.some((o) => byslug.get(o.slug)!.status === 'published')) sitemap.push(`${SITE}/guides/${g.id}/`);
  }

  fs.mkdirSync(path.join(OUT, 'guides'), { recursive: true });
  fs.writeFileSync(
    path.join(OUT, 'guides', 'index.html'),
    page({
      title: 'Game Guides and Walkthroughs | Quest Compendium',
      description: 'Game guides with item checklists, secrets, missables and enemy weaknesses, area by area.',
      depth: 1,
      canonical: `${SITE}/guides/`,
      body: `<h1 class="text-3xl font-bold text-white">Game guides</h1><p class="text-zinc-400 mt-2 mb-6">Area-by-area guides with checklists, secrets and enemy weaknesses.</p>${
        games.length
          ? `<ul>${games.map((g) => `<li class="border-t border-white/5 py-3"><a class="text-white font-semibold hover:text-[#a87ffb]" href="${esc(g.key)}/index.html">${esc(g.game)}</a> <span class="text-sm text-zinc-500">${g.count} area${g.count === 1 ? '' : 's'}</span></li>`).join('')}</ul>`
          : '<p class="text-zinc-500">The first guides are on their way.</p>'
      }`,
    }),
  );
  fs.writeFileSync(
    path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`,
  );
  fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  updateHomepage(games.filter((g) => g.published > 0));
  console.log(`Built ${games.reduce((n, g) => n + g.count, 0)} guide page(s) for ${games.length} game(s)${withDrafts ? ' (drafts included, marked DRAFT and hidden from search)' : ''}.`);
  console.log(`Open ${path.join(OUT, 'guides', 'index.html')} in your browser to look them over.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Publishing failed:', e?.message || e);
  process.exit(1);
});
