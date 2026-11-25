/**
 * Whether a question is about one named thing ("Where is the Ebony Blade?", "How do I get the Nagakiba?", "Should I take
 * the Ritual Dagger of Shar?", "Satori"), for the lookup lane: answered by the light answer (Hydrogen low) as a quick
 * answer, not a best one (owner, Nov 21 2026).
 *
 * Widened Nov 24 2026 (owner: "half the price is more valuable to me and taking half the amount of time may be more
 * valuable to players"). In the side-by-side test of 12 such questions, light kept the facts and steps of medium
 * (the Nagakiba's whole Yura questline too) in 11 s instead of 21 s, for $0.057 instead of $0.107; the owner's blind
 * picks were 7 medium, 4 light, "very close". A screenshot alone no longer rules a question out (the desktop app
 * sends one with nearly every question, so the lane almost never fired: 0 of a week's 107 questions), but a question
 * about the screen does: in the screenshot test medium read menus and maps clearly better (a charms menu, map
 * markers). What next, fights, puzzles, builds, "which" and "or" choices, and anything that needs judgement stay medium.
 */
import { asksWhatNext } from './whatNext';

const ASKS_FACT = new RegExp([
  // English: an amount, a place, what something is or does, how to get one thing, whether to take one thing, the best X.
  String.raw`^(?:how (?:much|many)|what (?:\w+ )?level|what does|what(?:'s| is| are) (?:the )?(?:price|cost|drop rate|requirements?)|what are the requirements|where (?:is|are|can i (?:get|find|buy)|do i (?:get|find|buy)))`,
  String.raw`^(?:how (?:do|can|would) i (?:get|find|obtain|unlock|buy|craft|earn)\b(?! (?:to|into|in|past|through|out|up|down|back|across|over|around)\b))`,
  String.raw`^(?:should i (?:take|keep|sell|buy|grab|loot|steal|pick up|equip|use|craft|upgrade)\b)`,
  String.raw`^(?:what(?:'s| is| are) (?:the )?best\b|who(?:'s| is)|what(?:'s| is| are) (?:a |an |the )?[a-z0-9'’-]+)`,
  // Spanish / Portuguese / German / French
  String.raw`^¿?(?:d[oó]nde (?:est[aá]|est[aá]n|consigo|encuentro|compro)|cu[aá]nto|qu[eé] hace|c[oó]mo (?:consigo|obtengo|desbloqueo)|qui[eé]n es|qu[eé] es)`,
  String.raw`^(?:onde (?:fica|est[aá]|encontro|compro|consigo)|quanto|o que (?:faz|o .* faz|[eé])|como (?:eu )?(?:consigo|pego|obtenho|desbloqueio)|quem [eé])`,
  String.raw`^(?:wo (?:finde ich|ist|sind|bekomme ich|kriege ich|kaufe ich)|wie viel|was (?:macht|bewirkt|ist)|wie (?:bekomme|kriege) ich|wer ist)`,
  String.raw`^(?:o[uù] (?:est|sont|trouver|acheter)|combien|que fait|comment (?:obtenir|avoir|trouver|d[eé]bloquer)|qui est)`,
].join('|'), 'i');
const NEEDS_JUDGEMENT = /\b(?:better|which|worth|build|strongest|beat|defeat|kill|fight|boss|stuck|puzzle|solve|choose|choice|missable|miss|or|vs|versus)\b|mejor|deber[ií]a|melhor|devo|beste|sollte|meilleur|dois-je/i;
// "Should I take ..." and "the best ..." are allowed in their lookup wordings only (above); elsewhere they need judgement.
const SHOULD_OR_BEST = /\b(?:should|best)\b/i;
const ALLOWED_SHOULD_OR_BEST = /^(?:should i (?:take|keep|sell|buy|grab|loot|steal|pick up|equip|use|craft|upgrade)\b|what(?:'s| is| are) (?:the )?best\b)/i;
// About the screen or the conversation, not one named thing: "where is this?", "should I take it?", "what's here?".
const POINTS_AT = /\b(?:this|these|that|those|here|there|it|him|her|them|screen|screenshot|picture|image|map|menu)\b|\b(?:esto|este|eso|ese|aqu[ií]|isso|isto|esse|essa|aqui|dies(?:e[rsmn]?)?|hier|ceci|cela|cette|ici)\b|(?:^|[\s,])ça(?=$|[\s,.?!])/i;
// Several questions in one ("... and what do I get for it?").
const COMPOUND = /\band (?:what|how|where|is|are|do|does|should|can|which|why|who)\b/i;
// Not a name: greetings, thanks, the app's own words.
const NOT_A_NAME = /\b(?:i|me|you|help|hi|hello|hey|thanks|thank|please|ok|okay|yes|no|not|why|when|how|what|where|who|do|does|is|are|can|could|would|should|nere|nerede|ne|nas[ıi]l|wo|was|wie|hilfe|donde|d[oó]nde|onde|qu[eé]|que|como|c[oó]mo|ayuda|ajuda|o[uù]|quoi|aide)\b|где|что|как|помоги/i;

export function isSimpleLookup(text: string, hasImage = false): boolean {
  void hasImage; // (a screenshot no longer rules a question out; see above)
  const t = String(text || '').trim().replace(/^(?:so|ok(?:ay)?|hey|quick question)[,:]?\s+/i, '');
  if (!t) return false;
  if (asksWhatNext(t)) return false;
  if ((t.match(/\?/g) || []).length > 1) return false;
  const words = t.split(/\s+/).length;
  if (words > 16) return false;
  if (POINTS_AT.test(t) || COMPOUND.test(t) || NEEDS_JUDGEMENT.test(t)) return false;
  if (SHOULD_OR_BEST.test(t) && !ALLOWED_SHOULD_OR_BEST.test(t)) return false;
  if (ASKS_FACT.test(t)) return true;
  // A bare name ("Satori", "Barcus rucksack"): up to 4 words with letters, no question words or chat.
  return words <= 4 && /\p{L}{2}/u.test(t) && !/\?/.test(t) && !NOT_A_NAME.test(t);
}
