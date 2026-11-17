/**
 * Controller mode step 5 (owner, Nov 17 2026): the on-screen keyboard suggests words as you type, so a question about
 * "Stormveil Castle" is two presses, not fifteen. Free and offline: the words come from what's already on screen (the
 * game, the quest log, recent answers), so they're in the player's language and the game's own names.
 *
 *   buildVocab(texts)            words and names (capitalised runs of up to 3 words, like "Margit the Fell") with counts
 *   suggest(vocab, text, caret)  up to 5 completions for the word being typed at the caret: names first, then words
 *   applySuggestion(...)         put one in place of the word being typed, with a space after
 *   deleteWord(text, caret)      the word before the caret goes (and the spaces after it)
 */
export type Vocab = Map<string, { text: string; n: number; name: boolean }>;

const WORD = /[\p{L}\p{N}'’-]+/gu;
/** Common question words, so the keyboard helps before any answer is on screen. */
const BASE = ['where', 'what', 'how', 'who', 'which', 'when', 'find', 'get', 'beat', 'kill', 'open', 'unlock', 'should', 'next', 'missable', 'quest', 'boss', 'weapon', 'armor', 'item', 'key', 'door', 'chest', 'build', 'best', 'after', 'before', 'here', 'there', 'the', 'this', 'that', 'with', 'from', 'about'];

export function buildVocab(texts: string[]): Vocab {
  const v: Vocab = new Map();
  const add = (text: string, name: boolean, n = 1) => {
    const key = text.toLowerCase();
    if (key.length < 3) return;
    const cur = v.get(key);
    if (cur) {
      cur.n += n;
      cur.name = cur.name || name;
    } else v.set(key, { text, n, name });
  };
  for (const w of BASE) add(w, false, 0.5);
  for (const raw of texts) {
    const text = String(raw || '');
    // Names: runs of capitalised words on one line (joined by "of", "the", "de"...), up to 3 capitalised words.
    for (const m of text.matchAll(/\p{Lu}[\p{L}'’-]+(?:[ \t]+(?:(?:of|the|de|du|la|le|von|der|del)[ \t]+)?\p{Lu}[\p{L}'’-]+){0,2}/gu)) {
      // The run and its endings that start with a capitalised word ("Find the Claw Talisman" also gives "Claw
      // Talisman": a sentence's first word is capitalised too).
      const words = m[0].replace(/\s+/g, ' ').trim().split(' ');
      for (let i = 0; i < words.length - 1; i++) {
        if (!/^\p{Lu}/u.test(words[i])) continue;
        add(words.slice(i).join(' '), true);
      }
    }
    for (const m of text.matchAll(WORD)) {
      const w = m[0].replace(/^['’-]+|['’-]+$/g, '');
      if (w.length < 3 || /^\d+$/.test(w)) continue;
      const capital = /^\p{Lu}/u.test(w) && m.index! > 0 && !/[.!?]\s*$/.test(text.slice(Math.max(0, m.index! - 3), m.index));
      add(w, capital);
    }
  }
  return v;
}

/** The word being typed: from its start to the caret. */
function partial(text: string, caret: number): { start: number; word: string } {
  let start = caret;
  while (start > 0 && /[\p{L}\p{N}'’-]/u.test(text[start - 1])) start--;
  return { start, word: text.slice(start, caret) };
}

export function suggest(vocab: Vocab, text: string, caret: number, max = 5): string[] {
  const { word } = partial(text, caret);
  if (word.length < 1) return [];
  const w = word.toLowerCase();
  const out = Array.from(vocab.entries())
    .filter(([key]) => key.startsWith(w) && key !== w)
    .sort(([, a], [, b]) => Number(b.name) - Number(a.name) || Number(b.text.includes(' ')) - Number(a.text.includes(' ')) || b.n - a.n || a.text.length - b.text.length)
    .slice(0, max)
    .map(([, e]) => e.text);
  return out;
}

export function applySuggestion(text: string, caret: number, pick: string): { text: string; caret: number } {
  const { start } = partial(text, caret);
  const after = text.slice(caret).replace(/^[\p{L}\p{N}'’-]*/u, '');
  const glue = after.startsWith(' ') ? '' : ' ';
  const next = text.slice(0, start) + pick + glue + after;
  return { text: next, caret: start + pick.length + 1 };
}

export function deleteWord(text: string, caret: number): { text: string; caret: number } {
  let i = caret;
  while (i > 0 && text[i - 1] === ' ') i--;
  while (i > 0 && text[i - 1] !== ' ') i--;
  return { text: text.slice(0, i) + text.slice(caret), caret: i };
}
