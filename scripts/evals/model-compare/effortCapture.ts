// Hydrogen light vs medium effort (owner OK, Nov 24 2026, $2 hard stop): 15 short questions about one named thing,
// from the week's real questions (lightly cleaned) plus two in the same style, to see whether light effort keeps the
// facts and steps of a medium answer. Includes multi-step "how do I get X" items (the Nagakiba: Yura, invasions,
// Eleonora), which the lookup rule leaves out on purpose. Capture against a local server in capture mode (no AI call):
//   QC_EVAL_CAPTURE=scratchpad/model-compare/captured-effort.jsonl npm run dev
//   npx tsx scripts/evals/model-compare/effortCapture.ts
// then replay both levels: CAPTURED=scratchpad/model-compare/captured-effort.jsonl RESULTS=scratchpad/model-compare/results-effort.jsonl
//   MODELS=gemini-4-hydrogen@medium,gemini-4-hydrogen@low STOP_DOLLARS=2 npx tsx scripts/evals/model-compare/replay.ts
export const EFFORT: { id: string; game: string; appId?: number; q: string; lang?: string; note?: string }[] = [
  { id: 'e1', game: 'ELDEN RING', appId: 1245620, q: 'how do i get the nagakiba', note: 'multi-step (Yura, invasions, Eleonora)' },
  { id: 'e2', game: 'ELDEN RING', appId: 1245620, q: "How do I get Eleonora's Poleblade?" },
  { id: 'e3', game: 'ELDEN RING', appId: 1245620, q: 'What is the best strength longbow?' },
  { id: 'e4', game: 'ELDEN RING', appId: 1245620, q: 'What items can I get in the Abandoned Cave in Caelid?' },
  { id: 'e5', game: "Baldur's Gate 3", appId: 1086940, q: 'should i take the ritual dagger of shar' },
  { id: 'e6', game: "Baldur's Gate 3", appId: 1086940, q: "Doesn't Zhalk have a nice sword I can get?" },
  { id: 'e7', game: "Baldur's Gate 3", appId: 1086940, q: 'What is the best heavy armor?' },
  { id: 'e8', game: "Baldur's Gate 3", appId: 1086940, q: 'Should I take the Blood of Lathander?', note: 'written in the same style' },
  { id: 'e9', game: 'Red Dead Redemption 2', appId: 1174180, q: "Where exactly is Micah's Revolver in Chapter 1: Colter, and how do I get it?", note: 'trap: not in Chapter 1' },
  { id: 'e10', game: 'Resident Evil 2', appId: 883710, lang: 'German', q: 'wo kriege ich den kreuzschlüssel' },
  { id: 'e11', game: 'Cyberpunk 2077', appId: 1091500, q: 'Satori', note: 'bare name' },
  { id: 'e12', game: "Baldur's Gate 3", appId: 1086940, q: 'Barcus rucksack', note: 'bare name' },
  { id: 'e13', game: 'The Legend of Zelda: Ocarina of Time', q: "How do I open Lord Jabu-Jabu's mouth?" },
  { id: 'e14', game: 'DARK SOULS: REMASTERED', appId: 570940, q: 'how do i get to the guy with the big armor and dragon tooth as a weapon?' },
  { id: 'e15', game: 'The Legend of Zelda: Ocarina of Time', lang: 'Spanish', q: '¿Qué es lo mejor que se puede conseguir en el juego de cavar de Dampé en Kakariko?' },
];

if (process.argv[1]?.endsWith('effortCapture.ts')) {
  (async () => {
    for (const x of EFFORT) {
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
