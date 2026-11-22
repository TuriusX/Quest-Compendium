// Simple-lookup test set (owner OK, Nov 21 2026, $10 hard stop): 30 single-fact questions across 10 games, 4 not in
// English, to see whether a lighter answer ("sol lite") keeps the facts of a best answer. Capture against a local
// server in capture mode (no AI call):
//   QC_EVAL_CAPTURE=scratchpad/model-compare/captured-lookup.jsonl npx tsx server.ts
//   npx tsx scripts/evals/model-compare/lookupCapture.ts
export const LOOKUPS: { id: string; game: string; appId?: number; q: string; lang?: string }[] = [
  { id: 'l1', game: 'ELDEN RING', appId: 1245620, q: 'How much Strength do I need for the Greatsword?' },
  { id: 'l2', game: 'ELDEN RING', appId: 1245620, q: 'Where can I buy a Lantern?' },
  { id: 'l3', game: 'ELDEN RING', appId: 1245620, q: 'What does the Shabriri Grape do?' },
  { id: 'l4', game: "Baldur's Gate 3", appId: 1086940, q: 'Where do I get the Everburn Blade?' },
  { id: 'l5', game: "Baldur's Gate 3", appId: 1086940, q: 'What does the Amulet of Misty Step do?' },
  { id: 'l6', game: "Baldur's Gate 3", appId: 1086940, lang: 'Spanish', q: '¿Dónde está el Anillo de la Rata (Ring of Absolute Force)?' },
  { id: 'l7', game: 'The Witcher 3: Wild Hunt', appId: 292030, q: 'Where do I find the Viper School steel sword diagram?' },
  { id: 'l8', game: 'The Witcher 3: Wild Hunt', appId: 292030, q: 'What does the Igni Firestream upgrade do?' },
  { id: 'l9', game: 'The Witcher 3: Wild Hunt', appId: 292030, lang: 'German', q: 'Wo finde ich die Diagramme der Greifenschule-Rüstung?' },
  { id: 'l10', game: 'Cyberpunk 2077', appId: 1091500, q: 'Where do I find Skippy?' },
  { id: 'l11', game: 'Cyberpunk 2077', appId: 1091500, q: 'What does the Sandevistan do?' },
  { id: 'l12', game: 'Cyberpunk 2077', appId: 1091500, q: "Where is Johnny's Malorian Arms 3516?" },
  { id: 'l13', game: 'Hollow Knight', appId: 367520, q: 'Where is the Mothwing Cloak?' },
  { id: 'l14', game: 'Hollow Knight', appId: 367520, q: 'How much does the Lumafly Lantern cost?' },
  { id: 'l15', game: 'Hollow Knight', appId: 367520, q: 'What does the Quick Slash charm do?' },
  { id: 'l16', game: 'Red Dead Redemption 2', appId: 1174180, q: 'Where is the legendary bear?' },
  { id: 'l17', game: 'Red Dead Redemption 2', appId: 1174180, q: 'Where do I get the White Arabian?' },
  { id: 'l18', game: 'Red Dead Redemption 2', appId: 1174180, q: 'What does a Ginseng Elixir do?' },
  { id: 'l19', game: 'The Elder Scrolls V: Skyrim Special Edition', appId: 489830, q: 'What Smithing level do I need for Daedric Smithing?' },
  { id: 'l20', game: 'The Elder Scrolls V: Skyrim Special Edition', appId: 489830, q: 'Where is the Ebony Blade?' },
  { id: 'l21', game: 'The Elder Scrolls V: Skyrim Special Edition', appId: 489830, lang: 'German', q: 'Wo finde ich Meridias Leuchtfeuer?' },
  { id: 'l22', game: 'The Legend of Zelda: Tears of the Kingdom', q: 'Where is the Hylian Shield?' },
  { id: 'l23', game: 'The Legend of Zelda: Tears of the Kingdom', q: 'What does a Zonai Rocket do?' },
  { id: 'l24', game: 'The Legend of Zelda: Tears of the Kingdom', q: 'Where do I get the Paraglider fabric from Kass?' },
  { id: 'l25', game: 'Stardew Valley', appId: 413150, q: 'How much do strawberry seeds cost at the Egg Festival?' },
  { id: 'l26', game: 'Stardew Valley', appId: 413150, q: 'What does a Deluxe Scarecrow do?' },
  { id: 'l27', game: 'Stardew Valley', appId: 413150, lang: 'Portuguese', q: 'Como eu consigo a Chave Enferrujada?' },
  { id: 'l28', game: 'FINAL FANTASY VII REMAKE INTERGRADE', appId: 1462040, q: 'Where is the Elemental materia?' },
  { id: 'l29', game: 'FINAL FANTASY VII REMAKE INTERGRADE', appId: 1462040, q: "How do I get Cloud's Hardedge?" },
  { id: 'l30', game: 'FINAL FANTASY VII REMAKE INTERGRADE', appId: 1462040, q: 'What does the Steadfast Block materia do?' },
];

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('lookupCapture.ts')) {
  (async () => {
    for (const x of LOOKUPS) {
      await new Promise((r) => setTimeout(r, 9500));
      const body: any = {
        question: x.q, history: [], aiMode: 'standard', isGameRunningLocally: true,
        activeGame: { name: x.game, ...(x.appId ? { appId: x.appId } : {}) }, language: x.lang || 'English', markers: false,
        answerModel: 'pro', evalId: x.id, done: [], playthrough: { choices: [], found: [], notes: '' },
      };
      const r = await fetch('http://localhost:3000/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer guest_dev_local' }, body: JSON.stringify(body) });
      const j: any = await r.json().catch(() => ({}));
      console.log(x.id, r.status, j.text === 'captured' ? 'captured' : String(j.text || j.error || '').slice(0, 120));
    }
    process.exit(0);
  })();
}
