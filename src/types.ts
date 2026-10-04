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
/** One quest-log takeaway from an answer: a step to take, a choice to make, or a warning (shown in amber). */
export interface QuestStep {
  kind: 'step' | 'choice' | 'warning';
  text: string;
  /** The sentence of the answer it comes from (its details on the quest log). */
  detail?: string;
}

export interface ScreenPoint {
  x: number;
  y: number;
  label: string;
  /** Which exact object it is among similar ones ("lower-right barrel of the three"). */
  where?: string;
  /** Found later by an area check (not on the original screenshot). */
  fromArea?: boolean;
  /** What kind of thing it is: weapon, armor, consumable, key, quest, lore, secret, character, enemy, danger, action, place. */
  category?: string;
  /** One short line: what it is and why it matters. */
  note?: string;
  /** A sentence or two more, shown when the player expands the item. */
  detail?: string;
  /** Lost for good if the player moves on (the objectives tracker warns about it). */
  missable?: boolean;
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
  /** A short quest-log name for what the player is doing (the objectives tracker's title). */
  title?: string;
  /** The 1-4 things to keep in front of the player (the quest log's "From your last answer"), most important first. */
  steps?: QuestStep[];
  /** Steps the player ticked on the quest log, by index. */
  doneSteps?: number[];
  /** Other items in the same area, looked for as the player walks (desktop). */
  nearby?: NearbyItem[];
  /** Markers the player checked off as collected (their on-screen markers are hidden). */
  donePoints?: number[];
  /** Where the AI thinks the player is when it answered, and whether it's sure. */
  place?: PlaceGuess;
  /** The place the player picked for this answer (hides the "where are you?" buttons). */
  placeChosen?: string;
  /** The story point the player picked for this answer. */
  storyChosen?: string;
  /** Markers the close-up check removed because it couldn't see them on screen (shown as a note under the list). */
  removedMarkers?: string[];
  /** How many facts this answer taught (or re-confirmed for) the game knowledge base. */
  factsSaved?: number;
  /** Corrections to the guide this answer made (candidates to verify): "That's right" on it confirms their area. */
  correctionIds?: string[];
}

export interface PlaceGuess {
  name: string;
  sure: boolean;
  /** Other likely places, for one-tap correction. */
  options?: string[];
  /** Where in the story the AI thinks the player is (places are often visited more than once). */
  story?: string;
  storySure?: boolean;
  storyOptions?: string[];
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
  /** Where the player is in this game. confirmed = the player picked or said it, not just the AI's guess. */
  place?: { name: string; confirmed: boolean; story?: string; storyConfirmed?: boolean };
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
  language?: 'en' | 'es' | 'pt' | 'de' | 'fr' | 'ru' | 'ja' | 'ko' | 'zh';
  /** Controller support (on by default) and the held chord that shows / hides the desktop overlay. */
  controllerEnabled?: boolean;
  controllerToggle?: 'back+start' | 'ls+rs' | 'lb+rb+back' | 'off';
  /** Desktop: screenshot the game just before the overlay opens (for games that pause when they lose focus). */
  snapshotOnOpen?: boolean;
  /**
   * On-screen markers (Settings, experimental, on by default): the AI points at things in the screenshot. Off: answers
   * aren't asked for markers (no tokens spent), no marker window, no markers card or checklist under answers. Markers
   * never feed the quest log (its "From your last answer" comes from the answer's steps).
   */
  showPointersOnScreen?: boolean;
  /** Desktop: markers stay on the things they point at while the game scrolls. */
  stickyPointers?: boolean;
  /** Desktop: markers show up in screenshots and screen recordings. */
  markersInRecordings?: boolean;
  /** Desktop: how long markers stay on screen, in seconds (0 = until hidden or the scene changes). */
  markerLifetime?: number;
  /** Where the player is in each game (keyed by game name, lowercase), so a new compendium starts from it. */
  gameProgress?: Record<string, { name: string; confirmed: boolean; story?: string; storyConfirmed?: boolean }>;
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
