/**
 * Which answer a question gets (owner, Nov 24 2026): the light answer (Gemini 4 Hydrogen, thinking low) by default,
 * the medium one only where it clearly helps. Owner: "light in a lot of ways wins for players just because it is almost
 * as good at half the time"; "half the price is more valuable to me".
 *
 * The tests behind it (Nov 24 2026, scratchpad/model-compare): 12 questions about one named thing, light 11 s / $0.057
 * against medium 21 s / $0.107 with the same facts (owner's blind picks 7 medium, 4 light, "very close"); 12 screenshot
 * questions, the same reading of the screen in 11, but medium clearly better on details: a charms menu (picked from
 * the charms on screen) and a map (3 right markers against 1). The Nov 21 2026 "what next" tests had medium ahead
 * (6.7-7.1 against 5.8-6.6 of 10). So medium stays for:
 *   - what next / where to go (whatNext.ts), and the app's What next? and what's-after quick questions
 *   - puzzles and being stuck (questionType.ts 'puzzle'), and the Stuck quick question
 *   - builds and planning (classes, feats, spells, stats, party, loadout)
 *   - details on the screen: menus, maps, inventory, skill trees, "show me where", Help me here
 *   - long questions with a lot of setup (over 35 words)
 *   - screenshot-only asks (the screen is the whole question)
 *   - voice messages when asked to (voice: true); the server sends them light unless config/chatRouting.lightVoice is false
 * Everything else, including fights, choices, lookups, "who / what is this" and follow-ups, gets the light answer.
 */
import { asksWhatNext } from './whatNext';
import { questionType } from './questionType';

const BUILD = /\b(?:build|builds|respec|loadout|party comp(?:osition)?|min-?max|multiclass|subclass|feats?|stat (?:spread|points)|level(?:ing)? up|what (?:class|race|spells?|skills?|perks?|talents?|charms?|stats?) (?:should|do|to)|which (?:class|subclass|race|feat|spells?|skills?|perks?|talents?|charms?|stats?))\b|\bcrea(?:r|te) (?:a |un |my )?(?:character|personaje|build)|construcci[oó]n|\bbuilds?\b|charakter(?:aufbau)?|skillung/i;
// Details on the screen, when there is a screenshot.
const SCREEN = /\b(?:map|minimap|menu|inventory|charms?|skill ?tree|talents?|perks?|equip(?:ped|ment)?|loadout|stats? screen|quest log|journal|hud|ui|which of (?:my|these|the)|on (?:my|the|this) screen|where am i|show me where|point (?:to|at|out)|mark(?:er)?s?)\b|mapa|inventario|invent[aá]rio|karte|inventar|carte|\bmenu\b/i;
const LONG_WORDS = 35;

export type EffortWhy = 'what-next' | 'puzzle' | 'build' | 'screen' | 'long' | 'voice' | 'screenshot-only' | 'empty';

/** Why a question needs the medium answer, or null for the light one. */
export function needsMedium(text: string, o: { quick?: string | null; hasImage?: boolean; voice?: boolean; standIn?: boolean } = {}): EffortWhy | null {
  const t = String(text || '').trim();
  if (o.voice) return 'voice';
  if (o.standIn) return 'screenshot-only';
  if (o.quick === 'here' || o.quick === 'where') return 'screen';
  if (asksWhatNext(t, o.quick || null)) return 'what-next';
  if (o.quick === 'stuck' || questionType(t, o.quick || null) === 'puzzle') return 'puzzle';
  if (!t) return 'empty';
  if (BUILD.test(t)) return 'build';
  if (o.hasImage && SCREEN.test(t)) return 'screen';
  if (t.split(/\s+/).length > LONG_WORDS) return 'long';
  return null;
}
