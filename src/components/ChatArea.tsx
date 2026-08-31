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
  X, 
  Sparkles, 
  BookmarkPlus, 
  Copy, 
  Check, 
  Eye, 
  Compass,
  Sword,
  Shield,
  Key,
  Layers,
  Bot,
  User,
  ExternalLink,
  Flame,
  Info
} from 'lucide-react';
import { ChatMessage, GameTab, AiMode, SteamGameData } from '../types';
import { playSnapSound, playChimeSound, playBlipSound } from '../utils/audio';

interface ChatAreaProps {
  activeTab: GameTab | null;
  onSendMessage: (text: string, imageBase64?: string) => Promise<void>;
  isLoading: boolean;
  aiMode: AiMode;
  activeGame: SteamGameData | null;
  soundEnabled: boolean;
  onAppendToNotes: (text: string) => void;
  onOpenScreenModal: (imageUrl: string) => void;
  ttsVoice: string;
  customApiKey?: string;
  steamName?: string;
  steamAvatar?: string;
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
  steamName,
  steamAvatar,
}) => {
  const [inputQuestion, setInputQuestion] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [savedNoteMessageId, setSavedNoteMessageId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [isCapturingScreen, setIsCapturingScreen] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);

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

  // Web Speech Recognition for Voice Input
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          const transcript = Array.from(event.results)
            .map((res: any) => res[0].transcript)
            .join('');
          setInputQuestion(transcript);
        };

        recognition.onerror = () => {
          setIsRecording(false);
        };

        recognition.onend = () => {
          setIsRecording(false);
        };

        recognitionRef.current = recognition;
      }
    }
  }, []);

  const toggleVoiceRecording = () => {
    playBlipSound(soundEnabled);
    if (!recognitionRef.current) {
      alert('Voice speech recognition is not supported in this browser. Please type your inquiry.');
      return;
    }

    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (err) {
        console.error('Speech recognition error:', err);
      }
    }
  };

  // Live Screen Capture from Game Window (WebRTC DisplayMedia)
  const captureGameScreen = async () => {
    try {
      setIsCapturingScreen(true);
      playSnapSound(soundEnabled);

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'window',
        },
        audio: false,
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setAttachedImage(dataUrl);
        playChimeSound(soundEnabled);
      }

      // Stop all video tracks
      stream.getTracks().forEach(track => track.stop());
      setIsCapturingScreen(false);
    } catch (err) {
      console.error('Screen capture cancelled or failed:', err);
      setIsCapturingScreen(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputQuestion.trim() && !attachedImage) || isLoading) return;

    const question = inputQuestion.trim();
    const image = attachedImage || undefined;

    setInputQuestion('');
    setAttachedImage(null);

    playSnapSound(soundEnabled);
    await onSendMessage(question, image);
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

  const handlePlayTTS = async (msgId: string, text: string) => {
    playBlipSound(soundEnabled);

    // Stop current audio if playing
    if (playingAudioId === msgId && currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
      setPlayingAudioId(null);
      return;
    }

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    try {
      setPlayingAudioId(msgId);

      // Call server TTS endpoint
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: ttsVoice || 'Kore', customApiKey }),
      });

      if (res.ok) {
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await res.json();
          if (data.audioBase64) {
            const audio = new Audio(`data:audio/mp3;base64,${data.audioBase64}`);
            currentAudioRef.current = audio;
            audio.onended = () => setPlayingAudioId(null);
            audio.onerror = () => setPlayingAudioId(null);
            await audio.play();
            return;
          }
        }
      }

      // Browser Web Speech fallback
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text.slice(0, 400));
        utterance.rate = 1.05;
        utterance.onend = () => setPlayingAudioId(null);
        utterance.onerror = () => setPlayingAudioId(null);
        window.speechSynthesis.speak(utterance);
      }
    } catch (err) {
      console.error('TTS playback failed:', err);
      setPlayingAudioId(null);
    }
  };

  const gamePrompts = [
    { 
      title: 'Boss Mechanics & Vulnerabilities',
      desc: 'Phase triggers, attack patterns, parry timings & element weaknesses',
      icon: Sword,
      color: 'text-rose-400',
      query: 'Analyze the current boss or major encounter: provide attack phases, dodge windows, weakness types, and recommended counters.' 
    },
    { 
      title: 'World Navigation & Checkpoints',
      desc: 'Optimal routing, nearest safe havens, and fast-travel landmarks',
      icon: Compass,
      color: 'text-cyan-400',
      query: 'Where should I head next in this zone? What are the key checkpoints, shortcuts, and safe bonfires / sites nearby?' 
    },
    { 
      title: 'Build Synergy & Gear Scaling',
      desc: 'Optimal stat thresholds, weapon affinities, and talisman loadouts',
      icon: Shield,
      color: 'text-emerald-400',
      query: 'What is the most effective stat allocation, weapon scaling, and gear synergy for this build archetype and current stage?' 
    },
    { 
      title: 'Cryptic Puzzles & Missable Secrets',
      desc: 'Dungeon riddles, hidden illusory walls, and quest branches',
      icon: Key,
      color: 'text-amber-400',
      query: 'Are there any missable questlines, hidden illusory walls, or rare secret items in my current area?' 
    },
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gradient-to-b from-[#0d0e14] via-[#090a0f] to-[#07070b] relative crt-grid">
      {/* Messages List Area */}
      <div 
        ref={chatContainerRef}
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
                Your dedicated AI companion for <strong className="text-white font-semibold">{activeGame?.name || activeTab?.name || 'PC Gaming'}</strong>. 
                Snap your screen to analyze puzzles, optimize stat synergies, or conquer legendary boss encounters.
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
                <span>Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded font-bold text-white">Ctrl + V</kbd> to paste game screenshots directly</span>
              </span>
            </div>
          </div>
        ) : (
          activeTab.messages.map((msg) => {
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
                        <img src={steamAvatar} alt="Avatar" className="w-5 h-5 rounded-full border border-white/20" />
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
                      <span className="font-fantasy font-bold text-zinc-200">QUEST COMPENDIUM</span>
                      <span className="px-1.5 py-0.2 rounded bg-white/10 text-[9.5px] text-zinc-400">
                        {msg.modelUsed || 'GEMINI 3.1 PRO'}
                      </span>
                      <span>•</span>
                      <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
                  {/* Screenshot Attachment Preview with Analysis Frame */}
                  {msg.imageUrl && (
                    <div className="mb-3 relative group overflow-hidden rounded-xl border border-white/20 bg-black/60">
                      <img
                        src={msg.imageUrl}
                        alt="Game Screenshot Analysis"
                        className="max-h-72 sm:max-h-96 w-auto rounded-xl object-contain cursor-pointer hover:scale-[1.01] transition-transform mx-auto"
                        onClick={() => onOpenScreenModal(msg.imageUrl!)}
                      />
                      <button
                        onClick={() => onOpenScreenModal(msg.imageUrl!)}
                        className="absolute bottom-2.5 right-2.5 px-3 py-1.5 rounded-lg bg-black/85 backdrop-blur-md text-xs font-mono text-white flex items-center gap-1.5 opacity-90 group-hover:opacity-100 hover:bg-black border border-white/20 shadow-lg cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5 text-[var(--accent-color)]" /> Full Resolution View
                      </button>
                    </div>
                  )}

                  {/* Message Body with Markdown */}
                  <div className="leading-relaxed break-words space-y-2.5 [&_p]:mb-2.5 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_strong]:text-white [&_strong]:font-semibold [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-[var(--accent-color)] [&_h1]:border-b [&_h1]:border-white/10 [&_h1]:pb-1 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-[var(--accent-color)] [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-white [&_code]:bg-black/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-purple-300 [&_code]:font-code [&_code]:text-xs [&_pre]:bg-black/80 [&_pre]:border [&_pre]:border-white/10 [&_pre]:p-3.5 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_table]:my-2 [&_th]:border [&_th]:border-white/15 [&_th]:p-2 [&_th]:bg-white/[0.06] [&_th]:font-semibold [&_th]:text-xs [&_td]:border [&_td]:border-white/10 [&_td]:p-2 [&_td]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--accent-color)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-zinc-400">
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
                        {/* Audio TTS button with animated wave indicator */}
                        <button
                          onClick={() => handlePlayTTS(msg.id, msg.text)}
                          title={isAudioPlaying ? "Stop Audio Narration" : "Read Aloud (Gemini Voice)"}
                          className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer text-xs font-medium ${
                            isAudioPlaying 
                              ? 'text-emerald-300 bg-emerald-500/20 border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.3)]' 
                              : 'text-zinc-400 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          {isAudioPlaying ? (
                            <>
                              <Square className="w-3 h-3 fill-current text-emerald-400" />
                              <div className="flex items-center gap-0.5 h-3">
                                <span className="w-0.5 bg-emerald-400 rounded-full animate-soundwave-1" />
                                <span className="w-0.5 bg-emerald-400 rounded-full animate-soundwave-2" />
                                <span className="w-0.5 bg-emerald-400 rounded-full animate-soundwave-3" />
                                <span className="w-0.5 bg-emerald-400 rounded-full animate-soundwave-4" />
                              </div>
                              <span className="text-[10px] font-mono">Narrating</span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline text-[11px]">Listen</span>
                            </>
                          )}
                        </button>

                        {/* Save to Notes Button */}
                        <button
                          onClick={() => handleSaveToNotes(msg.id, msg.text)}
                          title="Append this strategy to Playthrough Notes"
                          className="px-2 py-1 rounded-lg text-zinc-400 hover:text-purple-300 hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1"
                        >
                          {isNoteSaved ? (
                            <Check className="w-3.5 h-3.5 text-green-400" />
                          ) : (
                            <BookmarkPlus className="w-3.5 h-3.5" />
                          )}
                          <span className="hidden sm:inline text-[11px]">{isNoteSaved ? 'Saved!' : 'Save'}</span>
                        </button>

                        {/* Copy button */}
                        <button
                          onClick={() => handleCopyMessage(msg.id, msg.text)}
                          title="Copy Answer to Clipboard"
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
                </div>
              </div>
            );
          })
        )}

        {/* Animated 3D Levitating Tome Loader */}
        {isLoading && (
          <div className="flex items-center gap-3.5 p-4 rounded-2xl bg-[#11121a]/95 border border-[var(--accent-border)] w-fit select-none shadow-[0_8px_30px_rgba(0,0,0,0.5),0_0_20px_var(--accent-glow)]">
            <div className="animate-magical-flip">
              <svg 
                width="32" 
                height="32" 
                viewBox="0 0 32 32" 
                fill="none" 
                className="drop-shadow-[0_0_12px_var(--accent-glow)]"
              >
                <rect x="5" y="28" width="24" height="2" fill="#050508" opacity="0.7"/>
                <rect x="24" y="6" width="4" height="20" fill="#d9cdb4" />
                <rect x="8" y="4" width="16" height="24" fill="#140d24" />
                <rect x="15" y="12" width="2" height="8" fill="var(--accent-color)" />
                <rect x="13" y="14" width="6" height="4" fill="var(--accent-color)" />
                <rect x="14" y="14" width="4" height="4" fill="var(--accent-glow)" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="font-fantasy font-bold text-sm text-[var(--accent-color)] tracking-wide animate-pulse">
                Consulting the Quest Compendium...
              </span>
              <span className="text-[11px] text-zinc-400 font-sans">
                Synthesizing game vision frames, stat scaling & insightful guidance
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Screenshot Upload / Attached Thumbnail Preview Bar */}
      {attachedImage && (
        <div className="px-4 py-2.5 bg-[#12131c]/95 border-t border-white/10 flex items-center justify-between backdrop-blur-2xl">
          <div className="flex items-center gap-3">
            <div className="relative rounded-lg overflow-hidden border border-[var(--accent-border)] w-12 h-12 flex-shrink-0 shadow-md">
              <img src={attachedImage} alt="Attached screenshot" className="w-full h-full object-cover" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                Game Screenshot Attached
              </span>
              <span className="text-[11px] text-zinc-400">Ready for Gemini Multimodal Vision analysis</span>
            </div>
          </div>

          <button
            onClick={() => setAttachedImage(null)}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-red-500/20 text-zinc-400 hover:text-red-300 transition-colors cursor-pointer"
            title="Remove Screenshot"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Floating HUD Input Form Bar */}
      <form onSubmit={handleSubmit} className="p-3 sm:p-4 bg-[#0a0b10]/90 border-t border-white/[0.08] backdrop-blur-2xl">
        <div className="relative flex items-center rounded-2xl bg-[#13141d] border border-white/15 focus-within:border-[var(--accent-color)] focus-within:shadow-[0_0_20px_var(--accent-glow)] transition-all shadow-lg">
          <textarea
            value={inputQuestion}
            onChange={(e) => setInputQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              isRecording 
                ? "Listening to your inquiry..." 
                : attachedImage 
                  ? "Ask about this screenshot (e.g., puzzle answer, optimal route, stat comparison)..." 
                  : "Ask the Compendium (Shift+Enter for new line)..."
            }
            rows={1}
            className="flex-1 max-h-48 min-h-[72px] py-4 pl-4 pr-32 bg-transparent text-white outline-none resize-none"
          />

          {/* Action Buttons inside Input Bar */}
          <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">

            {/* Push to Talk / Voice Dictation */}
            <button
              type="button"
              onClick={toggleVoiceRecording}
              title={isRecording ? "Stop Voice Recording" : "Voice Input (Push to Talk)"}
              className={`p-2 rounded-xl transition-all cursor-pointer ${
                isRecording
                  ? 'bg-red-500/25 text-red-300 border border-red-500/40 animate-pulse shadow-[0_0_14px_rgba(239,68,68,0.5)]'
                  : 'text-zinc-400 hover:text-[var(--accent-color)] hover:bg-white/10'
              }`}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            {/* Submit Send Button */}
            <button
              type="submit"
              disabled={(!inputQuestion.trim() && !attachedImage) || isLoading}
              title="Consult Compendium"
              className="p-2.5 rounded-xl bg-[var(--accent-color)] text-black font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 hover:scale-105 active:scale-95 transition-all cursor-pointer shadow-[0_0_12px_var(--accent-glow)]"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
