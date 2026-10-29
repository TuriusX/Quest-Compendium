/**
 * Account sign-ups on a Standard Celeration Chart (owner, Oct 29 2026), for /stats chart (discord.ts) and one-off copies:
 *   - y: a multiply scale (log 10), count per day, four cycles from 0.1 to 1000; the counting floor is 1 a day (one
 *     day's count), and a day with none is a dot on the zero line just below it;
 *   - x: 140 successive calendar days from the first sign-up, every day drawn, Sunday lines every 7 days;
 *   - new real accounts a day (not the owner's, not test ones: ownerStats.ts realAccounts), as dots, every day up to today;
 *   - the celeration line (least squares on the log of the days with sign-ups) once there are 7 such days, labelled
 *     ×N or ÷N per week; the total of accounts in the corner.
 * Days are Central time, like the rest of the numbers. Drawn as SVG, turned into a PNG with sharp; no AI.
 */
import sharp from 'sharp';
import { realAccounts } from './ownerStats';
import { centralDay } from './questionsChart';

const DAY = 86_400_000;
const SPAN = 140;
const dayIndex = (day: string) => Math.round(Date.parse(`${day}T12:00:00Z`) / DAY);
const dayOfIndex = (i: number) => new Date(i * DAY).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (day: string) => `${MON[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8))}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export type SignupDays = { start: string; counts: number[]; total: number; celeration: { perWeek: number; a: number; b: number; from: number; to: number } | null };

/** Sign-ups a day from the first one to today (every day), and the celeration once 7 days have sign-ups. */
export async function signupDays(now = Date.now()): Promise<SignupDays> {
  const created = await realAccounts();
  const days = created.map((t) => centralDay(t)).sort();
  if (!days.length) return { start: centralDay(now), counts: [], total: 0, celeration: null };
  const s = dayIndex(days[0]), today = dayIndex(centralDay(now));
  const counts = Array.from({ length: Math.min(SPAN, today - s + 1) }, () => 0);
  for (const d of days) { const i = dayIndex(d) - s; if (i >= 0 && i < counts.length) counts[i]++; }
  // Least squares of log10(count) on the day, over the days with sign-ups.
  const pts = counts.map((c, i) => [i, c] as const).filter(([, c]) => c > 0);
  let celeration: SignupDays['celeration'] = null;
  if (pts.length >= 7) {
    const n = pts.length, mx = pts.reduce((a, [x]) => a + x, 0) / n, my = pts.reduce((a, [, c]) => a + Math.log10(c), 0) / n;
    const sxx = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0), sxy = pts.reduce((a, [x, c]) => a + (x - mx) * (Math.log10(c) - my), 0);
    const b = sxx ? sxy / sxx : 0;
    celeration = { perWeek: 10 ** (b * 7), a: my - b * mx, b, from: pts[0][0], to: counts.length - 1 };
  }
  return { start: days[0], counts, total: created.length, celeration };
}

/** "×1.4 per week" / "÷1.2 per week" (×1.0 when flat). */
export const celerationLabel = (perWeek: number) => (perWeek >= 1 ? `×${perWeek.toFixed(perWeek < 10 ? 1 : 0)} per week` : `÷${(1 / perWeek).toFixed(1 / perWeek < 10 ? 1 : 0)} per week`);

export function signupsSccSvg(d: SignupDays, title = 'Account sign-ups: Standard Celeration Chart'): string {
  const W = 1400, H = 820, L = 92, R = 40, T = 104, B = 112;
  const pw = W - L - R, ph = H - T - B;
  const LO = -1, HI = 3; // 0.1 to 1000
  const ZERO = 10 ** -0.25; // the zero line, just below the counting floor's cycle start would be too far: placed under 1
  const y = (v: number) => T + ph - ((Math.log10(v) - LO) / (HI - LO)) * ph;
  const x = (i: number) => L + (i / SPAN) * pw;
  const C = { bg: '#ffffff', line: '#bcd3ea', strong: '#6f9cc8', text: '#1f2937', dim: '#5b6b7d', dot: '#111827', zero: '#9aa7b5', floor: '#c2410c', cel: '#b91c1c' };
  const font = `font-family="DejaVu Sans, Segoe UI, Arial, sans-serif"`;
  const p: string[] = [`<rect width="${W}" height="${H}" fill="${C.bg}"/>`];
  p.push(`<text x="${L}" y="40" ${font} font-size="22" font-weight="700" fill="${C.text}">${esc(title)}</text>`);
  p.push(`<text x="${L}" y="66" ${font} font-size="14" fill="${C.dim}">${esc(`New real accounts a day (not yours, not test accounts), ${SPAN} successive calendar days from the first sign-up (${label(d.start)}), Central time.`)}</text>`);
  // Horizontal lines: every 1–9 of each cycle, the cycle lines stronger.
  for (let e = LO; e < HI; e++) for (let m = 1; m <= 9; m++) {
    const v = m * 10 ** e;
    p.push(`<line x1="${L}" y1="${y(v)}" x2="${L + pw}" y2="${y(v)}" stroke="${m === 1 ? C.strong : C.line}" stroke-width="${m === 1 ? 1.4 : 0.7}"/>`);
  }
  p.push(`<line x1="${L}" y1="${y(1000)}" x2="${L + pw}" y2="${y(1000)}" stroke="${C.strong}" stroke-width="1.4"/>`);
  for (const v of [0.1, 1, 10, 100, 1000]) p.push(`<text x="${L - 10}" y="${y(v) + 5}" ${font} font-size="14" fill="${C.text}" text-anchor="end">${v}</text>`);
  p.push(`<text x="26" y="${T + ph / 2}" ${font} font-size="14" fill="${C.text}" text-anchor="middle" transform="rotate(-90 26 ${T + ph / 2})">Count per day</text>`);
  // Vertical lines: every day light, Sundays strong; day numbers every 14 days on top, dates of those Sundays below.
  const s = dayIndex(d.start);
  for (let i = 0; i <= SPAN; i++) {
    const sunday = new Date((s + i) * DAY).getUTCDay() === 0;
    p.push(`<line x1="${x(i)}" y1="${T}" x2="${x(i)}" y2="${T + ph}" stroke="${sunday ? C.strong : C.line}" stroke-width="${sunday ? 1.1 : 0.4}"/>`);
    if (i % 14 === 0) p.push(`<text x="${x(i)}" y="${T - 10}" ${font} font-size="12" fill="${C.dim}" text-anchor="middle">${i}</text>`);
    if (sunday && Math.round((i - (7 - new Date(s * DAY).getUTCDay()) % 7) / 7) % 2 === 0) p.push(`<text x="${x(i)}" y="${T + ph + 20}" ${font} font-size="12" fill="${C.dim}" text-anchor="middle">${label(dayOfIndex(s + i))}</text>`);
  }
  p.push(`<text x="${L + pw / 2}" y="${T + ph + 46}" ${font} font-size="14" fill="${C.text}" text-anchor="middle">Successive calendar days (heavy lines: Sundays)</text>`);
  // The counting floor (1 a day) and the zero line just below it.
  p.push(`<line x1="${L}" y1="${y(1)}" x2="${L + pw}" y2="${y(1)}" stroke="${C.floor}" stroke-width="1.2" stroke-dasharray="8 5"/>`);
  p.push(`<text x="${L + pw - 4}" y="${y(1) - 6}" ${font} font-size="12" fill="${C.floor}" text-anchor="end">counting floor (1 a day)</text>`);
  p.push(`<line x1="${L}" y1="${y(ZERO)}" x2="${L + pw}" y2="${y(ZERO)}" stroke="${C.zero}" stroke-width="0.8" stroke-dasharray="2 4"/>`);
  p.push(`<text x="${L - 10}" y="${y(ZERO) + 4}" ${font} font-size="12" fill="${C.zero}" text-anchor="end">0</text>`);
  // The days: a dot each, zero days on the zero line.
  d.counts.forEach((c, i) => p.push(`<circle cx="${x(i)}" cy="${y(c > 0 ? c : ZERO)}" r="${c > 0 ? 4.2 : 3}" fill="${c > 0 ? C.dot : 'none'}" stroke="${C.dot}" stroke-width="1.3"/>`));
  // The celeration line and its value.
  if (d.celeration) {
    const c = d.celeration, at = (i: number) => 10 ** (c.a + c.b * i);
    p.push(`<line x1="${x(c.from)}" y1="${y(at(c.from))}" x2="${x(c.to)}" y2="${y(at(c.to))}" stroke="${C.cel}" stroke-width="2.5"/>`);
    p.push(`<text x="${x(c.to) + 8}" y="${y(at(c.to)) - 8}" ${font} font-size="15" font-weight="700" fill="${C.cel}">${esc(celerationLabel(c.perWeek))}</text>`);
  } else p.push(`<text x="${L + 12}" y="${T + 24}" ${font} font-size="13" fill="${C.dim}">No celeration line yet: it needs 7 days with sign-ups.</text>`);
  // The total, top right.
  p.push(`<rect x="${L + pw - 230}" y="${T + 10}" width="220" height="56" rx="6" fill="#ffffff" stroke="${C.strong}"/>`);
  p.push(`<text x="${L + pw - 120}" y="${T + 34}" ${font} font-size="13" fill="${C.dim}" text-anchor="middle">Accounts in total</text>`);
  p.push(`<text x="${L + pw - 120}" y="${T + 57}" ${font} font-size="20" font-weight="700" fill="${C.text}" text-anchor="middle">${d.total}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${p.join('')}</svg>`;
}

export async function signupsScc(): Promise<{ png: Buffer; data: SignupDays }> {
  const data = await signupDays();
  return { png: await sharp(Buffer.from(signupsSccSvg(data)), { density: 144 }).png().toBuffer(), data };
}
