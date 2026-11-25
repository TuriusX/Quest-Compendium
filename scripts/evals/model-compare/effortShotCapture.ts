// Hydrogen light vs medium, part 2: questions about the screen (owner OK, Nov 24 2026, $2 hard stop). Official Steam
// store screenshots stand in for player screenshots (in scratchpad/model-compare/shots-effort). Two have markers on.
// Capture as effortCapture.ts (QC_EVAL_CAPTURE=scratchpad/model-compare/captured-effort-shots.jsonl npm run dev), then
// replay with CAPTURED / RESULTS pointing at the -shots files and MODELS=gemini-4-hydrogen@medium,gemini-4-hydrogen@low.
import fs from 'fs';
const DIR = 'scratchpad/model-compare/shots-effort';
export const SHOT_QS: { id: string; game: string; appId?: number; q: string; image: string; markers?: boolean }[] = [
  { id: 'v1', game: 'ELDEN RING', appId: 1245620, image: 's1245620_4.jpg', q: 'What is this thing chasing me and can I beat it?' },
  { id: 'v2', game: 'ELDEN RING', appId: 1245620, image: 's1245620_5.jpg', q: 'What is this place and should I go in now?' },
  { id: 'v3', game: 'ELDEN RING', appId: 1245620, image: 's1245620_6.jpg', q: 'How do I beat this boss?' },
  { id: 'v4', game: "Baldur's Gate 3", appId: 1086940, image: 's1086940_2.jpg', q: 'Who is this and can I trust him?' },
  { id: 'v5', game: "Baldur's Gate 3", appId: 1086940, image: 's1086940_5.jpg', q: 'How do I deal with these guys?' },
  { id: 'v6', game: "Baldur's Gate 3", appId: 1086940, image: 's1086940_1.jpg', q: 'Where am I and is there a trader here?', markers: true },
  { id: 'v7', game: 'The Witcher 3: Wild Hunt', appId: 292030, image: 's292030_2.jpg', q: "What is this monster and what's it weak to?" },
  { id: 'v8', game: 'Hollow Knight', appId: 367520, image: 's367520_6.jpg', q: 'Which of my charms should I equip for boss fights?' },
  { id: 'v9', game: 'Hollow Knight', appId: 367520, image: 's367520_5.jpg', q: 'Where am I on the map and where should I go next?', markers: true },
  { id: 'v10', game: 'Hollow Knight', appId: 367520, image: 's367520_3.jpg', q: 'Who is this and what do I do here?' },
  { id: 'v11', game: 'Stardew Valley', appId: 413150, image: 's413150_6.jpg', q: 'What is this building and how do I fix it up?' },
  { id: 'v12', game: 'Cyberpunk 2077', appId: 1091500, image: 's1091500_1.jpg', q: "Who's the woman driving and can I miss this?" },
];

if (process.argv[1]?.endsWith('effortShotCapture.ts')) {
  (async () => {
    for (const x of SHOT_QS) {
      await new Promise((r) => setTimeout(r, 9500));
      const body: any = {
        question: x.q, history: [], aiMode: 'standard', isGameRunningLocally: true,
        activeGame: { name: x.game, ...(x.appId ? { appId: x.appId } : {}) }, language: 'English', markers: !!x.markers,
        answerModel: 'pro', evalId: x.id, done: [], playthrough: { choices: [], found: [], notes: '' },
        imageBase64: `data:image/jpeg;base64,${fs.readFileSync(`${DIR}/${x.image}`).toString('base64')}`,
      };
      const r = await fetch('http://localhost:3000/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer guest_dev_local' }, body: JSON.stringify(body) });
      const j: any = await r.json().catch(() => ({}));
      console.log(x.id, r.status, j.text === 'captured' ? 'captured' : String(j.text || j.error || '').slice(0, 120));
    }
    process.exit(0);
  })();
}
