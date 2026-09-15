import React from 'react';

interface VinylDiskProps {
  thumbnail?: string;
  isPlaying: boolean;
  spinEnabled: boolean;
  accentColor: string;
}

export const VinylDisk: React.FC<VinylDiskProps> = ({
  thumbnail,
  isPlaying,
  spinEnabled,
  accentColor,
}) => {
  const spinClass = spinEnabled && isPlaying ? 'animate-spin-slow' : '';

  return (
    <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
      <div
        className={`w-full h-full rounded-full p-[2px] shadow-lg transition-transform duration-500 overflow-hidden relative ${spinClass}`}
        style={{
          background: 'radial-gradient(circle, #2a2a2a 0%, #111111 60%, #000000 100%)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5), inset 0 0 4px rgba(255,255,255,0.1)',
        }}
      >
        <div className="absolute inset-0 rounded-full border border-white/5 pointer-events-none" />
        <div className="absolute inset-1 rounded-full border border-white/5 pointer-events-none" />
        <div className="absolute inset-2 rounded-full border border-white/5 pointer-events-none" />

        <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-zinc-800">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt="Track Thumbnail"
              className="w-full h-full object-cover select-none pointer-events-none"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-tr from-neutral-800 to-neutral-700 flex items-center justify-center text-xs text-neutral-400 font-bold">
              YT
            </div>
          )}
        </div>

        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border border-black/60 shadow-inner z-10"
          style={{ backgroundColor: accentColor }}
        >
          <div className="w-1.5 h-1.5 bg-black/80 rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
      </div>
    </div>
  );
};