/**
 * One narrator per game for immersive mode (owner, Nov 20 2026, idea #8: "voices would also change depending on the
 * game being played like the text answers do"). Made once per game by a small text call and kept, so the answers speak
 * as this character and the read-aloud voice sounds like them: who they are, their accent, voice and delivery, and the
 * Google voice that fits (owner preferred Google's voices on Nov 20 2026, after hearing Google's and OpenAI's).
 */

/** Google's speech voices (all 30), with the character Google gives each and whether it reads as a man or a woman. */
export const GOOGLE_VOICES: { name: string; style: string; gender: 'm' | 'f' }[] = [
  { name: 'Zephyr', style: 'bright', gender: 'f' }, { name: 'Puck', style: 'upbeat', gender: 'm' }, { name: 'Charon', style: 'informative', gender: 'm' },
  { name: 'Kore', style: 'firm', gender: 'f' }, { name: 'Fenrir', style: 'excitable', gender: 'm' }, { name: 'Leda', style: 'youthful', gender: 'f' },
  { name: 'Orus', style: 'firm', gender: 'm' }, { name: 'Aoede', style: 'breezy', gender: 'f' }, { name: 'Callirrhoe', style: 'easy-going', gender: 'f' },
  { name: 'Autonoe', style: 'bright', gender: 'f' }, { name: 'Enceladus', style: 'breathy', gender: 'm' }, { name: 'Iapetus', style: 'clear', gender: 'm' },
  { name: 'Umbriel', style: 'easy-going', gender: 'm' }, { name: 'Algieba', style: 'smooth', gender: 'm' }, { name: 'Despina', style: 'smooth', gender: 'f' },
  { name: 'Erinome', style: 'clear', gender: 'f' }, { name: 'Algenib', style: 'gravelly', gender: 'm' }, { name: 'Rasalgethi', style: 'informative', gender: 'm' },
  { name: 'Laomedeia', style: 'upbeat', gender: 'f' }, { name: 'Achernar', style: 'soft', gender: 'f' }, { name: 'Alnilam', style: 'firm', gender: 'm' },
  { name: 'Schedar', style: 'even', gender: 'm' }, { name: 'Gacrux', style: 'mature', gender: 'f' }, { name: 'Pulcherrima', style: 'forward', gender: 'f' },
  { name: 'Achird', style: 'friendly', gender: 'm' }, { name: 'Zubenelgenubi', style: 'casual', gender: 'm' }, { name: 'Vindemiatrix', style: 'gentle', gender: 'f' },
  { name: 'Sadachbia', style: 'lively', gender: 'm' }, { name: 'Sadaltager', style: 'knowledgeable', gender: 'm' }, { name: 'Sulafat', style: 'warm', gender: 'f' },
];

export type Narrator = { who: string; accent: string; voice: string; delivery: string; gender: 'm' | 'f'; google: string };

/** The narrator writer's request for a game (JSON reply). */
export function narratorRequest(game: string): string {
  const list = GOOGLE_VOICES.map((v) => `${v.name} (${v.gender === 'm' ? 'man' : 'woman'}, ${v.style})`).join(', ');
  return `A narrator who lives in the world of the video game "${game}" talks the player through it: what to do, where, what to watch for. They are not one of the game's named main characters, but someone a fan would recognise as belonging there: their trade, where they're from, their era, and the game's own tone (its humour or grimness). Choose whoever fits this game best, man or woman, young or old, and give them a personality that matches the game's tone (a playful game gets a playful narrator; a grim one, a grim one). Avoid the stock "old, gravelly guide" unless this game truly calls for one. Pick the voice by that personality too.
Describe them for a voice actor, as JSON only:
{"who": "one short phrase, e.g. a weary frontier stagecoach driver", "accent": "", "voice": "age, man or woman, timbre", "delivery": "tone, pace and attitude in one sentence", "gender": "m" or "f", "google": the one voice from this list that best fits them (same gender): ${list}}`;
}

/** The writer's reply as a Narrator, or null (a missing or unknown voice falls back to one of the right gender). */
export function parseNarrator(text: string): Narrator | null {
  try {
    const j = JSON.parse(String(text || '').replace(/^\s*```(?:json)?|```\s*$/g, '').trim());
    const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\r\n#"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
    const gender: 'm' | 'f' = j.gender === 'f' ? 'f' : 'm';
    const who = clean(j.who, 90);
    if (!who) return null;
    const known = GOOGLE_VOICES.find((v) => v.name.toLowerCase() === String(j.google || '').toLowerCase() && v.gender === gender);
    return { who, accent: clean(j.accent, 120), voice: clean(j.voice, 120), delivery: clean(j.delivery, 240), gender, google: known ? known.name : gender === 'f' ? 'Kore' : 'Charon' };
  } catch {
    return null;
  }
}

/** A game's narrator key: its name, lower case, letters and digits joined by "-". */
export const narratorKey = (game: string) => String(game || '').toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 100);

type Store = { get: (key: string) => Promise<Narrator | null>; set: (key: string, n: Narrator) => Promise<void> };
type Write = (request: string) => Promise<string>;
const memo = new Map<string, Narrator>();
const making = new Map<string, Promise<Narrator | null>>();

/**
 * The game's narrator: from memory, else the shared store (Firestore narrators/{key}, the same for every player, so a
 * game always sounds like itself), else made now (one small call) and kept. Null for no game, or when making one fails
 * (immersive mode then falls back to the general storyteller).
 */
export async function narratorFor(game: string, store: Store, write: Write): Promise<Narrator | null> {
  const key = narratorKey(game);
  if (!key) return null;
  const hit = memo.get(key);
  if (hit) return hit;
  let p = making.get(key);
  if (!p) {
    p = (async () => {
      const kept = await store.get(key).catch(() => null);
      if (kept) return kept;
      const n = parseNarrator(await write(narratorRequest(game)));
      if (n) await store.set(key, n).catch(() => {});
      return n;
    })().finally(() => making.delete(key));
    making.set(key, p);
  }
  const n = await p;
  if (n) { memo.set(key, n); if (memo.size > 2000) memo.clear(); }
  return n;
}

/** The answers' narrator line (searchPolicy ROLEPLAY_PERSONA): the same character the voice is. */
export const narratorLine = (n: Narrator) => `${n.who}${n.delivery ? `. How you talk: ${n.delivery}` : ''}`;

/** Director's notes for Google's speech models: only the text after "#### TRANSCRIPT" is read (ttsAudio.ts). */
export function narratorNotes(n: Narrator): string {
  return `# AUDIO PROFILE: ${n.who}\n## DIRECTOR'S NOTES\n${n.accent ? `Accent: ${n.accent}\n` : ''}${n.voice ? `Voice: ${n.voice}\n` : ''}${n.delivery ? `Delivery: ${n.delivery}\n` : ''}Read only the transcript.\n#### TRANSCRIPT`;
}
