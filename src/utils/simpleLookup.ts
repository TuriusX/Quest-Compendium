/**
 * Whether a question is a simple single-fact lookup ("How much Strength for the Greatsword?", "Where is the Ebony
 * Blade?"), for the lookup lane (owner, Nov 21 2026, under test): short, one question, asking for a fact (an amount, a
 * place, what something does or how to get one item), with no screenshot and nothing that needs judgement (best,
 * should, which, worth, a fight, a puzzle, a choice, what next).
 */
import { asksWhatNext } from './whatNext';

const ASKS_FACT = new RegExp([
  // English
  // ("How do I get X" is left out on purpose: in the test questions it was usually a multi-step quest or puzzle.)
  String.raw`^(?:how (?:much|many)|what (?:\w+ )?level|what does|what is the (?:price|cost|drop rate|requirement)|what are the requirements|where (?:is|are|can i (?:get|find|buy)|do i (?:get|find|buy)))`,
  // Spanish / Portuguese / German / French
  String.raw`^¿?(?:d[oó]nde (?:est[aá]|est[aá]n|consigo|encuentro|compro)|cu[aá]nto|qu[eé] hace)`,
  String.raw`^(?:onde (?:fica|est[aá]|encontro|compro)|quanto|o que (?:faz|o .* faz))`,
  String.raw`^(?:wo (?:finde ich|ist|sind|bekomme ich|kaufe ich)|wie viel|was (?:macht|bewirkt))`,
  String.raw`^(?:o[uù] (?:est|sont|trouver|acheter)|combien|que fait)`,
].join('|'), 'i');
const NEEDS_JUDGEMENT = /\b(?:best|better|should|which|worth|build|strongest|beat|defeat|kill|fight|boss|stuck|puzzle|solve|choose|choice|missable|miss)\b|mejor|deber[ií]a|melhor|devo|beste|sollte|meilleur|dois-je/i;

export function isSimpleLookup(text: string, hasImage = false): boolean {
  const t = String(text || '').trim();
  if (!t || hasImage) return false;
  if (asksWhatNext(t)) return false;
  if ((t.match(/\?/g) || []).length > 1) return false;
  if (t.split(/\s+/).length > 14) return false;
  if (NEEDS_JUDGEMENT.test(t)) return false;
  return ASKS_FACT.test(t.replace(/^(?:so|ok(?:ay)?|hey|quick question)[,:]?\s+/i, ''));
}
