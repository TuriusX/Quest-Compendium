/**
 * Whether a question asks what to do next or where to go (owner, Nov 21 2026): the "what next, in full" rule
 * (WHAT_NEXT_IN_FULL in searchPolicy.ts) is added only to these. In the Nov 21 blind tests it lifted "what next"
 * answers (6.6 -> 7.4 of 10, 7.5 on games it wasn't written around) but cost other questions a little (7.8 -> 7.6),
 * so lookups, puzzles and fights go without it.
 */
const NEXT = new RegExp([
  // English
  String.raw`\bwhat(?:'s| is)? (?:now|next)\b`, String.raw`\bwhat (?:do|should|can|could) i do\b`, String.raw`\bwhere (?:do|should|can) i go\b`,
  String.raw`\bwhere (?:to|now)\b`, String.raw`\bnext (?:step|steps|objective|quest|mission)\b`, String.raw`\bnow what\b`,
  String.raw`\bwhat should i (?:focus on|work on|prioriti[sz]e)\b`, String.raw`\bwhat (?:to do|first)\b`, String.raw`\bwhat do i do (?:now|first|here)\b`,
  // Spanish / Portuguese
  String.raw`qu[eé] (?:hago|debo hacer|deber[ií]a hacer)`, String.raw`ad[oó]nde (?:voy|debo ir)`, String.raw`(?:y )?ahora qu[eé]`, String.raw`siguiente paso`,
  String.raw`o que (?:eu )?(?:fa[cç]o|devo fazer)`, String.raw`para onde (?:eu )?(?:vou|devo ir)`, String.raw`e agora`, String.raw`pr[oó]ximo passo`,
  // German / French
  String.raw`was (?:soll ich|mache ich) (?:jetzt|als n[aä]chstes)`, String.raw`wohin (?:jetzt|als n[aä]chstes|soll ich)`, String.raw`wie geht'?s weiter`, String.raw`n[aä]chste[rn]? schritt`,
  String.raw`que (?:dois-je|faire) (?:faire )?(?:maintenant|ensuite)`, String.raw`o[uù] (?:aller|dois-je aller)`, String.raw`et maintenant`, String.raw`prochaine [eé]tape`,
  // Russian / Japanese / Korean / Chinese
  String.raw`что (?:делать|мне делать) (?:дальше|теперь)`, String.raw`куда (?:идти|дальше)`, '次(?:は|に)(?:何|どこ)', 'これから(?:何|どこ)', '다음(?:엔|에)? 뭐', '어디로 가', '接下来(?:做什么|去哪)', '下一步',
].join('|'), 'i');

/** True for "what now / where next" questions, and for the app's own "What next?" and "Done here, what's after?" quick questions. */
export function asksWhatNext(text: string, quick?: string | null): boolean {
  if (quick === 'next' || quick === 'after') return true;
  return NEXT.test(String(text || ''));
}
