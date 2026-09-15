import React from 'react';

interface ProgressBarProps {
  currentTime: number;
  duration: number;
  accentColor: string;
  onSeek: (seconds: number) => void;
}

const formatTime = (secs: number) => {
  if (isNaN(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  currentTime,
  duration,
  accentColor,
  onSeek,
}) => {
  const percent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="flex items-center gap-2 w-full text-[10px] text-neutral-400 font-mono select-none px-1">
      <span className="w-7 text-right">{formatTime(currentTime)}</span>
      <div className="relative flex-1 flex items-center group h-4 cursor-pointer">
        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden relative">
          <div
            className="h-full rounded-full transition-all duration-100"
            style={{
              width: `${percent}%`,
              backgroundColor: accentColor,
            }}
          />
        </div>

        <div
          className="absolute w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none -translate-x-1/2"
          style={{
            left: `${percent}%`,
          }}
        />

        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          step="any"
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
      <span className="w-7 text-left">{formatTime(duration)}</span>
    </div>
  );
};