import React, { useState, useRef, useEffect, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { ModelToggle } from './ModelToggle';
import { QuestionsPill } from './QuestionsPill';
import { balancesOf, modelKind, readAnswerModel, saveAnswerModel, startingModel, type AnswerModel } from '../utils/answerModel';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Send, 
  Camera, 
  Upload, 
  Mic, 
  MicOff, 
  Volume2, 
  Square, 
  Loader2,
  X, 
  Sparkles, 
  BookmarkPlus, 
  Copy, 
  Check, 
  Eye, 
  Maximize2,
  ChevronDown,
  Layers,
  Bot,
  User,
  ExternalLink,
  Flame,
  Info,
  AlertTriangle,
  AlertCircle,
  BookOpen,
  MapPin,
  Flag,
  ThumbsUp,
  ThumbsDown,
} from './icons';
import { AnnotatedShot, MarkerBadge, withMarkerBadges, markerMentions, unmarkedLine } from './ScreenPointers';
import { areaFindsFor, markersActiveFor } from './pointerStore';
import { ChatMessage, GameTab, AiMode, SteamGameData } from '../types';
import { getApiBaseUrl, DEFAULT_PREVIEW_URL } from '../utils/api';
import { auth } from '../lib/firebase';
import { playSnapSound, playChimeSound, playBlipSound } from '../utils/audio';
import { useT } from '../i18n';
import { QuestLogo } from './QuestLogo';
import { ReportAnswerModal, type ReportTarget } from './ReportAnswerModal';
import { PlaceBar } from './PlaceBar';
import { QcGuidesView } from './QcGuidesView';
import { GlainIcon } from './GlainIcon';
import { Walkthrough, walkthroughDone, OPEN_TOUR_EVENT } from './Walkthrough';
import { SignInCard } from './SignInCard';
import { isPhone } from '../utils/source';
import { samePlace, tipMatches, useAchievementGuide } from '../utils/achievementGuide';
import { useLocale } from '../i18n';
import { quickChips, quickLabelKey, type QuickId } from '../utils/quickQuestions';
import { displayGameName } from '../utils/gameName';
import { showFirstRunHints } from '../utils/sessions';
declare const __APP_BUILD__: { version: string } | undefined;
const BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : { version: 'dev' };

/** What a 👎 can say was wrong (optional). */
const VOTE_REASONS = ['place', 'info', 'marker', 'unhelpful'] as const;

interface ChatAreaProps {
  /** The player's questions left (the user status): Pro and Fast counts for the switch next to the send button. */
  quota?: any;
  /** A guest: the sign-in card can show under their last answer of the day (onSignIn opens sign-in). */
  isGuest?: boolean;
  onSignIn?: () => void;
  /** On-screen markers (Settings, on by default): off, answers show no markers card, checklist or marker badges. */
  markersOn?: boolean;
  /** The screenshot shortcut from Settings, ready to show ("Ctrl + Shift + S"). */
  screenshotKeys?: string;
  /** The show/hide shortcut ("Ctrl+\"), for the quick tour's "free your mouse" step. */
  hideKeys?: string;
  /** The quest log's tick and cycle shortcuts, for the quick tour. */
  tickKeys?: string;
  nextKeys?: string;
  /**
   * What the guide marks missable in the area the player is in and they haven't ticked (the quest log's "Missable
   * here"; ids are the log's g:<area>:<entry>): listed under the latest answer about that area.
   */
  missablesHere?: { area: string; items: { id: string; label: string; why?: string; where?: string }[] } | null;
  /** The compact view's "Near you": the next unticked thing the guide lists in this area (missables first). */
  nearYou?: { id: string; label: string; where?: string; missable?: boolean } | null;
  /** Immersive mode: hold-to-talk answers are read aloud (Settings; default on). */
  immersiveReadAloud?: boolean;
  /** Desktop: show an answer's markers in the on-screen objectives tracker (hides the panel). */
  onTrackOnScreen?: (msgId: string) => void;
  /** "Next turn" under a combat answer: a fresh screenshot and a short question for whoever acts now (desktop). */
  onNextTurn?: () => void;
  /** Desktop: how long markers stay on screen, in seconds (0 = always). */
  markerLifetime?: number;
  onChangeMarkerLifetime?: (seconds: number) => void;
  /** Hint mode (Settings): "Just a hint" among the quick questions. */
  hintMode?: boolean;
  /** The quest log is attached and showing: the controller's LB / RB reach it between Ask and Guide. */
  logAttached?: boolean;
  /** The player picked where they are (one tap or voice): remember it for this game. */
  onSetPlace?: (name: string) => void;
  /** "Locate me" in the PlaceBar (desktop, games with a guide). */
  onLocate?: () => void;
  locating?: boolean;
  locateNote?: string;
  /** The player picked where they are in the story: remember it for this game. */
  onSetStory?: (story: string) => void;
  /** Update fields of one message (e.g. which markers were checked off). */
  onUpdateMessage?: (msgId: string, patch: Partial<ChatMessage>) => void;
  activeTab: GameTab | null;
  onSendMessage: (text: string, imageBase64?: string, audioBase64?: string, preferredModel?: 'pro' | 'flash', quick?: QuickId) => Promise<void>;
  isLoading: boolean;
  aiMode: AiMode;
  activeGame: SteamGameData | null;
  soundEnabled: boolean;
  onAppendToNotes: (text: string) => void;
  onOpenScreenModal: (imageUrl: string) => void;
  ttsVoice: string;
  customApiKey?: string;
  openAiApiKey?: string;
  steamName?: string;
  steamAvatar?: string;
  /** Compact view: a small resting state (where you are, the current objective, the question box). */
  compact?: boolean;
  /** Open the full view (from the compact one). */
  onExpand?: () => void;
}

/**
 * The question box keeps its own text: typing re-renders only this box, never the conversation above it (with a long
 * conversation, re-rendering every message's markdown on each key made typing lag by most of a second). ChatArea reads
 * and sets the text through the ref, and hears only when it goes from empty to not (for the send button).
 */
type AskTextareaHandle = { get: () => string; set: (text: string) => void };
type AskTextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'defaultValue'> & {
  onHasTextChange: (hasText: boolean) => void;
  onEnter: () => void;
  /** Text set before the box was on screen (a prefilled question while the guide was showing). */
  takeInitial: () => string;
};
const AskTextarea = forwardRef<AskTextareaHandle, AskTextareaProps>(function AskTextarea({ onHasTextChange, onEnter, takeInitial, ...rest }, ref) {
  const [value, setValue] = useState(takeInitial);
  const valueRef = useRef(value);
  const had = useRef(!!value.trim());
  const report = (v: string) => {
    const h = !!v.trim();
    if (h !== had.current) {
      had.current = h;
      onHasTextChange(h);
    }
  };
  useEffect(() => {
    onHasTextChange(had.current);
  }, []);
  useImperativeHandle(ref, () => ({
    get: () => valueRef.current,
    set: (v: string) => {
      valueRef.current = v;
      setValue(v);
      report(v);
    },
  }), []);
  return (
    <textarea
      {...rest}
      data-qc-ask-input
      value={value}
      onChange={(e) => {
        valueRef.current = e.target.value;
        setValue(e.target.value);
        report(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
});

/**
 * Whether the question box has text, kept here rather than in ChatArea: the send button follows it without the
 * conversation re-rendering when the box goes from empty to not (the first key of every question).
 */
type HasTextHandle = { set: (hasText: boolean) => void };
const HasTextGate = forwardRef<HasTextHandle, { children: (hasText: boolean) => React.ReactNode }>(function HasTextGate({ children }, ref) {
  const [hasText, setHasText] = useState(false);
  useImperativeHandle(ref, () => ({ set: setHasText }), []);
  return <>{children(hasText)}</>;
});

const REMARK_PLUGINS = [remarkGfm];
/**
 * A message's markdown, parsed again only when its text or its marker badges change (not on every render of the
 * conversation: a tick, a streamed answer, a panel resize).
 */
const MessageMarkdown = React.memo(
  function MessageMarkdown({ text, link }: { text: string; link: (props: any) => React.ReactNode; markerKey: string }) {
    return (
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={{ a: link as any }}>
        {text}
      </ReactMarkdown>
    );
  },
  (a, b) => a.text === b.text && a.markerKey === b.markerKey,
);

export const ChatArea: React.FC<ChatAreaProps> = ({
  markersOn = true,
  quota,
  isGuest = false,
  onSignIn,
  activeTab,
  onSendMessage,
  isLoading,
  aiMode,
  activeGame,
  screenshotKeys,
  hideKeys,
  tickKeys,
  nextKeys,
  missablesHere,
  nearYou,
  immersiveReadAloud = true,
  onTrackOnScreen,
  onNextTurn,
  soundEnabled,
  onAppendToNotes,
  onOpenScreenModal,
  ttsVoice,
  customApiKey,
  openAiApiKey,
  steamName,
  steamAvatar,
  compact = false,
  onExpand,
  onUpdateMessage,
  markerLifetime,
  onChangeMarkerLifetime,
  hintMode = false,
  logAttached = false,
  onSetPlace,
  onLocate,
  locating,
  locateNote,
  onSetStory,
}) => {
  const t = useT();
  // The question box's text lives in AskTextarea (typing never re-renders the conversation); this reads and sets it.
  const askRef = useRef<AskTextareaHandle>(null);
  // Enter in the box submits with the latest handleSubmit (updated every render).
  const submitRef = useRef<() => void>(() => {});
  // The answer whose 👎 is asking "What was wrong?".
  const [voteAsk, setVoteAsk] = useState<string | null>(null);
  // "More" under the suggestions: the other quick questions, in a small menu.
  const [showMoreQuick, setShowMoreQuick] = useState(false);
  const moreQuickRef = useRef<HTMLDivElement>(null);
  const moreQuickBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (showMoreQuick) setTimeout(() => moreQuickRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }), 0);
  }, [showMoreQuick]);
  // The screenshot shortcut hint under the question box: first five sessions only.
  const [firstRunHint] = useState(showFirstRunHints);
  const pendingText = useRef('');
  const hasTextRef = useRef<HasTextHandle>(null);
  const setHasText = useCallback((h: boolean) => hasTextRef.current?.set(h), []);
  const getInputQuestion = () => askRef.current?.get() ?? pendingText.current;
  const setInputQuestion = useCallback((v: string) => {
    if (askRef.current) askRef.current.set(v);
    else {
      pendingText.current = v;
      setHasText(!!v.trim());
    }
  }, []);
  const takeInitialText = useCallback(() => {
    const v = pendingText.current;
    pendingText.current = '';
    return v;
  }, []);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  // Ask (the conversation) or Guide (the game's guide, open at where you are). The question box works in both; asking
  // switches back to the answer. The guide stays loaded once opened, so switching back and forth keeps your place.
  // The status strip: where you are, what's missable here (from the achievement guide, spoiler-safe), and the
  // Ask/Guide switch. The missable nudge shows once per place and can be dismissed.
  const localeNow = useLocale();
  const achGuideHere = useAchievementGuide(activeGame?.name, activeGame?.appId, localeNow);
  const placeNow = activeTab?.place?.name || '';
  const missHere = useMemo(() => {
    if (!achGuideHere || !placeNow) return [];
    return achGuideHere.list.filter((a) => a.missable && a.areaName && samePlace(a.areaName, placeNow) && !activeGame?.achievements?.some((x) => x.unlocked && tipMatches(a, x.name)));
  }, [achGuideHere, placeNow, activeGame?.achievements]);
  const [showTour, setShowTour] = useState(() => !walkthroughDone());
  // The ⋯ menu's "Quick tour" opens it again.
  useEffect(() => {
    const open = () => setShowTour(true);
    window.addEventListener(OPEN_TOUR_EVENT, open);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, open);
  }, []);
  const [mode, setModeState] = useState<'ask' | 'guide'>(() => {
    try {
      return localStorage.getItem('qc-main-mode') === 'guide' ? 'guide' : 'ask';
    } catch {
      return 'ask';
    }
  });
  const [guideLoaded, setGuideLoaded] = useState(mode === 'guide');
  const setMode = (m: 'ask' | 'guide') => {
    setModeState(m);
    if (m === 'guide') setGuideLoaded(true);
    try {
      localStorage.setItem('qc-main-mode', m);
    } catch {}
  };
  // "In the guide" from the achievements drawer, or "Open in guide" on a tracker entry: switch to the Guide at that
  // area (and that entry, shown and highlighted).
  const [guideOpenReq, setGuideOpenReq] = useState<{ slug: string; entry?: string; entity?: boolean; n: number } | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d?.slug) return;
      setMode('guide');
      setGuideOpenReq({ slug: d.slug, entry: typeof d.entry === 'string' ? d.entry : undefined, entity: !!d.entity, n: Date.now() });
    };
    window.addEventListener('qc-open-guide', onOpen);
    return () => window.removeEventListener('qc-open-guide', onOpen);
  }, []);
  /** "That's right" on an answer that corrected the guide: tell the server the player confirmed that area (best effort). */
  const confirmCorrectionsPlace = async (ids: string[]) => {
    try {
      const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      if (!token) return;
      await fetch(`${getApiBaseUrl()}/api/corrections/confirm-place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      });
    } catch {
      /* not important enough to bother the player */
    }
  };
  // "Ask about this" on a tracker entry: the question goes in the box, ready to edit or send (not sent).
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const text = (e as CustomEvent).detail?.text;
      if (typeof text !== 'string' || !text.trim()) return;
      setMode('ask');
      setInputQuestion(text);
      setTimeout(() => {
        const box = document.querySelector<HTMLTextAreaElement>('[data-qc-ask-input]');
        if (!box) return;
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      }, 250);
    };
    window.addEventListener('qc-prefill-question', onPrefill);
    return () => window.removeEventListener('qc-prefill-question', onPrefill);
  }, []);
  // Ctrl+G switches between Ask and Guide.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setMode(mode === 'guide' ? 'ask' : 'guide');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);
  // Pro / Fast next to the send button: the player's remembered choice when it has questions left, else the other one.
  const bal = balancesOf(quota);
  // The answer whose ⋯ menu (save, copy, report) is open.
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [answerModel, setAnswerModel] = useState<AnswerModel>(() => startingModel(readAnswerModel(), bal));
  const [modelNote, setModelNote] = useState('');
  const preferredModel: 'pro' | 'flash' = answerModel === 'fast' ? 'flash' : 'pro';
  const noteSwitch = (to: AnswerModel) => {
    setModelNote(t(to === 'fast' ? 'model.switchedToFast' : 'model.switchedToPro'));
    window.setTimeout(() => setModelNote(''), 5000);
  };
  const chooseModel = (m: AnswerModel) => {
    setAnswerModel(m);
    saveAnswerModel(m);
    setModelNote('');
  };
  // The chosen model ran out (the counts came back from an answer or the status): switch to the other, and say so.
  useEffect(() => {
    if (!quota) return;
    // The player's own choice has questions again (a new day): back to it.
    const saved = readAnswerModel();
    if (answerModel !== saved && (saved === 'pro' ? bal.pro : bal.fast) > 0) {
      setAnswerModel(saved);
      return;
    }
    const left = answerModel === 'pro' ? bal.pro : bal.fast;
    const other: AnswerModel = answerModel === 'pro' ? 'fast' : 'pro';
    if (left === 0 && (other === 'pro' ? bal.pro : bal.fast) > 0) {
      setAnswerModel(other);
      noteSwitch(other);
    }
  }, [bal.pro, bal.fast]);
  // The server answered with the other model (the chosen one was used up), or a controller's R3 switched.
  useEffect(() => {
    const switched = (e: Event) => {
      const to = (e as CustomEvent).detail?.to === 'fast' ? 'fast' : 'pro';
      setAnswerModel(to);
      noteSwitch(to);
    };
    const toggle = () => setAnswerModel((m) => {
      const next: AnswerModel = m === 'pro' ? 'fast' : 'pro';
      saveAnswerModel(next);
      return next;
    });
    window.addEventListener('qc-answer-model-switched', switched);
    window.addEventListener('qc-toggle-answer-model', toggle);
    return () => {
      window.removeEventListener('qc-answer-model-switched', switched);
      window.removeEventListener('qc-toggle-answer-model', toggle);
    };
  }, []);
  const attachedImageRef = useRef<string | null>(null);

  useEffect(() => {
    attachedImageRef.current = attachedImage;
  }, [attachedImage]);
  const [isRecording, setIsRecording] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  // "Report this answer" (Store policy 11.16): the answer the dialog is open for.
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [savedNoteMessageId, setSavedNoteMessageId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioLoadingId, setAudioLoadingId] = useState<string | null>(null);
  const [isCapturingScreen, setIsCapturingScreen] = useState(false);
  const [showIframeCaptureNotice, setShowIframeCaptureNotice] = useState(false);
  const [ttsStatusError, setTtsStatusError] = useState<{ msgId: string; error: string } | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const ttsCacheRef = useRef<Map<string, string[]>>(new Map());
  const ttsAbortControllerRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [activeTab?.messages, isLoading]);

  // Global Paste Handler for Game Screenshots (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
              if (event.target?.result) {
                setAttachedImage(event.target.result as string);
                playSnapSound(soundEnabled);
              }
            };
            reader.readAsDataURL(file);
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [soundEnabled]);

  // Cleanup media recorder & audio on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (ttsAbortControllerRef.current) {
        ttsAbortControllerRef.current.abort();
        ttsAbortControllerRef.current = null;
      }
      audioQueueRef.current = [];
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
        currentAudioRef.current = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Hold to talk (controller button or the held voice shortcut): immersive mode. Letting go sends the question with a
  // fresh screenshot, the panel steps aside, and the answer is read aloud (immersiveReadAloud).
  const immersiveRef = useRef(false);
  const stopPendingRef = useRef(false);
  const readAloudPendingRef = useRef(false);

  const startVoiceRecording = async () => {
    if (isRecording) return;
    stopPendingRef.current = false;

    playBlipSound(soundEnabled);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        
        // Auto-capture screenshot if one isn't already attached
        let finalImage = attachedImageRef.current;
        const immersive = immersiveRef.current;
        immersiveRef.current = false;
        const api = (window as any).electronAPI;
        if (immersive && api?.captureFresh) {
          // Immersive: the panel steps aside first, so the screenshot is the game as it is now.
          api.hidePanel?.();
          await new Promise((r) => setTimeout(r, 250));
          finalImage = (await api.captureFresh().catch(() => null)) || finalImage;
        }
        if (!finalImage) {
          finalImage = await captureGameScreen();
        }
        if (immersive && immersiveReadAloud) readAloudPendingRef.current = true;

        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          // Automatically send the voice note
          onSendMessage(t('chat.voiceMessage'), finalImage || undefined, base64Audio);
          setAttachedImage(null);
          attachedImageRef.current = null;
          setInputQuestion('');
        };
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      // Let go before the microphone was ready: send what there is.
      if (stopPendingRef.current) {
        stopPendingRef.current = false;
        setTimeout(() => { if (mediaRecorder.state === 'recording') { playBlipSound(soundEnabled); mediaRecorder.stop(); setIsRecording(false); } }, 300);
      }
    } catch (err: any) {
      console.warn('Microphone access warning:', err?.message || err);
      setIsRecording(false);
    }
  };

  const stopVoiceRecording = () => {
    if (isRecording && mediaRecorderRef.current) {
      playBlipSound(soundEnabled);
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const toggleVoiceRecording = () => {
    if (isRecording) stopVoiceRecording();
    else startVoiceRecording();
  };

  /** Hold to talk: 'start' while held, 'end' when let go. */
  const handleTalk = (e: Event) => {
    const state = (e as CustomEvent).detail?.state;
    if (state === 'start') {
      if (isLoading) return;
      if (mode === 'guide') setMode('ask');
      immersiveRef.current = true;
      void startVoiceRecording();
    } else if (state === 'end') {
      if (isRecording && mediaRecorderRef.current) stopVoiceRecording();
      else stopPendingRef.current = true;
    }
  };

  /** Bumpers (controller): RB goes Ask -> Guide -> the next game; LB the other way. */
  const handlePadMode = (e: Event) => {
    const dir = Number((e as CustomEvent).detail?.dir) || 0;
    const fromLog = !!(e as CustomEvent).detail?.fromLog;
    // With the quest log attached: Ask -> the quest log -> Guide (RB), and back (LB).
    if (fromLog) {
      if (dir > 0) setMode('guide');
      return;
    }
    if (logAttached && ((dir > 0 && mode === 'ask') || (dir < 0 && mode === 'guide'))) {
      if (dir < 0) setMode('ask');
      window.dispatchEvent(new CustomEvent('qc-log-focus'));
      return;
    }
    if (dir > 0) {
      if (mode === 'ask') setMode('guide');
      else { window.dispatchEvent(new CustomEvent('qc-switch-tab', { detail: { delta: 1 } })); setMode('ask'); }
    } else if (dir < 0) {
      if (mode === 'guide') setMode('ask');
      else window.dispatchEvent(new CustomEvent('qc-switch-tab', { detail: { delta: -1 } }));
    }
  };

  // Controller: a question picked from the quick-questions list or typed on the on-screen keyboard.
  const handleControllerAsk = (e: Event) => {
    const { text, quick } = (e as CustomEvent).detail || {};
    if (typeof text === 'string' && text.trim() && !isLoading) {
      setInputQuestion('');
      handleSubmit(undefined, text.trim(), undefined, quick);
    }
  };
  const handleControllerInput = (e: Event) => {
    const text = (e as CustomEvent).detail?.text;
    if (typeof text === 'string') setInputQuestion(text);
  };

  const handleAutoScreenshotSubmit = async () => {
    if (isLoading) return;
    // Overriding the question to prompt the AI to examine the picture
    // And leaving the image undefined will trigger the auto-screenshot flow in handleSubmit
    await handleSubmit(undefined, t('chat.referencePicture'), undefined);
  };

  useEffect(() => {
    window.addEventListener('trigger-voice-start', startVoiceRecording);
    window.addEventListener('trigger-voice-stop', stopVoiceRecording);
    window.addEventListener('trigger-voice-record', toggleVoiceRecording);
    window.addEventListener('qc-talk', handleTalk);
    window.addEventListener('qc-pad-mode', handlePadMode);
    window.addEventListener('trigger-auto-screenshot-submit', handleAutoScreenshotSubmit);
    window.addEventListener('qc-ask', handleControllerAsk);
    window.addEventListener('qc-set-input', handleControllerInput);
    return () => {
      window.removeEventListener('trigger-voice-start', startVoiceRecording);
      window.removeEventListener('trigger-voice-stop', stopVoiceRecording);
      window.removeEventListener('trigger-voice-record', toggleVoiceRecording);
      window.removeEventListener('qc-talk', handleTalk);
      window.removeEventListener('qc-pad-mode', handlePadMode);
      window.removeEventListener('trigger-auto-screenshot-submit', handleAutoScreenshotSubmit);
      window.removeEventListener('qc-ask', handleControllerAsk);
      window.removeEventListener('qc-set-input', handleControllerInput);
    };
  }, [isRecording, soundEnabled, attachedImage, onSendMessage, isLoading, mode, immersiveReadAloud]);

  // Live Screen Capture from Game Window (WebRTC DisplayMedia or File Upload Fallback)
  const captureGameScreen = async (): Promise<string | null> => {
    try {
      setIsCapturingScreen(true);
      playSnapSound(soundEnabled);

      // Mobile check - if on a mobile device, trigger the native camera instead of screen sharing
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
      if (isMobile) {
        setIsCapturingScreen(false);
        cameraInputRef.current?.click();
        return null;
      }

      if ((window as any).electronAPI?.takeScreenshot) {
        const dataUrl = await (window as any).electronAPI.takeScreenshot();
        if (dataUrl) {
          setAttachedImage(dataUrl);
          playChimeSound(soundEnabled);
        }
        setIsCapturingScreen(false);
        return dataUrl || null;
      }

      if (!navigator?.mediaDevices?.getDisplayMedia) {
        setIsCapturingScreen(false);
        fileInputRef.current?.click();
        return null;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const video = document.createElement('video');
      video.style.position = 'fixed';
      video.style.top = '-9999px';
      video.style.opacity = '0';
      document.body.appendChild(video);
      video.srcObject = stream;
      video.autoplay = true;
      video.muted = true;
      video.play();
      await new Promise((resolve) => {
        video.onloadeddata = () => resolve(null);
      });
      await new Promise(r => setTimeout(r, 300));
      
      let dataUrl = null;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (ctx && video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setAttachedImage(dataUrl);
        playChimeSound(soundEnabled);
      }

      stream.getTracks().forEach(track => track.stop());
      if (video.parentNode) video.parentNode.removeChild(video);
      setIsCapturingScreen(false);
      return dataUrl;
    } catch (err: any) {
      setIsCapturingScreen(false);
      const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
      if (err?.name === 'NotAllowedError' && (err?.message?.includes('permissions policy') || err?.message?.includes('disallowed') || isEmbedded)) {
        setShowIframeCaptureNotice(true);
      } else if (err?.name === 'NotAllowedError' && (err?.message?.includes('permissions policy') || err?.message?.includes('disallowed'))) {
        fileInputRef.current?.click();
      } else {
        console.warn('Screen capture not completed or cancelled:', err?.message || err);
      }
      return null;
    }
  };

  const processAndCompressImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_DIMENSION = 1600;

          if (width > height) {
            if (width > MAX_DIMENSION) {
              height *= MAX_DIMENSION / width;
              width = MAX_DIMENSION;
            }
          } else {
            if (height > MAX_DIMENSION) {
              width *= MAX_DIMENSION / height;
              height = MAX_DIMENSION;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            setAttachedImage(dataUrl);
            playSnapSound(soundEnabled);
          }
        };
        img.src = event.target.result as string;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processAndCompressImage(file);
    }
    // Clear input so same file can be selected again
    if (e.target) e.target.value = '';
  };

  const handleTextareaPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    let handled = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        handled = true;
        const file = items[i].getAsFile();
        if (file) {
          processAndCompressImage(file);
        }
      }
    }
    if (handled) {
      e.preventDefault();
    }
  };

  // A quick question (a chip): its label is the question, and the id tells the server what it asks for.
  const handleSubmit = async (e?: React.FormEvent, overrideText?: string, overrideImage?: string, quick?: QuickId) => {
    if (e) e.preventDefault();
    if (isLoading) return;
    if (mode === 'guide') setMode('ask'); // show the answer

    // In electron, we auto-capture if no image is attached
    const isElectron = !!(typeof window !== 'undefined' && (window as any).electronAPI);
    let finalImage = overrideImage !== undefined ? overrideImage : attachedImage;
    let finalQuestion = overrideText !== undefined ? overrideText : getInputQuestion().trim();
    
    // We only block submission if it's empty AND we can't auto-capture
    if (!finalQuestion && !finalImage && !isElectron) return;

    if (isElectron && !finalImage) {
      setIsCapturingScreen(true);
      playSnapSound(soundEnabled);
      try {
        const screenshotPromise = (window as any).electronAPI.takeScreenshot();
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
        const dataUrl = await Promise.race([screenshotPromise, timeoutPromise]);
        if (dataUrl) {
          finalImage = dataUrl;
        }
      } catch (err) {
        console.error("Auto-screenshot failed", err);
      } finally {
        setIsCapturingScreen(false);
      }
    } else if (!finalImage) {
       playSnapSound(soundEnabled);
    } else {
       playSnapSound(soundEnabled); // Play snap even if they pasted
    }

    // Default question if they submitted an image without any text
    if (!finalQuestion && finalImage) {
      finalQuestion = t('chat.defaultShotQ');
    } else if (!finalQuestion) {
      finalQuestion = t('chat.defaultQ');
    }

    setInputQuestion('');
    setAttachedImage(null);
    attachedImageRef.current = null;

    await onSendMessage(finalQuestion, finalImage || undefined, undefined, preferredModel, quick);
    playChimeSound(soundEnabled);
  };

  /** A 👍 / 👎 (or 'none': taken back) on an answer, with what it was about, for the Quality numbers. */
  const sendVote = async (msg: ChatMessage, vote: 'up' | 'down' | 'none', reason?: string) => {
    try {
      const msgs = activeTab?.messages ?? [];
      const idx = msgs.findIndex((m) => m.id === msg.id);
      let question = '';
      for (let j = idx - 1; j >= 0; j--) if (msgs[j].role === 'user') { question = msgs[j].text; break; }
      const token = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => null) : null;
      await fetch(`${getApiBaseUrl()}/api/answer-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          messageId: msg.id, vote, ...(reason ? { reason } : {}), qtype: msg.qtype, model: msg.modelUsed,
          game: activeTab?.activeSteamGame?.name || activeGame?.name || activeTab?.name || '',
          markers: !!(markersOn && msg.points && msg.points.length), question, answer: msg.text,
          client: isDesktopApp ? 'desktop' : 'web', appVersion: BUILD.version,
          ...(msg.kind ? { kind: msg.kind } : {}),
        }),
      });
    } catch {
      /* a vote that didn't send is just not counted */
    }
  };

  const handleCopyMessage = (msgId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(msgId);
    playBlipSound(soundEnabled);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  const handleSaveToNotes = (msgId: string, text: string) => {
    playBlipSound(soundEnabled);
    onAppendToNotes(text);
    setSavedNoteMessageId(msgId);
    setTimeout(() => setSavedNoteMessageId(null), 2000);
  };

  const stopAllAudio = () => {
    // 1. Abort any in-flight TTS generation network request
    if (ttsAbortControllerRef.current) {
      ttsAbortControllerRef.current.abort();
      ttsAbortControllerRef.current = null;
    }
    // 2. Clear remaining queued audio chunks
    audioQueueRef.current = [];
    // 3. Pause and reset any active HTML5 audio element
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    // 4. Cancel any native browser speech synthesis queue
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setPlayingAudioId(null);
    setAudioLoadingId(null);
  };

  const playNextAudioChunk = (msgId: string, src: string) => {
    if (ttsAbortControllerRef.current?.signal.aborted) return;
    const audio = new Audio(src);
    currentAudioRef.current = audio;

    audio.onended = () => {
      if (currentAudioRef.current === audio) {
        if (audioQueueRef.current.length > 0) {
          const nextSrc = audioQueueRef.current.shift()!;
          playNextAudioChunk(msgId, nextSrc);
        } else {
          currentAudioRef.current = null;
          setPlayingAudioId(null);
          setAudioLoadingId(null);
        }
      }
    };

    audio.onerror = () => {
      if (currentAudioRef.current === audio) {
        if (audioQueueRef.current.length > 0) {
          const nextSrc = audioQueueRef.current.shift()!;
          playNextAudioChunk(msgId, nextSrc);
        } else {
          currentAudioRef.current = null;
          setPlayingAudioId(null);
          setAudioLoadingId(null);
        }
      }
    };

    audio.play().catch((err) => {
      console.warn('Audio playback start was prevented or interrupted:', err);
    });
  };

  const handlePlayTTS = async (msgId: string, text: string) => {
    playBlipSound(soundEnabled);

    // If currently playing or loading this exact message, immediately STOP
    if (playingAudioId === msgId) {
      stopAllAudio();
      return;
    }

    // Stop any existing audio before starting new playback
    stopAllAudio();

    const cacheKey = `${ttsVoice || 'puck'}::${text}`;
    if (ttsCacheRef.current.has(cacheKey)) {
      const cached = [...ttsCacheRef.current.get(cacheKey)!];
      if (cached.length > 0) {
        setPlayingAudioId(msgId);
        setAudioLoadingId(null);
        const first = cached.shift()!;
        audioQueueRef.current = cached;
        playNextAudioChunk(msgId, first);
        return;
      }
    }

    
    // Global array to prevent Chrome garbage collection of utterances
    const fallbackToBrowserTTS = (reason: string) => {
      console.warn('[TTS] Falling back to browser native TTS:', reason);
      if (!('speechSynthesis' in window)) {
        setTtsStatusError({ msgId, error: t('err.voice') });
        setPlayingAudioId(null);
        setAudioLoadingId(null);
        return;
      }
      setTtsStatusError(null);
      setAudioLoadingId(null);
      
      window.speechSynthesis.cancel();
      
      // Clean up markdown for TTS
      const cleanText = text.replace(/\*\*/g, '')
                          .replace(/\*/g, '')
                          .replace(/__/g, '')
                          .replace(/_/g, '')
                          .replace(/#/g, '')
                          .replace(/\[(.*?)\]\(.*?\)/g, '$1')
                          .replace(/`/g, '');
                          
      // Split text into chunks to bypass the Chrome 15-second TTS limit bug
      const sentences = [];
      let current = "";
      const tokens = cleanText.split(/([.!?\n]+)/);
      for (let i = 0; i < tokens.length; i += 2) {
        const textChunk = tokens[i];
        const delim = tokens[i + 1] || "";
        current += textChunk + delim;
        if (current.trim().length > 60 || delim.includes('\n')) {
           sentences.push(current.trim());
           current = "";
        }
      }
      if (current.trim()) sentences.push(current.trim());
      
      const voiceKey = (ttsVoice || 'puck').toLowerCase();
      
      let utterancesFinished = 0;
      
      // We must store utterances globally to prevent garbage collection stopping playback mid-way
      (window as any)._ttsUtterances = []; 
      
      if (sentences.length === 0) {
        setPlayingAudioId(null);
        return;
      }
      
      sentences.forEach((sentence, index) => {
        if (!sentence) {
          utterancesFinished++;
          if (utterancesFinished === sentences.length) setPlayingAudioId(null);
          return;
        }
        
        const utterance = new SpeechSynthesisUtterance(sentence);
        (window as any)._ttsUtterances.push(utterance);
        
        if (['puck', 'charon', 'fenrir'].includes(voiceKey)) {
          utterance.pitch = 0.8;
        } else {
          utterance.pitch = 1.2;
        }
        
        utterance.onend = () => {
          utterancesFinished++;
          if (utterancesFinished === sentences.length) {
            setPlayingAudioId(null);
            (window as any)._ttsUtterances = []; // Clean up
          }
        };
        
        utterance.onerror = () => {
          utterancesFinished++;
          if (utterancesFinished === sentences.length) {
            setPlayingAudioId(null);
            (window as any)._ttsUtterances = [];
          }
        };
        
        window.speechSynthesis.speak(utterance);
      });
    };

    // The device's built-in voice (the default, and free): no server call.
    if ((ttsVoice || '').toLowerCase() === 'device') {
      setPlayingAudioId(msgId);
      fallbackToBrowserTTS('built-in voice selected');
      return;
    }

    const abortController = new AbortController();
    ttsAbortControllerRef.current = abortController;

    try {
      setPlayingAudioId(msgId);
      setAudioLoadingId(msgId);
      
      const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;

      const targetBaseUrl = getApiBaseUrl();
      console.log(`[TTS] Requesting voice "${ttsVoice || 'puck'}" from endpoint: ${targetBaseUrl || '(relative)'}/api/tts`);

      // Call server TTS endpoint with stream: true for fast first-chunk playback
      const res = await fetch(`${targetBaseUrl}/api/tts`, {
        method: 'POST',
        signal: abortController.signal,
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/x-ndjson, application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ text, voice: ttsVoice || 'puck', stream: true }),
      });

      if (abortController.signal.aborted) return;

      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';

        // If streaming NDJSON (progressive chunks)
        if (contentType.includes('application/x-ndjson') && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          const collectedChunks: string[] = [];
          let firstChunkPlayed = false;

          while (true) {
            const { value, done } = await reader.read();
            if (abortController.signal.aborted) break;

            if (value) {
              buffer += decoder.decode(value, { stream: !done });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const chunkData = JSON.parse(trimmed);
                  if (chunkData.audioBase64) {
                    const mime = chunkData.mimeType || 'audio/wav';
                    const audioSrc = `data:${mime};base64,${chunkData.audioBase64}`;
                    collectedChunks.push(audioSrc);

                    if (!firstChunkPlayed) {
                      firstChunkPlayed = true;
                      setAudioLoadingId(null);
                      setTtsStatusError(null);
                      playNextAudioChunk(msgId, audioSrc);
                    } else {
                      audioQueueRef.current.push(audioSrc);
                      if (!currentAudioRef.current) {
                        const nextSrc = audioQueueRef.current.shift()!;
                        setPlayingAudioId(msgId);
                        playNextAudioChunk(msgId, nextSrc);
                      }
                    }
                  }
                } catch (e) {
                  // Ignore JSON parse errors for incomplete chunks
                }
              }
            }

            if (done) break;
          }

          if (collectedChunks.length > 0) {
            ttsCacheRef.current.set(cacheKey, collectedChunks);
          }
          if (firstChunkPlayed) return;
          fallbackToBrowserTTS('TTS Rate limit exceeded (100 requests/day for gemini-3.1-flash-tts). Using local fallback.'); return;
        } else if (contentType.includes('application/json')) {
          // Standard JSON payload fallback
          const data = await res.json();
          if (abortController.signal.aborted) return;

          if (data.audioBase64) {
            setAudioLoadingId(null);
            setTtsStatusError(null);
            const mime = data.mimeType || 'audio/wav';
            const audioSrc = `data:${mime};base64,${data.audioBase64}`;
            ttsCacheRef.current.set(cacheKey, [audioSrc]);
            playNextAudioChunk(msgId, audioSrc);
            return;
          }
        }
      }

      // If server returned non-200 OK
      let errMsg = `Server HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errMsg = errJson.error || errMsg;
      } catch (e) {
        // non-JSON
      }

      const helpfulError = res.status === 404
        ? `Cloud Backend not found at ${targetBaseUrl || window.location.origin}. Please ensure your AI Studio app is published.`
        : res.status === 401
        ? `Authentication required for Gemini Voice. Please sign in or reconnect to your cloud server.`
        : `Gemini Voice generation error: ${errMsg}`;

      fallbackToBrowserTTS(helpfulError);

    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // User deliberately stopped playback
        return;
      }
      const networkHelp = `Cannot connect to server at ${getApiBaseUrl() || window.location.origin}.`;
      fallbackToBrowserTTS(networkHelp);
    }
  };

  const askQuick = (id: QuickId, image?: string) => {
    playBlipSound(soundEnabled);
    handleSubmit(undefined, t(quickLabelKey(id)), image, id);
  };

  // Immersive mode: a hold-to-talk question's answer is read aloud as soon as it arrives.
  useEffect(() => {
    if (isLoading || !readAloudPendingRef.current) return;
    const msgs = activeTab?.messages ?? [];
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== 'assistant') return;
    readAloudPendingRef.current = false;
    void handlePlayTTS(last.id, last.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, activeTab?.messages?.length]);
  const lastAssistantId = (() => {
    const msgs = activeTab?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') return msgs[i].id;
    return null;
  })();
  const isDesktopApp = typeof window !== 'undefined' && !!(window as any).electronAPI;
  const gameLabel = displayGameName(activeGame?.name || activeTab?.activeSteamGame?.name);

  submitRef.current = () => {
    void handleSubmit();
  };

  const askForm = (
      <form
        onSubmit={handleSubmit}
        className={compact ? 'p-2.5' : 'p-3 sm:p-4 bg-[#0a0b10]/90 border-t border-white/[0.08] backdrop-blur-2xl'}
      >
        {/* Suggestions, one set at a time on one line: the starter questions in an empty conversation, the follow-ups
            after an answer ("Show me where on screen" only with markers on and an answer about a screenshot: the web
            app sends that screenshot again, the desktop app takes a fresh one). The rest are under "More". */}
        {!compact && (() => {
          const msgs = activeTab?.messages ?? [];
          const asked = msgs.some((m) => m.role === 'user');
          let shot: string | undefined;
          if (asked) {
            const last = msgs.map((m) => m.id).lastIndexOf(lastAssistantId ?? '');
            for (let i = last - 1; i >= 0; i--) if (msgs[i].role === 'user') { shot = msgs[i].imageUrl; break; }
          }
          const lastAnswer = lastAssistantId ? msgs.find((m) => m.id === lastAssistantId) : undefined;
          const { shown, extra } = quickChips({ asked: asked && !!lastAssistantId, combat: !!lastAnswer?.combat, canShowWhere: markersOn && !!shot, hintMode });
          const ask = (id: QuickId) => {
            setShowMoreQuick(false);
            askQuick(id, id === 'where' && !isDesktopApp ? shot : undefined);
          };
          return (
            <div className="relative mb-2 flex items-center gap-1.5">
              <div role="group" aria-label={t('quick.label')} className="flex-1 min-w-0 flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {shown.map((id) => (
                  <button
                    key={id}
                    type="button"
                    disabled={isLoading}
                    onClick={() => ask(id)}
                    className="qc-px-frame shrink-0 whitespace-nowrap px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-[11.5px] font-medium text-zinc-300 hover:text-white hover:border-[var(--accent-border)] hover:bg-[var(--accent-dim)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
                  >
                    {t(quickLabelKey(id))}
                  </button>
                ))}
              </div>
              <button
                ref={moreQuickBtnRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={showMoreQuick}
                disabled={isLoading}
                onClick={() => {
                  playBlipSound(soundEnabled);
                  setShowMoreQuick((v) => !v);
                }}
                className="qc-px-frame shrink-0 whitespace-nowrap px-2.5 py-1 rounded-full border border-[var(--accent-border)] text-[11.5px] font-semibold text-[var(--accent-color)] hover:bg-[var(--accent-dim)] transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50 disabled:cursor-default"
              >
                {t('quick.more')}
                <ChevronDown className={`w-3 h-3 transition-transform ${showMoreQuick ? '' : 'rotate-180'}`} />
              </button>
              {showMoreQuick && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMoreQuick(false)} aria-hidden="true" />
                  <div
                    ref={moreQuickRef}
                    role="menu"
                    aria-label={t('quick.label')}
                    onKeyDown={(e) => {
                      const items = Array.from(moreQuickRef.current?.querySelectorAll<HTMLElement>('button') || []);
                      const i = items.indexOf(document.activeElement as HTMLElement);
                      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
                      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShowMoreQuick(false); moreQuickBtnRef.current?.focus(); }
                    }}
                    className="absolute right-0 bottom-full mb-1.5 z-50 w-max max-w-[min(20rem,calc(100vw-2rem))] py-1.5 rounded-xl bg-[#161620] border border-white/15 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
                  >
                    {extra.map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="menuitem"
                        onClick={() => ask(id)}
                        className="w-full px-3 py-1.5 text-left text-[12.5px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer"
                      >
                        {t(quickLabelKey(id))}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })()}
        <div className="relative flex items-center rounded-2xl bg-[#13141d] border border-white/15 focus-within:border-[var(--accent-color)] focus-within:shadow-[0_0_20px_var(--accent-glow)] transition-all shadow-lg">
          <AskTextarea
            ref={askRef}
            takeInitial={takeInitialText}
            onHasTextChange={setHasText}
            onEnter={() => submitRef.current()}
            onPaste={handleTextareaPaste}
            placeholder={
              isRecording 
                ? t('chat.listening') 
                : attachedImage 
                  ? t('chat.askShot') 
                  : gameLabel
                    ? t('chat.askGame', { game: gameLabel })
                    : t('chat.ask')
            }
            rows={1}
            className={`flex-1 max-h-48 bg-transparent text-white outline-none resize-none ${compact ? 'min-h-[44px] py-3 pl-3.5 pr-40' : 'min-h-[72px] py-4 pl-4 pr-4 sm:pr-4 pb-14'}`}
          />

          {/* Action Buttons inside Input Bar */}
          <div className={`absolute flex items-center gap-1.5 ${compact ? 'right-1.5 bottom-1.5' : 'right-2.5 bottom-2.5'}`}>

            {/* Hidden file input for manual upload */}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />

            {/* Hidden file input for mobile camera capture */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              ref={cameraInputRef}
              onChange={handleFileUpload}
            />

            {/* Attach Screenshot / Game Screen */}
            <button
              type="button"
              onClick={() => {
                playBlipSound(soundEnabled);
                captureGameScreen();
              }}
              disabled={isLoading || isCapturingScreen}
              aria-label={t('chat.attachShot')}
              title={
                typeof window !== 'undefined' && (window as any).electronAPI
                  ? t('chat.snapTitle')
                  : t('chat.attachTitle')
              }
              className={`p-2 rounded-xl transition-all cursor-pointer ${
                isCapturingScreen
                  ? 'bg-[var(--accent-dim)] text-[var(--accent-color)] border border-[var(--accent-border)] animate-pulse shadow-[0_0_12px_var(--accent-glow)]'
                  : attachedImage
                    ? 'text-[var(--accent-color)] bg-[var(--accent-dim)]'
                    : 'text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/10'
              }`}
            >
              {isCapturingScreen ? (
                <div className="w-4 h-4 border-2 border-[var(--accent-color)] border-t-transparent rounded-full animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
            </button>

            {/* Push to Talk / Voice Dictation */}
            <button
              type="button"
              onClick={toggleVoiceRecording}
              title={isRecording ? t('chat.stopVoice') : t('chat.voice')}
              aria-label={isRecording ? t('chat.stopVoice') : t('chat.voice')}
              className={`p-2 rounded-xl transition-all cursor-pointer ${
                isRecording
                  ? 'bg-red-500/25 text-red-300 border border-red-500/40 animate-pulse shadow-[0_0_14px_rgba(239,68,68,0.5)]'
                  : 'text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/10'
              }`}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            {/* Pro / Fast, with the questions left of each */}
            <ModelToggle value={answerModel} onChange={chooseModel} pro={bal.pro} fast={bal.fast} disabled={isLoading} balances={bal} />

            {/* Submit Send Button (follows whether the box has text without re-rendering the conversation) */}
            <HasTextGate ref={hasTextRef}>{(hasText) => (
            <button
              type="submit"
              aria-label={t('chat.send')}
              disabled={
                (!hasText && !attachedImage && !(typeof window !== 'undefined' && (window as any).electronAPI)) ||
                isLoading ||
                isCapturingScreen
              }
              title={
                isCapturingScreen
                  ? t('chat.snapping')
                  : !hasText && !attachedImage && typeof window !== 'undefined' && (window as any).electronAPI
                    ? t('chat.snapSend')
                    : t('chat.send')
              }
              className="qc-px-bevel p-2.5 rounded-xl bg-[var(--accent-color)] text-black font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 hover:scale-105 active:scale-95 transition-all cursor-pointer shadow-[0_0_12px_var(--accent-glow)] flex items-center justify-center"
            >
              {isCapturingScreen ? (
                <Camera className="w-4 h-4 animate-pulse text-black" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
            )}</HasTextGate>
          </div>
        </div>
        {(() => {
          const note = modelNote || (firstRunHint && !compact ? (isDesktopApp ? t('chat.hintDesktop') : t('chat.hintWeb')) : '');
          return (
            <div role="status" aria-live="polite" className={`${note ? 'mt-2' : ''} text-center text-[10px] font-mono uppercase ${modelNote ? 'text-[var(--accent-color)]' : 'text-zinc-500'}`}>
              {note}
            </div>
          );
        })()}
      </form>
  );

  // The compact view: where you are, the current objective and the question box; a click (or Ctrl+Shift+F) opens
  // the full view.
  if (compact && activeTab) {
    const msgs = activeTab.messages ?? [];
    let objective: { title?: string; step?: string } | null = null;
    for (let i = msgs.length - 1; i >= 0 && !objective; i--) {
      const m = msgs[i];
      if (m.role !== 'assistant' || !(m.title || m.steps?.length)) continue;
      const done = m.doneSteps ?? [];
      const next = (m.steps ?? []).find((st, j) => st.kind !== 'warning' && !done.includes(j));
      objective = { title: m.title, step: next?.text };
    }
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-gradient-to-b from-[#0d0e14] to-[#07070b] relative">
        {/* Where you are, the questions pill (its live countdown) and ⤢ for the full view */}
        <div className="flex items-center gap-2 min-w-0 px-3.5 pt-2.5 text-[11px] text-zinc-400" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <MapPin className="w-3.5 h-3.5 text-[var(--accent-color)] flex-shrink-0" aria-hidden="true" />
          <span className={`truncate ${placeNow ? 'text-zinc-200 font-semibold' : ''}`}>{placeNow || t('strip.noPlace')}</span>
          {gameLabel && <span className="truncate text-zinc-500">· {gameLabel}</span>}
          <span className="ml-auto flex-shrink-0 flex items-center gap-1">
            <QuestionsPill userData={quota} small onPress={() => { playBlipSound(soundEnabled); onExpand?.(); }} />
            <button
              type="button"
              onClick={() => {
                playBlipSound(soundEnabled);
                onExpand?.();
              }}
              title={`${t('compact.expand')} (Ctrl+Shift+F)`}
              aria-label={t('compact.expand')}
              className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/[0.06] cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            playBlipSound(soundEnabled);
            onExpand?.();
          }}
          title={`${t('compact.expand')} (Ctrl+Shift+F)`}
          className="group flex-1 min-h-0 text-left px-3.5 pt-1 pb-1 flex flex-col gap-1 min-w-0 cursor-pointer hover:bg-white/[0.03] focus-visible:bg-white/[0.05] outline-none"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          {objective ? (
            <span className="min-w-0">
              {objective.title && <span className="block font-fantasy font-bold text-[14px] text-white truncate">{objective.title}</span>}
              {objective.step && <span className="block text-[12.5px] text-zinc-300 line-clamp-2">{objective.step}</span>}
            </span>
          ) : (
            <span className="text-[12.5px] text-zinc-400">{t('compact.noObjective')}</span>
          )}
        </button>
        {/* Near you: the next thing the guide lists here, unticked (missables first). Opens it in the guide. Free. */}
        {nearYou && (
          <button
            type="button"
            onClick={() => {
              playBlipSound(soundEnabled);
              const [, slug, ...rest] = nearYou.id.split(':');
              onExpand?.();
              setTimeout(() => window.dispatchEvent(new CustomEvent('qc-open-guide', { detail: { slug, entry: rest.join(':').split('+')[0] } })), 50);
            }}
            title={t('answer.missOpen')}
            className="mx-3.5 mb-1 flex items-center gap-1.5 min-w-0 text-left text-[11.5px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            {nearYou.missable ? <AlertTriangle className="w-3 h-3 text-amber-300 flex-shrink-0" aria-hidden="true" /> : <BookOpen className="w-3 h-3 text-[var(--accent-color)] flex-shrink-0" aria-hidden="true" />}
            <span className="flex-shrink-0 font-semibold text-zinc-300">{t('compact.nearYou')}</span>
            <span className="truncate">{nearYou.label}{nearYou.where ? ` · ${nearYou.where}` : ''}</span>
          </button>
        )}
        {askForm}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gradient-to-b from-[#0d0e14] via-[#090a0f] to-[#07070b] relative crt-grid">
      {activeTab && (
        <div className="flex-shrink-0 h-10 px-3 sm:px-4 flex items-center gap-2.5 text-[11px] text-zinc-300 min-w-0 border-b border-white/[0.06] bg-black/15">
          {/* Ask | Guide */}
          <div role="tablist" aria-label={t('main.modeLabel')} className="flex-shrink-0 flex items-center p-0.5 rounded-lg bg-black/40 border border-white/10" title={t('main.modeHint')}>
            {(['ask', 'guide'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`h-6 px-2.5 rounded-md text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  mode === m ? 'bg-[var(--accent-dim)] text-white border border-[var(--accent-border)]' : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                }`}
              >
                {m === 'ask' ? <QuestLogo size={14} compact /> : <BookOpen className="w-3.5 h-3.5 text-[var(--accent-color)]" />}
                {t(m === 'ask' ? 'main.ask' : 'main.guide')}
              </button>
            ))}
          </div>
          {/* Where you are, and what can be missed here (opens the guide at the missables) */}
          <span className="ml-auto min-w-0 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-[var(--accent-color)] flex-shrink-0" aria-hidden="true" />
            <span className={`truncate ${placeNow ? 'text-zinc-100 font-semibold' : 'text-zinc-500'}`}>{placeNow || t('strip.noPlace')}</span>
          </span>
          {missHere.length > 0 && (
            <button
              type="button"
              onClick={() => missHere[0].area && window.dispatchEvent(new CustomEvent('qc-open-guide', { detail: { slug: missHere[0].area } }))}
              className="flex-shrink-0 flex items-center gap-1 px-1.5 h-5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-200 font-semibold hover:bg-amber-500/25 cursor-pointer"
              title={t('strip.missableHint')}
            >
              ⚠ {t('strip.missable', { n: missHere.length })}
            </button>
          )}
        </div>
      )}

      {activeTab && showTour && <Walkthrough isDesktop={isDesktopApp} screenshotKeys={screenshotKeys} hideKeys={hideKeys} tickKeys={tickKeys} nextKeys={nextKeys} onDone={() => setShowTour(false)} />}

      {activeTab && guideLoaded && (
        <div className={mode === 'guide' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
          <QcGuidesView
            gameName={activeTab.activeSteamGame?.name || activeGame?.name || activeTab.name}
            place={activeTab.place?.name || undefined}
            openRequest={guideOpenReq}
            achievements={activeGame?.achievements}
            onAsk={(q) => {
              setMode('ask');
              handleSubmit(undefined, q);
            }}
          />
        </div>
      )}

      {/* Messages List Area */}
      <div 
        ref={chatContainerRef}
        data-qc-scroll
        className={`flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 ${activeTab && mode === 'guide' ? 'hidden' : ''}`}
      >
        {(!activeTab?.messages || activeTab.messages.length === 0) ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 sm:p-8 max-w-2xl mx-auto select-none my-auto">
            {/* Illuminated Center Crest */}
            <div className="relative mb-5 group">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[var(--accent-dim)] to-black/60 border border-[var(--accent-border)] flex items-center justify-center shadow-[0_0_30px_var(--accent-glow)]">
                <QuestLogo size={48} large className="animate-pulse" />
              </div>
              <div className="absolute -inset-1 rounded-2xl bg-[var(--accent-color)] opacity-20 blur-lg -z-10 group-hover:opacity-40 transition-opacity" />
            </div>

            <div className="space-y-2 mb-6">
              <h2 className="font-fantasy font-bold text-2xl sm:text-3xl text-white tracking-wide">
                QUEST COMPENDIUM <span className="text-[var(--accent-color)]">HUD</span>
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 font-sans leading-relaxed max-w-lg">
                {t('chat.heroIntro', { game: activeGame?.name || activeTab?.name || t('chat.heroGameFallback') })}
              </p>
            </div>

            {/* Quick Pro-Tip Bar */}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-zinc-400 font-mono">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-[11px]">
                <Camera className="w-3 h-3 text-[var(--accent-color)]" />
                {typeof window !== 'undefined' && (window as any).electronAPI ? (
                  <span>{t('chat.heroAuto')}</span>
                ) : isPhone() ? (
                  <span>{t('chat.heroPhone')}</span>
                ) : (
                  <span>{t('chat.heroPastePre')} <kbd className="px-1.5 py-0.5 bg-white/10 rounded font-bold text-white">Ctrl + V</kbd> {t('chat.heroPastePost')}</span>
                )}
              </span>
            </div>
          </div>
        ) : (
          activeTab.messages.map((msg, msgIndex) => {
            const isUser = msg.role === 'user';
            const isAudioPlaying = playingAudioId === msg.id;
            const isNoteSaved = savedNoteMessageId === msg.id;
            // The markers card: on the web it sits above the answer with the screenshot (there's no overlay); in the
            // desktop app it's a compact footer after the answer, since the markers are already on the game screen and
            // the numbered checkboxes live in the text.
            const markerCard = (compact: boolean) => {
              if (isUser || !markersOn || !msg.points || msg.points.length === 0) return null;
                          const shotUrl = (() => {
                              // The screenshot this answer is about: the nearest earlier question that had one.
                              for (let i = msgIndex - 1; i >= 0; i--) {
                                const m = activeTab.messages[i];
                                if (m.role === 'user') return m.imageUrl;
                              }
                              return undefined;
                            })();
                          const points = msg.points;
                          const done = msg.donePoints ?? [];
                          const api = (window as any).electronAPI;
                          // Put this answer's markers on screen, skipping the ones checked off.
                          const startMarkers = (doneList: number[]) => {
                            const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
                            api?.showScreenPointers?.(points.filter((p) => !p.fromArea), accent, {
                              refImage: shotUrl,
                              sessionId: msg.id,
                              hidden: doneList,
                              watchNearby: !!msg.nearby?.some((n) => !n.found),
                              extra: areaFindsFor(msg.id),
                              combat: !!msg.combat,
                            });
                          };
                          const setDone = (next: number[]) => {
                            onUpdateMessage?.(msg.id, { donePoints: next });
                            if (!isDesktopApp) return;
                            if (next.length >= points.length) api?.hideScreenPointers?.();
                            else if (markersActiveFor(msg.id)) api?.setPointersHidden?.(msg.id, next);
                            else startMarkers(next);
                          };
                          return (
                            <AnnotatedShot
                              msgId={msg.id}
                              imageUrl={shotUrl}
                              points={points}
                              nearby={msg.nearby}
                              done={done}
                              isDesktop={isDesktopApp}
                              onToggle={(i) => setDone(done.includes(i) ? done.filter((d) => d !== i) : [...done, i].sort((x, y) => x - y))}
                              onShowAll={() => setDone([])}
                              onHideAll={() => setDone(points.map((_, i) => i))}
                              lifetime={markerLifetime ?? 120}
                              onChangeLifetime={onChangeMarkerLifetime}
                              removed={msg.removedMarkers}
                              compact={compact}
                              referenced={compact ? markerMentions(msg.text, points) : undefined}
                              onTrack={compact && onTrackOnScreen ? () => onTrackOnScreen(msg.id) : undefined}
                              onHighlight={(i) => {
                                if (isDesktopApp && markersActiveFor(msg.id)) api?.highlightPointer?.(msg.id, i);
                              }}
                            />
              );
            };

            return (
              <div
                key={msg.id}
                className={`group/msg flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-full`}
              >
                {/* User or AI Message Header Tag */}
                <div className={`flex items-center gap-2 mb-1 text-[11px] font-mono ${isUser ? 'text-zinc-400 justify-end' : 'text-zinc-400'}`}>
                  {isUser ? (
                    <>
                      <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="font-semibold text-zinc-300 uppercase">{steamName || 'PLAYER'}</span>
                      {steamAvatar ? (
                        <img src={steamAvatar} alt={steamName || 'Player'} className="w-5 h-5 rounded-full border border-white/20" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-zinc-300">
                          <User className="w-3 h-3" />
                        </div>
                      )}
                    </>
                  ) : (
                    // One small grey line: "Fast · 10:38" (there's only one speaker; Spot it says so)
                    <span className="text-zinc-500 font-sans">
                      {[
                        msg.kind === 'spot' ? msg.modelUsed : modelKind(msg.modelUsed) ? t(`model.${modelKind(msg.modelUsed)}`) : '',
                        new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                      ].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>

                {/* Message Bubble Card */}
                <div
                  className={`relative rounded-2xl p-4 max-w-[94%] sm:max-w-[88%] transition-all ${
                    isUser
                      ? 'bg-gradient-to-br from-[#1a1528] to-[#120f1c] border border-[var(--accent-border)] text-white shadow-[0_4px_20px_rgba(0,0,0,0.4)]'
                      : 'bg-[#11121a]/95 border border-white/[0.08] text-zinc-200 shadow-[0_6px_25px_rgba(0,0,0,0.5)]'
                  }`}
                >
                  {!isUser && msg.collapsed ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <Flag className="w-3.5 h-3.5 text-rose-300 shrink-0" aria-hidden="true" />
                      <span className="flex-1">{t('report.hidden')}</span>
                      <button
                        type="button"
                        onClick={() => onUpdateMessage?.(msg.id, { collapsed: false })}
                        className="text-[var(--accent-color)] hover:underline cursor-pointer"
                      >
                        {t('report.showAnyway')}
                      </button>
                    </div>
                  ) : (<>
                  {!isUser && msg.bannerImageUrl && (
                    <div 
                      onClick={() => onOpenScreenModal(msg.bannerImageUrl!)}
                      title={t('chat.viewArt')}
                      className="mb-4 rounded-xl overflow-hidden border border-white/10 shadow-lg relative w-full bg-black/70 group cursor-pointer flex items-center justify-center min-h-[160px] max-h-[500px]"
                    >
                      {/* Ambient blurred backdrop for ultrawide bubbles */}
                      <img 
                        src={msg.bannerImageUrl} 
                        alt="" 
                        aria-hidden="true"
                        referrerPolicy="no-referrer"
                        className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-35 scale-110 pointer-events-none" 
                      />
                      {/* Full uncropped artwork */}
                      <img 
                        src={msg.bannerImageUrl} 
                        alt="Immersive Game Theme Banner" 
                        referrerPolicy="no-referrer"
                        className="relative z-10 w-full max-h-[480px] h-auto object-contain transition-transform duration-500 group-hover:scale-[1.01]" 
                      />
                      <div className="absolute top-2.5 right-2.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity bg-black/75 hover:bg-black/90 backdrop-blur-md text-white text-[11px] font-medium px-2.5 py-1 rounded-lg border border-white/20 shadow-md flex items-center gap-1.5 pointer-events-none">
                        <Maximize2 className="w-3 h-3 text-purple-300" />
                        <span>{t('chat.viewArt')}</span>
                      </div>
                    </div>
                  )}
                  {msg.imageUrl && (
                    <div 
                      onClick={() => onOpenScreenModal(msg.imageUrl!)}
                      title={t('chat.inspectShot')}
                      className="mb-3 rounded-lg overflow-hidden border border-white/[0.06] shadow-md group relative cursor-pointer"
                    >
                      <img src={msg.imageUrl} alt="Attached" className="max-w-full h-auto rounded-lg max-h-60 object-contain transition-transform duration-300 group-hover:opacity-90" />
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur-md text-white text-[10px] px-2 py-0.5 rounded border border-white/10 flex items-center gap-1">
                        <Maximize2 className="w-2.5 h-2.5 text-purple-300" />
                        <span>{t('chat.expand')}</span>
                      </div>
                    </div>
                  )}
                  {msg.audioBase64 && (
                    <div className="mb-3">
                      <audio controls src={msg.audioBase64} className="h-8 max-w-full w-[250px] outline-none" />
                    </div>
                  )}

                  {/* Message Body with Markdown */}
                  {!isUser && msg.place && (
                    <PlaceBar
                      msg={msg}
                      question={(() => {
                        const idx = activeTab.messages.findIndex((m) => m.id === msg.id);
                        for (let j = idx - 1; j >= 0; j--) if (activeTab.messages[j].role === 'user') return activeTab.messages[j];
                        return undefined;
                      })()}
                      confirmedPlace={activeTab.place?.confirmed ? activeTab.place.name : undefined}
                      confirmedStory={activeTab.place?.storyConfirmed ? activeTab.place.story : undefined}
                      onChoosePlace={(name) => {
                        onUpdateMessage?.(msg.id, { placeChosen: name });
                        onSetPlace?.(name);
                        // This answer corrected the guide: the player confirming where they are backs up the correction's area.
                        if (msg.correctionIds?.length) confirmCorrectionsPlace(msg.correctionIds);
                      }}
                      onChooseStory={(story) => {
                        onUpdateMessage?.(msg.id, { storyChosen: story });
                        onSetStory?.(story);
                      }}
                      onLocate={onLocate}
                      locating={locating}
                      locateNote={locateNote}
                      onReask={(name, story, q) => {
                        if (isLoading) return;
                        const where = story ? `${name} (${story})` : name;
                        onSendMessage(t('place.reaskQuestion', { place: where, question: q.text }), q.imageUrl || undefined);
                      }}
                    />
                  )}
                  {!isDesktopApp && markerCard(false)}
                  <div style={{ fontFamily: 'var(--chat-font-family)' }} className="qc-md leading-relaxed break-words space-y-2.5 [&_p]:mb-2.5 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_strong]:text-white [&_strong]:font-semibold [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-[var(--accent-color)] [&_h1]:border-b [&_h1]:border-white/10 [&_h1]:pb-1 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-[var(--accent-color)] [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-white [&_code]:bg-black/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-purple-300 [&_code]:font-code [&_code]:text-xs [&_pre]:bg-black/80 [&_pre]:border [&_pre]:border-white/10 [&_pre]:p-3.5 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_table]:my-2 [&_th]:border [&_th]:border-white/15 [&_th]:p-2 [&_th]:bg-white/[0.06] [&_th]:font-semibold [&_th]:text-xs [&_td]:border [&_td]:border-white/10 [&_td]:p-2 [&_td]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--accent-color)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-zinc-400">
                    <MessageMarkdown
                      markerKey={!isUser && markersOn && msg.points?.length ? `${msg.points.length}:${(msg.donePoints ?? []).join(',')}` : ''}
                      link={({ href, children, node, ...rest }: any) => {
                          const m = typeof href === 'string' ? href.match(/^#qc-marker-(\d+)$/) : null;
                          if (m && !isUser && msg.points) {
                            const i = Number(m[1]) - 1;
                            const done = msg.donePoints ?? [];
                            return (
                              <MarkerBadge
                                n={i + 1}
                                label={msg.points[i]?.label ?? ''}
                                checked={done.includes(i)}
                                onToggle={() => {
                                  const next = done.includes(i) ? done.filter((d) => d !== i) : [...done, i].sort((x, y) => x - y);
                                  onUpdateMessage?.(msg.id, { donePoints: next });
                                  const api = (window as any).electronAPI;
                                  if (!isDesktopApp) return;
                                  if (next.length >= msg.points.length) api?.hideScreenPointers?.();
                                  else if (markersActiveFor(msg.id)) api?.setPointersHidden?.(msg.id, next);
                                }}
                              />
                            );
                          }
                          return (
                            <a href={href} {...rest}>
                              {children}
                            </a>
                          );
                        }}
                      text={!isUser && markersOn && msg.points?.length ? withMarkerBadges(msg.text, msg.points) : msg.text}
                    />
                  </div>
                  {isDesktopApp && markerCard(true)}

                  {/* Answer actions: a small bar on the answer's bottom edge, shown on hover or keyboard / controller
                      focus (always on touch screens), and kept while reading aloud, just copied or saved, or asking
                      what was wrong after a 👎. It takes no room in the answer. */}
                  {!isUser && (
                    <div className={`absolute -bottom-4 right-3 z-10 text-xs text-zinc-400 transition-opacity duration-150 focus-within:opacity-100 ${
                      isAudioPlaying || isNoteSaved || copiedMessageId === msg.id || voteAsk === msg.id || actionMenu === msg.id ? '' : '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/msg:opacity-100'
                    }`}>
                      <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-[#171822] border border-white/[0.12] shadow-[0_4px_14px_rgba(0,0,0,0.55)]">
                        {/* Audio TTS button with animated wave indicator / stop control */}
                        <button
                          onClick={() => handlePlayTTS(msg.id, msg.text)}
                          title={isAudioPlaying ? t('chat.stopNarration') : t('chat.readAloud')}
                          className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer text-xs font-medium ${
                            isAudioPlaying 
                              ? 'text-emerald-300 bg-emerald-500/20 border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.3)] hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/40' 
                              : 'text-zinc-400 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          {isAudioPlaying ? (
                            audioLoadingId === msg.id ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                                <span className="text-[10px] font-mono">{t('chat.generating')}</span>
                              </>
                            ) : (
                              <>
                                <Square className="w-3 h-3 fill-current text-emerald-400 group-hover:text-rose-400" />
                                <div className="flex items-center gap-0.5 h-3">
                                  <span className="w-0.5 bg-emerald-400 rounded-full animate-soundwave-1" />
                                  <span className="w-0.5 bg-emerald-400 rounded-full animate-soundwave-2" />
                                  <span className="w-0.5 bg-emerald-400 rounded-full animate-soundwave-3" />
                                  <span className="w-0.5 bg-emerald-400 rounded-full animate-soundwave-4" />
                                </div>
                                <span className="text-[10px] font-mono">{t('chat.stop')}</span>
                              </>
                            )
                          ) : (
                            <>
                              <Volume2 className="w-3.5 h-3.5" aria-label={t('chat.listen')} />
                            </>
                          )}
                        </button>

                        {/* 👍 / 👎: one tap; a 👎 then offers "What was wrong?" (optional) */}
                        {(['up', 'down'] as const).map((v) => {
                          const on = msg.vote === v;
                          const Icon = v === 'up' ? ThumbsUp : ThumbsDown;
                          return (
                            <button
                              key={v}
                              onClick={() => {
                                playBlipSound(soundEnabled);
                                const next = on ? undefined : v;
                                onUpdateMessage?.(msg.id, { vote: next, voteReason: undefined });
                                if (next === 'down') setVoteAsk(msg.id);
                                else if (voteAsk === msg.id) setVoteAsk(null);
                                void sendVote(msg, next ?? 'none');
                              }}
                              title={t(v === 'up' ? 'vote.up' : 'vote.down')}
                              aria-label={t(v === 'up' ? 'vote.up' : 'vote.down')}
                              aria-pressed={on}
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-white/10 ${on ? (v === 'up' ? 'text-emerald-300' : 'text-amber-300') : 'text-zinc-400 hover:text-white'}`}
                            >
                              <Icon className="w-3.5 h-3.5" fill={on ? 'currentColor' : 'none'} />
                            </button>
                          );
                        })}

                        {/* ⋯: save to notes, copy, report */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setActionMenu(actionMenu === msg.id ? null : msg.id)}
                            aria-haspopup="menu"
                            aria-expanded={actionMenu === msg.id}
                            title={t('header.menu')}
                            aria-label={t('header.menu')}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-white/10 ${actionMenu === msg.id ? 'text-white bg-white/10' : 'text-zinc-400 hover:text-white'}`}
                          >
                            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="3" cy="8" r="1.5" fill="currentColor" /><circle cx="8" cy="8" r="1.5" fill="currentColor" /><circle cx="13" cy="8" r="1.5" fill="currentColor" /></svg>
                          </button>
                          {actionMenu === msg.id && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setActionMenu(null)} aria-hidden="true" />
                              <div
                                role="menu"
                                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setActionMenu(null); } }}
                                className="absolute right-0 bottom-9 z-50 w-52 py-1 rounded-xl bg-[#161620] border border-white/15 shadow-2xl"
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  autoFocus
                                  onClick={() => { handleSaveToNotes(msg.id, msg.text); setActionMenu(null); }}
                                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer"
                                >
                                  <BookmarkPlus className="w-3.5 h-3.5 text-purple-300" />
                                  {t('chat.saveTitle')}
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => { handleCopyMessage(msg.id, msg.text); setActionMenu(null); }}
                                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer"
                                >
                                  <Copy className="w-3.5 h-3.5 text-zinc-400" />
                                  {t('chat.copy')}
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setActionMenu(null);
                                    const idx = activeTab.messages.findIndex((m) => m.id === msg.id);
                                    let question = '';
                                    for (let j = idx - 1; j >= 0; j--) if (activeTab.messages[j].role === 'user') { question = activeTab.messages[j].text; break; }
                                    setReportTarget({
                                      messageId: msg.id, answer: msg.text, question,
                                      game: activeTab.activeSteamGame?.name || activeGame?.name || activeTab.name,
                                      place: msg.placeChosen || msg.place?.name || activeTab.place?.name,
                                      model: msg.modelUsed,
                                    });
                                  }}
                                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] hover:bg-white/[0.07] focus:bg-white/[0.07] outline-none cursor-pointer ${msg.reported ? 'text-rose-300' : 'text-zinc-200'}`}
                                >
                                  <Flag className="w-3.5 h-3.5 text-rose-300" fill={msg.reported ? 'currentColor' : 'none'} />
                                  {msg.reported ? t('report.reported') : t('report.tooltip')}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        {/* Saved or copied: a tick for a moment */}
                        {(isNoteSaved || copiedMessageId === msg.id) && <Check className="w-3.5 h-3.5 mx-1 text-green-400" aria-label={isNoteSaved ? t('chat.saved') : t('chat.copy')} />}
                      </div>
                    </div>
                  )}

                  {/* After a 👎: what was wrong (optional, one tap) */}
                  {!isUser && voteAsk === msg.id && msg.vote === 'down' && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]" role="group" aria-label={t('vote.whatWrong')}>
                      <span className="text-zinc-400 mr-0.5">{t('vote.whatWrong')}</span>
                      {VOTE_REASONS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => {
                            playBlipSound(soundEnabled);
                            onUpdateMessage?.(msg.id, { voteReason: r });
                            setVoteAsk(null);
                            void sendVote(msg, 'down', r);
                          }}
                          className="qc-px-frame px-2 py-0.5 rounded-full border border-white/15 text-zinc-300 hover:text-white hover:border-[var(--accent-border)] cursor-pointer"
                        >
                          {t(`vote.reason.${r}`)}
                        </button>
                      ))}
                      <button type="button" onClick={() => setVoteAsk(null)} aria-label={t('vote.skip')} className="px-1 text-zinc-500 hover:text-white cursor-pointer">×</button>
                    </div>
                  )}

                  {/* "From the guide": the answer used checked guide entries; each opens the guide at that entry */}
                  {!isUser && msg.guideRefs && msg.guideRefs.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {msg.guideRefs.map((r, i) => (
                        <button
                          key={`${r.slug}:${r.entry || i}`}
                          type="button"
                          onClick={() => window.dispatchEvent(new CustomEvent('qc-open-guide', { detail: { slug: r.slug, entry: r.entry } }))}
                          title={t('guideBadge.open', { name: r.name, area: r.area })}
                          className="qc-px-frame inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/30 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/20 cursor-pointer"
                        >
                          <BookOpen className="w-3 h-3" />
                          {i === 0 ? t('guideBadge.label') : ''}
                          <span className="font-normal text-emerald-100/80 max-w-[14rem] truncate">{i === 0 ? `· ${r.name}` : r.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Every marker was dropped by the close-up check: what they were and where, in words */}
                  {!isUser && msg.removedMarkers && msg.removedMarkers.length > 0 && !(msg.points && msg.points.length) && (
                    <p className="mt-2 text-[11px] leading-snug text-zinc-400">{unmarkedLine(t, msg.removedMarkers)}</p>
                  )}

                  {/* TTS Error / Connection diagnostic notification if speech failed */}
                  {ttsStatusError && ttsStatusError.msgId === msg.id && (
                    <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/25 flex items-start gap-2 text-xs text-red-300 animate-fadeIn">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                      <div className="flex-1 text-[11px] leading-relaxed">
                        {ttsStatusError.error}
                      </div>
                      <button 
                        onClick={() => setTtsStatusError(null)}
                        className="text-zinc-400 hover:text-white p-0.5 text-[10px] cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  </>)}
                </div>

                {/* Missable here: the guide's missables in the area the latest answer is about, not ticked yet. Each opens
                    the guide at its entry. From guide data, no AI. */}
                {!isUser && msg.id === lastAssistantId && !isLoading && missablesHere && missablesHere.items.length > 0 &&
                  (!(msg.placeChosen || msg.place?.name) || samePlace(msg.placeChosen || msg.place?.name, missablesHere.area)) && (
                  <div className="qc-px-frame mt-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2.5 max-w-full">
                    <div className="flex items-center gap-1.5 text-[12px] font-bold text-amber-200">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                      <span>{t('answer.missHere', { area: missablesHere.area })}</span>
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {missablesHere.items.slice(0, 3).map((it) => {
                        const [, slug, ...rest] = it.id.split(':');
                        const entry = rest.join(':').split('+')[0];
                        // Why it can be missed when the guide says so (a section title like "Don't miss" says nothing), else where it is.
                        const sub = it.why && it.why.length > 24 ? it.why : it.where;
                        return (
                          <li key={it.id}>
                            <button
                              type="button"
                              onClick={() => window.dispatchEvent(new CustomEvent('qc-open-guide', { detail: { slug, entry } }))}
                              title={t('answer.missOpen')}
                              className="w-full text-left text-[12.5px] leading-snug rounded-md px-1.5 py-1 -mx-1.5 hover:bg-amber-500/10 cursor-pointer"
                            >
                              <span className="font-semibold text-zinc-100">{it.label}</span>
                              {sub && <span className="block text-[11.5px] text-zinc-400 line-clamp-2">{sub.charAt(0).toUpperCase() + sub.slice(1)}</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {missablesHere.items.length > 3 && (
                      <button
                        type="button"
                        onClick={() => {
                          const [, slug] = missablesHere.items[0].id.split(':');
                          window.dispatchEvent(new CustomEvent('qc-open-guide', { detail: { slug } }));
                        }}
                        className="mt-1 text-[11.5px] font-semibold text-amber-200 hover:text-amber-100 cursor-pointer"
                      >
                        {t('answer.missMore', { n: missablesHere.items.length - 3 })} →
                      </button>
                    )}
                  </div>
                )}

                {/* A fight: "Next turn" asks again with a fresh screenshot (a normal question) */}
                {!isUser && msg.combat && msg.id === lastAssistantId && !isLoading && onNextTurn && (
                  <button
                    type="button"
                    onClick={() => {
                      playBlipSound(soundEnabled);
                      onNextTurn();
                    }}
                    title={t('tracker.nextTurnHint')}
                    className="qc-px-frame mt-2.5 px-3.5 py-1.5 rounded-full border border-[var(--accent-color)] text-[12.5px] font-bold text-[var(--accent-color)] hover:bg-[var(--accent-color)] hover:text-black transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    ⟳ {t('tracker.nextTurn')}
                  </button>
                )}

              </div>
            );
          })
        )}

        {/* A guest's last question today: one card under it (what signing in gives), dismissible for the day. */}
        {isGuest && onSignIn && !isLoading && activeTab?.messages?.length && activeTab.messages[activeTab.messages.length - 1].signInNudge ? (
          <SignInCard onSignIn={onSignIn} pro={quota?.signedInPro} fast={quota?.signedInFlash} />
        ) : null}

        {/* Animated 3D Levitating Tome Loader */}
        {isLoading && (
          <div className="flex items-center gap-3 ml-4 mb-4 w-fit">
            <div className="w-5 h-5 shrink-0 flex items-center justify-center animate-magical-flip">
              <QuestLogo size={16} compact />
            </div>
            <span className="qc-keep-anim font-fantasy font-bold text-xs text-[var(--accent-color)] tracking-wide animate-pulse mt-1">
              {t('chat.consulting')}
            </span>
          </div>
        )}
      </div>

      {/* Screenshot Upload / Attached Thumbnail Preview Bar */}
      {attachedImage && (
        <div className="px-4 py-2.5 bg-[#12131c]/95 border-t border-white/10 flex items-center justify-between backdrop-blur-2xl">
          <div className="flex items-center gap-3">
            <div className="relative rounded-lg overflow-hidden border border-[var(--accent-border)] w-12 h-12 flex-shrink-0 shadow-md">
              <img src={attachedImage} alt={t('chat.shotAlt')} className="w-full h-full object-cover" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                {t('chat.shotAttached')}
              </span>
              <span className="text-[11px] text-zinc-400">{t('chat.shotReady')}</span>
            </div>
          </div>

          <button
            onClick={() => setAttachedImage(null)}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-red-500/20 text-zinc-400 hover:text-red-300 transition-colors cursor-pointer"
            title={t('chat.removeShot')}
            aria-label={t('chat.removeShot')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {askForm}

      {/* Embedded Browser Screen Capture Guidance Modal */}
      <ReportAnswerModal
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        onSent={(reason) => {
          // An offensive or harmful answer is folded away for the player ("Show anyway" opens it).
          if (reportTarget) onUpdateMessage?.(reportTarget.messageId, { reported: reason, ...(reason === 'harmful' ? { collapsed: true } : {}) });
        }}
      />
      {showIframeCaptureNotice && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0e0e14] border border-amber-500/30 rounded-2xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>Screen Capture in Embedded Browser</span>
              </div>
              <button
                onClick={() => setShowIframeCaptureNotice(false)}
                className="text-zinc-500 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Browser security rules restrict embedded games (such as Itch.io iframes) from accessing screen capture APIs or selecting individual computer windows.
            </p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              To select and capture game windows directly on your computer, open the Standalone Web App or use the Desktop version. You can also upload a screenshot file below.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={() => {
                  setShowIframeCaptureNotice(false);
                  fileInputRef.current?.click();
                }}
                className="flex-1 py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors cursor-pointer text-center"
              >
                Upload File
              </button>
              <a
                href={DEFAULT_PREVIEW_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => setShowIframeCaptureNotice(false)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-[var(--accent-color)] text-black text-xs font-bold transition-colors flex items-center justify-center gap-1.5 hover:bg-white cursor-pointer text-center"
              >
                <span>Open Standalone App</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
