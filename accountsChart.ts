/**
 * Accounts over time (owner, Oct 29 2026), for /stats chart (discord.ts) and one-off copies, in the questions chart's
 * style: the running total of real accounts (not the owner's, not test ones: ownerStats.ts realAccounts) as a line, one
 * point a day from the first sign-up (or the window's start) to today, the total written at its end; the day's new
 * sign-ups as small bars underneath; the app's releases marked like on the questions chart. Days are Central time.
 * Drawn as SVG, turned into a PNG with sharp; no AI.
 */
import sharp from 'sharp';
import { realAccounts } from './ownerStats';
import { centralDay, appReleases, type Release } from './questionsChart';

const DAY = 86_400_000;
const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (day: string) => `${MON[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8))}`;
const niceStep = (top: number) => [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => top / s <= 5) || 10000;

export type AccountDay = { day: string; added: number; total: number };

/** Every day from the first sign-up (or `from`, when later) to today: new accounts that day and the total after it. */
export async function accountDays(from = ''): Promise<AccountDay[]> {
  const days = (await realAccounts()).map((t) => centralDay(t)).sort();
  if (!days.length) return [];
  const added = new Map<string, number>();
  for (const d of days) added.set(d, (added.get(d) || 0) + 1);
  const out: AccountDay[] = [];
  let total = 0;
  for (let day = days[0], end = centralDay(); day <= end; day = addDay(day, 1)) {
    total += added.get(day) || 0;
    if (!from || day >= from) out.push({ day, added: added.get(day) || 0, total });
  }
  return out;
}

export function accountsChartSvg(days: AccountDay[], releases: Release[], title: string): string {
  const W = 1200, H = 660, L = 64, R = 70, T = 116, B = 118;
  const pw = W - L - R, ph = H - T - B;
  const gap = 18, barsH = Math.round(ph * 0.22), lineH = ph - barsH - gap; // the line above, the bars in a strip below
  const C = { bg: '#0b0b10', grid: '#24242e', text: '#e4e4e7', dim: '#8b8b96', line: '#a87ffb', bar: '#2dd4bf', rel: '#71717a', relMajor: '#c4b0ff' };
  const font = `font-family="DejaVu Sans, Segoe UI, Arial, sans-serif"`;
  const first = days[0]?.total ?? 0, last = days[days.length - 1]?.total ?? 0;
  const lo = Math.max(0, first - (days[0]?.added ?? 0)); // the line starts at the total before the window
  const step = niceStep(Math.max(4, last - lo));
  const ymin = Math.floor(lo / step) * step, ymax = Math.max(ymin + step, Math.ceil(last / step) * step);
  const y = (v: number) => T + lineH - ((v - ymin) / (ymax - ymin)) * lineH;
  const bTop = T + lineH + gap, bMax = Math.max(2, ...days.map((d) => d.added));
  const bStep = bMax <= 4 ? 1 : niceStep(bMax);
  const bCeil = Math.ceil(bMax / bStep) * bStep;
  const yb = (v: number) => bTop + barsH - (v / bCeil) * barsH;
  const slot = pw / Math.max(1, days.length);
  const bw = Math.max(2, Math.min(22, slot * 0.6));
  const x = (i: number) => L + slot * i + slot / 2;
  const p: string[] = [`<rect width="${W}" height="${H}" fill="${C.bg}"/>`];
  p.push(`<text x="${L}" y="40" ${font} font-size="22" font-weight="700" fill="${C.text}">${esc(title)}</text>`);
  p.push(`<line x1="${L}" y1="66" x2="${L + 22}" y2="66" stroke="${C.line}" stroke-width="3"/><text x="${L + 30}" y="71" ${font} font-size="14" fill="${C.dim}">Accounts in total</text>`);
  p.push(`<rect x="${L + 200}" y="58" width="16" height="16" rx="3" fill="${C.bar}"/><text x="${L + 224}" y="71" ${font} font-size="14" fill="${C.dim}">New sign-ups that day</text>`);
  // Grids and axes: the total above, the day's sign-ups below.
  for (let v = ymin; v <= ymax; v += step) p.push(`<line x1="${L}" y1="${y(v)}" x2="${L + pw}" y2="${y(v)}" stroke="${C.grid}"/><text x="${L - 10}" y="${y(v) + 5}" ${font} font-size="13" fill="${C.dim}" text-anchor="end">${v}</text>`);
  for (let v = 0; v <= bCeil; v += bStep) p.push(`<line x1="${L}" y1="${yb(v)}" x2="${L + pw}" y2="${yb(v)}" stroke="${C.grid}"/><text x="${L - 10}" y="${yb(v) + 4}" ${font} font-size="11" fill="${C.dim}" text-anchor="end">${v}</text>`);
  // Releases, as on the questions chart.
  const byDay = new Map<string, Release[]>();
  for (const r of releases) { const d = centralDay(r.at); if (days.length && d >= days[0].day && d <= days[days.length - 1].day) byDay.set(d, [...(byDay.get(d) || []), r]); }
  const newest = releases.slice().sort((a, b) => b.at - a.at)[0]?.tag;
  let lastLabelX = -1e9;
  for (const [d, rs] of [...byDay.entries()].sort()) {
    const i = days.findIndex((q) => q.day === d);
    const major = rs.filter((r) => /\.0$/.test(r.tag) || r.tag === newest).sort((a, b) => a.at - b.at);
    p.push(`<line x1="${x(i)}" y1="${T - 6}" x2="${x(i)}" y2="${bTop + barsH}" stroke="${major.length ? C.relMajor : C.rel}" stroke-width="1" stroke-dasharray="3 4" stroke-opacity="${major.length ? 0.8 : 0.45}"/>`);
    if (major.length && x(i) - lastLabelX > 70) { p.push(`<text x="${x(i) + 4}" y="${T - 10}" ${font} font-size="12" fill="${C.relMajor}">${esc(major.map((r) => r.tag).join(', '))}</text>`); lastLabelX = x(i); }
  }
  // The day's sign-ups.
  days.forEach((d, i) => { if (d.added) p.push(`<rect x="${x(i) - bw / 2}" y="${yb(d.added)}" width="${bw}" height="${yb(0) - yb(d.added)}" fill="${C.bar}"/>`); });
  p.push(`<line x1="${L}" y1="${yb(0)}" x2="${L + pw}" y2="${yb(0)}" stroke="${C.dim}"/>`);
  // The running total, a point a day, and the total at its end.
  if (days.length) {
    p.push(`<polyline fill="none" stroke="${C.line}" stroke-width="3" stroke-linejoin="round" points="${days.map((d, i) => `${x(i).toFixed(1)},${y(d.total).toFixed(1)}`).join(' ')}"/>`);
    if (days.length <= 120) days.forEach((d, i) => p.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(d.total).toFixed(1)}" r="2.6" fill="${C.line}"/>`));
    const e = days.length - 1;
    p.push(`<circle cx="${x(e)}" cy="${y(last)}" r="5" fill="${C.line}"/><text x="${x(e) + 10}" y="${y(last) + 6}" ${font} font-size="18" font-weight="700" fill="${C.text}">${last}</text>`);
  }
  const every = Math.max(1, Math.ceil(days.length / 10));
  days.forEach((d, i) => { if (i % every === 0 || i === days.length - 1) p.push(`<text x="${x(i)}" y="${bTop + barsH + 22}" ${font} font-size="13" fill="${C.dim}" text-anchor="middle">${label(d.day)}</text>`); });
  const newIn = days.reduce((n, d) => n + d.added, 0);
  p.push(`<text x="${L}" y="${H - 52}" ${font} font-size="13" fill="${C.dim}">${esc(`${last} real accounts (not yours, not test accounts); ${newIn} new in these ${days.length} days (Central time). Dashed lines: app releases (named: x.y.0 and the newest).`)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${p.join('')}</svg>`;
}

/** The chart as a PNG, for `days` days back (0: since the first sign-up). */
export async function accountsChart(opts: { days?: number; title?: string } = {}): Promise<{ png: Buffer; days: AccountDay[] }> {
  const from = opts.days ? centralDay(Date.now() - (opts.days - 1) * DAY) : '';
  const [days, releases] = await Promise.all([accountDays(from), appReleases()]);
  const svg = accountsChartSvg(days, releases, opts.title || `Accounts, ${opts.days ? `last ${opts.days} days` : 'all time'}`);
  return { png: await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer(), days };
}
