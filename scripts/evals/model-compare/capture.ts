// Step 1 of a model comparison (README.md). Sends the 20 test questions to the local server in capture mode (QC_EVAL_CAPTURE): the server builds the real Pro
// answer request (system prompt, guide context, search tools) and writes it to captured.jsonl without calling a model.
import fs from 'fs';
const DIR = 'scratchpad/model-compare';
// The screenshot questions use official IGDB screenshots (downloaded once into DIR).
const SHOTS: Record<string, string> = { 'rdr2.jpg': 'sctkgp', 'bg3.jpg': 'scxtb7', 'er.jpg': 'scu5kx' };
async function img(f: string) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = `${DIR}/${f}`;
  if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from(await (await fetch(`https://images.igdb.com/igdb/image/upload/t_1080p/${SHOTS[f]}.jpg`)).arrayBuffer()));
  return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
}
export const QUESTIONS: { id: string; real: boolean; game: string; appId?: number; q: string; image?: string; lang?: string }[] = [
  // Real player questions (anonymized), as asked.
  { id: 'r1', real: true, game: 'The Witcher 3: Wild Hunt', appId: 292030, q: 'Where are the places of power on the map here?' },
  { id: 'r2', real: true, game: 'RuneScape: Dragonwilds', q: 'this is dragonwilds monktongue enchanted twig part' },
  { id: 'r3', real: true, game: 'Detroit: Become Human', appId: 1222140, q: 'ne yapmalıyım türkçe cevapla' },
  { id: 'r4', real: true, game: 'Metroid Prime Remastered', q: 'What should I do next?' },
  { id: 'r5', real: true, game: "Baldur's Gate 3", appId: 1086940, q: 'Where can I find the Soul Coin here?' },
  { id: 'r6', real: true, game: 'PUBG MOBILE', q: 'gameloop for pubg mobile' },
  // Typical questions in the same style (written for the test), across our guide games.
  { id: 'c1', real: false, game: 'Red Dead Redemption 2', appId: 1174180, q: 'How do I find the Legendary Bear in chapter 2 and what do I get for it?' },
  { id: 'c2', real: false, game: "Baldur's Gate 3", appId: 1086940, q: 'Should I side with the tieflings or the goblins at the grove? What do I lose either way?' },
  { id: 'c3', real: false, game: "Baldur's Gate 3", appId: 1086940, q: 'How do I beat Ketheric Thorm at Moonrise Towers?' },
  { id: 'c4', real: false, game: 'ELDEN RING', appId: 1245620, q: "Can I miss Ranni's questline if I go to the Mountaintops of the Giants first?" },
  { id: 'c5', real: false, game: 'ELDEN RING', appId: 1245620, q: 'Where do I go after beating Godrick?' },
  { id: 'c6', real: false, game: 'The Witcher 3: Wild Hunt', appId: 292030, q: 'Which choices in the Bloody Baron quest change what happens to Anna and the Baron?' },
  { id: 'c7', real: false, game: 'FINAL FANTASY VI', appId: 1173820, q: 'Where do I get the Genji Glove and is it missable?' },
  { id: 'c8', real: false, game: 'Hollow Knight', appId: 367520, q: 'How do I get into the City of Tears?' },
  { id: 'c9', real: false, game: 'Cyberpunk 2077', appId: 1091500, q: 'What do I need to do to get the Temperance ending?' },
  { id: 'c10', real: false, game: 'Hades II', appId: 1145350, q: 'How do I unlock the second weapon?' },
  { id: 'c11', real: false, game: 'Clair Obscur: Expedition 33', appId: 1903340, q: 'Is there anything I can miss for good in Act 1?' },
  // With a screenshot (official IGDB screenshots standing in for player screenshots).
  { id: 's1', real: false, game: 'Red Dead Redemption 2', appId: 1174180, q: 'Where am I and is there anything worth doing nearby?', image: 'rdr2.jpg' },
  { id: 's2', real: false, game: "Baldur's Gate 3", appId: 1086940, q: 'Who is this and is there anything I should do here?', image: 'bg3.jpg' },
  { id: 's3', real: false, game: 'ELDEN RING', appId: 1245620, q: 'What is this castle and should I go in now?', image: 'er.jpg' },
];

if (/capture\.ts$/.test(process.argv[1] || '')) {
  const only = process.argv.slice(2);
  for (const x of QUESTIONS.filter((q) => !only.length || only.includes(q.id))) {
    await new Promise((r) => setTimeout(r, 9500));
    const body: any = {
      question: x.q, history: [], aiMode: 'standard', isGameRunningLocally: true,
      activeGame: { name: x.game, ...(x.appId ? { appId: x.appId } : {}) }, language: 'English', markers: false,
      model: 'pro', preferredModel: 'pro', evalId: x.id, ...(x.image ? { imageBase64: await img(x.image) } : {}),
    };
    const r = await fetch('http://localhost:3000/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer guest_dev_local' }, body: JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({}));
    console.log(x.id, r.status, j.text === 'captured' ? 'captured' : String(j.text || j.error || '').slice(0, 120));
  }
  process.exit(0);
}
