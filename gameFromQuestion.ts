/**
 * The game a question is about when the app gives none (a general compendium tab, the website with no game running,
 * a tab named something that isn't a game): read from the question and the last few messages by the cheapest model
 * (owner, Nov 23 2026: "even if there is no recognized game the app should try to answer the question and detect the
 * game based on the question asked"). About 0.03c a question, and only for questions without a game.
 */
import type { GoogleGenAI } from '@google/genai';
import { logUsage } from './usage';

const MODEL = process.env.GAME_DETECT_MODEL || 'gemini-3.1-flash-lite';

/** The detector's reply: a game name only when it was sure enough. */
export function parseGameReply(text: string): string | null {
  try {
    const raw = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
    const j = JSON.parse(raw);
    const game = String(j?.game || '').trim().slice(0, 120);
    if (!game || /^(none|unknown|n\/a)$/i.test(game)) return null;
    return j?.confidence === 'high' ? game : null;
  } catch {
    return null;
  }
}

export async function gameFromQuestion(client: GoogleGenAI, question: string, history: string[]): Promise<string | null> {
  const convo = history.map((t) => String(t || '').trim()).filter(Boolean).slice(-4).map((t) => `- ${t.slice(0, 400)}`).join('\n');
  if (!String(question || '').trim() && !convo) return null;
  const prompt =
    'A player asked a game help app a question, with no game selected. Which video game is it about?\n' +
    (convo ? `Earlier messages (latest last):\n${convo}\n` : '') +
    `The question: "${String(question || '').slice(0, 600)}"\n\n` +
    'Use the game named in the question or the earlier messages (nicknames and short forms count: "GTA6" is Grand ' +
    'Theft Auto VI, "BG3" is Baldur\'s Gate 3), or one that the characters, places, items or bosses named clearly ' +
    'belong to and no other game has. Games newer than you know are real: give the name as the player wrote it. A ' +
    'question that could fit several games (chapters, a house, a gate, a boss with no name) has an empty game: never ' +
    'guess.\n' +
    'Reply with JSON only: {"game": "the game\'s full usual name, or empty", "confidence": "high" | "medium" | "low"}';
  try {
    const response: any = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 80 },
    });
    logUsage('game-detect', MODEL, response);
    return parseGameReply(response?.text ?? '');
  } catch (err: any) {
    console.warn('[game-detect] failed:', err?.message);
    return null;
  }
}
