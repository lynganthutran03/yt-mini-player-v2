import React from 'react';

interface TrackInfoViewProps {
  title: string;
  artist: string;
  album?: string;
  platformName: string;
}

export const TrackInfoView: React.FC<TrackInfoViewProps> = ({
  title,
  artist,
  album,
  platformName,
}) => {
  return (
    <div className="flex-1 min-w-0 flex flex-col justify-center select-none overflow-hidden px-1">
      <div
        className="text-[13px] font-semibold text-white truncate tracking-wide leading-tight hover:text-red-400 transition-colors cursor-default"
        title={title || 'Chưa phát nhạc'}
      >
        {title || 'Đang chờ phát nhạc...'}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 truncate mt-0.5">
        <span className="truncate">{artist || platformName}</span>
        {album && (
          <>
            <span className="text-neutral-600 font-bold">•</span>
            <span className="truncate text-neutral-500">{album}</span>
          </>
        )}
      </div>
    </div>
  );
};
