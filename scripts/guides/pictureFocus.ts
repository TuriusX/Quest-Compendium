/**
 * The focal point of an approved picture (src/utils/focus.ts): where every cut of it is centred, so a portrait keeps
 * its head. The owner sets it in /admin/images (`focus`); until he does, one is found once per picture when it is first
 * published (`autoFocus`): Flash-Lite boxes the main subject's face (a person or creature) or the main subject. About
 * $0.0002 a picture, counted in the pictures' budget (owner-approved: $0.50 a night, $5 a month, shared with the
 * suggester and Find another). With no budget left or no reply, the picture keeps its default (src/utils/focus.ts).
 */
import { ThinkingLevel } from '@google/genai';
import { db, gemini } from './common';
import { asFocus, type Focus } from '../../src/utils/focus';

const LITE = process.env.GUIDE_LITE_MODEL || 'gemini-3.1-flash-lite';
/** What one look costs at most (a 600-wide JPEG in, a few words out). */
export const FOCUS_COST = 0.0005;
const STATE = () => db().collection('system').doc('imageSuggest');

// ---- The picture budget (owner-approved): $0.50 a night and $5 a month, shared by everything that looks at pictures ----

const nightId = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
export async function pictureBudget(): Promise<{ nightLeft: number; monthLeft: number; add: (d: number) => Promise<void> }> {
  const st: any = (await STATE().get()).data() || {};
  const month = new Date().toISOString().slice(0, 7), night = nightId();
  let monthUsed = st.month?.id === month ? Number(st.month.dollars) || 0 : 0;
  let nightUsed = st.night?.id === night ? Number(st.night.dollars) || 0 : 0;
  return {
    get nightLeft() { return Math.max(0, 0.5 - nightUsed); },
    get monthLeft() { return Math.max(0, 5 - monthUsed); },
    add: async (d: number) => {
      monthUsed += d; nightUsed += d;
      await STATE().set({ month: { id: month, dollars: monthUsed }, night: { id: night, dollars: nightUsed } }, { merge: true });
    },
  };
}

/** The reply's box ([ymin, xmin, ymax, xmax] out of 1000, Gemini's usual) as a focal point at its middle. */
export function focusFromReply(j: any): Focus | null {
  const b = Array.isArray(j?.box_2d) ? j.box_2d.map(Number) : null;
  if (!b || b.length !== 4 || b.some((n: number) => !Number.isFinite(n))) return null;
  const [y0, x0, y1, x1] = b.map((n: number) => Math.min(1000, Math.max(0, n)) / 1000);
  if (y1 <= y0 || x1 <= x0) return null;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return asFocus({ x: r3((x0 + x1) / 2), y: r3((y0 + y1) / 2), face: j.face === true });
}

/** One look: the face of the person or creature the picture is about, or its main subject. */
export async function findFocus(jpeg: Buffer, name: string, label: string): Promise<Focus | null> {
  const prompt =
    `This picture is for a game guide's page about "${name}" (${label.toLowerCase()}). It will be cropped to small ` +
    'thumbnails, so we need the part that must stay in frame. If its main subject is a person or creature, box that ' +
    "subject's face (head only). Otherwise box the main subject (the building, landmark or object the picture is about). " +
    'Reply with JSON only: {"face": true | false, "box_2d": [ymin, xmin, ymax, xmax]} with coordinates from 0 to 1000.';
  try {
    const res: any = await gemini().models.generateContent({
      model: LITE,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } }, { text: prompt }] }],
      config: { temperature: 0, maxOutputTokens: 80, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
    });
    const t = String(res.text || '').replace(/```json|```/g, '');
    const a = t.indexOf('{'), z = t.lastIndexOf('}');
    return a >= 0 && z > a ? focusFromReply(JSON.parse(t.slice(a, z + 1))) : null;
  } catch {
    return null;
  }
}
