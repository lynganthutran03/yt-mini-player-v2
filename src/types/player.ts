export type PlatformType = 'youtube-music' | 'youtube' | 'soundcloud';

export type LoopMode = 'none' | 'all' | 'one';

export interface TrackInfo {
  title: string;
  artist: string;
  album?: string;
  thumbnail: string;
  duration: number; // in seconds
  currentTime: number; // in seconds
  isPlaying: boolean;
  volume: number; // 0 - 100
  isMuted: boolean;
  isShuffle: boolean;
  loopMode: LoopMode;
}

export interface PlayerSettings {
  theme: 'dark' | 'light' | 'glass';
  accentColor: string;
  enableVinylSpin: boolean;
  enableCustomThumb: boolean;
  customThumbUrl?: string;
  enableIdleMode: boolean;
  idleTimeout: number; // in seconds
  idleImageUrl?: string;
}
