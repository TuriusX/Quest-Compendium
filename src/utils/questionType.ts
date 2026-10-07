/**
 * What kind of question a player asked, for model routing and the Quality numbers (answer feedback): a quick question
 * (src/utils/quickQuestions.ts) says so itself; anything typed is read from its words, in the app's languages.
 *   location  where something or someone is, how to get somewhere
 *   puzzle    a puzzle, an obstacle, being stuck
 *   fight     a fight, a boss, an enemy
 *   choice    a decision, which option to pick
 *   missable  what can be missed for good, points of no return
 *   general   everything else
 */
import type { QuickId } from './quickQuestions';

export type QuestionType = 'location' | 'puzzle' | 'fight' | 'choice' | 'missable' | 'general';
export const QUESTION_TYPES: QuestionType[] = ['location', 'puzzle', 'fight', 'choice', 'missable', 'general'];

const QUICK_TYPES: Record<QuickId, QuestionType> = {
  next: 'general', stuck: 'puzzle', missable: 'missable', fight: 'fight', choice: 'choice', leave: 'missable',
  keep: 'general', hint: 'puzzle', after: 'general', where: 'location', hintInstead: 'puzzle',
};

// Checked in this order: the more specific kinds first ("where is the missable chest" is about a missable).
const RULES: [QuestionType, RegExp][] = [
  ['missable', /\bmiss(?:able|ables|ing out)?\b.*\b(?:here|anything|forever|for good|permanently)\b|\bmissables?\b|point of no return|\bpermanently\b|lock(?:ed|s)? (?:me )?out|perdibles?|perd[ií]ve(?:l|is)|verpass|verpassbar|manquer|rater d[eé]finitivement|пропуст|取り返し|見逃|놓칠|錯過|错过/i],
  ['choice', /\bshould i (?:choose|pick|side|help|kill|spare|trust|join|take|accept|refuse|let)\b|\bwhich (?:option|side|choice|answer|path|one should)\b|\b(?:choice|choices|decision|decide)\b|\bbest (?:choice|option|answer)\b|eleg(?:ir|ir[ée])|opci[oó]n|escolh|decis[aã]o|\bwahl\b|entscheid|\bchoix\b|choisir|выбор|выбрать|選択|選ぶ|선택|选择|选哪/i],
  ['fight', /\b(?:fight|fights|boss|bosses|battle|combat|enemy|enemies|kill|defeat|beat|weakness|weak to)\b|combate|pelea|jefe|luta|chefe|inimig|kampf|gegner|\bcombat\b|ennemi|бой|босс|враг|戦闘|ボス|倒し|전투|보스|战斗|首领|打败/i],
  ['puzzle', /\b(?:puzzle|riddle|stuck|lever|levers|mechanism|locked|unlock|solve|solution)\b|how (?:do|can) i (?:get past|get through|open|solve|reach|get up|get across|cross)|can'?t (?:get|reach|open|pass|find a way)|acertijo|rompecabezas|atascad|no puedo avanzar|enigma|quebra-cabe|travad|travei|r[äa]tsel|feststeck|\b[ée]nigme\b|bloqu[ée]|головоломк|застрял|не могу пройти|謎|パズル|詰ま|퍼즐|막혔|谜题|卡住|卡关/i],
  ['location', /\bwhere(?:'s| is| are| can| do| does| did)?\b|\bfind\b|\blocat(?:e|ion|ed)\b|how (?:do|can) i get (?:down |up |over |back |across )?to|\bway to\b|d[oó]nde|ad[oó]nde|ubicaci|\bonde\b|encontr|\bwo (?:ist|sind|finde)|finde ich|\bo[uù] (?:est|sont|trouver)|trouver|где|найти|どこ|어디|哪里|在哪|找到/i],
];

/** The kind of question: the quick question's own, else read from the text. */
export function questionType(text: string, quick?: string | null): QuestionType {
  if (quick && Object.prototype.hasOwnProperty.call(QUICK_TYPES, quick)) return QUICK_TYPES[quick as QuickId];
  const t = String(text || '');
  for (const [kind, re] of RULES) if (re.test(t)) return kind;
  return 'general';
}
