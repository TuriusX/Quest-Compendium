export type AiMode = 'standard' | 'roleplay' | 'minmax';

export type ColorTheme = 'purple' | 'red' | 'cyan' | 'blue' | 'amber' | 'luigi' | 'masterchief' | 'gold' | 'pink' | 'silver';

export type UiStyle = 'lofi' | 'classic';

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

/** A spot the AI pointed at on the screenshot (0-1 fractions from the top-left) with a short label. */
export interface ScreenPoint {
  x: number;
  y: number;
  label: string;
  /** Which exact object it is among similar ones ("lower-right barrel of the three"). */
  where?: string;
  /** Found later by an area check (not on the original screenshot). */
  fromArea?: boolean;
}

/** Something the AI knows is in this area but wasn't on screen yet. */
export interface NearbyItem {
  label: string;
  hint: string;
  /** On the map the player is on (can scroll into view), vs inside another building, floor or room. */
  onMap?: boolean;
  found?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  imageUrl?: string;
  bannerImageUrl?: string;
  modelUsed?: string;
  audioBase64?: string;
  isStreaming?: boolean;
  /** On-screen pointers for the screenshot this answer is about. */
  points?: ScreenPoint[];
  /** Other items in the same area, looked for as the player walks (desktop). */
  nearby?: NearbyItem[];
  /** Markers the player checked off as collected (their on-screen markers are hidden). */
  donePoints?: number[];
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
  uiScale?: number;
  steamId: string;
  steamName?: string;
  steamAvatar?: string;
  ttsVoice: string;
  customApiKey?: string;
  openAiApiKey?: string;
  hideAppShortcut: string;
  voiceInputShortcut: string;
  autoScreenshotShortcut: string;
  enableThematicBanners?: boolean;
  /** Interface style: 'lofi' (pixel art, default) or 'classic' (the original look). */
  uiStyle?: UiStyle;
  /** Interface + AI answer language. */
  language?: 'en' | 'es' | 'pt';
  /** Controller support (on by default) and the held chord that shows / hides the desktop overlay. */
  controllerEnabled?: boolean;
  controllerToggle?: 'back+start' | 'ls+rs' | 'lb+rb+back' | 'off';
  /** Desktop: screenshot the game just before the overlay opens (for games that pause when they lose focus). */
  snapshotOnOpen?: boolean;
  /** Desktop: draw the AI's pointers over the game when an answer arrives. */
  showPointersOnScreen?: boolean;
  /** Desktop: markers stay on the things they point at while the game scrolls. */
  stickyPointers?: boolean;
  /** Desktop: markers show up in screenshots and screen recordings. */
  markersInRecordings?: boolean;
  /** Desktop: how long markers stay on screen, in seconds (0 = until hidden or the scene changes). */
  markerLifetime?: number;
}

export interface SyncEventLog {
  id: string;
  timestamp: number;
  timeFormatted: string;
  type: string;
  details: string;
  isError?: boolean;
}

export interface CloudSyncDiagnostics {
  accountEmail: string | null;
  uid: string | null;
  uidLast6: string | null;
  subscriptionStatus: string;
  isInitializing: boolean;
  isListenerAttached: boolean;
  lastSnapshotTime: number | null;
  lastSnapshotFromCache: boolean | null;
  lastSnapshotPendingWrites: boolean | null;
  localTabsCount: number;
  cloudTabsCount: number | null;
  estimatedUploadSizeBytes: number;
  estimatedUploadSizeKb: number;
  lastSuccessfulWriteTime: number | null;
  lastWriteError: { code?: string; message: string; timestamp: number } | null;
  eventLogs: SyncEventLog[];
  copyDiagnostics: () => Promise<boolean>;
  getSummaryText: () => string;
  triggerSyncNow?: () => Promise<boolean>;
  addEvent?: (type: string, details: string, isError?: boolean) => void;
}
