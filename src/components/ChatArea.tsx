import React, { useState, useRef, useEffect } from 'react';
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
  Compass,
  Sword,
  Shield,
  Key,
  Layers,
  Bot,
  User,
  ExternalLink,
  Flame,
  Info,
  AlertTriangle,
  AlertCircle
} from './icons';
import { AnnotatedShot } from './ScreenPointers';
import { ChatMessage, GameTab, AiMode, SteamGameData } from '../types';
import { getApiBaseUrl, DEFAULT_PREVIEW_URL } from '../utils/api';
import { auth } from '../lib/firebase';
import { playSnapSound, playChimeSound, playBlipSound } from '../utils/audio';
import { useT } from '../i18n';

/** Quick follow-ups offered under the latest answer (sent as a normal question, in the user's language). */
const FOLLOW_UP_KEYS = ['chat.follow1', 'chat.follow2', 'chat.follow3'];

interface ChatAreaProps {
  activeTab: GameTab | null;
  onSendMessage: (text: string, imageBase64?: string, audioBase64?: string, preferredModel?: 'pro' | 'flash') => Promise<void>;
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
  fontMenuOpen?: boolean;
  onToggleFontMenu?: () => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  activeTab,
  onSendMessage,
  isLoading,
  aiMode,
  activeGame,
  soundEnabled,
  onAppendToNotes,
  onOpenScreenModal,
  ttsVoice,
  customApiKey,
  openAiApiKey,
  steamName,
  steamAvatar,
  fontMenuOpen,
  onToggleFontMenu,
}) => {
  const t = useT();
  const [inputQuestion, setInputQuestion] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [preferredModel, setPreferredModel] = useState<'pro' | 'flash'>('pro');
  const attachedImageRef = useRef<string | null>(null);

  useEffect(() => {
    attachedImageRef.current = attachedImage;
  }, [attachedImage]);
  const [isRecording, setIsRecording] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
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

  const startVoiceRecording = async () => {
    if (isRecording) return;

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
        if (!finalImage) {
          finalImage = await captureGameScreen();
        }

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

  // Controller: a question picked from the quick-questions list or typed on the on-screen keyboard.
  const handleControllerAsk = (e: Event) => {
    const text = (e as CustomEvent).detail?.text;
    if (typeof text === 'string' && text.trim() && !isLoading) {
      setInputQuestion('');
      handleSubmit(undefined, text.trim());
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
    window.addEventListener('trigger-auto-screenshot-submit', handleAutoScreenshotSubmit);
    window.addEventListener('qc-ask', handleControllerAsk);
    window.addEventListener('qc-set-input', handleControllerInput);
    return () => {
      window.removeEventListener('trigger-voice-start', startVoiceRecording);
      window.removeEventListener('trigger-voice-stop', stopVoiceRecording);
      window.removeEventListener('trigger-voice-record', toggleVoiceRecording);
      window.removeEventListener('trigger-auto-screenshot-submit', handleAutoScreenshotSubmit);
      window.removeEventListener('qc-ask', handleControllerAsk);
      window.removeEventListener('qc-set-input', handleControllerInput);
    };
  }, [isRecording, soundEnabled, attachedImage, onSendMessage, inputQuestion, isLoading]);

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

  const handleSubmit = async (e?: React.FormEvent, overrideText?: string, overrideImage?: string) => {
    if (e) e.preventDefault();
    if (isLoading) return;

    // In electron, we auto-capture if no image is attached
    const isElectron = !!(typeof window !== 'undefined' && (window as any).electronAPI);
    let finalImage = overrideImage !== undefined ? overrideImage : attachedImage;
    let finalQuestion = overrideText !== undefined ? overrideText : inputQuestion.trim();
    
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

    await onSendMessage(finalQuestion, finalImage || undefined, undefined, preferredModel);
    playChimeSound(soundEnabled);
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
        setTtsStatusError({ msgId, error: reason });
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

  const gamePrompts = [
    { title: t('chat.p1.title'), desc: t('chat.p1.desc'), icon: Sword, color: 'text-rose-400', query: t('chat.p1.q') },
    { title: t('chat.p2.title'), desc: t('chat.p2.desc'), icon: Compass, color: 'text-cyan-400', query: t('chat.p2.q') },
    { title: t('chat.p3.title'), desc: t('chat.p3.desc'), icon: Shield, color: 'text-emerald-400', query: t('chat.p3.q') },
    { title: t('chat.p4.title'), desc: t('chat.p4.desc'), icon: Key, color: 'text-amber-400', query: t('chat.p4.q') },
  ];

  const questionCount = activeTab?.messages?.filter((m) => m.role === 'user').length ?? 0;
  const lastAssistantId = (() => {
    const msgs = activeTab?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') return msgs[i].id;
    return null;
  })();
  const isDesktopApp = typeof window !== 'undefined' && !!(window as any).electronAPI;
  const gameLabel = activeGame?.name || activeTab?.activeSteamGame?.name || '';

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gradient-to-b from-[#0d0e14] via-[#090a0f] to-[#07070b] relative crt-grid">
      {/* Conversation header: which compendium, which game, which persona */}
      {activeTab && (
        <div className="h-11 flex-shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 border-b border-white/[0.06] bg-black/20">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <span className="font-fantasy font-bold text-sm text-white truncate">{activeTab.name}</span>
            <span className="hidden sm:inline text-[11px] text-zinc-500 truncate">
              {[activeGame?.name || activeTab.activeSteamGame?.name, t('chat.personaLabel', { name: t(`chat.persona.${aiMode}`) })].filter(Boolean).join(' · ')}
            </span>
          </div>
          {questionCount > 0 && (
            <span className="text-[10px] font-mono uppercase text-zinc-500 flex-shrink-0">
              {t(questionCount === 1 ? 'chat.q1' : 'chat.qN', { n: questionCount })}
            </span>
          )}
        </div>
      )}

      {/* Messages List Area */}
      <div 
        ref={chatContainerRef}
        data-qc-scroll
        className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6"
      >
        {(!activeTab?.messages || activeTab.messages.length === 0) ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 sm:p-8 max-w-2xl mx-auto select-none my-auto">
            {/* Illuminated Center Crest */}
            <div className="relative mb-5 group">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[var(--accent-dim)] to-black/60 border border-[var(--accent-border)] flex items-center justify-center shadow-[0_0_30px_var(--accent-glow)]">
                <Sparkles className="w-10 h-10 text-[var(--accent-color)] animate-pulse" />
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

            {/* Categorized Inquiry Prompts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
              {gamePrompts.map((p, idx) => {
                const Icon = p.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setInputQuestion(p.query);
                      playBlipSound(soundEnabled);
                    }}
                    className="p-3 rounded-xl bg-black/40 hover:bg-white/[0.06] border border-white/[0.08] hover:border-[var(--accent-border)] text-xs text-zinc-300 hover:text-white transition-all cursor-pointer group shadow-sm flex items-start gap-3"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-center flex-shrink-0 group-hover:border-[var(--accent-border)] group-hover:bg-[var(--accent-dim)] transition-colors">
                      <Icon className={`w-4 h-4 ${p.color} group-hover:scale-110 transition-transform`} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-white group-hover:text-[var(--accent-color)] transition-colors mb-0.5 leading-snug">
                        {p.title}
                      </div>
                      <div className="text-[11px] text-zinc-400 leading-snug">
                        {p.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Quick Pro-Tip Bar */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-zinc-400 font-mono">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-[11px]">
                <Camera className="w-3 h-3 text-[var(--accent-color)]" />
                {typeof window !== 'undefined' && (window as any).electronAPI ? (
                  <span>{t('chat.heroAuto')}</span>
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

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-full`}
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
                    <>
                      <div className="w-5 h-5 rounded-md bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent-color)]">
                        <Sparkles className="w-3 h-3" />
                      </div>
                      <span className="font-fantasy font-bold text-zinc-200">{t('chat.compendium')}</span>
                      <span className="px-1.5 py-0.2 rounded bg-white/10 text-[9.5px] text-zinc-400">
                        {msg.modelUsed || 'GEMINI'}
                      </span>
                      <span className="text-zinc-500">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </>
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
                  {!isUser && msg.points && msg.points.length > 0 && (
                    <AnnotatedShot
                      imageUrl={(() => {
                        // The screenshot this answer is about: the nearest earlier question that had one.
                        for (let i = msgIndex - 1; i >= 0; i--) {
                          const m = activeTab.messages[i];
                          if (m.role === 'user') return m.imageUrl;
                        }
                        return undefined;
                      })()}
                      points={msg.points}
                      onShowOnScreen={
                        isDesktopApp
                          ? () => {
                              const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
                              (window as any).electronAPI?.showScreenPointers?.(msg.points, accent);
                            }
                          : undefined
                      }
                    />
                  )}
                  <div style={{ fontFamily: 'var(--chat-font-family)' }} className="qc-md leading-relaxed break-words space-y-2.5 [&_p]:mb-2.5 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_strong]:text-white [&_strong]:font-semibold [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-[var(--accent-color)] [&_h1]:border-b [&_h1]:border-white/10 [&_h1]:pb-1 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-[var(--accent-color)] [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-white [&_code]:bg-black/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-purple-300 [&_code]:font-code [&_code]:text-xs [&_pre]:bg-black/80 [&_pre]:border [&_pre]:border-white/10 [&_pre]:p-3.5 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_table]:my-2 [&_th]:border [&_th]:border-white/15 [&_th]:p-2 [&_th]:bg-white/[0.06] [&_th]:font-semibold [&_th]:text-xs [&_td]:border [&_td]:border-white/10 [&_td]:p-2 [&_td]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--accent-color)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-zinc-400">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.text}
                    </ReactMarkdown>
                  </div>

                  {/* Message Bottom Toolbar (for AI responses) */}
                  {!isUser && (
                    <div className="mt-3.5 pt-2.5 border-t border-white/[0.08] flex items-center justify-between text-xs text-zinc-400">
                      <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                      </div>

                      <div className="flex items-center gap-1.5">
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
                              <Volume2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline text-[11px]">{t('chat.listen')}</span>
                            </>
                          )}
                        </button>

                        {/* Save to Notes Button */}
                        <button
                          onClick={() => handleSaveToNotes(msg.id, msg.text)}
                          title={t('chat.saveTitle')}
                          className="px-2 py-1 rounded-lg text-zinc-400 hover:text-purple-300 hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1"
                        >
                          {isNoteSaved ? (
                            <Check className="w-3.5 h-3.5 text-green-400" />
                          ) : (
                            <BookmarkPlus className="w-3.5 h-3.5" />
                          )}
                          <span className="hidden sm:inline text-[11px]">{isNoteSaved ? t('chat.saved') : t('chat.save')}</span>
                        </button>

                        {/* Copy button */}
                        <button
                          onClick={() => handleCopyMessage(msg.id, msg.text)}
                          title={t('chat.copy')}
                          aria-label={t('chat.copy')}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                        >
                          {copiedMessageId === msg.id ? (
                            <Check className="w-3.5 h-3.5 text-green-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
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
                </div>

                {/* Suggested follow-ups under the latest answer */}
                {!isUser && msg.id === lastAssistantId && !isLoading && (
                  <div className="mt-2.5 flex flex-wrap gap-2 max-w-[94%] sm:max-w-[88%]">
                    {FOLLOW_UP_KEYS.map((key) => t(key)).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => {
                          playBlipSound(soundEnabled);
                          handleSubmit(undefined, f);
                        }}
                        className="qc-px-frame px-3 py-1.5 rounded-full bg-[var(--accent-dim)] border border-[var(--accent-border)] text-[12px] font-medium text-zinc-200 hover:text-white hover:bg-[var(--accent-border)] transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Sparkles className="w-3 h-3 text-[var(--accent-color)]" />
                        {f}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Animated 3D Levitating Tome Loader */}
        {isLoading && (
          <div className="flex items-center gap-3 ml-4 mb-4 w-fit">
            <div className="w-5 h-5 shrink-0 flex items-center justify-center animate-magical-flip">
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 4C6 2.89543 6.89543 2 8 2H22C23.1046 2 24 2.89543 24 4V28C24 29.1046 23.1046 30 22 30H8C6.89543 30 6 29.1046 6 28V4Z" fill="#140d24" />
                <path d="M6 4C6 2.89543 6.89543 2 8 2H10V30H8C6.89543 30 6 29.1046 6 28V4Z" fill="#d9cdb4" />
                <rect x="5" y="28" width="24" height="2" fill="#050508" opacity="0.7"/>
                <rect x="24" y="6" width="4" height="20" fill="#d9cdb4" />
                <rect x="8" y="4" width="16" height="24" fill="#140d24" />
                <rect x="15" y="12" width="2" height="8" fill="var(--accent-color)" />
                <rect x="13" y="14" width="6" height="4" fill="var(--accent-color)" />
                <rect x="14" y="14" width="4" height="4" fill="var(--accent-glow)" />
              </svg>
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

      {/* Floating HUD Input Form Bar */}
      <form onSubmit={handleSubmit} className="p-3 sm:p-4 bg-[#0a0b10]/90 border-t border-white/[0.08] backdrop-blur-2xl">
        <div className="relative flex items-center rounded-2xl bg-[#13141d] border border-white/15 focus-within:border-[var(--accent-color)] focus-within:shadow-[0_0_20px_var(--accent-glow)] transition-all shadow-lg">
          <textarea
            data-qc-ask-input
            value={inputQuestion}
            onChange={(e) => setInputQuestion(e.target.value)}
            onPaste={handleTextareaPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
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
            className="flex-1 max-h-48 min-h-[72px] py-4 pl-4 pr-4 sm:pr-4 pb-14 bg-transparent text-white outline-none resize-none"
          />

          {/* Action Buttons inside Input Bar */}
          <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">

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

            {/* Font Quick Switcher */}
            {onToggleFontMenu && (
              <button
                type="button"
                onClick={() => {
                  playBlipSound(soundEnabled);
                  onToggleFontMenu();
                }}
                title={t('chat.fontSettings')}
                aria-label={t('chat.fontSettings')}
                className={`p-2 rounded-xl transition-all cursor-pointer ${
                  fontMenuOpen 
                    ? 'bg-[var(--accent-dim)] text-[var(--accent-color)] border border-[var(--accent-border)] shadow-[0_0_12px_var(--accent-glow)]' 
                    : 'text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/10'
                }`}
              >
                <span className="font-bold font-serif text-[15px] leading-none px-0.5">Aa</span>
              </button>
            )}

            {/* Model switch: Pro (smarter) or Flash (faster) */}
            <div role="group" aria-label={t('chat.model')} className="flex items-center p-0.5 rounded-xl bg-white/[0.05] border border-white/10">
              {(['pro', 'flash'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={preferredModel === m}
                  onClick={() => {
                    playBlipSound(soundEnabled);
                    setPreferredModel(m);
                  }}
                  title={m === 'pro' ? t('chat.proTitle') : t('chat.flashTitle')}
                  className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                    preferredModel === m
                      ? m === 'pro'
                        ? 'bg-[var(--accent-dim)] text-[var(--accent-color)] shadow-[inset_0_-2px_0_var(--accent-color)]'
                        : 'bg-amber-500/20 text-amber-300 shadow-[inset_0_-2px_0_#f59e0b]'
                      : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Submit Send Button */}
            <button
              type="submit"
              aria-label={t('chat.send')}
              disabled={
                (!inputQuestion.trim() && !attachedImage && !(typeof window !== 'undefined' && (window as any).electronAPI)) ||
                isLoading ||
                isCapturingScreen
              }
              title={
                isCapturingScreen
                  ? t('chat.snapping')
                  : !inputQuestion.trim() && !attachedImage && typeof window !== 'undefined' && (window as any).electronAPI
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
          </div>
        </div>
        <div className="mt-2 text-center text-[10px] font-mono uppercase text-zinc-500">
          {isDesktopApp ? t('chat.hintDesktop') : t('chat.hintWeb')}
        </div>
      </form>

      {/* Embedded Browser Screen Capture Guidance Modal */}
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
