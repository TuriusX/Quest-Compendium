import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Save, 
  Trash2, 
  Copy, 
  Check, 
  X, 
  Bold, 
  Italic, 
  List, 
  CheckSquare, 
  Sparkles, 
  Clock, 
  Download 
} from 'lucide-react';
import { GameTab } from '../types';
import { playBlipSound } from '../utils/audio';

interface PlaythroughNotepadProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: GameTab | null;
  onUpdateNotes: (notes: string) => void;
  soundEnabled: boolean;
}

export const PlaythroughNotepad: React.FC<PlaythroughNotepadProps> = ({
  isOpen,
  onClose,
  activeTab,
  onUpdateNotes,
  soundEnabled,
}) => {
  const gameName = activeTab?.name || 'Current Game';
  const initialNotes = activeTab?.notes || '';
  const [content, setContent] = useState(initialNotes);
  const [copied, setCopied] = useState(false);
  const [lastSaved, setLastSaved] = useState<string>('Just now');

  useEffect(() => {
    setContent(activeTab?.notes || '');
  }, [activeTab?.notes]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    onUpdateNotes(val);
    setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    playBlipSound(soundEnabled);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${gameName.toLowerCase().replace(/\s+/g, '_')}_playthrough_notes.txt`;
    a.click();
    URL.revokeObjectURL(url);
    playBlipSound(soundEnabled);
  };

  const insertFormatting = (prefix: string, suffix: string = '') => {
    const textarea = document.getElementById('notepad-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end) || 'note';
    const replacement = `${prefix}${selectedText}${suffix}`;

    const newContent = content.substring(0, start) + replacement + content.substring(end);
    setContent(newContent);
    onUpdateNotes(newContent);
    playBlipSound(soundEnabled);
  };

  const insertTimestamp = () => {
    const timestamp = `\n[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] `;
    insertFormatting(timestamp, '');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#0c0d14] border border-white/15 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_30px_var(--accent-glow)] flex flex-col h-[80vh] max-h-[700px] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-white/[0.08] flex items-center justify-between bg-black/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
              <FileText className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h3 className="font-fantasy font-bold text-sm tracking-wider text-white">
                PLAYTHROUGH GRIMOIRE & QUEST LOG
              </h3>
              <p className="text-[11px] text-zinc-400 font-mono">
                {gameName} • Auto-saved ({lastSaved})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleExport}
              title="Export as Text File"
              className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={handleCopy}
              title="Copy All Notes"
              className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-4 py-2 border-b border-white/[0.08] bg-black/30 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1">
            <button
              onClick={() => insertFormatting('**', '**')}
              title="Bold"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => insertFormatting('*', '*')}
              title="Italic"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => insertFormatting('\n- ')}
              title="Bullet Point"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => insertFormatting('\n- [ ] ')}
              title="Quest Checkbox"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <CheckSquare className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={insertTimestamp}
              title="Insert Timestamp"
              className="px-2.5 py-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 font-mono text-[11px] flex items-center gap-1 cursor-pointer"
            >
              <Clock className="w-3 h-3" /> Timestamp
            </button>
          </div>

          <button
            onClick={() => {
              if (confirm('Clear all notes for this game?')) {
                setContent('');
                onUpdateNotes('');
              }
            }}
            className="text-[11px] text-red-400/80 hover:text-red-300 flex items-center gap-1 cursor-pointer px-2 py-1 rounded hover:bg-red-500/10"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        </div>

        {/* Textarea */}
        <div className="flex-1 p-4 bg-[#0a0b10]/90">
          <textarea
            id="notepad-textarea"
            value={content}
            onChange={handleChange}
            placeholder={`Log your quest progress, puzzle solutions, build stats, and reminders for ${gameName}...`}
            className="w-full h-full bg-transparent text-zinc-200 text-sm font-sans leading-relaxed outline-none resize-none placeholder:text-zinc-600"
          />
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-white/10 bg-black/50 flex items-center justify-between text-xs text-zinc-400 font-mono">
          <span>{content.length} characters • {content.trim() ? content.trim().split(/\s+/).length : 0} words</span>
          <span className="flex items-center gap-1 text-[var(--accent-color)]">
            <Sparkles className="w-3 h-3" /> Real-time sync enabled
          </span>
        </div>
      </div>
    </div>
  );
};
