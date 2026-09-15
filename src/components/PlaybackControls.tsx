import React from 'react';
import { Shuffle, SkipBack, Play, Pause, SkipForward, Repeat, Repeat1 } from 'lucide-react';
import { LoopMode } from '../types/player';

interface ControlsProps {
  isPlaying: boolean;
  isShuffle: boolean;
  loopMode: LoopMode;
  accentColor: string;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleShuffle: () => void;
  onToggleLoop: () => void;
}

export const PlaybackControls: React.FC<ControlsProps> = ({
  isPlaying,
  isShuffle,
  loopMode,
  accentColor,
  onPlayPause,
  onNext,
  onPrev,
  onToggleShuffle,
  onToggleLoop,
}) => {
  return (
    <div className="flex items-center gap-1">
      {/* Shuffle */}
      <button
        onClick={onToggleShuffle}
        className="p-1 rounded-full text-neutral-400 hover:text-white transition-colors cursor-pointer"
        style={{ color: isShuffle ? accentColor : undefined }}
        title="Trộn bài"
      >
        <Shuffle className="w-3.5 h-3.5" />
      </button>

      {/* Prev */}
      <button
        onClick={onPrev}
        className="p-1 rounded-full text-neutral-300 hover:text-white transition-colors cursor-pointer"
        title="Bài trước"
      >
        <SkipBack className="w-4 h-4 fill-current" />
      </button>

      {/* Play/Pause */}
      <button
        onClick={onPlayPause}
        className="p-1.5 rounded-full text-white shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
        style={{ backgroundColor: accentColor }}
        title={isPlaying ? 'Tạm dừng' : 'Phát'}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 fill-current ml-0.5" />
        )}
      </button>

      {/* Next */}
      <button
        onClick={onNext}
        className="p-1 rounded-full text-neutral-300 hover:text-white transition-colors cursor-pointer"
        title="Bài tiếp"
      >
        <SkipForward className="w-4 h-4 fill-current" />
      </button>

      {/* Loop */}
      <button
        onClick={onToggleLoop}
        className="p-1 rounded-full text-neutral-400 hover:text-white transition-colors cursor-pointer"
        style={{ color: loopMode !== 'none' ? accentColor : undefined }}
        title="Lặp lại"
      >
        {loopMode === 'one' ? (
          <Repeat1 className="w-3.5 h-3.5" />
        ) : (
          <Repeat className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
};
