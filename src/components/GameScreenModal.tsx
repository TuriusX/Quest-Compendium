import React from 'react';
import { X, Download, ZoomIn, Sparkles } from 'lucide-react';
import { playBlipSound } from '../utils/audio';

interface GameScreenModalProps {
  imageUrl: string | null;
  onClose: () => void;
  soundEnabled: boolean;
}

export const GameScreenModal: React.FC<GameScreenModalProps> = ({
  imageUrl,
  onClose,
  soundEnabled,
}) => {
  if (!imageUrl) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-lg flex items-center justify-center p-4">
      <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center">
        {/* Controls */}
        <div className="absolute -top-12 right-0 flex items-center gap-2">
          <a
            href={imageUrl}
            download="quest_compendium_game_screen.png"
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Download Screenshot"
          >
            <Download className="w-5 h-5" />
          </a>
          <button
            onClick={() => {
              playBlipSound(soundEnabled);
              onClose();
            }}
            className="p-2 rounded-lg bg-white/10 hover:bg-red-500/30 text-white transition-colors cursor-pointer"
            title="Close Fullscreen View"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Image Display */}
        <img
          src={imageUrl}
          alt="Examined Game Screenshot"
          className="max-w-full max-h-[85vh] object-contain rounded-xl border border-white/20 shadow-[0_0_40px_rgba(0,0,0,0.9)]"
        />
      </div>
    </div>
  );
};
