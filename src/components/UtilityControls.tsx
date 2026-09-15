import React from 'react';
import { Volume2, VolumeX, Settings, Maximize2 } from 'lucide-react';
import { PlatformType } from '../types/player';

interface UtilityControlsProps {
  volume: number;
  isMuted: boolean;
  platform: PlatformType;
  accentColor: string;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onPlatformChange: (p: PlatformType) => void;
  onOpenSettings: () => void;
  onToggleExpand: () => void;
}

export const UtilityControls: React.FC<UtilityControlsProps> = ({
  volume,
  isMuted,
  platform,
  accentColor,
  onVolumeChange,
  onToggleMute,
  onPlatformChange,
  onOpenSettings,
  onToggleExpand,
}) => {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 group" title={`Volume: ${volume}%`}>
        <button
          onClick={onToggleMute}
          className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
        >
          {isMuted || volume === 0 ? (
            <VolumeX className="w-3.5 h-3.5" />
          ) : (
            <Volume2 className="w-3.5 h-3.5" />
          )}
        </button>
        <div className="w-14 relative flex items-center">
          <div className="w-full h-1 bg-white/15 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: isMuted ? '0%' : `${volume}%`,
                backgroundColor: accentColor,
              }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={isMuted ? 0 : volume}
            onChange={(e) => onVolumeChange(parseInt(e.target.value, 10))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>
      </div>

      <div className="relative flex items-center bg-black/40 border border-white/10 rounded-md px-1.5 py-0.5">
        <select
          value={platform}
          onChange={(e) => onPlatformChange(e.target.value as PlatformType)}
          className="bg-transparent text-[11px] text-neutral-300 font-medium focus:outline-none cursor-pointer pr-1"
        >
          <option value="youtube-music" className="bg-neutral-900 text-white">YT Music</option>
          <option value="youtube" className="bg-neutral-900 text-white">YouTube</option>
          <option value="soundcloud" className="bg-neutral-900 text-white">SoundCloud</option>
        </select>
      </div>

      <button
        onClick={onOpenSettings}
        className="p-1 text-neutral-400 hover:text-white hover:rotate-45 transition-all cursor-pointer rounded-full"
        title="Cài đặt"
      >
        <Settings className="w-3.5 h-3.5" />
      </button>

      <button
        onClick={onToggleExpand}
        className="p-1 text-neutral-400 hover:text-white transition-colors cursor-pointer rounded-full"
        title="Mở rộng giao diện"
      >
        <Maximize2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};