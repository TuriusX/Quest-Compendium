import { SteamGameData } from '../types';

export const POPULAR_STEAM_GAMES: SteamGameData[] = [
  {
    name: 'Elden Ring',
    appId: 1245620,
    headerImage: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
    genre: 'Action RPG / Soulslike',
    developer: 'FromSoftware Inc.',
    patchNotes: [
      '[Patch 1.13] General weapon poise adjustments and PvP damage scaling balance.',
      '[Patch 1.12.3] Shadow of the Erdtree DLC scaling tweaks for Scadutree Blessings.',
      '[Patch 1.10] Critical hit damage improvements across Colossal weapons.'
    ],
    achievements: [
      {
        apiname: 'ACH_ELDEN_RING',
        name: 'Elden Ring',
        description: 'Obtained all achievements across the Lands Between.',
        unlocked: true,
        unlockDate: 'Nov 14, 2025',
        rarity: 8.9,
        tier: 'gold',
        icon: '👑'
      },
      {
        apiname: 'ACH_MALENIA',
        name: 'Malenia, Blade of Miquella',
        description: 'Defeated the Goddess of Rot in the Haligtree Roots.',
        unlocked: true,
        unlockDate: 'Oct 22, 2025',
        rarity: 9.8,
        tier: 'gold',
        icon: '🌸'
      },
      {
        apiname: 'ACH_RANNI_ENDING',
        name: 'Age of the Stars',
        description: 'Achieved the Age of the Stars ending with Lunar Princess Ranni.',
        unlocked: true,
        unlockDate: 'Oct 15, 2025',
        rarity: 22.4,
        tier: 'silver',
        icon: '🌙'
      },
      {
        apiname: 'ACH_RADAHN',
        name: 'Starscourge Radahn',
        description: 'Defeated General Radahn during the festival of Redmane Castle.',
        unlocked: true,
        unlockDate: 'Sep 30, 2025',
        rarity: 44.1,
        tier: 'bronze',
        icon: '⚔️'
      },
      {
        apiname: 'ACH_MARGIT',
        name: 'Margit, the Fell Omen',
        description: 'Defeated Margit, the Fell Omen on the way to Stormveil Castle.',
        unlocked: true,
        unlockDate: 'Sep 12, 2025',
        rarity: 71.5,
        tier: 'bronze',
        icon: '🛡️'
      },
      {
        apiname: 'ACH_LEGENDARY_ARMAMENTS',
        name: 'Legendary Armaments',
        description: 'Acquired all 9 legendary weapons (Bolt of Gransax, Dark Moon GS, etc).',
        unlocked: false,
        rarity: 7.2,
        tier: 'gold',
        icon: '🗡️'
      },
      {
        apiname: 'ACH_FRENZIED_FLAME',
        name: 'Lord of the Frenzied Flame',
        description: 'Achieved the Lord of the Frenzied Flame ending.',
        unlocked: false,
        rarity: 14.8,
        tier: 'silver',
        icon: '🔥'
      }
    ],
    totalAchievements: 42,
    unlockedAchievements: 38
  },
  {
    name: "Baldur's Gate 3",
    appId: 1086940,
    headerImage: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
    genre: 'CRPG / Turn-Based D&D',
    developer: 'Larian Studios',
    patchNotes: [
      '[Patch 7] Official modding toolkit integration and new evil ending cinematics.',
      '[Hotfix 28] Fixed companion dialogue flag desync in Act 3 Upper City.',
      '[Patch 6] Improved party kissing animations and Honor Mode combat tweaks.'
    ],
    achievements: [
      {
        apiname: 'ACH_FOEHAMMER',
        name: 'Foehammer',
        description: 'Complete the entire game in Honor Mode with single-save rules.',
        unlocked: false,
        rarity: 4.6,
        tier: 'gold',
        icon: '💀'
      },
      {
        apiname: 'ACH_CRITICAL_HIT',
        name: 'Critical Hit',
        description: 'Complete the game on Tactician difficulty.',
        unlocked: true,
        unlockDate: 'Dec 02, 2025',
        rarity: 12.1,
        tier: 'silver',
        icon: '🎯'
      },
      {
        apiname: 'ACH_SAVE_ALL_TIEFLINGS',
        name: 'Leave No One Behind',
        description: 'Save every tiefling refugee you can throughout the entire story.',
        unlocked: false,
        rarity: 6.8,
        tier: 'gold',
        icon: '🤝'
      },
      {
        apiname: 'ACH_SCRATCH_FETCH',
        name: 'Fetch Quest',
        description: 'Play fetch with Scratch the loyal dog in your camp.',
        unlocked: true,
        unlockDate: 'Aug 19, 2025',
        rarity: 58.3,
        tier: 'bronze',
        icon: '🐕'
      }
    ],
    totalAchievements: 54,
    unlockedAchievements: 39
  },
  {
    name: 'Cyberpunk 2077',
    appId: 1091500,
    headerImage: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80',
    genre: 'Action RPG / Cyberpunk',
    developer: 'CD PROJEKT RED',
    patchNotes: [
      '[Patch 2.13] AMD FSR 3 frame generation support with Intel XeSS upgrades.',
      '[Patch 2.1] Night City Metro rapid transit system & hangout events.'
    ],
    achievements: [
      {
        apiname: 'ACH_CITY_LEGEND',
        name: 'Never Fade Away',
        description: 'Reach maximum Street Cred in Night City.',
        unlocked: true,
        unlockDate: 'Jan 10, 2026',
        rarity: 32.5,
        tier: 'bronze',
        icon: '🏙️'
      },
      {
        apiname: 'ACH_DON_FEAR_REAPER',
        name: 'The Sun',
        description: 'Become a legend of the Afterlife.',
        unlocked: true,
        unlockDate: 'Feb 04, 2026',
        rarity: 9.4,
        tier: 'gold',
        icon: '☀️'
      },
      {
        apiname: 'ACH_ROUGH_LANDING',
        name: 'Rough Landing',
        description: 'Perform a Berserk landing kill from high above.',
        unlocked: false,
        rarity: 18.2,
        tier: 'silver',
        icon: '💥'
      }
    ],
    totalAchievements: 45,
    unlockedAchievements: 32
  },
  {
    name: 'Hollow Knight',
    appId: 367520,
    headerImage: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=600&auto=format&fit=crop&q=80',
    genre: 'Metroidvania / Soulslike',
    developer: 'Team Cherry',
    patchNotes: [
      '[Update 1.5] Controller rumble latency fixes and resolution scaling.'
    ],
    achievements: [
      {
        apiname: 'ACH_PANTHEON_5',
        name: 'Embrace the Void',
        description: 'Ascend the Pantheon of Hallownest and take your place atop.',
        unlocked: false,
        rarity: 4.1,
        tier: 'gold',
        icon: '🌌'
      },
      {
        apiname: 'ACH_STEEL_SOUL',
        name: 'Steel Soul',
        description: 'Finish the game in Steel Soul permadeath mode.',
        unlocked: false,
        rarity: 5.7,
        tier: 'gold',
        icon: '⚔️'
      },
      {
        apiname: 'ACH_DREAM_NO_MORE',
        name: 'Dream No More',
        description: 'Defeat the Radiance and consume the light.',
        unlocked: true,
        unlockDate: 'Dec 18, 2025',
        rarity: 19.3,
        tier: 'silver',
        icon: '✨'
      }
    ],
    totalAchievements: 63,
    unlockedAchievements: 47
  }
];

export const DEFAULT_BOOKMARKS = [
  { name: 'GameFAQs', url: 'https://gamefaqs.gamespot.com', category: 'Guides & Walkthroughs' },
  { name: 'Steam Community Hub', url: 'https://steamcommunity.com', category: 'Official Hubs' },
  { name: 'Fextralife Wiki', url: 'https://eldenring.wiki.fextralife.com', category: 'RPG Wikis' },
  { name: 'MapGenie Interactive Maps', url: 'https://mapgenie.io', category: 'Game Maps' },
  { name: 'IGN Walkthroughs', url: 'https://www.ign.com/wikis', category: 'Guides' },
  { name: 'PCPartPicker / Settings', url: 'https://pcpartpicker.com', category: 'Hardware Optimization' }
];
