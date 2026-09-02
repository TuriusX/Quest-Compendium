export type AiMode = 'standard' | 'roleplay' | 'minmax';

export type ColorTheme = 'purple' | 'red' | 'cyan' | 'blue' | 'amber' | 'luigi' | 'masterchief' | 'gold' | 'pink' | 'silver';

export type DockPosition = 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left' | 'undocked';

export type ChatFont = 'segoe' | 'pixel' | 'fantasy' | 'lore' | 'code';

export interface Achievement {
  apiname: string;
  name: string;
  description: string;
  icon?: string;
  unlocked: boolean;
  unlockDate?: string | null;
  rarity?: number | null; // e.g. 8.4%
  tier: 'gold' | 'silver' | 'bronze';
}

export interface SteamGameData {
  name: string;
  appId: number;
  headerImage?: string;
  genre?: string;
  developer?: string;
  patchNotes?: string[];
  achievements?: Achievement[];
  totalAchievements?: number;
  unlockedAchievements?: number;
  isAutoDetected?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  imageUrl?: string;
  modelUsed?: string;
  audioBase64?: string;
  isStreaming?: boolean;
}

export interface PersonalQuest {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}

export interface GameTab {
  id: string;
  name: string;
  icon?: string;
  activeSteamGame?: SteamGameData | null;
  messages: ChatMessage[];
  notes: string;
  personalQuests?: PersonalQuest[];
  createdAt: number;
  lastActive: number;
}

export interface BrowserTab {
  id: string;
  name: string;
  url: string;
}

export interface FavoriteBookmark {
  name: string;
  url: string;
  category?: string;
}

export interface AppSettings {
  aiMode: AiMode;
  theme: ColorTheme;
  chatFont: ChatFont;
  chatFontSize: number;
  tabFontSize: number;
  soundEnabled: boolean;
  dockPosition: DockPosition;
  windowOpacity: number;
  steamId: string;
  steamName?: string;
  steamAvatar?: string;
  ttsVoice: 'alloy' | 'ash' | 'coral' | 'echo' | 'fable' | 'nova' | 'onyx' | 'sage' | 'shimmer';
  customApiKey?: string;
  openAiApiKey?: string;
  hideAppShortcut: string;
  voiceInputShortcut: string;
}
