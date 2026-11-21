// "What next" test set (owner, Nov 21 2026): follow-up questions inside a conversation, with the playthrough's save
// (src/utils/playthrough.ts SaveState), progress and place as the app sends them. n1 is the player's real BG3
// conversation (Dark Urge, Shadowheart only, after the Nautiloid). Run against a local server in capture mode:
//   QC_EVAL_CAPTURE=scratchpad/model-compare/captured-next.jsonl npx tsx server.ts
//   npx tsx scripts/evals/model-compare/nextCapture.ts
type Turn = { role: 'user' | 'assistant'; text: string };
type State = { who: string; party: string; story: string; open: string[] };
type Case = { id: string; game: string; appId?: number; q: string; lang?: string; history: Turn[]; place?: { name: string; story?: string; confirmed?: boolean }; done?: string[]; choices?: string[]; found?: string[]; state?: State; expect: string };
// Held-out cases (Nov 21 2026): written AFTER the route rule, to check a revised rule on games it wasn't tuned on.
export const HELD_OUT: Case[] = [
  {
    id: 'n13', game: 'The Elder Scrolls V: Skyrim Special Edition', appId: 489830, q: 'Gave Farengar the Dragonstone. What now?',
    history: [{ role: 'user', text: 'How do I open the claw door in Bleak Falls Barrow?' }, { role: 'assistant', text: 'Look at the back of the Golden Claw for the three animals, then set the rings to match from top to bottom and use the claw on the keyhole.' }],
    place: { name: 'Dragonsreach, Whiterun', story: 'Returned the Dragonstone', confirmed: true },
    done: ['Unbound', 'Before the Storm', 'Bleak Falls Barrow'],
    state: { who: 'Nord warrior, level 8', party: 'No follower yet', story: 'Main quest: brought the Dragonstone back to Farengar', open: [] },
    expect: 'Dragon Rising next (Irileth, Western Watchtower), warning it is a dragon fight and how to handle it; Lydia as housecarl/follower after it; Whiterun things worth doing (Companions at Jorrvaskr, merchants); then the Greybeards at High Hrothgar.',
  },
  {
    id: 'n14', game: 'The Legend of Zelda: Tears of the Kingdom', q: "I'm off the sky island and at Lookout Landing. Where should I go?",
    history: [{ role: 'user', text: 'How do I get the paraglider?' }, { role: 'assistant', text: 'Purah gives it to you at Lookout Landing once you reach her after the Great Sky Island.' }],
    place: { name: 'Lookout Landing', story: 'After the Great Sky Island', confirmed: true },
    done: ['Great Sky Island', 'Paraglider'],
    state: { who: 'Link', party: '', story: 'Reached Lookout Landing and got the paraglider from Purah', open: ['Investigate the regional phenomena'] },
    expect: 'Activate Lookout Landing Skyview Tower; the four regional phenomena with a sensible first pick (often Rito/Wind Temple or Zora) and why; nearby things worth doing first (shrines, Hateno / camera if relevant, armour); dangers like Gloom and Hyrule Field enemies; no starting from scratch.',
  },
  {
    id: 'n15', game: 'Mass Effect Legendary Edition', appId: 1328670, q: 'Just got the Normandy and became a Spectre. What should I do first?',
    history: [{ role: 'user', text: "Should I let Wrex kill Fist or not?" }, { role: 'assistant', text: 'Either works; Fist dies either way in most cases. Letting Wrex do it changes nothing major.' }],
    place: { name: 'Citadel', story: 'Became a Spectre, given the Normandy', confirmed: true },
    done: ['Eden Prime', 'Citadel: Expose Saren'], choices: ['Recruited Garrus, Wrex, Tali, Ashley and Kaidan'],
    state: { who: 'Commander Shepard, Soldier, ME1', party: 'Garrus, Wrex, Tali, Ashley, Kaidan', story: 'Mass Effect 1: just made a Spectre and given the Normandy', open: ['Find Liara T\'Soni', 'Stop Saren'] },
    expect: "Citadel side quests worth doing before leaving (Wrex's family armour, Garrus's Dr. Saleon lead, others) briefly; Therum first to recruit Liara (her role in the story); then Feros and Noveria in any order; no suggesting recruiting people already in the party.",
  },
  {
    id: 'n16', game: 'God of War', appId: 1593500, q: 'Beat the stranger at the house. Now what?',
    history: [{ role: 'user', text: 'How do I beat the stranger?' }, { role: 'assistant', text: 'Block his combos, punish after his ground-pound, and throw the axe while he recovers. In the last phase, dodge his rushes and counter.' }],
    place: { name: "Kratos's house", story: 'Beat the Stranger', confirmed: true },
    done: ['The Marked Trees', 'The Stranger'],
    state: { who: 'Kratos', party: 'Atreus', story: 'Path to the Mountain: just beat the Stranger at the house', open: ['Take Faye\'s ashes to the highest peak'] },
    expect: 'Head out with Atreus through the Wildwoods toward the River Pass; Brok\'s shop; the Witch (Freya) comes soon; dangers on the way (draugr, how to fight them) and what to upgrade; not repeating the Stranger fight.',
  },
  {
    id: 'n17', game: 'DARK SOULS III', appId: 374320, lang: 'Spanish', q: 'Ya maté a Vordt. ¿Qué hago ahora?',
    history: [{ role: 'user', text: '¿Cómo derroto a Vordt?' }, { role: 'assistant', text: 'Quédate detrás de sus patas traseras, golpea y esquiva hacia sus costados. Usa fuego si lo tienes; en la segunda fase ten cuidado con su carga.' }],
    place: { name: 'Muralla Alta de Lothric', story: 'Derrotó a Vordt', confirmed: true },
    done: ['Iudex Gundyr', 'Vordt of the Boreal Valley'],
    state: { who: 'Caballero, nivel 18', party: '', story: 'Derrotó a Vordt en la Muralla Alta', open: [] },
    expect: 'In Spanish. Nearby first: Greirat in the cell (Cell Key), the High Wall items worth grabbing; then the Undead Settlement via the Firelink tower, what is there (Siegward, Yoel, Curse-Rotted Greatwood) and dangers; Road of Sacrifices after.',
  },
  {
    id: 'n18', game: "Baldur's Gate 3", appId: 1086940, q: 'Made it to Last Light Inn. What next?',
    history: [{ role: 'user', text: 'How do I get through the shadow curse?' }, { role: 'assistant', text: 'Stay near light sources: the Moonlantern, Pixie or the lights at Last Light Inn keep the curse off you.' }],
    place: { name: 'Last Light Inn', story: 'Act 2: reached the Last Light Inn', confirmed: true },
    done: ['Act 1', 'Shadow-Cursed Lands entry'], choices: ['Sided with the Grove', 'Got the Pixie blessing'],
    state: { who: 'Tav, half-elf ranger', party: 'Shadowheart, Astarion, Karlach', story: 'Act 2: arrived at Last Light Inn under the Harpers', open: ['Find Ketheric Thorm\'s secret', 'Remove the tadpole'] },
    expect: "Talk to Jaheira (recruit her later), Isobel and the Harpers; warn that the attack on the inn needs Isobel protected; Reithwin Town and the House of Healing nearby; Moonrise Towers as the main objective and how to get in (True Soul ruse); uses the party given.",
  },
  {
    id: 'n19', game: 'Sekiro: Shadows Die Twice', appId: 814380, q: 'Beat Gyoubu. Where do I go now?',
    history: [{ role: 'user', text: "How do I beat Gyoubu?" }, { role: 'assistant', text: 'Use the grappling hook on him when he gallops to pull him off his horse, then hit him; keep close and use the Firecracker on the horse.' }],
    place: { name: 'Ashina Outskirts', story: 'Defeated Gyoubu Oniwa', confirmed: true },
    done: ['Gyoubu Oniwa'],
    state: { who: 'Wolf', party: '', story: 'Beat Gyoubu at the Ashina Castle Gate fortress', open: ['Rescue Kuro'] },
    expect: "Gyoubu's prayer bead and the Ashina Castle Gate idol; Hirata Estate via the Dilapidated Temple bell (Lady Butterfly there), or on toward Ashina Castle; Genichiro later; nearby the Sculptor's tools and prosthetic upgrades; the chained ogre / general warnings only if on the way.",
  },
  {
    id: 'n20', game: 'Persona 5 Royal', appId: 1687950, q: 'Finished the first palace. What should I focus on now?',
    history: [{ role: 'user', text: 'Should I fight the Shadow in the gym first?' }, { role: 'assistant', text: 'Clear the rooms in order; you need the Treasure route first.' }],
    place: { name: 'Shibuya', story: 'After Kamoshida\'s Palace', confirmed: true },
    done: ["Kamoshida's Palace"], choices: ['Ann and Ryuji joined'],
    state: { who: 'Joker', party: 'Ryuji, Morgana, Ann', story: 'May: finished the first palace', open: ['Mementos requests'] },
    expect: "Mementos and the first requests (Mishima); confidants open now (Ryuji, Morgana, Ann, Tae Takemi, Sojiro, the Velvet Room) and social stats; studying for exams; the next target (Madarame) arrives on its own; no spoilers past that.",
  },
  // Genres without a story route (owner, Nov 21: the rule must work for every game).
  {
    id: 'n21', game: 'Hades', appId: 1145360, q: "Just died to Meg again. What should I do now?",
    history: [{ role: 'user', text: 'Which weapon is easiest to start with?' }, { role: 'assistant', text: 'The Stygian Blade (sword) is a solid start: good damage and a simple special.' }],
    place: { name: 'House of Hades', story: 'Back home after a run', confirmed: true },
    done: [],
    state: { who: 'Zagreus', party: '', story: 'Early runs: keeps dying to Megaera at the end of Tartarus', open: [] },
    expect: 'Fits a roguelike: spend Darkness at the Mirror of Night (Death Defiance etc.), talk to NPCs and give Nectar, try boons that help vs Meg, tips for her fight; no fake "route" or recruits.',
  },
  {
    id: 'n22', game: 'Stardew Valley', appId: 413150, q: "It's day 10 of spring, what should I focus on?",
    history: [{ role: 'user', text: 'What crops make the most money in spring?' }, { role: 'assistant', text: 'Strawberries (from the Egg Festival) and cauliflower are strong; potatoes and kale are good early.' }],
    place: { name: 'Pelican Town farm', story: 'Spring, year 1, day 10', confirmed: true },
    done: [],
    state: { who: 'Farmer', party: '', story: 'Year 1 spring day 10, a few parsnip and potato fields', open: ['Community Center bundles'] },
    expect: 'Fits a life sim: the Egg Festival on spring 13 (strawberry seeds), mines progress, upgrading tools/watering, Community Center spring bundles, fishing, friendship; priorities not a quest route; no invented recruits.',
  },
  {
    id: 'n23', game: 'Minecraft', q: 'I have full iron armor and a few diamonds. What now?',
    history: [{ role: 'user', text: 'Where do diamonds spawn?' }, { role: 'assistant', text: 'Mostly deep underground, most common around Y -58; strip mine or explore caves down there.' }],
    place: { name: 'Overworld base', story: 'Survival, early-mid game', confirmed: true },
    done: [],
    state: { who: 'Survival player', party: '', story: 'Has iron armor, a few diamonds, a small base', open: [] },
    expect: 'Fits a sandbox: diamond pickaxe, enchanting table and bookshelves, obsidian and a Nether portal, blaze rods/ender pearls toward the End; dangers in the Nether; priorities not a story; no recruits.',
  },
  {
    id: 'n24', game: 'The Last of Us Part I', appId: 1888930, q: 'Just got out of the tunnels with Henry and Sam. Where now?',
    history: [{ role: 'user', text: 'Any tips for the sniper section in Pittsburgh?' }, { role: 'assistant', text: 'Stay in cover, move when he reloads, and push up the left side to get behind him.' }],
    place: { name: 'Pittsburgh outskirts', story: 'Left the sewers with Henry and Sam', confirmed: true },
    done: ['Pittsburgh', 'The Sewers'],
    state: { who: 'Joel', party: 'Ellie, Henry, Sam', story: 'Fall: through the sewers with Henry and Sam', open: [] },
    expect: 'Fits a linear game: just keep going to the suburbs, what to grab (supplies, upgrade parts, workbench), the fight ahead and how to handle it; brief; no invented side quests or recruits; no spoilers about Henry and Sam.',
  },
];
export const NEXT: Case[] = [
  {
    id: 'n1', game: "Baldur's Gate 3", appId: 1086940, q: 'I got Shadowheart on the ravaged beach. What do I do next?',
    history: [
      { role: 'user', text: 'What are these eldritch runes on the nautiloid? Can I read them?' },
      { role: 'assistant', text: 'You can read the Eldritch Runes if you pass the check, but they are of little consequence: a bit of mind flayer lore and some flavour, nothing you need to progress. Head on through the ship toward the helm.' },
    ],
    place: { name: 'Ravaged Beach', story: 'After the Nautiloid crash', confirmed: true },
    done: ['Nautiloid'], choices: ['Playing the Dark Urge'],
    state: { who: 'The Dark Urge', party: 'On their own so far', story: 'Act 1: woke up on the Ravaged Beach after the Nautiloid crashed', open: ['Find a way to remove the tadpole'] },
    expect: 'Treats Shadowheart as the only companion (no "bring companions from camp"); never mentions the rune; before the Grove, points to recruiting Astarion, Gale and Lae\'zel nearby and warns about the intellect devourers at the Overgrown Ruins (and a way around them); then the Emerald Grove and Nettie.',
  },
  {
    id: 'n2', game: "Baldur's Gate 3", appId: 1086940, q: "Okay I'm inside the grove now. What should I do next?",
    history: [
      { role: 'user', text: 'How do I save Arabella?' },
      { role: 'assistant', text: "Go to Kagha in the Druids' Chambers and talk her out of it, or free Arabella yourself before the Rite. Persuade or intimidate Kagha, then Arabella runs back to her parents." },
    ],
    place: { name: 'Emerald Grove', story: 'Inside the Grove after the goblin raid', confirmed: true },
    done: ['Nautiloid', 'Ravaged Beach', 'Defend the Emerald Grove gate', 'Save Arabella'], choices: ['Saved Arabella from Kagha'],
    state: { who: 'Tav, half-elf ranger', party: "Shadowheart, Astarion and Lae'zel (in party), Gale at camp", story: 'Act 1: defended the Grove gate, saved Arabella', open: ['Find a healer for the tadpole', 'Rescue Halsin'] },
    expect: "Uses the party as given; points to Wyll and Karlach (recruitment), Nettie, Zevlor's Save the Refugees quest and Halsin as the next lead (goblin camp via the Blighted Village); no hedging about who is recruited.",
  },
  {
    id: 'n3', game: 'ELDEN RING', appId: 1245620, q: 'Finally beat Margit. What now?',
    history: [
      { role: 'user', text: 'Any tips for Margit?' },
      { role: 'assistant', text: "Use Margit's Shackle from the Imprisoned Merchant (Murkwater Cave area) to pin him twice, summon spirit ashes, and punish after his delayed combos." },
      { role: 'user', text: 'Where do I get the Margit\'s Shackle again?' },
      { role: 'assistant', text: 'Buy it from Patches in Murkwater Cave, or from the Imprisoned Merchant beneath the Fort Haight area in the Limgrave catacombs.' },
    ],
    place: { name: 'Stormhill', story: 'Just beat Margit at Castleward Tunnel', confirmed: true },
    done: ['Margit, the Fell Omen'], found: ["Margit's Shackle"],
    state: { who: 'Vagabond, level 28', party: 'Spirit ashes: Lone Wolf Ashes', story: 'Beat Margit; Stormveil Castle is next on the main path', open: ['Stormveil Castle and Godrick'] },
    expect: 'Stormveil route (main gate vs side path, Gostoc), what to prepare, optional areas worth doing first; does not talk about Margit\'s Shackle again.',
  },
  {
    id: 'n4', game: 'The Witcher 3: Wild Hunt', appId: 292030, q: 'I just finished Family Matters. Where do I go next?',
    history: [
      { role: 'user', text: 'Should I kill the botchling or turn it into a lubberkin?' },
      { role: 'assistant', text: 'Turn it into a lubberkin: carry it to the Baron\'s old house and perform the ritual. It gives the better outcome and a little extra experience.' },
    ],
    place: { name: 'Crow\'s Perch', story: 'Finished Family Matters', confirmed: true },
    done: ['White Orchard', 'Family Matters'], choices: ['Turned the botchling into a lubberkin'],
    state: { who: 'Geralt, level 9', party: '', story: 'Velen: helped the Bloody Baron find Anna, the Baron gone to find her', open: ['Ladies of the Wood', 'Find Ciri'] },
    expect: 'Ladies of the Wood in Velen (Crookback Bog) vs Novigrad (Pyres of Novigrad, Triss) vs Skellige, with a sensible order and level advice; not starting from Velen basics.',
  },
  {
    id: 'n5', game: 'Red Dead Redemption 2', appId: 1174180, q: 'Done with that mission, what should I do next?',
    history: [
      { role: 'user', text: 'How do I lose the O\'Driscolls in Who Is Not Without Sin?' },
      { role: 'assistant', text: 'That mission is with the Reverend, not the O\'Driscolls. If you are being chased after it, ride out of the red zone and hide in the trees until they lose you.' },
    ],
    place: { name: 'Horseshoe Overlook', story: 'Chapter 2', confirmed: true },
    done: ['Chapter 1: Colter', 'Who Is Not Without Sin'],
    state: { who: 'Arthur Morgan', party: '', story: 'Chapter 2: camp at Horseshoe Overlook', open: [] },
    expect: 'Chapter 2 story missions and worthwhile strangers/side activity around Valentine (no invented quests); concise order.',
  },
  {
    id: 'n6', game: 'Hollow Knight', appId: 367520, q: 'Got the Mantis Claw! Where to next?',
    history: [
      { role: 'user', text: 'Where do I find the Mantis Claw?' },
      { role: 'assistant', text: 'In Mantis Village at the bottom of Fungal Wastes. Walk past the mantis warriors (they stay friendly until you fight their lords) and the Claw is on a ledge near the village entrance.' },
    ],
    place: { name: 'Mantis Village', story: 'Just got the Mantis Claw', confirmed: true },
    done: ['False Knight', 'Hornet (Greenpath)', 'Mothwing Cloak', 'Mantis Claw'],
    state: { who: 'The Knight', party: '', story: 'Explored Forgotten Crossroads, Greenpath and Fungal Wastes', open: ['City of Tears', 'Mantis Lords (optional)'] },
    expect: 'City of Tears route (and the Mantis Lords as optional, Crystal Peak or others unlocked by the claw), nothing already done.',
  },
  {
    id: 'n7', game: 'Cyberpunk 2077', appId: 1091500, q: 'So the heist went bad and I woke up in the landfill. What now?',
    history: [
      { role: 'user', text: 'Should I take the Flathead with me during the heist?' },
      { role: 'assistant', text: 'Yes, take the Flathead: it makes the heist easier and you keep it.' },
    ],
    place: { name: 'Watson', story: 'After The Heist and Playing for Time', confirmed: false },
    done: ['The Heist'],
    state: { who: 'V, Street Kid', party: '', story: 'Act 1 over: the Relic heist went wrong, Jackie is gone', open: [] },
    expect: 'Act 2 leads (Takemura and Down on the Street, Judy, Panam), side jobs and Jackie\'s funeral (Heroes); no Flathead talk.',
  },
  {
    id: 'n8', game: 'FINAL FANTASY VI', appId: 1173820, q: 'I just got off the island. What should I do next?',
    history: [
      { role: 'user', text: 'How do I save Cid?' },
      { role: 'assistant', text: 'Feed Cid only the fast fish (the ones that swim quickly), not the slow or rotten ones, until he recovers.' },
    ],
    place: { name: 'Albrook', story: 'World of Ruin, just left the Solitary Island with Celes', confirmed: true },
    done: ['World of Balance', 'Solitary Island'],
    state: { who: 'Celes', party: 'Celes (alone)', story: 'World of Ruin: woke on the Solitary Island a year after the world fell', open: ['Find the others'] },
    expect: 'Albrook, then Tzen (Sabin), Mobliz, Nikeah and the Falcon route; regaining party members in order; no Cid fish talk.',
  },
  {
    id: 'n9', game: 'Clair Obscur: Expedition 33', appId: 1903340, q: 'The prologue is done. What should I do next?',
    history: [],
    place: { name: 'Spring Meadows', story: 'After the Lumière prologue', confirmed: true },
    done: ['Prologue'],
    state: { who: 'Gustave', party: 'Gustave (alone)', story: 'Act 1: landed on the continent; the expedition was attacked', open: ['Find the rest of the expedition'] },
    expect: 'Spring Meadows: find Lune/regroup, what to pick up there, the route ahead; plain about who is in the party.',
  },
  {
    id: 'n10', game: "Baldur's Gate 3", appId: 1086940, q: 'Já falei com o Zevlor e salvei a Arabella. O que faço agora?', lang: 'Portuguese',
    history: [
      { role: 'user', text: 'Onde encontro a Nettie?' },
      { role: 'assistant', text: 'A Nettie fica na biblioteca dos druidas, nas Câmaras dos Druidas do Bosque Esmeralda.' },
    ],
    place: { name: 'Emerald Grove', story: 'In the Grove', confirmed: true },
    done: ['Nautiloid', 'Ravaged Beach', 'Save Arabella'], choices: ['Salvou a Arabella'],
    state: { who: 'Lae\'zel origin', party: 'Shadowheart, Astarion, Gale (in party)', story: 'Ato 1: dentro do Bosque Esmeralda', open: ['Encontrar Halsin'] },
    expect: 'Answers in Portuguese; Nettie if not done, Wyll/Karlach, Halsin lead via the Blighted Village to the goblin camp.',
  },
  {
    id: 'n11', game: 'The Witcher 3: Wild Hunt', appId: 292030, q: 'Ich habe den Greif getötet. Was soll ich als Nächstes tun?', lang: 'German',
    history: [],
    place: { name: 'White Orchard', story: 'After The Beast of White Orchard', confirmed: true },
    done: ['Lilac and Gooseberries', 'The Beast of White Orchard'],
    state: { who: 'Geralt', party: '', story: 'White Orchard: killed the griffin for the Nilfgaardians', open: [] },
    expect: 'Answers in German; report to the commander, then Vizima and the Emperor (Imperial Audience), White Orchard side quests worth doing first.',
  },
  {
    id: 'n12', game: 'ELDEN RING', appId: 1245620, q: 'Okay I made it to Liurnia. Where should I go first?',
    history: [
      { role: 'user', text: 'Where is the key for the Stormveil Castle chest in the Limgrave catacomb?' },
      { role: 'assistant', text: 'That chest needs a Stonesword Key; you can buy them from the Twin Maiden Husks at the Roundtable Hold.' },
    ],
    place: { name: 'Liurnia of the Lakes', story: 'After Godrick', confirmed: true },
    done: ['Stormveil Castle', 'Godrick the Grafted'],
    state: { who: 'Samurai, level 40', party: '', story: 'Beat Godrick, crossed into Liurnia', open: ['Academy of Raya Lucaria'] },
    expect: 'Liurnia route (Lake-Facing Cliffs, Academy Glintstone Key, Ranni at the Church of Elleh/Three Sisters, Caria Manor), drops the Stonesword Key topic silently.',
  },
];

if (/nextCapture\.ts$/.test(process.argv[1] || '')) {
  const only = process.argv.slice(2);
  for (const x of [...NEXT, ...HELD_OUT].filter((q) => !only.length || only.includes(q.id))) {
    await new Promise((r) => setTimeout(r, 9500));
    const body: any = {
      question: x.q, history: x.history, aiMode: 'standard', isGameRunningLocally: true,
      activeGame: { name: x.game, ...(x.appId ? { appId: x.appId } : {}) }, language: x.lang || 'English', markers: false,
      answerModel: 'pro', evalId: x.id,
      ...(x.place ? { place: { name: x.place.name, confirmed: x.place.confirmed === true, ...(x.place.story ? { story: x.place.story, storyConfirmed: x.place.confirmed === true } : {}) } } : {}),
      done: x.done || [],
      playthrough: { choices: x.choices || [], found: x.found || [], notes: '', ...(x.state ? { state: x.state } : {}) },
    };
    const r = await fetch('http://localhost:3000/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer guest_dev_local' }, body: JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({}));
    console.log(x.id, r.status, j.text === 'captured' ? 'captured' : String(j.text || j.error || '').slice(0, 120));
  }
  process.exit(0);
}
