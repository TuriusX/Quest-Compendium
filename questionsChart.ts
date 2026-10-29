/**
 * Questions per day as a chart (owner, Oct 29 2026): one bar a day split into signed-in and guest questions, the 7-day
 * average as a line, and the app's releases marked. Drawn as SVG and turned into a PNG with sharp; no AI. Used for the
 * owner's /stats chart (discord.ts) and for one-off copies.
 *
 * From the daily counts (stats/{day}, Central time), without the owner's accounts (config/players.ownerHashes and the
 * days' owners) and test accounts (config/players.testUids; test guests and local servers are never counted):
 *   - from Oct 15 2026 each day keeps every player's question count (costs), so the owner's questions come out exactly;
 *   - before that only the day's totals were kept: guest questions are always counted (the owner asks signed in); a
 *     day when the owner was signed in counts only its guest questions (its signed-in ones can't be told apart from the
 *     owner's).
 */
import { getFirestore } from 'firebase-admin/firestore';
import sharp from 'sharp';
import { playerHash } from './ownerStats';

export type QuestionDay = { day: string; signedIn: number; guests: number };
export type Release = { tag: string; at: number };

const DAY = 86_400_000;
const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const centralDay = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

/** Every day from the first one with counts (or `from`) to today, with no gaps (a day with nothing is zero). */
export async function questionDays(from = ''): Promise<QuestionDay[]> {
  const db = getFirestore();
  const cfg: any = (await db.collection('config').doc('players').get()).data() || {};
  const owners = new Set<string>(cfg.ownerHashes || []);
  const tests = new Set<string>((cfg.testUids || []).map((u: string) => playerHash(u)));
  const docs = new Map((await db.collection('stats').get()).docs.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.id)).map((d) => [d.id, d.data() as any]));
  const first = [...docs.keys()].sort()[0];
  if (!first) return [];
  const out: QuestionDay[] = [];
  for (let day = from && from > first ? from : first, end = centralDay(); day <= end; day = addDay(day, 1)) {
    const s = docs.get(day) || {};
    const left = new Set<string>([...owners, ...tests, ...(s.owners || [])]);
    const costs = Object.entries((s.costs || {}) as Record<string, any>);
    if (costs.length) {
      let signedIn = 0, guests = 0;
      for (const [h, c] of costs) {
        if (left.has(h)) continue;
        if (c.tier === 'guest') guests += Number(c.questions) || 0;
        else signedIn += Number(c.questions) || 0;
      }
      out.push({ day, signedIn, guests });
      continue;
    }
    const players: string[] = s.players || [];
    const ownerIn = players.some((h) => left.has(h));
    out.push({ day, guests: Number(s.guestQuestions) || 0, signedIn: ownerIn ? 0 : Number(s.playerQuestions) || 0 });
  }
  return out;
}

/** The app's releases (GitHub, public), newest first. */
export async function appReleases(): Promise<Release[]> {
  try {
    const r = await fetch('https://api.github.com/repos/TuriusX/Quest-Compendium/releases?per_page=100', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'quest-compendium' } });
    if (!r.ok) return [];
    return ((await r.json()) as any[]).filter((x) => !x.draft && /^v\d+\.\d+\.\d+$/.test(x.tag_name)).map((x) => ({ tag: String(x.tag_name), at: Date.parse(x.published_at) }));
  } catch {
    return [];
  }
}

/** The 7-day average (trailing; the first days average what there is). */
export const sevenDay = (days: QuestionDay[]) => days.map((_, i) => { const w = days.slice(Math.max(0, i - 6), i + 1); return w.reduce((n, d) => n + d.signedIn + d.guests, 0) / w.length; });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (day: string) => `${MON[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8))}`;

/** The chart as SVG (1200 × 640): bars, the average line, the releases, a legend and a note. */
export function questionsChartSvg(days: QuestionDay[], releases: Release[], title: string): string {
  const W = 1200, H = 660, L = 64, R = 24, T = 116, B = 118;
  const pw = W - L - R, ph = H - T - B;
  const avg = sevenDay(days);
  const top = Math.max(4, ...days.map((d) => d.signedIn + d.guests), ...avg);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => top / s <= 6) || 1000;
  const ymax = Math.ceil(top / step) * step;
  const y = (v: number) => T + ph - (v / ymax) * ph;
  const slot = pw / Math.max(1, days.length);
  const bw = Math.max(2, Math.min(28, slot * 0.72));
  const x = (i: number) => L + slot * i + slot / 2;
  const C = { bg: '#0b0b10', grid: '#24242e', text: '#e4e4e7', dim: '#8b8b96', signed: '#a87ffb', guest: '#2dd4bf', avg: '#fbbf24', rel: '#71717a', relMajor: '#c4b0ff' };
  const font = `font-family="DejaVu Sans, Segoe UI, Arial, sans-serif"`;
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
  parts.push(`<text x="${L}" y="40" ${font} font-size="22" font-weight="700" fill="${C.text}">${esc(title)}</text>`);
  // Legend.
  const leg = [[C.signed, 'Signed in', ''], [C.guest, 'Guests', ''], [C.avg, '7-day average', 'line']];
  let lx = L;
  for (const [c, t, kind] of leg) {
    if (kind === 'line') parts.push(`<line x1="${lx}" y1="66" x2="${lx + 22}" y2="66" stroke="${c}" stroke-width="3"/>`);
    else parts.push(`<rect x="${lx}" y="58" width="16" height="16" rx="3" fill="${c}"/>`);
    parts.push(`<text x="${lx + (kind === 'line' ? 30 : 24)}" y="71" ${font} font-size="14" fill="${C.dim}">${esc(t)}</text>`);
    lx += 40 + t.length * 7.4;
  }
  // Grid and the y axis.
  for (let v = 0; v <= ymax; v += step) parts.push(`<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" stroke="${C.grid}" stroke-width="1"/><text x="${L - 10}" y="${y(v) + 5}" ${font} font-size="13" fill="${C.dim}" text-anchor="end">${v}</text>`);
  // Releases: a dashed line on the day; minor versions (x.y.0) and the newest are named.
  const byDay = new Map<string, Release[]>();
  for (const r of releases) { const d = centralDay(r.at); if (d >= days[0]?.day && d <= days[days.length - 1]?.day) byDay.set(d, [...(byDay.get(d) || []), r]); }
  const newest = releases.slice().sort((a, b) => b.at - a.at)[0]?.tag;
  let lastLabelX = -1e9;
  for (const [d, rs] of [...byDay.entries()].sort()) {
    const i = days.findIndex((q) => q.day === d);
    const major = rs.filter((r) => /\.0$/.test(r.tag) || r.tag === newest).sort((a, b) => a.at - b.at);
    parts.push(`<line x1="${x(i)}" y1="${T - 6}" x2="${x(i)}" y2="${T + ph}" stroke="${major.length ? C.relMajor : C.rel}" stroke-width="1" stroke-dasharray="3 4" stroke-opacity="${major.length ? 0.8 : 0.45}"/>`);
    const name = (major.length ? major : rs).map((r) => r.tag).join(', ');
    if (major.length && x(i) - lastLabelX > 70) {
      parts.push(`<text x="${x(i) + 4}" y="${T - 10}" ${font} font-size="12" fill="${C.relMajor}">${esc(name)}</text>`);
      lastLabelX = x(i);
    }
  }
  // Bars: signed in (bottom), then guests.
  days.forEach((d, i) => {
    let base = 0;
    for (const [v, fill] of [[d.signedIn, C.signed], [d.guests, C.guest]] as [number, string][]) {
      if (!v) continue;
      parts.push(`<rect x="${x(i) - bw / 2}" y="${y(base + v)}" width="${bw}" height="${y(base) - y(base + v)}" fill="${fill}"/>`);
      base += v;
    }
  });
  // The average line.
  parts.push(`<polyline fill="none" stroke="${C.avg}" stroke-width="3" stroke-linejoin="round" points="${avg.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`);
  // Dates: about ten along the axis, the last day always.
  const every = Math.max(1, Math.ceil(days.length / 10));
  days.forEach((d, i) => { if (i % every === 0 || i === days.length - 1) parts.push(`<text x="${x(i)}" y="${T + ph + 22}" ${font} font-size="13" fill="${C.dim}" text-anchor="middle">${label(d.day)}</text>`); });
  parts.push(`<line x1="${L}" y1="${T + ph}" x2="${W - R}" y2="${T + ph}" stroke="${C.dim}" stroke-width="1"/>`);
  const total = days.reduce((n, d) => n + d.signedIn + d.guests, 0);
  parts.push(`<text x="${L}" y="${H - 52}" ${font} font-size="13" fill="${C.dim}">${esc(`${total} questions in ${days.length} days (Central time), without your accounts and test accounts. Dashed lines: app releases (named: x.y.0 and the newest).`)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

/** The chart as a PNG, and its numbers as CSV. */
export async function questionsChart(opts: { from?: string; title?: string } = {}): Promise<{ png: Buffer; csv: string; days: QuestionDay[] }> {
  const [days, releases] = await Promise.all([questionDays(opts.from || ''), appReleases()]);
  const avg = sevenDay(days);
  const svg = questionsChartSvg(days, releases, opts.title || 'Questions per day');
  const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
  const rel = new Map<string, string[]>();
  for (const r of releases) { const d = centralDay(r.at); rel.set(d, [...(rel.get(d) || []), r.tag]); }
  const csv = ['day,signed_in,guests,total,seven_day_average,releases',
    ...days.map((d, i) => `${d.day},${d.signedIn},${d.guests},${d.signedIn + d.guests},${avg[i].toFixed(2)},${(rel.get(d.day) || []).sort().join(' ')}`)].join('\n') + '\n';
  return { png, csv, days };
}
